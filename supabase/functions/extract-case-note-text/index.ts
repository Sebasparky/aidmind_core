/**
 * extract-case-note-text
 *
 * Extracts text from uploaded case-note files stored in the
 * `review-documents` Supabase Storage bucket.
 *
 * For text-based files (.txt, .md): reads content directly.
 * For binary documents (.pdf, .docx): proxies to a Google Cloud Run
 * extraction service via CASE_NOTE_EXTRACTOR_URL.
 *
 * Authorization:
 *   - The caller must present a valid Supabase user JWT (Authorization: Bearer).
 *   - `storage_path` must match `<tenant_id>/<session_id>/<review_document_id>.<ext>`.
 *   - The caller must be a member (`tenant_users`) of the tenant in the path.
 *   Storage is read with the service role only AFTER these checks pass.
 *
 * Part of the Guidance Phase 2 pipeline.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { logEyeEvent } from "../_shared/eye.ts";
import {
  isPathWithinMemberTenants,
  parseReviewDocumentPath,
  sessionIdMatchesPath,
} from "../_shared/storage-path-authorization.ts";
import { requireUser } from "../_shared/require-user.ts";

const SERVICE_NAME = "extract-case-note-text";
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB
const STORAGE_BUCKET = "review-documents";

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { success: false, error: "Method not allowed" });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { success: false, error: "Invalid JSON body" });
  }

  // ── Authenticate caller (user JWT required; active profile; tenant membership) ──
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const auth = await requireUser(req, supabase);
  if (!auth.ok) return json(auth.status, { success: false, error: auth.error });

  // ── Validate storage path shape ──────────────────────────
  if (!body.storage_path || typeof body.storage_path !== "string" || body.storage_path.trim().length === 0) {
    return json(400, { success: false, error: "storage_path is required" });
  }
  const parsedPath = parseReviewDocumentPath(body.storage_path);
  if (!parsedPath) {
    return json(400, { success: false, error: "storage_path is not a valid review document path" });
  }
  if (!sessionIdMatchesPath(parsedPath, body.session_id)) {
    return json(400, { success: false, error: "session_id does not match storage_path" });
  }
  const storagePath = parsedPath.normalizedPath;

  const mimeType = (body.mime_type as string) || "application/octet-stream";
  const sessionId = parsedPath.sessionId;

  // ── Authorize: caller must belong to the tenant in the path ──
  if (!isPathWithinMemberTenants(parsedPath, auth.caller.tenantIds)) {
    // Deliberately indistinguishable from "not found" to avoid confirming object existence.
    return json(404, { success: false, error: "File not found in storage" });
  }

  // ── Download file from storage (service role, post-authorization) ──
  const { data: fileData, error: downloadErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .download(storagePath);

  if (downloadErr || !fileData) {
    console.error(`[${SERVICE_NAME}] Download error:`, downloadErr?.message);
    return json(404, {
      success: false,
      error: "File not found in storage",
    });
  }

  const fileBytes = await fileData.arrayBuffer();
  if (fileBytes.byteLength > MAX_FILE_BYTES) {
    return json(400, {
      success: false,
      error: `File exceeds maximum size (${MAX_FILE_BYTES / (1024 * 1024)} MB)`,
    });
  }

  // ── Text-based files: extract directly ───────────────────
  const isTextFile =
    mimeType === "text/plain" ||
    mimeType === "text/markdown" ||
    storagePath.endsWith(".txt") ||
    storagePath.endsWith(".md");

  if (isTextFile) {
    const decoder = new TextDecoder("utf-8");
    const text = decoder.decode(fileBytes);

    try {
      await logEyeEvent(supabase, {
        session_id: sessionId,
        event_type: "case_note.text_extracted",
        serviceName: SERVICE_NAME,
        payload: {
          result: "success",
          source: "direct_text",
          storage_path: storagePath,
          char_count: text.length,
        },
      });
    } catch { /* eye fire-and-forget */ }

    return json(200, {
      success: true,
      text,
      char_count: text.length,
      extraction_method: "direct_text",
    });
  }

  // ── Binary files: proxy to Cloud Run extraction service ──
  const extractorUrl = Deno.env.get("CASE_NOTE_EXTRACTOR_URL");
  if (!extractorUrl) {
    console.error(`[${SERVICE_NAME}] CASE_NOTE_EXTRACTOR_URL not configured`);
    return json(503, {
      success: false,
      error: "Text extraction service is not configured. Server-side extraction for PDF/DOCX files is unavailable.",
      extraction_method: "cloud_run_unavailable",
    });
  }

  try {
    // Send file to Cloud Run extraction service
    const formData = new FormData();
    const blob = new Blob([fileBytes], { type: mimeType });
    const filename = storagePath.split("/").pop() || "document";
    formData.append("file", blob, filename);
    formData.append("mime_type", mimeType);

    const extractResponse = await fetch(`${extractorUrl}/extract`, {
      method: "POST",
      body: formData,
      headers: {
        // Use the kick secret for service-to-service auth if configured
        ...(Deno.env.get("KB_EXTRACTOR_KICK_SECRET")
          ? { "X-AIDMIND-KICK-SECRET": Deno.env.get("KB_EXTRACTOR_KICK_SECRET")! }
          : {}),
      },
    });

    if (!extractResponse.ok) {
      const errText = await extractResponse.text().catch(() => "unknown");
      console.error(
        `[${SERVICE_NAME}] Cloud Run extraction failed [${extractResponse.status}]: ${errText}`
      );
      return json(502, {
        success: false,
        error: `Text extraction service returned error (${extractResponse.status})`,
        extraction_method: "cloud_run",
      });
    }

    const extractResult = await extractResponse.json();
    const extractedText = extractResult.text || extractResult.content || "";

    if (!extractedText || typeof extractedText !== "string" || extractedText.trim().length === 0) {
      return json(200, {
        success: true,
        text: "",
        char_count: 0,
        extraction_method: "cloud_run",
        warning: "No text could be extracted from the document. It may be image-only or empty.",
      });
    }

    try {
      await logEyeEvent(supabase, {
        session_id: sessionId,
        event_type: "case_note.text_extracted",
        serviceName: SERVICE_NAME,
        payload: {
          result: "success",
          source: "cloud_run",
          storage_path: storagePath,
          char_count: extractedText.length,
          mime_type: mimeType,
        },
      });
    } catch { /* eye fire-and-forget */ }

    return json(200, {
      success: true,
      text: extractedText.trim(),
      char_count: extractedText.trim().length,
      extraction_method: "cloud_run",
    });
  } catch (err) {
    console.error(`[${SERVICE_NAME}] Extraction error:`, err);
    return json(502, {
      success: false,
      error: err instanceof Error ? err.message : "Text extraction failed",
      extraction_method: "cloud_run",
    });
  }
});
