// supabase/functions/upload-review-document/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { logEyeEvent } from "../_shared/eye.ts";

type JsonBody = Record<string, unknown>;

function json(status: number, body: JsonBody, extraHeaders: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders },
  });
}

function safeFilename(name: string) {
  // avoid weird paths / control chars
  return name.replace(/[^\w.\-() ]+/g, "_").slice(0, 180);
}

function inferExt(filename: string, mime: string) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (mime === "application/pdf") return "pdf";
  return "bin";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json(405, { success: false, error: "Method not allowed" });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceKey) {
      return json(500, { success: false, error: "Supabase env not configured" });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // Expect multipart/form-data with:
    // - session_id (uuid)
    // - file (pdf)
    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return json(400, { success: false, error: "Expected multipart/form-data" });
    }

    const form = await req.formData();
    const session_id = form.get("session_id");
    const file = form.get("file");

    if (typeof session_id !== "string" || !session_id) {
      return json(400, { success: false, error: "session_id is required" });
    }
    if (!(file instanceof File)) {
      return json(400, { success: false, error: "file is required" });
    }

    // 1) Load session (must have tenant_id)
    const { data: session, error: sessErr } = await supabase
      .from("sessions")
      .select("id, tenant_id, review_document_id")
      .eq("id", session_id)
      .maybeSingle();

    if (sessErr) return json(500, { success: false, error: `Failed to fetch session: ${sessErr.message}` });
    if (!session) return json(404, { success: false, error: "Session not found" });
    if (!session.tenant_id) return json(409, { success: false, error: "Session tenant_id is null" });

    const tenant_id: string = session.tenant_id;

    // 2) Create review_documents row first to get id
    const bucket = "review-documents";
    const originalFilename = safeFilename(file.name || "review.pdf");
    const mimeType = file.type || "application/octet-stream";
    const fileSizeBytes = file.size ?? null;

    const { data: reviewDoc, error: insertErr } = await supabase
      .from("review_documents")
      .insert({
        tenant_id,
        session_id,
        storage_bucket: bucket,
        storage_object_key: "", // filled after upload
        original_filename: originalFilename,
        mime_type: mimeType,
        file_size_bytes: fileSizeBytes,
        status: "uploading",
      })
      .select("*")
      .single();

    if (insertErr) {
      return json(500, { success: false, error: `DB insert failed: ${insertErr.message}` });
    }

    const review_document_id: string = reviewDoc.id;

    // 3) Upload to storage using deterministic key
    const ext = inferExt(originalFilename, mimeType);
    const objectKey = `${tenant_id}/${session_id}/${review_document_id}.${ext}`;

    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error: storageErr } = await supabase.storage
      .from(bucket)
      .upload(objectKey, bytes, {
        contentType: mimeType,
        upsert: true,
      });

    if (storageErr) {
      // mark row failed
      await supabase
        .from("review_documents")
        .update({ status: "failed", error: `Storage upload failed: ${storageErr.message}` })
        .eq("id", review_document_id);

      return json(500, { success: false, error: `Storage upload failed: ${storageErr.message}` });
    }

    // 4) Update review_documents with final storage key + status
    const { error: updateDocErr } = await supabase
      .from("review_documents")
      .update({
        storage_object_key: objectKey,
        status: "uploaded",
        error: null,
      })
      .eq("id", review_document_id);

    if (updateDocErr) {
      return json(500, { success: false, error: `DB update failed: ${updateDocErr.message}` });
    }

    // 5) Attach to session (NEW)
    const { error: sessionUpdateErr } = await supabase
      .from("sessions")
      .update({ review_document_id })
      .eq("id", session_id);

    if (sessionUpdateErr) {
      // do not delete file; just report
      return json(500, {
        success: false,
        error: `Uploaded file but failed to attach review_document_id to session: ${sessionUpdateErr.message}`,
        review_document_id,
      });
    }

    // 6) Eye event (best-effort)
    try {
      await logEyeEvent(supabase, session_id, "REVIEW_DOCUMENT_UPLOADED", {
        actor: "upload-review-document",
        review_document_id,
        tenant_id,
        storage_bucket: bucket,
        storage_object_key: objectKey,
        original_filename: originalFilename,
        mime_type: mimeType,
        file_size_bytes: fileSizeBytes,
      });
    } catch (e) {
      console.error("[upload-review-document] eye event failed:", e);
    }

    return json(200, {
      success: true,
      session_id,
      tenant_id,
      review_document_id,
      storage_bucket: bucket,
      storage_object_key: objectKey,
      original_filename: originalFilename,
      mime_type: mimeType,
      file_size_bytes: fileSizeBytes,
      status: "uploaded",
    });
  } catch (err) {
    console.error("[upload-review-document] error:", err);
    const payload =
      err instanceof Error
        ? { success: false, error: err.message, name: err.name, stack: err.stack }
        : { success: false, error: String(err) };

    return new Response(JSON.stringify(payload), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});