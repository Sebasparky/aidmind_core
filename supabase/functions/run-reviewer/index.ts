/**
 * run-reviewer v3.1 Edge Function — language-first, reconciliation-aware
 *
 * Accepts a TRANSIENT structured reviewer payload with:
 *   - document_text: raw text for tone/bias/policy-language review
 *   - structured_answers: ALL recovered fields for completeness/consistency
 *   - review_worthy_answers: only authored-text fields for tone/bias analysis
 *   - unanswered_fields / human_review_fields
 *   - reconciliation_context (optional): structured comparison data
 *   - language_trigger_metadata (optional): category-level trigger counts (metadata only)
 *
 * v3.1 changes:
 *   - finding_track assigned server-side deterministically, not by model
 *   - Hybrid confidence/coverage: deterministic caps, LLM can only lower
 *   - unsupported_conclusion as first-class issue type
 *   - Authored-vs-quoted awareness in prompt
 *   - Stronger comparison noise suppression
 *   - Secondary findings cannot alone drive overall_risk to high
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

// ── Reviewer v3.1 System Prompt ────────────────────────────────────────────

const REVIEWER_V3_SYSTEM_PROMPT = `You are AidMind Reviewer, a LANGUAGE-FIRST auditor for social-services case documentation.

YOUR PRIMARY JOB is reviewing AUTHORED NARRATIVE TEXT for quality, professionalism, and compliance. You are NOT a form-completion verifier.

You receive a STRUCTURED REVIEW PACKET containing:
1. "review_worthy_answers" — AUTHORED TEXT FIELDS (narratives, comments, summaries, "specify" fields). These are your PRIMARY targets.
2. "structured_answers" — narrative-eligible recovered field values. Use for context only.
3. "unanswered_fields" — NARRATIVE FIELDS that appear blank. Only these qualify for completeness findings.
4. "human_review_fields" — fields requiring manual human verification (do NOT flag their absence).
5. "document_text" — raw document text for reviewing all authored narrative language for tone, bias, and policy compliance.
6. "reconciliation_context" (when present) — NARRATIVE-ONLY comparison between case notes and the completed form.

ISSUE CATEGORIES — STRICT DEFINITIONS:

- tone: For unprofessional, judgmental, emotionally charged, blaming, shaming, or condescending language in AUTHORED text. This is your highest-priority category.

- bias: For stigmatizing language, unsupported assumptions, stereotypes, or subjective labels presented as fact in AUTHORED text. Labeling a person rather than describing observable facts.

- unsupported_conclusion: For conclusions presented with more certainty than the evidence supports. Inference stated as fact. Mental-state claims stated as fact when only behavior was observed. Clinical or legal conclusions without documented basis. Intent or motive attributed without supporting evidence.

- policy_language: For prohibited terminology, incorrect policy terms, or wording that conflicts with policy standards in AUTHORED text.

- completeness: ONLY for NARRATIVE SECTIONS that appear blank, empty, or obviously insufficient. You may ONLY flag fields that appear in the unanswered_fields list. Do NOT flag checkbox, date, boolean, categorical, demographic, or administrative fields as missing. Report ONE issue per missing narrative field.

- consistency: ONLY for genuine narrative contradictions when reconciliation_context is provided. Use ONLY when notes and form narratives genuinely conflict in meaning. Do NOT use for structured field differences.

AUTHORED VS QUOTED — CRITICAL DISTINCTION:
You MUST distinguish between the caseworker's own authored language and quoted/attributed speech from clients, collaterals, or other sources.
- Quoted speech (in quotes, or following "client stated", "mother reported", "according to", etc.) should NOT be flagged for tone or bias UNLESS the caseworker adopts, amplifies, or presents that language uncritically as their own assessment.
- Example of safe quoting: 'Client stated "he is dangerous and should be locked up."' — The harsh language belongs to the client, not the caseworker. Do NOT flag.
- Example of adoption: 'The neighbor reported the mother is a mess, and based on this, the mother clearly cannot provide care.' — The caseworker adopted the neighbor's characterization and overclaimed. DO flag.

FINDING THRESHOLDS — STRICT:
Each finding MUST have:
1. A clear anchored text span (excerpt ≤ 30 words)
2. A clear risk category
3. An explanation DIRECTLY tied to that specific text
4. Enough confidence to avoid speculation

Prefer ZERO findings over weak, speculative, or vaguely-anchored findings. If you are uncertain, do not report it.

WHAT YOU MUST NOT DO:
1. Do NOT flag missing checkboxes, select-many values, dates, phone numbers, addresses, SSNs, booleans, or categorical fields.
2. Do NOT flag demographics, repeated person blocks, relationship matrices, or administrative markers.
3. Do NOT infer that a structured field is "missing" — you cannot reliably detect checkbox or categorical completeness from text.
4. Do NOT treat the absence of a date, number, or identifier as a completeness issue.
5. Do NOT analyze checkbox/categorical/boolean/number/date fields for tone or bias.
6. Do NOT produce any finding about a field type you cannot confidently verify from narrative text alone.
7. Do NOT flag quoted speech for tone/bias unless the caseworker adopts that language as their own assessment.
8. Do NOT produce vague or speculative findings without a clear anchored excerpt.

WHAT YOU SHOULD DO:
1. Focus deeply on the quality of AUTHORED NARRATIVE language.
2. Identify judgmental, biased, stigmatizing, or unprofessional phrasing — in the caseworker's voice specifically.
3. Flag unsupported conclusions: observations stated as fact, intent attributed without evidence, certainty stronger than evidence supports.
4. Flag policy-language violations in narrative text.
5. Note when major narrative sections (intake narrative, decision summary, reason for involvement) are blank.
6. When reconciliation shows narrative discrepancies, report them as consistency issues.
7. When in doubt between flagging and not flagging, prefer NO FINDING over a weak finding.

RECONCILIATION-AWARE RULES (when reconciliation_context is provided):
1. Do NOT flag confirmed_fields as completeness issues.
2. Do NOT flag likely_corrections as errors — they are intentional refinements.
3. DO flag narrative discrepancies as consistency issues with careful, measured language.
4. DO flag narrative omissions as completeness issues.
5. ALL reconciliation data has already been filtered to narrative fields only. Trust this filtering.

CONFIDENCE RULES:
1. Be conservative. If you are uncertain whether something is an issue, do not report it.
2. Prefer precision over recall — fewer, more accurate findings are better than many questionable ones.
3. If the document is well-written and compliant, return ZERO issues. That is a valid and good outcome.

SEVERITY LEVELS:
- "low": Minor language concern, may want to refine
- "medium": Should address before finalising — notable tone/bias/policy issue
- "high": Must address — serious compliance, bias, or professionalism risk

SELF-ASSESSMENT:
You must also report your own assessment of review quality:
- review_confidence: "high" if you are confident in your analysis, "medium" if uncertain about some areas, "low" if the text was difficult to analyze
- narrative_coverage: "sufficient" if there was ample authored narrative to review, "partial" if limited narrative was available, "insufficient" if very little authored narrative existed
Note: These values may be adjusted downward by the server based on deterministic signals. You should be honest — do not overclaim confidence.

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
    "fields_human_review": <int>,
    "review_confidence": "high" | "medium" | "low",
    "narrative_coverage": "sufficient" | "partial" | "insufficient"
  },
  "issues": [
    {
      "type": "completeness | policy_language | tone | bias | unsupported_conclusion | consistency",
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

const VALID_ISSUE_TYPES = new Set(["completeness", "policy_language", "tone", "bias", "consistency", "unsupported_conclusion"]);
const VALID_SEVERITIES = new Set(["low", "medium", "high"]);
const VALID_CONFIDENCE = new Set(["high", "medium", "low"]);
const VALID_COVERAGE = new Set(["sufficient", "partial", "insufficient"]);

function validateReviewReport(parsed: unknown): boolean {
  if (typeof parsed !== "object" || parsed === null) return false;
  const obj = parsed as Record<string, unknown>;

  if (typeof obj.summary !== "object" || obj.summary === null) return false;
  const summary = obj.summary as Record<string, unknown>;
  if (!VALID_SEVERITIES.has(summary.overall_risk as string)) return false;
  if (!Array.isArray(summary.key_findings)) return false;
  // review_confidence and narrative_coverage are optional from LLM (we have defaults)

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

// ── Finding Track Assignment (deterministic, server-side) ────────────────

type FindingTrack = "primary" | "secondary";

const PRIMARY_ISSUE_TYPES = new Set(["tone", "bias", "policy_language", "unsupported_conclusion"]);

function assignFindingTrack(issueType: string): FindingTrack {
  return PRIMARY_ISSUE_TYPES.has(issueType) ? "primary" : "secondary";
}

// ── Hybrid Confidence/Coverage Caps (deterministic) ──────────────────────

type ConfidenceLevel = "high" | "medium" | "low";
type CoverageLevel = "sufficient" | "partial" | "insufficient";

const CONFIDENCE_ORDER: Record<ConfidenceLevel, number> = { low: 0, medium: 1, high: 2 };
const COVERAGE_ORDER: Record<CoverageLevel, number> = { insufficient: 0, partial: 1, sufficient: 2 };

function capConfidence(llmValue: ConfidenceLevel | undefined, deterministicCap: ConfidenceLevel): ConfidenceLevel {
  const llm = llmValue && CONFIDENCE_ORDER[llmValue] !== undefined ? llmValue : "medium";
  return CONFIDENCE_ORDER[llm] <= CONFIDENCE_ORDER[deterministicCap] ? llm : deterministicCap;
}

function capCoverage(llmValue: CoverageLevel | undefined, deterministicCap: CoverageLevel): CoverageLevel {
  const llm = llmValue && COVERAGE_ORDER[llmValue] !== undefined ? llmValue : "partial";
  return COVERAGE_ORDER[llm] <= COVERAGE_ORDER[deterministicCap] ? llm : deterministicCap;
}

function computeDeterministicCaps(
  docTextLength: number,
  reviewWorthyCount: number,
  hasReconciliation: boolean,
): { coverageCap: CoverageLevel; confidenceCap: ConfidenceLevel } {
  // Coverage cap: based on how much authored narrative was available
  let coverageCap: CoverageLevel;
  if (docTextLength < 200 || reviewWorthyCount === 0) {
    coverageCap = "insufficient";
  } else if (docTextLength < 1000 || reviewWorthyCount < 3) {
    coverageCap = "partial";
  } else {
    coverageCap = "sufficient";
  }

  // Confidence cap: based on coverage + reconciliation availability
  let confidenceCap: ConfidenceLevel;
  if (coverageCap === "insufficient") {
    confidenceCap = "low";
  } else if (!hasReconciliation && reviewWorthyCount < 5) {
    confidenceCap = "medium";
  } else {
    confidenceCap = "high";
  }

  return { coverageCap, confidenceCap };
}

// ── Completeness Issue Deduplication & Structured-Field Suppression ─────

interface ReviewIssue {
  type: string;
  severity: string;
  excerpt: string;
  explanation: string;
  field_key?: string;
  finding_track?: FindingTrack;
}

/** Hard-blocked field label patterns — server-side safety net */
const BLOCKED_FIELD_RE = [
  /^time$/i,
  /^date$/i,
  /\b(dob|date\s*of\s*birth|birth\s*date)\b/i,
  /\b(ssn|social\s*security)\b/i,
  /\b(phone|telephone|fax|cell)\b/i,
  /\b(address|street|city|state|zip)\b/i,
  /\b(age|gender|sex|race|ethnicity)\b/i,
  /\b(email|e-mail)\b/i,
  /\b(signature|signed\s*by|date\s*signed)\b/i,
  /\b(case\s*number|case\s*id|worker\s*id)\b/i,
  /\b(application\s*date|received\s*date)\b/i,
  /\b(relationship\s*to|relation\s*to)\b/i,
  /\bperson\s*\d/i,
  /\bchild\s*\d/i,
  /\b(height|weight)\b/i,
  /\btime\s*(of|for)\b/i,
  /\b(start|end|begin)\s*(time|date)\b/i,
  /\b(marital\s*status)\b/i,
  /\b(medicaid|medicare)\s*(number|#|id)\b/i,
];

const BLOCKED_EXPLANATION_TERMS = [
  "time narrative section is blank",
  "time field",
  "date of birth",
  "dob field",
  "ssn field",
  "phone number",
  "address field",
  "checkbox",
  "select one",
  "select many",
  "boolean",
  "demographic",
  "relationship matrix",
  "signature field",
];

function isIssueAboutBlockedField(issue: ReviewIssue): boolean {
  if (issue.field_key) {
    const label = issue.field_key.replace(/_/g, " ");
    if (BLOCKED_FIELD_RE.some(re => re.test(label) || re.test(issue.field_key!))) return true;
  }
  if (issue.type === "completeness" || issue.type === "consistency") {
    const combined = `${issue.explanation} ${issue.excerpt}`.toLowerCase();
    if (BLOCKED_EXPLANATION_TERMS.some(term => combined.includes(term))) return true;
  }
  return false;
}

function dedupeAndFilterIssues(issues: ReviewIssue[]): { filtered: ReviewIssue[]; suppressed: number } {
  let suppressed = 0;

  // Step 1: Remove any findings about blocked structured fields
  let filtered = issues.filter(i => {
    if (isIssueAboutBlockedField(i)) { suppressed++; return false; }
    return true;
  });

  // Step 2: Suppress weak comparison findings (consistency with tiny excerpts)
  filtered = filtered.filter(i => {
    if (i.type === "consistency" && i.excerpt.length < 20) {
      suppressed++;
      return false;
    }
    return true;
  });

  // Step 3: Deduplicate completeness issues
  const completeness = filtered.filter((i) => i.type === "completeness");
  const others = filtered.filter((i) => i.type !== "completeness");

  if (completeness.length <= 1) return { filtered, suppressed };

  const coveredFieldKeys = new Set<string>();
  const perFieldIssues: ReviewIssue[] = [];
  const groupedIssues: ReviewIssue[] = [];

  for (const issue of completeness) {
    if (issue.field_key && issue.field_key.trim().length > 0) {
      if (coveredFieldKeys.has(issue.field_key)) { suppressed++; continue; }
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
    if (mentionedCount >= 2) { suppressed++; return false; }
    return true;
  });

  return { filtered: [...others, ...perFieldIssues, ...survivingGrouped], suppressed };
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
  /** Metadata-only trigger counts from client-side deterministic scanner */
  language_trigger_metadata?: Record<string, number>;
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

  parts.push("Review the authored narrative language in the following completed case document.\n");
  parts.push("IMPORTANT: You are reviewing AUTHORED TEXT QUALITY only. Do NOT flag structured fields (checkboxes, dates, booleans, demographics, identifiers) as missing or incomplete.");
  parts.push("IMPORTANT: Distinguish between the caseworker's authored language and quoted/attributed speech. Do NOT flag quoted client statements for tone/bias unless the caseworker adopts that language.\n");

  // Language trigger metadata (metadata only — no text excerpts)
  if (body.language_trigger_metadata && Object.keys(body.language_trigger_metadata).length > 0) {
    const counts = Object.entries(body.language_trigger_metadata)
      .filter(([k]) => !k.startsWith("_"))
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    const quotedRegions = body.language_trigger_metadata._quoted_regions ?? 0;
    const attributionMarkers = body.language_trigger_metadata._attribution_markers ?? 0;
    if (counts) {
      parts.push(`LANGUAGE TRIGGER METADATA (deterministic pre-scan — increase scrutiny on these categories): ${counts}`);
    }
    if (quotedRegions > 0 || attributionMarkers > 0) {
      parts.push(`ATTRIBUTION CONTEXT: ${quotedRegions} quoted regions, ${attributionMarkers} attribution markers detected — exercise caution distinguishing caseworker voice from quoted speech.`);
    }
    parts.push("");
  }

  // Reconciliation context (highest priority framing)
  if (body.reconciliation_context) {
    const rc = body.reconciliation_context;
    parts.push("NARRATIVE RECONCILIATION CONTEXT (comparison between case notes and completed form — narrative fields only):");
    parts.push("Use this comparison CONSERVATIVELY — only flag meaningful narrative contradictions, not formatting or trivial wording differences.");
    if (rc.reconciliation_summary) {
      const s = rc.reconciliation_summary;
      parts.push(`  Parse confidence: ${s.template_parse_confidence}`);
      parts.push(`  Narrative matches: ${s.matches}, Corrections: ${s.likely_corrections}, Discrepancies: ${s.possible_discrepancies}, Omissions: ${s.likely_omissions}`);
    }
    if (rc.confirmed_fields && rc.confirmed_fields.length > 0) {
      parts.push(`  CONFIRMED NARRATIVE FIELDS (present in both — do NOT flag): ${rc.confirmed_fields.join(", ")}`);
    }
    if (rc.likely_corrections && rc.likely_corrections.length > 0) {
      parts.push("  NARRATIVE CORRECTIONS (form intentionally refined from notes — NOT errors):");
      for (const c of rc.likely_corrections.slice(0, 15)) {
        parts.push(`    ${c.field_key}: notes="${(c.notes || "").slice(0, 40)}" → form="${(c.form || "").slice(0, 40)}"`);
      }
    }
    if (rc.discrepancies && rc.discrepancies.length > 0) {
      parts.push("  NARRATIVE DISCREPANCIES (notes and form genuinely differ — report as CONSISTENCY issues only if meaningful):");
      for (const d of rc.discrepancies.slice(0, 15)) {
        parts.push(`    ${d.field_key} [${d.section}]: notes="${(d.notes || "").slice(0, 40)}" ≠ form="${(d.form || "").slice(0, 40)}"`);
      }
    }
    if (rc.omissions && rc.omissions.length > 0) {
      parts.push("  NARRATIVE OMISSIONS (in notes but missing from form — report as COMPLETENESS issues):");
      for (const o of rc.omissions.slice(0, 15)) {
        parts.push(`    ${o.field_key} [${o.section}]: "${(o.notes_value || "").slice(0, 50)}"`);
      }
    }
    parts.push("");
  }

  // Review-worthy answers (authored narrative text — primary targets)
  const reviewWorthy = body.review_worthy_answers ?? [];
  if (reviewWorthy.length > 0) {
    parts.push("AUTHORED NARRATIVE TEXT (primary review targets — check for tone, bias, unsupported conclusions, policy language, clarity):");
    for (const a of reviewWorthy) {
      if (a.requires_human_review) continue;
      const conf = a.recovery_confidence === "low" ? " [low confidence]" : "";
      const val = a.missing ? "(blank — narrative section appears empty)" : (a.answer || "(blank)");
      parts.push(`  ${a.label}: ${val}${conf}`);
    }
    parts.push("");
  }

  // Narrative-eligible structured answers (for context only)
  if (body.structured_answers && body.structured_answers.length > 0) {
    parts.push("NARRATIVE-ELIGIBLE FIELDS (for context — do NOT flag checkbox, date, boolean, demographic, or identifier fields):");
    for (const a of body.structured_answers) {
      if (a.requires_human_review) continue;
      const status = a.missing ? "[BLANK]" : `[${a.recovery_confidence}]`;
      const val = a.answer || "(blank)";
      parts.push(`  ${status} ${a.label}: ${val}`);
    }
    parts.push("");
  }

  // Unanswered narrative fields (only these qualify for completeness)
  if (body.unanswered_fields && body.unanswered_fields.length > 0) {
    parts.push("BLANK NARRATIVE SECTIONS (these are narrative fields that appear empty — report ONE completeness issue per field):");
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
  parts.push("DOCUMENT TEXT (use for reviewing all authored narrative language for tone, bias, unsupported conclusions, and policy compliance):");
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
    const reviewWorthyCount = v2.review_worthy_answers?.length ?? 0;

    await eye(supabase, v2.session_id, "reviewer_v3.started", {
      tenant_id: session.tenant_id,
      doc_text_length: v2.document_text.length,
      structured_answers_count: v2.structured_answers?.length ?? 0,
      review_worthy_count: reviewWorthyCount,
      unanswered_count: v2.unanswered_fields?.length ?? 0,
      human_review_count: v2.human_review_fields?.length ?? 0,
      has_reconciliation: hasReconciliation,
      reconciliation_parse_confidence: v2.reconciliation_context?.reconciliation_summary?.template_parse_confidence ?? null,
      has_trigger_metadata: !!v2.language_trigger_metadata,
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
          { role: "system", content: REVIEWER_V3_SYSTEM_PROMPT },
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

    // ── Post-processing ──────────────────────────────────────────────

    // Step 1: Filter blocked fields + deduplicate + suppress weak comparison
    const { filtered: filteredIssues, suppressed: serverSuppressed } = dedupeAndFilterIssues(reportObj.issues);

    // Step 2: Deterministic classification pipeline
    // Normalize spans, apply rule-based category assignment, resolve overlaps,
    // calibrate severity, and deduplicate near-identical findings
    const classificationResult = deterministicClassify(filteredIssues);
    reportObj.issues = classificationResult.issues.map((ci: any) => ({
      type: ci.type,
      severity: ci.severity,
      excerpt: ci.excerpt,
      explanation: ci.explanation,
      field_key: ci.field_key,
      finding_track: undefined, // will be assigned below
    }));

    // Step 3: Assign finding_track deterministically (server-side, not model)
    for (const issue of reportObj.issues) {
      issue.finding_track = assignFindingTrack(issue.type);
    }

    // Step 4: Compute deterministic confidence/coverage caps
    const { coverageCap, confidenceCap } = computeDeterministicCaps(
      v2.document_text.length,
      reviewWorthyCount,
      hasReconciliation,
    );

    const summary = reportObj.summary as Record<string, any>;
    summary.review_confidence = capConfidence(summary.review_confidence, confidenceCap);
    summary.narrative_coverage = capCoverage(summary.narrative_coverage, coverageCap);

    // Step 5: Recalculate metrics from classified issues
    const primaryIssues = reportObj.issues.filter((i: ReviewIssue) => i.finding_track === "primary");
    const secondaryIssues = reportObj.issues.filter((i: ReviewIssue) => i.finding_track === "secondary");

    reportObj.metrics = {
      issue_count: reportObj.issues.length,
      high_severity_count: reportObj.issues.filter((i: ReviewIssue) => i.severity === "high").length,
    };

    // Step 6: overall_risk must not be driven to high by secondary findings alone
    const primaryHighCount = primaryIssues.filter((i: ReviewIssue) => i.severity === "high").length;
    const primaryMedCount = primaryIssues.filter((i: ReviewIssue) => i.severity === "medium").length;

    if (primaryHighCount > 0) {
      summary.overall_risk = "high";
    } else if (primaryMedCount > 0) {
      summary.overall_risk = "medium";
    } else {
      const anySecondaryHigh = secondaryIssues.some((i: ReviewIssue) => i.severity === "high");
      summary.overall_risk = anySecondaryHigh ? "medium" : "low";
    }

    await eye(supabase, v2.session_id, "reviewer_v3.completed", {
      tenant_id: session.tenant_id,
      issue_count: reportObj.metrics.issue_count,
      high_severity_count: reportObj.metrics.high_severity_count,
      overall_risk: summary.overall_risk,
      review_confidence: summary.review_confidence,
      narrative_coverage: summary.narrative_coverage,
      primary_finding_count: primaryIssues.length,
      secondary_finding_count: secondaryIssues.length,
      server_suppressed: serverSuppressed,
      has_reconciliation: hasReconciliation,
      has_trigger_metadata: !!v2.language_trigger_metadata,
    });

    return json(200, {
      success: true,
      review_report: reportObj,
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[run-reviewer] error:", message);

    await eye(supabase, v2.session_id, "reviewer_v3.failed", {
      reason: message.slice(0, 250),
    });

    return errJson(500, "REVIEWER_FAILED", message.slice(0, 500));
  }
});
