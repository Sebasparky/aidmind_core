/**
 * run-reviewer v2 Edge Function
 *
 * Accepts a TRANSIENT structured reviewer payload:
 *   - document_text (raw extracted text, NOT persisted)
 *   - structured_answers (schema-aware field recovery results)
 *   - unanswered_fields / human_review_fields
 *
 * Runs an LLM reviewer that JUDGES the structured packet.
 * Only the final review report is persisted (optionally).
 *
 * Privacy: source text is never stored. Only report metadata is written.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { logEyeEvent } from "../_shared/eye.ts";

// ── Constants ──────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DOC_TEXT_CHARS = 120_000;
const MIN_DOC_TEXT_CHARS = 50;
const MAX_STRUCTURED_ANSWERS = 200;
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

// ── Reviewer v2 Prompt ─────────────────────────────────────────────────────

const REVIEWER_V2_SYSTEM_PROMPT = `You are AidMind Reviewer, a compliance and quality auditor for social-services case documentation.

You receive a STRUCTURED REVIEW PACKET containing:
1. "document_text" — the raw extracted text from a completed case document
2. "structured_answers" — a list of template fields with recovered answers (some may be missing)
3. "unanswered_fields" — fields where no answer was recovered from the document
4. "human_review_fields" — fields flagged as requiring manual human verification

Your job is to AUDIT this packet for quality and compliance issues.

ISSUE CATEGORIES:
- completeness: Missing required fields, incomplete sections, gaps in documentation. USE the structured_answers and unanswered_fields to identify these efficiently.
- policy_language: Language that conflicts with policy requirements, prohibited terms, incorrect terminology. USE the document_text for this.
- tone: Unprofessional, judgmental, or emotionally charged language. USE the document_text for this.
- bias: Assumptions, stereotypes, stigmatizing language, or subjective judgments without evidence. USE the document_text for this.
- consistency: Internal contradictions between structured answers, conflicting information, logical inconsistencies. USE both structured_answers and document_text.

SEVERITY LEVELS:
- "low": Minor issue, may want to address
- "medium": Should address before finalising
- "high": Must address — critical compliance or quality risk

EFFICIENCY RULES:
1. For COMPLETENESS checks: primarily use structured_answers + unanswered_fields. These tell you exactly what was and wasn't filled in.
2. For TONE/BIAS/POLICY checks: scan the document_text for problematic language.
3. For CONSISTENCY checks: cross-reference structured_answers against each other and against document_text.
4. human_review_fields are fields that require manual verification (e.g., SSNs, IDs). Flag them as informational but do NOT treat their absence as a completeness failure.

STRICT RULES:
1. Produce ONLY a JSON report. No markdown, no commentary.
2. Do NOT rewrite any text from the document.
3. Do NOT suggest replacement text or alternative wording.
4. Do NOT act like an editor — you are an auditor.
5. Do NOT provide suggestions of any kind.
6. Only identify and explain issues found.
7. Keep excerpts short (≤ 30 words).
8. Focus on concrete, identifiable issues — not vague impressions.
9. If the document is well-written and compliant, return zero issues.
10. When reporting completeness issues, include the field_key in the issue.

OUTPUT SCHEMA (return ONLY this JSON):
{
  "summary": {
    "overall_risk": "low" | "medium" | "high",
    "key_findings": ["finding 1", "finding 2"],
    "fields_reviewed": <int>,
    "fields_missing": <int>,
    "fields_human_review": <int>
  },
  "issues": [
    {
      "type": "completeness | policy_language | tone | bias | consistency",
      "severity": "low | medium | high",
      "excerpt": "short excerpt from the document (if applicable)",
      "explanation": "why this is problematic",
      "field_key": "optional — the field this relates to"
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

function validateReviewReport(parsed: unknown): boolean {
  if (typeof parsed !== "object" || parsed === null) return false;
  const obj = parsed as Record<string, unknown>;

  if (typeof obj.summary !== "object" || obj.summary === null) return false;
  const summary = obj.summary as Record<string, unknown>;
  if (!VALID_SEVERITIES.has(summary.overall_risk as string)) return false;
  if (!Array.isArray(summary.key_findings)) return false;

  if (!Array.isArray(obj.issues)) return false;
  for (const issue of obj.issues) {
    if (typeof issue !== "object" || issue === null) return false;
    const i = issue as Record<string, unknown>;
    if (!VALID_ISSUE_TYPES.has(i.type as string)) return false;
    if (!VALID_SEVERITIES.has(i.severity as string)) return false;
    if (typeof i.excerpt !== "string") return false;
    if (typeof i.explanation !== "string") return false;
  }

  if (typeof obj.metrics !== "object" || obj.metrics === null) return false;
  const metrics = obj.metrics as Record<string, unknown>;
  if (typeof metrics.issue_count !== "number") return false;
  if (typeof metrics.high_severity_count !== "number") return false;

  return true;
}

// ── Input validation ──────────────────────────────────────────────────────

interface StructuredAnswer {
  field_key: string;
  label: string;
  answer: string | null;
  recovery_confidence: string;
  missing: boolean;
  requires_human_review: boolean;
}

interface V2Body {
  session_id: string;
  template_id?: string;
  phase2_schema_id?: string;
  document_text: string;
  structured_answers?: StructuredAnswer[];
  unanswered_fields?: Array<{ field_key: string; label: string }>;
  human_review_fields?: Array<{ field_key: string; label: string; reason: string }>;
}

function validateV2Body(body: unknown): body is V2Body {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;

  if (typeof b.session_id !== "string") return false;
  if (typeof b.document_text !== "string") return false;

  if (b.structured_answers !== undefined && !Array.isArray(b.structured_answers)) return false;
  if (b.unanswered_fields !== undefined && !Array.isArray(b.unanswered_fields)) return false;
  if (b.human_review_fields !== undefined && !Array.isArray(b.human_review_fields)) return false;

  return true;
}

// ── Build LLM user message ────────────────────────────────────────────────

function buildUserMessage(body: V2Body): string {
  const parts: string[] = [];

  parts.push("Review the following completed case document.\n");

  // Structured answers summary
  if (body.structured_answers && body.structured_answers.length > 0) {
    parts.push("STRUCTURED FIELD ANSWERS (recovered from document):");
    for (const a of body.structured_answers) {
      if (a.requires_human_review) continue; // handled separately
      const status = a.missing ? "[MISSING]" : `[${a.recovery_confidence}]`;
      const val = a.answer || "(blank)";
      parts.push(`  ${status} ${a.label}: ${val}`);
    }
    parts.push("");
  }

  // Unanswered fields
  if (body.unanswered_fields && body.unanswered_fields.length > 0) {
    parts.push("UNANSWERED FIELDS (not found in document):");
    for (const f of body.unanswered_fields) {
      parts.push(`  - ${f.label}`);
    }
    parts.push("");
  }

  // Human review fields
  if (body.human_review_fields && body.human_review_fields.length > 0) {
    parts.push("HUMAN-REVIEW-ONLY FIELDS (require manual verification, do NOT flag as missing):");
    for (const f of body.human_review_fields) {
      parts.push(`  - ${f.label}: ${f.reason}`);
    }
    parts.push("");
  }

  // Raw document text
  parts.push("DOCUMENT TEXT:");
  const docText = body.document_text.length > MAX_DOC_TEXT_CHARS
    ? body.document_text.slice(0, MAX_DOC_TEXT_CHARS)
    : body.document_text;
  parts.push(docText);

  return parts.join("\n");
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errJson(400, "INVALID_JSON", "Request body must be valid JSON");
  }

  // ── V2 path: transient structured payload ────────────────────────────────

  if (!validateV2Body(body)) {
    return errJson(400, "INVALID_PAYLOAD", "Missing required fields: session_id, document_text");
  }

  const v2 = body as V2Body;

  // Validate session_id format
  if (!UUID_RE.test(v2.session_id)) {
    return errJson(400, "INVALID_SESSION_ID", "session_id must be a valid UUID");
  }

  // Validate document_text length
  if (v2.document_text.trim().length < MIN_DOC_TEXT_CHARS) {
    return errJson(400, "TEXT_TOO_SHORT", `document_text must be at least ${MIN_DOC_TEXT_CHARS} characters`);
  }

  // Cap structured_answers
  if (v2.structured_answers && v2.structured_answers.length > MAX_STRUCTURED_ANSWERS) {
    return errJson(400, "TOO_MANY_FIELDS", `structured_answers exceeds max of ${MAX_STRUCTURED_ANSWERS}`);
  }

  try {
    // ── 1. Verify session exists ─────────────────────────────────────────

    const { data: session, error: sessErr } = await supabase
      .from("sessions")
      .select("id, tenant_id")
      .eq("id", v2.session_id)
      .maybeSingle();

    if (sessErr) throw new Error(`DB error: ${sessErr.message}`);
    if (!session) return errJson(404, "SESSION_NOT_FOUND", "Session not found");
    if (!session.tenant_id) return errJson(409, "NO_TENANT", "Session has no tenant_id");

    // ── 2. Eye: started ──────────────────────────────────────────────────

    await eye(supabase, v2.session_id, "reviewer_v2.started", {
      tenant_id: session.tenant_id,
      doc_text_length: v2.document_text.length,
      structured_answers_count: v2.structured_answers?.length ?? 0,
      unanswered_count: v2.unanswered_fields?.length ?? 0,
      human_review_count: v2.human_review_fields?.length ?? 0,
      has_schema: !!v2.phase2_schema_id,
    });

    // ── 3. Build LLM message ─────────────────────────────────────────────

    const userMessage = buildUserMessage(v2);

    // ── 4. Call OpenAI ───────────────────────────────────────────────────

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
          { role: "system", content: REVIEWER_V2_SYSTEM_PROMPT },
          { role: "user", content: userMessage },
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

    // ── 5. Parse & validate report ───────────────────────────────────────

    let report: unknown;
    try {
      report = JSON.parse(rawContent);
    } catch {
      throw new Error("LLM output is not valid JSON");
    }

    if (!validateReviewReport(report)) {
      throw new Error("LLM output does not match expected review report schema");
    }

    // ── 6. Eye: completed ────────────────────────────────────────────────

    const reportObj = report as Record<string, any>;

    await eye(supabase, v2.session_id, "reviewer_v2.completed", {
      tenant_id: session.tenant_id,
      issue_count: reportObj.metrics.issue_count,
      high_severity_count: reportObj.metrics.high_severity_count,
      overall_risk: reportObj.summary.overall_risk,
    });

    // ── 7. Return report (NOT persisted — transient) ─────────────────────

    return json(200, {
      success: true,
      review_report: reportObj,
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[run-reviewer] error:", message);

    await eye(supabase, v2.session_id, "reviewer_v2.failed", {
      reason: message.slice(0, 250),
    });

    return errJson(500, "REVIEWER_FAILED", message.slice(0, 500));
  }
});
