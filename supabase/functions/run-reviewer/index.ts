/**
 * run-reviewer Edge Function
 *
 * Accepts { session_id }, resolves the linked review_document,
 * reads pre-extracted text from review_documents.extracted_text,
 * runs an LLM review, and writes the structured report back.
 *
 * Text extraction is handled upstream by upload-review-document.
 * This function does NOT download PDFs or perform extraction.
 *
 * Status transitions: extracted → reviewing → completed | failed
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { logEyeEvent } from "../_shared/eye.ts";

// ── Constants ──────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_EXTRACTED_CHARS = 120_000; // truncate before sending to LLM
const MIN_TEXT_LENGTH = 50; // minimum chars to attempt review
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

/** Update review_documents row */
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
2. Do NOT rewrite any text from the document.
3. Do NOT suggest replacement text or alternative wording.
4. Do NOT recommend wording changes.
5. Do NOT act like an editor — you are an auditor.
6. Do NOT provide suggestions of any kind.
7. Only identify and explain issues found in the document.
8. Keep excerpts short (≤ 30 words).
9. Focus on concrete, identifiable issues — not vague impressions.
10. If the document is well-written and compliant, return zero issues.

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
      "explanation": "why this is problematic"
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
  issues: Array<{ type: string; severity: string; excerpt: string; explanation: string }>;
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
      .select("id, tenant_id, status, extracted_text, extraction_metadata")
      .eq("id", reviewDocId)
      .maybeSingle();

    if (docErr) throw new Error(`DB error fetching review document: ${docErr.message}`);
    if (!doc) return errJson(404, "REVIEW_DOC_NOT_FOUND", "Review document not found");

    // Tenant guard
    if (doc.tenant_id !== session.tenant_id) {
      return errJson(403, "TENANT_MISMATCH", "Review document tenant does not match session tenant");
    }

    // ── 3. Validate extracted_text ───────────────────────────────────────

    const extractedText = doc.extracted_text;

    if (!extractedText || typeof extractedText !== "string" || extractedText.trim().length === 0) {
      throw new Error("No extracted text available for review. Ensure upload-review-document completed extraction successfully.");
    }

    if (extractedText.trim().length < MIN_TEXT_LENGTH) {
      throw new Error(
        `Extracted text too short for meaningful review (${extractedText.trim().length} chars, minimum ${MIN_TEXT_LENGTH}). ` +
        "The document may be image-only or extraction may have failed."
      );
    }

    // ── 4. Eye: started ──────────────────────────────────────────────────

    await eye(supabase, session_id, "review_document.review_started", {
      review_document_id: reviewDocId,
      tenant_id: session.tenant_id,
      input_char_count: extractedText.length,
    });

    // ── 5. Status → reviewing ────────────────────────────────────────────

    await updateReviewDoc(supabase, reviewDocId, { status: "reviewing", error: null });

    // ── 6. Call OpenAI ───────────────────────────────────────────────────

    const textForReview = extractedText.length > MAX_EXTRACTED_CHARS
      ? extractedText.slice(0, MAX_EXTRACTED_CHARS)
      : extractedText;

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

    // ── 7. Parse & validate report ───────────────────────────────────────

    let report: unknown;
    try {
      report = JSON.parse(rawContent);
    } catch {
      throw new Error("LLM output is not valid JSON");
    }

    if (!validateReviewReport(report)) {
      throw new Error("LLM output does not match expected review report schema");
    }

    // ── 8. Persist results & complete ────────────────────────────────────

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

    // ── 9. Eye: completed ────────────────────────────────────────────────

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
