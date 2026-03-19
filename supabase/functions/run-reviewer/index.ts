/**
 * run-reviewer v2.2 Edge Function — reconciliation-aware
 *
 * Accepts a TRANSIENT structured reviewer payload with:
 *   - document_text: raw text for tone/bias/policy-language review
 *   - structured_answers: ALL recovered fields for completeness/consistency
 *   - review_worthy_answers: only authored-text fields for tone/bias analysis
 *   - unanswered_fields / human_review_fields
 *   - reconciliation_context (optional): structured comparison data
 *
 * Post-processing deduplicates overlapping completeness issues.
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

// ── Reviewer v2.2 Prompt (reconciliation-aware) ────────────────────────────

const REVIEWER_V2_SYSTEM_PROMPT = `You are AidMind Reviewer, a compliance and quality auditor for social-services case documentation.

You receive a STRUCTURED REVIEW PACKET containing:
1. "review_worthy_answers" — short-answer and free-text fields containing AUTHORED LANGUAGE. These are your PRIMARY targets for tone, bias, and policy-language analysis.
2. "structured_answers" — ALL recovered field values (including checkbox, categorical, boolean, number, date). Use these primarily for COMPLETENESS and CONSISTENCY checks.
3. "unanswered_fields" — fields where no answer was recovered.
4. "human_review_fields" — fields requiring manual human verification (do NOT flag as missing).
5. "document_text" — raw document text as backup context.
6. "reconciliation_context" (when present) — structured comparison between case notes and the completed form. USE THIS to make smarter decisions:
   - "confirmed_fields": fields that match between notes and form — do NOT flag these as completeness issues.
   - "likely_corrections": fields where the form corrected/refined what was in notes — these are intentional changes, NOT errors.
   - "discrepancies": fields where notes and form genuinely differ — report these as CONSISTENCY issues, not completeness issues.
   - "omissions": fields present in notes but missing from the final form — these are legitimate completeness concerns.

ISSUE CATEGORIES — STRICT DEFINITIONS:

- completeness: ONLY for missing required fields, incomplete sections, blank required items. Do NOT flag fields that are confirmed as present in reconciliation. Report ONE issue per missing field.

- consistency: ONLY for genuine contradictions or logical conflicts. Also use for reconciliation discrepancies where notes and form genuinely differ. Do NOT use for tone or wording issues.

- tone: For unprofessional, judgmental, emotionally charged, blaming, shaming, or condescending language in AUTHORED text.

- bias: For stigmatizing language, unsupported assumptions, stereotypes, subjective labels presented as fact in AUTHORED text.

- policy_language: For prohibited terminology, incorrect policy terms, wording that conflicts with policy standards in AUTHORED text.

CRITICAL CATEGORIZATION RULES:
1. If the issue is about HOW something is worded (judgmental, emotional, unprofessional), it is TONE — never consistency.
2. If the issue is about ASSUMPTIONS or STEREOTYPES, it is BIAS — never consistency.
3. CONSISTENCY requires TWO conflicting data points. A single problematic phrase is never a consistency issue.
4. Do NOT analyze checkbox/categorical/boolean/number/date fields for tone or bias.
5. Focus tone/bias/policy-language analysis on review_worthy_answers and document_text only.

RECONCILIATION-AWARE RULES (when reconciliation_context is provided):
1. Do NOT flag confirmed_fields as completeness issues — they are verified present.
2. Do NOT flag likely_corrections as errors — they are intentional refinements.
3. DO flag discrepancies as consistency issues with an explanation of what differs.
4. DO flag omissions as completeness issues.
5. When reconciliation_context has template_parse_confidence = "low", add a caveat about parsing uncertainty.

COMPLETENESS RULES:
1. Report exactly ONE issue per missing field.
2. Do NOT create grouped issues that bundle multiple missing fields.
3. Do NOT create an issue for a field already covered by another completeness issue.
4. human_review_fields are intentionally excluded — do NOT flag their absence.

CONFIDENCE RULES:
1. Treat low-confidence recovered values cautiously — note uncertainty.
2. When recovery is weak, use raw document_text as backup reference.

SEVERITY LEVELS:
- "low": Minor issue, may want to address
- "medium": Should address before finalising
- "high": Must address — critical compliance or quality risk

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
10. When reporting completeness issues, include the field_key.

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

// ── Completeness Issue Deduplication ────────────────────────────────────────

interface ReviewIssue {
  type: string;
  severity: string;
  excerpt: string;
  explanation: string;
  field_key?: string;
}

function dedupeCompletenessIssues(issues: ReviewIssue[]): ReviewIssue[] {
  const completeness = issues.filter((i) => i.type === "completeness");
  const others = issues.filter((i) => i.type !== "completeness");

  if (completeness.length <= 1) return issues;

  const coveredFieldKeys = new Set<string>();
  const perFieldIssues: ReviewIssue[] = [];
  const groupedIssues: ReviewIssue[] = [];

  for (const issue of completeness) {
    if (issue.field_key && issue.field_key.trim().length > 0) {
      if (coveredFieldKeys.has(issue.field_key)) continue;
      coveredFieldKeys.add(issue.field_key);
      perFieldIssues.push(issue);
    } else {
      groupedIssues.push(issue);
    }
  }

  const coveredLabels = perFieldIssues
    .map((i) => i.field_key?.replace(/_/g, " ").toLowerCase() ?? "")
    .filter(Boolean);

  const survivingGrouped = groupedIssues.filter((gi) => {
    const explanation = gi.explanation.toLowerCase();
    const mentionedCount = coveredLabels.filter((label) => explanation.includes(label)).length;
    return mentionedCount < 2;
  });

  return [...others, ...perFieldIssues, ...survivingGrouped];
}

function recalcMetrics(report: Record<string, any>): void {
  const issues = report.issues as ReviewIssue[];
  report.metrics = {
    issue_count: issues.length,
    high_severity_count: issues.filter((i) => i.severity === "high").length,
  };
}

// ── Input types ───────────────────────────────────────────────────────────

interface StructuredAnswer {
  field_key: string;
  label: string;
  answer: string | null;
  recovery_confidence: string;
  recovery_method?: string;
  matching_mode?: string;
  review_relevance?: string;
  missing: boolean;
  requires_human_review: boolean;
}

interface ReconciliationContext {
  reconciliation_summary?: {
    matches: number;
    mismatches: number;
    likely_corrections: number;
    possible_discrepancies: number;
    likely_omissions: number;
    unresolved: number;
    template_parse_confidence: string;
  };
  confirmed_fields?: string[];
  likely_corrections?: Array<{ field_key: string; notes: string | null; form: string | null }>;
  discrepancies?: Array<{ field_key: string; notes: string | null; form: string | null; section: string }>;
  omissions?: Array<{ field_key: string; notes_value: string | null; section: string }>;
}

interface V2Body {
  session_id: string;
  template_id?: string;
  phase2_schema_id?: string;
  document_text: string;
  structured_answers?: StructuredAnswer[];
  review_worthy_answers?: StructuredAnswer[];
  unanswered_fields?: Array<{ field_key: string; label: string; review_relevance?: string }>;
  human_review_fields?: Array<{ field_key: string; label: string; reason: string }>;
  reconciliation_context?: ReconciliationContext;
}

function validateV2Body(body: unknown): body is V2Body {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  if (typeof b.session_id !== "string") return false;
  if (typeof b.document_text !== "string") return false;
  if (b.structured_answers !== undefined && !Array.isArray(b.structured_answers)) return false;
  if (b.review_worthy_answers !== undefined && !Array.isArray(b.review_worthy_answers)) return false;
  if (b.unanswered_fields !== undefined && !Array.isArray(b.unanswered_fields)) return false;
  if (b.human_review_fields !== undefined && !Array.isArray(b.human_review_fields)) return false;
  return true;
}

// ── Build LLM user message ────────────────────────────────────────────────

function buildUserMessage(body: V2Body): string {
  const parts: string[] = [];

  parts.push("Review the following completed case document.\n");

  // Reconciliation context (highest priority framing)
  if (body.reconciliation_context) {
    const rc = body.reconciliation_context;
    parts.push("RECONCILIATION CONTEXT (comparison between case notes and completed form):");
    if (rc.reconciliation_summary) {
      const s = rc.reconciliation_summary;
      parts.push(`  Parse confidence: ${s.template_parse_confidence}`);
      parts.push(`  Matches: ${s.matches}, Corrections: ${s.likely_corrections}, Discrepancies: ${s.possible_discrepancies}, Omissions: ${s.likely_omissions}, Unresolved: ${s.unresolved}`);
    }
    if (rc.confirmed_fields && rc.confirmed_fields.length > 0) {
      parts.push(`  CONFIRMED FIELDS (present in both notes and form — do NOT flag): ${rc.confirmed_fields.join(", ")}`);
    }
    if (rc.likely_corrections && rc.likely_corrections.length > 0) {
      parts.push("  LIKELY CORRECTIONS (form intentionally refined from notes — NOT errors):");
      for (const c of rc.likely_corrections.slice(0, 15)) {
        parts.push(`    ${c.field_key}: notes="${(c.notes || "").slice(0, 40)}" → form="${(c.form || "").slice(0, 40)}"`);
      }
    }
    if (rc.discrepancies && rc.discrepancies.length > 0) {
      parts.push("  DISCREPANCIES (notes and form genuinely differ — report as CONSISTENCY issues):");
      for (const d of rc.discrepancies.slice(0, 15)) {
        parts.push(`    ${d.field_key} [${d.section}]: notes="${(d.notes || "").slice(0, 40)}" ≠ form="${(d.form || "").slice(0, 40)}"`);
      }
    }
    if (rc.omissions && rc.omissions.length > 0) {
      parts.push("  OMISSIONS (in notes but missing from form — report as COMPLETENESS issues):");
      for (const o of rc.omissions.slice(0, 15)) {
        parts.push(`    ${o.field_key} [${o.section}]: "${(o.notes_value || "").slice(0, 50)}"`);
      }
    }
    parts.push("");
  }

  // Review-worthy answers
  const reviewWorthy = body.review_worthy_answers ?? [];
  if (reviewWorthy.length > 0) {
    parts.push("REVIEW-WORTHY ANSWERS (authored text — check for tone, bias, policy language):");
    for (const a of reviewWorthy) {
      if (a.requires_human_review) continue;
      const conf = a.recovery_confidence === "low" ? " [low confidence]" : "";
      const val = a.missing ? "(blank — not recovered)" : (a.answer || "(blank)");
      parts.push(`  ${a.label}: ${val}${conf}`);
    }
    parts.push("");
  }

  // Structured answers summary
  if (body.structured_answers && body.structured_answers.length > 0) {
    parts.push("ALL STRUCTURED FIELDS (for completeness and consistency checks only — do NOT review these for tone/bias):");
    for (const a of body.structured_answers) {
      if (a.requires_human_review) continue;
      const status = a.missing ? "[MISSING]" : `[${a.recovery_confidence}]`;
      const val = a.answer || "(blank)";
      parts.push(`  ${status} ${a.label}: ${val}`);
    }
    parts.push("");
  }

  // Unanswered fields
  if (body.unanswered_fields && body.unanswered_fields.length > 0) {
    parts.push("UNANSWERED FIELDS (not found in document — report ONE completeness issue per field):");
    for (const f of body.unanswered_fields) {
      parts.push(`  - ${f.label} (field_key: ${f.field_key})`);
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
  parts.push("DOCUMENT TEXT (backup context for tone/bias/policy-language review):");
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errJson(400, "INVALID_JSON", "Request body must be valid JSON");
  }

  if (!validateV2Body(body)) {
    return errJson(400, "INVALID_PAYLOAD", "Missing required fields: session_id, document_text");
  }

  const v2 = body as V2Body;

  if (!UUID_RE.test(v2.session_id)) {
    return errJson(400, "INVALID_SESSION_ID", "session_id must be a valid UUID");
  }

  if (v2.document_text.trim().length < MIN_DOC_TEXT_CHARS) {
    return errJson(400, "TEXT_TOO_SHORT", `document_text must be at least ${MIN_DOC_TEXT_CHARS} characters`);
  }

  if (v2.structured_answers && v2.structured_answers.length > MAX_STRUCTURED_ANSWERS) {
    return errJson(400, "TOO_MANY_FIELDS", `structured_answers exceeds max of ${MAX_STRUCTURED_ANSWERS}`);
  }

  try {
    const { data: session, error: sessErr } = await supabase
      .from("sessions")
      .select("id, tenant_id")
      .eq("id", v2.session_id)
      .maybeSingle();

    if (sessErr) throw new Error(`DB error: ${sessErr.message}`);
    if (!session) return errJson(404, "SESSION_NOT_FOUND", "Session not found");
    if (!session.tenant_id) return errJson(409, "NO_TENANT", "Session has no tenant_id");

    const hasReconciliation = !!v2.reconciliation_context;

    await eye(supabase, v2.session_id, "reviewer_v2.started", {
      tenant_id: session.tenant_id,
      doc_text_length: v2.document_text.length,
      structured_answers_count: v2.structured_answers?.length ?? 0,
      review_worthy_count: v2.review_worthy_answers?.length ?? 0,
      unanswered_count: v2.unanswered_fields?.length ?? 0,
      human_review_count: v2.human_review_fields?.length ?? 0,
      has_reconciliation: hasReconciliation,
      reconciliation_parse_confidence: v2.reconciliation_context?.reconciliation_summary?.template_parse_confidence ?? null,
    });

    const userMessage = buildUserMessage(v2);

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

    let report: unknown;
    try {
      report = JSON.parse(rawContent);
    } catch {
      throw new Error("LLM output is not valid JSON");
    }

    if (!validateReviewReport(report)) {
      throw new Error("LLM output does not match expected review report schema");
    }

    const reportObj = report as Record<string, any>;

    // Post-process: deduplicate completeness issues
    reportObj.issues = dedupeCompletenessIssues(reportObj.issues);
    recalcMetrics(reportObj);

    await eye(supabase, v2.session_id, "reviewer_v2.completed", {
      tenant_id: session.tenant_id,
      issue_count: reportObj.metrics.issue_count,
      high_severity_count: reportObj.metrics.high_severity_count,
      overall_risk: reportObj.summary.overall_risk,
      has_reconciliation: hasReconciliation,
    });

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
