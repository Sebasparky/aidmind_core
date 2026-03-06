/**
 * run-reviewer Edge Function
 *
 * Accepts { session_id }, resolves the linked review_document,
 * downloads the PDF from Storage, extracts text, runs an LLM review,
 * and writes the structured report back to review_documents.
 *
 * Status lifecycle: uploaded → extracting → extracted → reviewing → completed | failed
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { logEyeEvent } from "../_shared/eye.ts";

// ── Constants ──────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PDF_BYTES = 50 * 1024 * 1024; // 50 MB hard cap for review docs
const MAX_EXTRACTED_CHARS = 120_000; // truncate before sending to LLM
const SERVICE_NAME = "run-reviewer";

// ── Helpers ────────────────────────────────────────────────────────────────

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errJson(status: number, code: string, message: string) {
  return json(status, { error: { code, message } });
}

/** Fire-and-forget eye event – failures must never break the pipeline */
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
    console.error(`[run-reviewer] eye event ${eventType} failed:`, e);
  }
}

/** Update review_documents row – thin wrapper */
async function updateReviewDoc(
  supabase: any,
  docId: string,
  fields: Record<string, unknown>,
) {
  const { error } = await supabase
    .from("review_documents")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", docId);
  if (error) throw new Error(`DB update review_documents failed: ${error.message}`);
}

// ── Text Extraction Layer ──────────────────────────────────────────────────
//
// ARCHITECTURE NOTE:
// The extraction step is intentionally isolated behind this helper so the
// team can later swap to a different strategy (external microservice,
// server-side pdfjs, Apache Tika, etc.) without touching the reviewer
// pipeline. The contract is:
//
//   Input:  raw PDF bytes (Uint8Array) + mime type
//   Output: { text: string; metadata: ExtractionMetadata }
//
// Current implementation: a lightweight Deno-native approach that sends the
// bytes to a simple in-process text decoder.  For PDFs this is a best-effort
// heuristic that works for born-digital / text-layer PDFs.  Scanned / image
// PDFs will return empty or low-quality text, which the pipeline handles
// gracefully (the review report will note completeness issues).
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
 * This parses raw PDF bytes looking for text stream objects.
 * It is NOT a full PDF parser – it handles most born-digital PDFs.
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

  // Attempt basic PDF text extraction from content streams
  let text = "";
  let pageCount: number | null = null;

  try {
    const raw = new TextDecoder("latin1").decode(fileBytes);

    // Count pages via /Type /Page entries (rough)
    const pageMatches = raw.match(/\/Type\s*\/Page(?!\s*s)/g);
    pageCount = pageMatches ? pageMatches.length : null;

    // Extract text between BT ... ET blocks (PDF text objects)
    const textBlocks: string[] = [];
    const btEtRegex = /BT\s([\s\S]*?)ET/g;
    let match: RegExpExecArray | null;
    while ((match = btEtRegex.exec(raw)) !== null) {
      const block = match[1];
      // Extract parenthesised text strings: (Hello World)
      const parenRegex = /\(([^)]*)\)/g;
      let pMatch: RegExpExecArray | null;
      while ((pMatch = parenRegex.exec(block)) !== null) {
        if (pMatch[1].trim()) textBlocks.push(pMatch[1]);
      }
      // Extract hex strings: <48656C6C6F>
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
    // Return empty text – the pipeline will handle this gracefully
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
        ? "No text extracted – PDF may be image-only or encrypted. Consider using a full PDF parser."
        : null,
    },
  };
}

// ── Reviewer Prompt ────────────────────────────────────────────────────────

const REVIEWER_SYSTEM_PROMPT = `You are AidMind Reviewer, a compliance and quality reviewer for social-services case documentation.

You analyze a completed case document and produce a STRUCTURED REVIEW REPORT identifying concrete issues.

ISSUE CATEGORIES:
- completeness: Missing required fields, incomplete sections, gaps in documentation
- policy_language: Language that conflicts with policy requirements, prohibited terms, incorrect terminology
- tone: Unprofessional, judgmental, or emotionally charged language
- bias: Assumptions, stereotypes, stigmatizing language, or subjective judgments without evidence
- consistency: Internal contradictions, conflicting information, logical inconsistencies

SEVERITY LEVELS:
- "low": Minor issue, may want to address
- "medium": Should address before finalising
- "high": Must address — critical compliance or quality risk

STRICT RULES:
1. Produce ONLY a JSON report. No markdown, no commentary.
2. Do NOT rewrite or suggest replacement text.
3. Keep excerpts short (≤ 30 words).
4. Suggestions must be actionable and specific.
5. Focus on concrete, identifiable issues — not vague impressions.
6. If the document is well-written and compliant, return zero issues.

OUTPUT SCHEMA (return ONLY this JSON):
{
  "summary": {
    "overall_risk": "low" | "medium" | "high",
    "key_findings": ["finding 1", "finding 2"]
  },
  "issues": [
    {
      "type": "completeness | policy_language | tone | bias | consistency",
      "severity": "low | medium | high",
      "excerpt": "short excerpt from the document",
      "explanation": "why this is a problem",
      "suggestion": "how to fix it"
    }
  ],
  "metrics": {
    "issue_count": <int>,
    "high_severity_count": <int>
  }
}

No additional keys. No markdown fences. No commentary outside the JSON.`;

// ── Output Validation ──────────────────────────────────────────────────────

const VALID_ISSUE_TYPES = new Set(["completeness", "policy_language", "tone", "bias", "consistency"]);
const VALID_SEVERITIES = new Set(["low", "medium", "high"]);

function validateReviewReport(parsed: unknown): parsed is {
  summary: { overall_risk: string; key_findings: string[] };
  issues: Array<{ type: string; severity: string; excerpt: string; explanation: string; suggestion: string }>;
  metrics: { issue_count: number; high_severity_count: number };
} {
  if (typeof parsed !== "object" || parsed === null) return false;
  const obj = parsed as Record<string, unknown>;

  // summary
  if (typeof obj.summary !== "object" || obj.summary === null) return false;
  const summary = obj.summary as Record<string, unknown>;
  if (!VALID_SEVERITIES.has(summary.overall_risk as string)) return false;
  if (!Array.isArray(summary.key_findings)) return false;

  // issues
  if (!Array.isArray(obj.issues)) return false;
  for (const issue of obj.issues) {
    if (typeof issue !== "object" || issue === null) return false;
    const i = issue as Record<string, unknown>;
    if (!VALID_ISSUE_TYPES.has(i.type as string)) return false;
    if (!VALID_SEVERITIES.has(i.severity as string)) return false;
    if (typeof i.excerpt !== "string") return false;
    if (typeof i.explanation !== "string") return false;
    if (typeof i.suggestion !== "string") return false;
  }

  // metrics
  if (typeof obj.metrics !== "object" || obj.metrics === null) return false;
  const metrics = obj.metrics as Record<string, unknown>;
  if (typeof metrics.issue_count !== "number") return false;
  if (typeof metrics.high_severity_count !== "number") return false;

  return true;
}

// ── Main Handler ───────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return errJson(405, "METHOD_NOT_ALLOWED", "POST only");

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const openaiKey = Deno.env.get("OPENAI_API_KEY");

  if (!openaiKey) return errJson(500, "CONFIG_ERROR", "OPENAI_API_KEY not configured");

  const supabase = createClient(supabaseUrl, serviceKey);

  // ── Parse & validate input ───────────────────────────────────────────────

  let body: { session_id?: string };
  try {
    body = await req.json();
  } catch {
    return errJson(400, "INVALID_JSON", "Request body must be valid JSON");
  }

  const { session_id } = body;
  if (!session_id || typeof session_id !== "string" || !UUID_RE.test(session_id)) {
    return errJson(400, "INVALID_SESSION_ID", "session_id is required and must be a valid UUID");
  }

  // We'll track the review_document_id so the catch block can mark it failed
  let reviewDocId: string | null = null;

  try {
    // ── 1. Fetch session ─────────────────────────────────────────────────

    const { data: session, error: sessErr } = await supabase
      .from("sessions")
      .select("id, tenant_id, review_document_id")
      .eq("id", session_id)
      .maybeSingle();

    if (sessErr) throw new Error(`DB error fetching session: ${sessErr.message}`);
    if (!session) return errJson(404, "SESSION_NOT_FOUND", "Session not found");
    if (!session.review_document_id) {
      return errJson(409, "NO_REVIEW_DOCUMENT", "Session has no review_document_id attached");
    }
    if (!session.tenant_id) {
      return errJson(409, "NO_TENANT", "Session has no tenant_id");
    }

    reviewDocId = session.review_document_id;

    // ── 2. Fetch review document ─────────────────────────────────────────

    const { data: doc, error: docErr } = await supabase
      .from("review_documents")
      .select("*")
      .eq("id", reviewDocId)
      .maybeSingle();

    if (docErr) throw new Error(`DB error fetching review document: ${docErr.message}`);
    if (!doc) return errJson(404, "REVIEW_DOC_NOT_FOUND", "Review document not found");

    // Tenant guard
    if (doc.tenant_id !== session.tenant_id) {
      return errJson(403, "TENANT_MISMATCH", "Review document tenant does not match session tenant");
    }

    if (!doc.storage_bucket || !doc.storage_object_key) {
      return errJson(409, "MISSING_STORAGE_INFO", "Review document has no storage location");
    }

    // ── 3. Eye: started ──────────────────────────────────────────────────

    await eye(supabase, session_id, "review_document.review_started", {
      review_document_id: reviewDocId,
      tenant_id: session.tenant_id,
    });

    // ── 4. Resolve extracted text ────────────────────────────────────────
    //
    // upload-review-document now extracts text at upload time.
    // If extracted_text is already populated, skip re-extraction.
    // Otherwise fall back to downloading and extracting here.

    let extractedText: string | null = doc.extracted_text ?? null;

    if (extractedText && extractedText.trim().length > 0) {
      // Text already available from upload — skip extraction
      console.log(`[run-reviewer] Using pre-extracted text (${extractedText.length} chars)`);
    } else {
      // Fallback: extract from storage (legacy docs or empty extraction)
      await updateReviewDoc(supabase, reviewDocId, { status: "extracting", error: null });

      const { data: fileData, error: dlErr } = await supabase.storage
        .from(doc.storage_bucket)
        .download(doc.storage_object_key);

      if (dlErr || !fileData) {
        throw new Error(`Storage download failed: ${dlErr?.message ?? "empty response"}`);
      }

      const fileBytes = new Uint8Array(await fileData.arrayBuffer());

      if (fileBytes.length === 0) throw new Error("Downloaded file is empty");
      if (fileBytes.length > MAX_PDF_BYTES) {
        throw new Error(`File too large (${fileBytes.length} bytes, max ${MAX_PDF_BYTES})`);
      }

      const extraction = await extractReviewDocumentText(fileBytes, doc.mime_type);

      await updateReviewDoc(supabase, reviewDocId, {
        status: "extracted",
        extracted_text: extraction.text || null,
        extraction_metadata: extraction.metadata,
      });

      extractedText = extraction.text;

      if (!extractedText || extractedText.trim().length === 0) {
        throw new Error(
          "No text could be extracted from the PDF. The document may be image-only or encrypted. " +
          "A full PDF parser or OCR service is required."
        );
      }
    }

    // ── 7. Status → reviewing ────────────────────────────────────────────

    await updateReviewDoc(supabase, reviewDocId, { status: "reviewing" });

    // ── 8. Call OpenAI ───────────────────────────────────────────────────

    const textForReview = extraction.text.length > MAX_EXTRACTED_CHARS
      ? extraction.text.slice(0, MAX_EXTRACTED_CHARS)
      : extraction.text;

    const llmResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          { role: "system", content: REVIEWER_SYSTEM_PROMPT },
          {
            role: "user",
            content: `Review the following completed case document and produce a structured review report.\n\nDOCUMENT TEXT:\n${textForReview}`,
          },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!llmResponse.ok) {
      const errText = await llmResponse.text();
      throw new Error(`OpenAI API error ${llmResponse.status}: ${errText.slice(0, 300)}`);
    }

    const llmData = await llmResponse.json();
    const rawContent = llmData?.choices?.[0]?.message?.content;

    if (!rawContent || typeof rawContent !== "string") {
      throw new Error("OpenAI response missing message content");
    }

    // ── 9. Parse & validate report ───────────────────────────────────────

    let report: unknown;
    try {
      report = JSON.parse(rawContent);
    } catch {
      throw new Error("LLM output is not valid JSON");
    }

    if (!validateReviewReport(report)) {
      throw new Error("LLM output does not match expected review report schema");
    }

    // ── 10. Persist results & complete ───────────────────────────────────

    const reviewMeta = {
      reviewed_at: new Date().toISOString(),
      model: "gpt-4o-mini",
      input_char_count: textForReview.length,
      reviewer_version: "1.0.0",
    };

    await updateReviewDoc(supabase, reviewDocId, {
      status: "completed",
      reviewer_model: "gpt-4o-mini",
      review_report: report,
      review_metadata: reviewMeta,
      error: null,
    });

    // ── 11. Eye: completed ───────────────────────────────────────────────

    await eye(supabase, session_id, "review_document.review_completed", {
      review_document_id: reviewDocId,
      tenant_id: session.tenant_id,
      issue_count: (report as any).metrics.issue_count,
      high_severity_count: (report as any).metrics.high_severity_count,
      overall_risk: (report as any).summary.overall_risk,
    });

    return json(200, {
      success: true,
      review_document_id: reviewDocId,
      status: "completed",
      review_report: report as Record<string, unknown>,
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[run-reviewer] error:", message);

    // Mark doc as failed if we have an id
    if (reviewDocId) {
      try {
        await updateReviewDoc(supabase, reviewDocId, {
          status: "failed",
          error: message.slice(0, 1000),
        });
      } catch (e2) {
        console.error("[run-reviewer] failed to mark doc as failed:", e2);
      }
    }

    await eye(supabase, session_id, "review_document.review_failed", {
      review_document_id: reviewDocId,
      reason: message.slice(0, 250),
    });

    return errJson(500, "REVIEWER_FAILED", message.slice(0, 500));
  }
});
