import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { logEyeEvent } from "../_shared/eye.ts";

interface SelectTemplateRequest {
  session_id?: string;
  template_id?: string;
  template_version?: string;
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { success: false, error: "Method not allowed" });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let payload: SelectTemplateRequest;
  try {
    payload = await req.json();
  } catch {
    return json(400, { success: false, error: "Invalid JSON body" });
  }

  const { session_id, template_id, template_version } = payload;

  if (!session_id) return json(400, { success: false, error: "session_id is required" });
  if (!template_id) return json(400, { success: false, error: "template_id is required" });

  try {
    // 1. Fetch session
    const { data: session, error: sessionErr } = await supabase
      .from("sessions")
      .select("id, tenant_id, status, metadata")
      .eq("id", session_id)
      .maybeSingle();

    if (sessionErr) throw new Error(`Failed to fetch session: ${sessionErr.message}`);
    if (!session) return json(404, { success: false, error: "Session not found" });

    // 2. Status gate
    if (session.status !== "initialized") {
      return json(409, {
        success: false,
        error: `Invalid status: expected "initialized", got "${session.status}"`,
      });
    }

    // 3. Fetch template
    const { data: template, error: templateErr } = await supabase
      .from("kb_templates")
      .select("id, tenant_id, name, version, content_hash, is_active, extraction_status")
      .eq("id", template_id)
      .maybeSingle();

    if (templateErr) throw new Error(`Failed to fetch template: ${templateErr.message}`);
    if (!template) return json(404, { success: false, error: "Template not found" });

    // 4. Template validations
    if (template.tenant_id !== session.tenant_id) {
      return json(403, { success: false, error: "Template does not belong to this tenant" });
    }
    if (!template.is_active) {
      return json(409, { success: false, error: "Template is not active" });
    }
    if (template.extraction_status !== "ready") {
      return json(409, {
        success: false,
        error: `Template extraction not ready (status: "${template.extraction_status}")`,
      });
    }

    // 5. Optional version check
    if (template_version !== undefined && template_version !== template.version) {
      return json(409, {
        success: false,
        error: `Version mismatch: expected "${template_version}", got "${template.version}"`,
      });
    }

    // 6. Update session
    const mergedMetadata = {
      ...(session.metadata ?? {}),
      template_snapshot: {
        template_id: template.id,
        name: template.name,
        version: template.version,
        content_hash: template.content_hash,
      },
    };

    const { error: updateErr } = await supabase
      .from("sessions")
      .update({
        template_id: template.id,
        status: "template_selected",
        metadata: mergedMetadata,
      })
      .eq("id", session_id);

    if (updateErr) throw new Error(`Failed to update session: ${updateErr.message}`);

    // 7. Eye event
    await logEyeEvent(supabase, session_id, "TEMPLATE_SELECTED", {
      actor: "select-template",
      template_id: template.id,
      template_name: template.name,
      template_version: template.version,
    });

    // 8. Response
    return json(200, {
      success: true,
      session_id,
      status: "template_selected",
      template: {
        id: template.id,
        name: template.name,
        version: template.version,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[select-template] error:", message);
    return json(500, { success: false, error: message });
  }
});
