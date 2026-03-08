import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logEyeEvent } from "../_shared/eye.ts";
import { buildCorsSecurityHeaders } from "../_shared/security-headers.ts";
import { validateUuid, validatePlainText } from "../_shared/input-validation.ts";

const MAX_TEMPLATE_SIZE = 20 * 1024 * 1024; // 20 MB

function json(req: Request, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...buildCorsSecurityHeaders(req), "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: buildCorsSecurityHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { success: false, error: "Method not allowed" });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── Parse multipart or JSON ──────────────────────────────────
  let sessionId: string | undefined;
  let templateId: string | undefined;
  let templateVersion: string | undefined;
  let templateName: string | undefined;
  let uploadFile: File | null = null;
  let templateContent: string | null = null;

  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    // Upload path: multipart with optional PDF
    const form = await req.formData();
    sessionId = form.get("session_id")?.toString();
    templateId = form.get("template_id")?.toString() || undefined;
    templateName = form.get("template_name")?.toString() || undefined;
    templateVersion = form.get("template_version")?.toString() || undefined;
    const fileField = form.get("template_upload");
    if (fileField instanceof File && fileField.size > 0) {
      uploadFile = fileField;
    }
    // Accept pre-extracted text from client-side PDF parsing
    const contentField = form.get("template_content")?.toString();
    if (contentField && contentField.trim().length > 0) {
      templateContent = contentField.trim();
    }
  } else {
    // JSON path: existing template selection
    try {
      const body = await req.json();
      sessionId = body.session_id;
      templateId = body.template_id;
      templateVersion = body.template_version;
      templateName = body.template_name;
    } catch {
      return json(req, 400, { success: false, error: "Invalid JSON body", code: "INVALID_JSON" });
    }
  }

  // ── Validate session_id ──────────────────────────────────────
  if (!sessionId) return json(req, 400, { success: false, error: "session_id is required", code: "SESSION_ID_REQUIRED" });

  const sessionIdResult = validateUuid("session_id", sessionId);
  if (!sessionIdResult.ok) {
    return json(req, 400, { success: false, error: "Invalid session_id format", code: "INVALID_SESSION_ID" });
  }

  // Must provide either template_id OR upload
  if (!templateId && !uploadFile) {
    return json(req, 400, { success: false, error: "Provide template_id or template_upload", code: "TEMPLATE_INPUT_REQUIRED" });
  }

  try {
    // ── 1. Fetch session ───────────────────────────────────────
    const { data: session, error: sessionErr } = await supabase
      .from("sessions")
      .select("id, tenant_id, status, metadata, user_id")
      .eq("id", sessionIdResult.value)
      .maybeSingle();

    if (sessionErr) throw new Error(`Failed to fetch session: ${sessionErr.message}`);
    if (!session) return json(req, 404, { success: false, error: "Session not found", code: "SESSION_NOT_FOUND" });

    const tenantId = session.tenant_id;
    if (!tenantId) return json(req, 400, { success: false, error: "Session has no tenant", code: "NO_TENANT" });

    // ── 2. Resolve template_id ─────────────────────────────────
    let resolvedTemplateId: string;
    let resolvedTemplateName: string;
    let resolvedTemplateVersion: string;

    if (uploadFile) {
      // ── Upload path ──────────────────────────────────────────
      if (uploadFile.type !== "application/pdf") {
        return json(req, 400, { success: false, error: "Only PDF files are accepted", code: "INVALID_FILE_TYPE" });
      }
      if (uploadFile.size > MAX_TEMPLATE_SIZE) {
        return json(req, 400, { success: false, error: "File exceeds 20MB limit", code: "FILE_TOO_LARGE" });
      }

      // Validate template_name if provided
      const safeName = templateName
        ? (() => {
            const r = validatePlainText("template_name", templateName, { maxLength: 100, minLength: 1 });
            return r.ok ? r.value : uploadFile.name.replace(/\.pdf$/i, "");
          })()
        : uploadFile.name.replace(/\.pdf$/i, "");

      // Generate safe storage path
      const fileId = crypto.randomUUID();
      const storagePath = `${tenantId}/${fileId}.pdf`;

      // Upload to storage
      const fileBytes = new Uint8Array(await uploadFile.arrayBuffer());
      const { error: uploadErr } = await supabase.storage
        .from("templates")
        .upload(storagePath, fileBytes, {
          contentType: "application/pdf",
          upsert: false,
        });

      if (uploadErr) throw new Error(`Failed to upload template: ${uploadErr.message}`);

      // Create kb_templates record
      const hasContent = !!templateContent && templateContent.length >= 10;
      const { data: newTemplate, error: insertErr } = await supabase
        .from("kb_templates")
        .insert({
          tenant_id: tenantId,
          name: safeName,
          version: "1.0",
          storage_path: storagePath,
          created_by: session.user_id,
          content: templateContent ?? "",
          content_type: "pdf",
          extraction_status: hasContent ? "ready" : "pending",
          is_active: true,
          metadata: {
            source: "upload",
            original_filename: uploadFile.name,
            content_char_count: templateContent?.length ?? 0,
            extraction_method: hasContent ? "client_pdfjs" : "none",
          },
        })
        .select("id, name, version, extraction_status")
        .single();

      if (insertErr) throw new Error(`Failed to create template record: ${insertErr.message}`);

      resolvedTemplateId = newTemplate.id;
      resolvedTemplateName = newTemplate.name;
      resolvedTemplateVersion = newTemplate.version;
    } else {
      // ── Existing template selection path ─────────────────────
      const tidResult = validateUuid("template_id", templateId);
      if (!tidResult.ok) {
        return json(400, { success: false, error: "Invalid template_id format", code: "INVALID_TEMPLATE_ID" });
      }

      const { data: template, error: templateErr } = await supabase
        .from("kb_templates")
        .select("id, tenant_id, name, version, content_hash, is_active, extraction_status")
        .eq("id", tidResult.value)
        .maybeSingle();

      if (templateErr) throw new Error(`Failed to fetch template: ${templateErr.message}`);
      if (!template) return json(404, { success: false, error: "Template not found", code: "TEMPLATE_NOT_FOUND" });

      // Tenant isolation
      if (template.tenant_id !== tenantId) {
        await logEyeEvent(supabase, {
          session_id: sessionIdResult.value,
          event_type: "template.selected",
          serviceName: "select-template",
          payload: { template_id: tidResult.value, result: "denied", reason_code: "TENANT_MISMATCH" },
        });
        return json(403, { success: false, error: "Template does not belong to this tenant", code: "TENANT_MISMATCH" });
      }

      if (!template.is_active) {
        return json(409, { success: false, error: "Template is not active", code: "TEMPLATE_INACTIVE" });
      }

      if (template.extraction_status !== "ready") {
        return json(409, {
          success: false,
          error: `Template extraction not ready (status: "${template.extraction_status}")`,
          code: "TEMPLATE_NOT_READY",
        });
      }

      // Optional version check
      if (templateVersion !== undefined && templateVersion !== template.version) {
        return json(409, {
          success: false,
          error: `Version mismatch: expected "${templateVersion}", got "${template.version}"`,
          code: "VERSION_MISMATCH",
        });
      }

      resolvedTemplateId = template.id;
      resolvedTemplateName = template.name;
      resolvedTemplateVersion = template.version;
    }

    // ── 3. Update session with template_id ─────────────────────
    const mergedMetadata = {
      ...(session.metadata ?? {}),
      template_snapshot: {
        template_id: resolvedTemplateId,
        name: resolvedTemplateName,
        version: resolvedTemplateVersion,
      },
    };

    const { error: updateErr } = await supabase
      .from("sessions")
      .update({
        template_id: resolvedTemplateId,
        status: "template_selected",
        metadata: mergedMetadata,
      })
      .eq("id", sessionIdResult.value);

    if (updateErr) throw new Error(`Failed to update session: ${updateErr.message}`);

    // ── 4. Eye event ───────────────────────────────────────────
    await logEyeEvent(supabase, {
      session_id: sessionIdResult.value,
      event_type: "template.selected",
      serviceName: "select-template",
      payload: {
        template_id: resolvedTemplateId,
        template_name: resolvedTemplateName,
        template_version: resolvedTemplateVersion,
        result: "success",
        source: uploadFile ? "upload" : "existing",
        extraction_status: uploadFile ? (templateContent ? "ready" : "pending") : "ready",
      },
    });

    // ── 5. Response ────────────────────────────────────────────
    return json(200, {
      success: true,
      session_id: sessionIdResult.value,
      template_id: resolvedTemplateId,
      status: "template_selected",
      template: {
        id: resolvedTemplateId,
        name: resolvedTemplateName,
        version: resolvedTemplateVersion,
        extraction_status: uploadFile ? (templateContent ? "ready" : "pending") : "ready",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[select-template] error:", message);
    return json(500, { success: false, error: message, code: "INTERNAL_ERROR" });
  }
});
