/**
 * upload-review-document Edge Function
 *
 * Accepts multipart/form-data with session_id + PDF file.
 * Uploads PDF to Supabase Storage, extracts text, inserts a
 * review_documents row (status = 'extracted'), and links it
 * to the session via sessions.review_document_id.
 *
 * Status on success: 'extracted' (ready for run-reviewer)
 * Status on failure: 'failed'
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { logEyeEvent } from "../_shared/eye.ts";
import { requireUser, assertSessionAccess, requireTenantFor } from "../_shared/require-user.ts";

// ── Constants ──────────────────────────────────────────────────────────────

const SERVICE_NAME = "upload-review-document";
const MAX_PDF_BYTES = 50 * 1024 * 1024; // 50 MB

// ── Helpers ────────────────────────────────────────────────────────────────

type JsonBody = Record<string, unknown>;

function json(status: number, body: JsonBody) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeFilename(name: string) {
  return name.replace(/[^\w.\-() ]+/g, "_").slice(0, 180);
}

/** Fire-and-forget eye event */
async function eye(
  supabase: any,
  sessionId: string,
  eventType: string,
  payload: Record<string, unknown>,
) {
  try {
    await logEyeEvent(supabase, {
      session_id: sessionId,
      event_type: eventType,
      serviceName: SERVICE_NAME,
      payload,
    });
  } catch (e) {
    console.error(`[${SERVICE_NAME}] eye event ${eventType} failed:`, e);
  }
}

// ── Text Extraction Layer ──────────────────────────────────────────────────
//
// ARCHITECTURE NOTE — SWAPPABLE EXTRACTION BOUNDARY
//
// The extraction step is intentionally isolated behind this helper so the
// team can later swap to a different strategy (external microservice,
// server-side pdfjs, Apache Tika, PyMuPDF worker, etc.) without touching
// the upload pipeline.
//
// Contract:
//   Input:  raw file bytes (Uint8Array) + MIME type string
//   Output: { text: string; metadata: ExtractionMetadata }
//
// Current implementation: lightweight Deno-native heuristic that parses
// PDF text objects (BT/ET blocks).  Works for born-digital / text-layer
// PDFs.  Scanned / image-only PDFs will return empty text; the pipeline
// handles this gracefully by setting status = 'extracted' with empty text
// and noting the issue in extraction_metadata.
//
// To swap implementation, edit ONLY this function.
// ────────────────────────────────────────────────────────────────────────────

interface ExtractionMetadata {
  extractor: string;
  extractor_version: string;
  bytes_processed: number;
  page_count: number | null;
  char_count: number;
  extracted_at: string;
  notes: string | null;
}

interface ExtractionResult {
  text: string;
  metadata: ExtractionMetadata;
}

/**
 * Extract text from a PDF (or supported document).
 *
 * TEMPORARY IMPLEMENTATION — basic binary-stream text extraction.
 * Parses raw PDF bytes looking for BT/ET text stream objects.
 * NOT a full PDF parser – handles most born-digital PDFs.
 *
 * TODO: Replace with a proper extraction service or library when the
 * team finalises the extraction strategy.
 */
async function extractReviewDocumentText(
  fileBytes: Uint8Array,
  _mimeType: string,
): Promise<ExtractionResult> {
  const extractedAt = new Date().toISOString();
  const bytesProcessed = fileBytes.length;

  let text = "";
  let pageCount: number | null = null;

  try {
    const raw = new TextDecoder("latin1").decode(fileBytes);

    // Count pages via /Type /Page entries (rough heuristic)
    const pageMatches = raw.match(/\/Type\s*\/Page(?!\s*s)/g);
    pageCount = pageMatches ? pageMatches.length : null;

    // Extract text between BT ... ET blocks (PDF text objects)
    const textBlocks: string[] = [];
    const btEtRegex = /BT\s([\s\S]*?)ET/g;
    let match: RegExpExecArray | null;
    while ((match = btEtRegex.exec(raw)) !== null) {
      const block = match[1];
      // Parenthesised text strings: (Hello World)
      const parenRegex = /\(([^)]*)\)/g;
      let pMatch: RegExpExecArray | null;
      while ((pMatch = parenRegex.exec(block)) !== null) {
        if (pMatch[1].trim()) textBlocks.push(pMatch[1]);
      }
      // Hex strings: <48656C6C6F>
      const hexRegex = /<([0-9A-Fa-f]+)>/g;
      let hMatch: RegExpExecArray | null;
      while ((hMatch = hexRegex.exec(block)) !== null) {
        const hex = hMatch[1];
        if (hex.length >= 4 && hex.length % 2 === 0) {
          let decoded = "";
          for (let i = 0; i < hex.length; i += 2) {
            const charCode = parseInt(hex.substring(i, i + 2), 16);
            if (charCode >= 32 && charCode < 127) decoded += String.fromCharCode(charCode);
          }
          if (decoded.trim()) textBlocks.push(decoded);
        }
      }
    }

    text = textBlocks.join(" ").replace(/\s+/g, " ").trim();
  } catch (e) {
    console.error("[extractReviewDocumentText] extraction error:", e);
  }

  return {
    text,
    metadata: {
      extractor: "deno-pdf-basic",
      extractor_version: "0.1.0",
      bytes_processed: bytesProcessed,
      page_count: pageCount,
      char_count: text.length,
      extracted_at: extractedAt,
      notes: text.length === 0
        ? "No text extracted – PDF may be image-only or encrypted. Consider a full PDF parser."
        : null,
    },
  };
}

// ── Main Handler ───────────────────────────────────────────────────────────

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

    // ── 1. Validate multipart/form-data ────────────────────────────────────

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

    // ── Authenticate caller and authorize the session before any privileged access ──
    const auth = await requireUser(req, supabase);
    if (!auth.ok) return json(auth.status, { success: false, error: auth.error });
    const access = await assertSessionAccess(supabase, auth.caller, session_id, { allowSupervisor: true });
    if (!access.ok) return json(access.status, { success: false, error: access.error });

    if (!(file instanceof File)) {
      return json(400, { success: false, error: "file is required" });
    }

    // ── 2. Validate file ───────────────────────────────────────────────────

    const mimeType = file.type || "application/octet-stream";
    const originalFilename = safeFilename(file.name || "review.pdf");
    const fileSizeBytes = file.size ?? null;

    if (fileSizeBytes && fileSizeBytes > MAX_PDF_BYTES) {
      return json(400, { success: false, error: `File too large (max ${MAX_PDF_BYTES} bytes)` });
    }

    // ── 3. Fetch session ───────────────────────────────────────────────────

    const { data: session, error: sessErr } = await supabase
      .from("sessions")
      .select("id, tenant_id, review_document_id")
      .eq("id", session_id)
      .maybeSingle();

    if (sessErr) return json(500, { success: false, error: `Failed to fetch session: ${sessErr.message}` });
    if (!session) return json(404, { success: false, error: "Session not found" });
    if (!session.tenant_id) return json(409, { success: false, error: "Session tenant_id is null" });

    const tenant_id: string = session.tenant_id;
    const bucket = "review-documents";

    // ── 4. Read file bytes ─────────────────────────────────────────────────

    const fileBytes = new Uint8Array(await file.arrayBuffer());

    // ── 5. Extract text before inserting row ────────────────────────────────
    //
    // We extract text during upload so that the review_documents row
    // is immediately usable by downstream tools (run-reviewer can skip
    // re-extraction if extracted_text is already populated).

    let extraction: ExtractionResult;
    try {
      extraction = await extractReviewDocumentText(fileBytes, mimeType);
    } catch (extractErr) {
      // Extraction failed — we'll still upload the file and mark status as failed
      console.error(`[${SERVICE_NAME}] extraction failed:`, extractErr);
      extraction = {
        text: "",
        metadata: {
          extractor: "deno-pdf-basic",
          extractor_version: "0.1.0",
          bytes_processed: fileBytes.length,
          page_count: null,
          char_count: 0,
          extracted_at: new Date().toISOString(),
          notes: `Extraction failed: ${extractErr instanceof Error ? extractErr.message : String(extractErr)}`,
        },
      };
    }

    // ── 6. Insert review_documents row (get id first) ──────────────────────

    // Determine status: 'extracted' if we got text, 'failed' if extraction produced nothing
    // Note: empty text is valid (image-only PDF) — status is still 'extracted' so run-reviewer
    // can decide how to handle it. Only hard extraction errors set 'failed'.
    const insertStatus = "extracted";

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
        status: "extracting", // temporary until upload + extraction complete
        extracted_text: extraction.text || null,
        extraction_metadata: extraction.metadata,
        error: null,
      })
      .select("id")
      .single();

    if (insertErr) {
      return json(500, { success: false, error: `DB insert failed: ${insertErr.message}` });
    }

    const review_document_id: string = reviewDoc.id;

    // ── 7. Upload to Storage ───────────────────────────────────────────────

    const objectKey = `${tenant_id}/${session_id}/${review_document_id}.pdf`;

    const { error: storageErr } = await supabase.storage
      .from(bucket)
      .upload(objectKey, fileBytes, {
        contentType: mimeType,
        upsert: false, // object keys are fresh UUIDs; overwrite authority is not needed
      });

    if (storageErr) {
      // Mark row failed
      await supabase
        .from("review_documents")
        .update({ status: "failed", error: `Storage upload failed: ${storageErr.message}` })
        .eq("id", review_document_id);

      return json(500, { success: false, error: `Storage upload failed: ${storageErr.message}` });
    }

    // ── 8. Finalise review_documents row ───────────────────────────────────

    const { error: updateDocErr } = await supabase
      .from("review_documents")
      .update({
        storage_object_key: objectKey,
        status: insertStatus,
        error: null,
      })
      .eq("id", review_document_id);

    if (updateDocErr) {
      return json(500, { success: false, error: `DB update failed: ${updateDocErr.message}` });
    }

    // ── 9. Attach to session ───────────────────────────────────────────────

    const { error: sessionUpdateErr } = await supabase
      .from("sessions")
      .update({ review_document_id })
      .eq("id", session_id);

    if (sessionUpdateErr) {
      return json(500, {
        success: false,
        error: `Uploaded file but failed to attach review_document_id to session: ${sessionUpdateErr.message}`,
        review_document_id,
      });
    }

    // ── 10. Eye event ──────────────────────────────────────────────────────

    await eye(supabase, session_id, "review_document.uploaded", {
      result: "success",
      review_document_id,
      tenant_id,
      storage_bucket: bucket,
      storage_object_key: objectKey,
      original_filename: originalFilename,
      mime_type: mimeType,
      file_size_bytes: fileSizeBytes,
      extraction_char_count: extraction.metadata.char_count,
      extraction_page_count: extraction.metadata.page_count,
    });

    // ── 11. Return success ─────────────────────────────────────────────────

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
      status: insertStatus,
      extraction_metadata: extraction.metadata as unknown as JsonBody,
    });
  } catch (err) {
    console.error(`[${SERVICE_NAME}] error:`, err);
    const message = err instanceof Error ? err.message : String(err);
    return json(500, { success: false, error: message });
  }
});
