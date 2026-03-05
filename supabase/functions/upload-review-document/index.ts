// supabase/functions/upload-review-document/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Json = Record<string, unknown>;

function json(status: number, body: Json, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}

// Minimal CORS (adjust origins if you want)
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BUCKET = "review-documents";

// Basic PDF validation
function assertPdf(file: File) {
  const name = (file.name ?? "").toLowerCase();
  const isPdfByType = file.type === "application/pdf";
  const isPdfByExt = name.endsWith(".pdf");

  // some browsers/clients may omit mime_type; accept extension as fallback
  if (!isPdfByType && !isPdfByExt) {
    throw new Error("Only PDF files are supported (application/pdf).");
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json(405, { success: false, error: "Method not allowed" }, corsHeaders);

  // IMPORTANT: This function expects multipart/form-data.
  // Supabase Dashboard "Invoke" currently sends JSON; use curl/Postman for file testing.
  const contentType = req.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return json(
      400,
      {
        success: false,
        error: "Expected multipart/form-data. (Use curl/Postman; Supabase Dashboard Invoke does not support file uploads.)",
      },
      corsHeaders,
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json(500, { success: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, corsHeaders);
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  let form: FormData;
  try {
    form = await req.formData();
  } catch (e) {
    console.error("[upload-review-document] formData parse error:", e);
    return json(400, { success: false, error: "Invalid multipart/form-data body" }, corsHeaders);
  }

  const session_id = form.get("session_id");
  const file = form.get("file");

  if (!session_id || typeof session_id !== "string") {
    return json(400, { success: false, error: "session_id (text) is required" }, corsHeaders);
  }
  if (!(file instanceof File)) {
    return json(400, { success: false, error: "file (PDF) is required" }, corsHeaders);
  }

  try {
    assertPdf(file);

    // 1) Load session to get tenant_id
    const { data: session, error: sessErr } = await supabase
      .from("sessions")
      .select("id, tenant_id")
      .eq("id", session_id)
      .maybeSingle();

    if (sessErr) throw new Error(`Failed to fetch session: ${sessErr.message}`);
    if (!session) return json(404, { success: false, error: "Session not found" }, corsHeaders);

    const tenant_id: string = session.tenant_id;

    // 2) Generate review_document_id first (Option B)
    const review_document_id = crypto.randomUUID();

    // Keep a stable, deterministic path
    const ext = "pdf";
    const storage_object_key = `${tenant_id}/${session_id}/${review_document_id}.${ext}`;

    // 3) Upload to storage first
    const bytes = new Uint8Array(await file.arrayBuffer());

    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(storage_object_key, bytes, {
        contentType: "application/pdf",
        upsert: false,
      });

    if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

    // 4) Insert the DB row ONCE (with our chosen id)
    const original_filename =
      (typeof file.name === "string" && file.name.trim().length > 0) ? file.name.trim() : "uploaded.pdf";

    const mime_type =
      (typeof file.type === "string" && file.type.trim().length > 0) ? file.type : "application/pdf";

    const file_size_bytes = Number.isFinite(file.size) ? Number(file.size) : null;

    const { error: insertErr } = await supabase.from("review_documents").insert({
      id: review_document_id,
      tenant_id,
      session_id,
      storage_bucket: BUCKET,
      storage_object_key,
      original_filename,
      mime_type,
      file_size_bytes,
      status: "uploaded",
      extracted_text: null,
      extraction_metadata: {},
      reviewer_model: null,
      review_report: null,
      review_metadata: {},
      error: null,
    });

    if (insertErr) {
      // Cleanup: remove uploaded file if DB insert fails
      await supabase.storage.from(BUCKET).remove([storage_object_key]);
      throw new Error(`DB insert failed: ${insertErr.message}`);
    }

    return json(
      200,
      {
        success: true,
        review_document_id,
        storage_bucket: BUCKET,
        storage_object_key,
        original_filename,
        mime_type,
        file_size_bytes,
        status: "uploaded",
      },
      corsHeaders,
    );
  } catch (err) {
    console.error("[upload-review-document] error:", err);

    const message = err instanceof Error ? err.message : String(err);
    return json(500, { success: false, error: message }, corsHeaders);
  }
});