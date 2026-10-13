/**
 * run-reviewer v3.3 Edge Function — deterministic classification engine
 *
 * v3.3 changes:
 *   - DCE v2: category-pure explanations, borderline observational guardrail
 *   - Stronger overlap merging (50% threshold, same-field proximity)
 *   - UC priority raised above tone for overclaiming spans
 *   - Deterministic final ordering: primary→secondary, severity, category, excerpt
 *   - Explanation validation pass strips cross-category vocabulary
 *   - borderline_suppressed stat tracked
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { logEyeEvent } from "../_shared/eye.ts";
import { requireUser, assertSessionAccess, requireTenantFor } from "../_shared/require-user.ts";
import {
  classifyAndDeduplicate,
  type CandidateIssue,
  type ClassifiedIssue,
} from "../_shared/deterministic-classifier.ts";
import {
  hashDocumentText,
  hashReviewPacket,
  hashIssuesArray,
  hashCandidates,
  createRunId,
  type ReviewerRunDiagnostics,
  type ReviewerStageSnapshot,
} from "../_shared/reviewer-diagnostics.ts";

// ── Constants ──────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DOC_TEXT_CHARS = 120_000;
const MIN_DOC_TEXT_CHARS = 50;
const MAX_STRUCTURED_ANSWERS = 200;
const SERVICE_NAME = "run-reviewer";
const LOVABLE_AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

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

// ── Reviewer v3.2 System Prompt ────────────────────────────────────────────
// The model is now a CONSERVATIVE CANDIDATE SPAN DETECTOR.
// Final category assignment, severity calibration, and deduplication
// are handled by the deterministic classification engine (DCE).

const REVIEWER_V3_SYSTEM_PROMPT = `You are AidMind Reviewer's span detection layer. Your job is to CONSERVATIVELY identify candidate problematic text spans in caseworker documentation.

IMPORTANT: You are NOT the final authority on issue categorization, severity, or deduplication. A deterministic classification engine will post-process your output to assign final categories, resolve overlaps, calibrate severity, and deduplicate findings. Your job is to surface candidate spans accurately and conservatively.

YOUR PRIMARY JOB:
- Identify text spans in AUTHORED NARRATIVE that may contain language quality issues
- Provide your best-guess category and severity as starting points for the deterministic engine
- Anchor each finding to a specific, short excerpt (≤ 30 words)
- Provide a clear explanation of why the span is potentially problematic

SPAN BOUNDARY RULES — CRITICAL FOR STABILITY:
These rules are mandatory. Violating them degrades trust and reproducibility.

1. EXACT QUOTING: Every excerpt must be an exact, verbatim substring of the document text. Do not paraphrase, shorten, or rephrase.
2. MINIMAL SPANS: Each excerpt must contain ONLY the specific problematic phrase or sentence. Do not include surrounding context, preamble, or adjacent text that is not itself problematic.
3. ONE ISSUE = ONE SPAN: If a single sentence contains one problematic element, report that sentence as one finding. Do not split it into multiple overlapping findings targeting different words within the same clause.
4. INDEPENDENT ISSUES ONLY: Only report two separate findings from nearby text if they are genuinely independent problems that could each stand alone. If they are aspects of the same concern, report them as one finding anchored to the most problematic clause.
5. NO MERGING DISTANT SPANS: Do not combine two sentences from different parts of the document into a single excerpt. Each finding must be anchored to one contiguous span.
6. SENTENCE-LEVEL ANCHORING: Prefer anchoring to the exact sentence or clause that contains the problematic language. Do not anchor to a paragraph or multi-sentence block.
7. DETERMINISTIC BOUNDARIES: Given the same input text, always select the same span boundaries. Do not vary span selection based on surrounding context that does not change the meaning of the span itself.

You receive a STRUCTURED REVIEW PACKET containing:
1. "review_worthy_answers" — AUTHORED TEXT FIELDS (narratives, comments, summaries). PRIMARY targets.
2. "structured_answers" — narrative-eligible recovered field values. Context only.
3. "unanswered_fields" — NARRATIVE FIELDS that appear blank. Only these qualify for completeness findings.
4. "human_review_fields" — fields requiring manual human verification (do NOT flag).
5. "document_text" — raw document text for reviewing all authored narrative language.
6. "reconciliation_context" (when present) — NARRATIVE-ONLY comparison data.

CANDIDATE ISSUE CATEGORIES (suggest your best guess — the deterministic engine may reclassify):

- tone: Judgmental, blaming, shaming, condescending, emotionally charged, or unprofessional language in AUTHORED text.
- bias: Stigmatizing labels, unsupported assumptions, stereotypes, or subjective labels presented as fact. Labeling a person rather than describing observable behavior.
- unsupported_conclusion: Conclusions with more certainty than evidence supports. Inference stated as fact. Mental-state claims without behavioral basis. Clinical/legal conclusions without documentation. Intent/motive attributed without evidence.
- policy_language: Prohibited terminology, incorrect policy terms, informal language, or emotionally charged qualifiers in professional documentation.
- completeness: ONLY for NARRATIVE SECTIONS that appear blank/empty. ONLY flag fields from the unanswered_fields list. Do NOT flag checkboxes, dates, booleans, demographics, or identifiers.
- consistency: ONLY for genuine narrative contradictions when reconciliation_context is provided. Do NOT use for structured field differences.

AUTHORED VS QUOTED — CRITICAL DISTINCTION:
- Quoted speech ("client stated", "mother reported", "according to") should NOT be flagged UNLESS the caseworker adopts or amplifies that language as their own assessment.
- Example of safe quoting: 'Client stated "he is dangerous."' → Do NOT flag.
- Example of adoption: 'The neighbor said she is a mess, and based on this, she clearly cannot provide care.' → DO flag.

DETECTION THRESHOLD:
- Be CONSERVATIVE. Only surface spans you are reasonably confident contain a real issue.
- Prefer ZERO findings over weak, speculative, or vaguely-anchored findings.
- If you are uncertain, do NOT report it. The deterministic engine cannot fix false positives.
- One span = one finding. Do NOT report the same span multiple times with different categories. The deterministic engine handles multi-category resolution.

WHAT YOU MUST NOT DO:
1. Do NOT flag missing checkboxes, dates, phone numbers, addresses, SSNs, booleans, or categorical fields.
2. Do NOT flag demographics, person blocks, relationship matrices, or administrative markers.
3. Do NOT infer structured field completeness from text.
4. Do NOT analyze checkbox/categorical/boolean/number/date fields for tone or bias.
5. Do NOT flag quoted speech unless the caseworker adopts it.
6. Do NOT produce vague findings without a clear anchored excerpt.
7. Do NOT report the same problematic span multiple times — report it ONCE with your best category guess.
8. Do NOT merge two distinct problematic phrases from different sentences into one excerpt.
9. Do NOT split one sentence into multiple findings unless the issues are clearly independent.

SELF-ASSESSMENT:
Report your own assessment of review quality:
- review_confidence: "high" if confident, "medium" if uncertain about some areas, "low" if text was difficult to analyze
- narrative_coverage: "sufficient" if ample narrative, "partial" if limited, "insufficient" if very little
Note: These may be adjusted downward by deterministic caps. Be honest.

RECONCILIATION RULES (when reconciliation_context is provided):
1. Do NOT flag confirmed_fields as completeness issues.
2. Do NOT flag likely_corrections as errors.
3. DO flag genuine narrative discrepancies as consistency issues.
4. DO flag narrative omissions as completeness issues.
5. ALL reconciliation data is pre-filtered to narrative fields.

SEVERITY GUIDANCE (your suggestion — the deterministic engine may override):
- "low": Minor style concern
- "medium": Should address before finalizing
- "high": Serious compliance, bias, or professionalism risk

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
      "excerpt": "exact verbatim substring from the document (≤ 30 words)",
      "explanation": "why this is problematic",
      "field_key": "optional — the field this relates to"
    }
  ],
  "metrics": {
    "issue_count": <int>,
    "high_severity_count": <int>
  }
}

STRICT RULES:
1. Produce ONLY a JSON report. No markdown, no commentary.
2. Do NOT rewrite or suggest replacement text.
3. Do NOT act like an editor — you are a detection layer.
4. Keep excerpts short (≤ 30 words), exact, and verbatim.
5. Focus on concrete, identifiable issues.
6. If the document is well-written and compliant, return zero issues.
7. ONE finding per problematic span — do not duplicate.
8. When reporting completeness issues, include the field_key.

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
  let coverageCap: CoverageLevel;
  if (docTextLength < 200 || reviewWorthyCount === 0) {
    coverageCap = "insufficient";
  } else if (docTextLength < 1000 || reviewWorthyCount < 3) {
    coverageCap = "partial";
  } else {
    coverageCap = "sufficient";
  }

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

const BLOCKED_FIELD_RE = [
  /^time$/i, /^date$/i,
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
  /\bperson\s*\d/i, /\bchild\s*\d/i,
  /\b(height|weight)\b/i,
  /\btime\s*(of|for)\b/i,
  /\b(start|end|begin)\s*(time|date)\b/i,
  /\b(marital\s*status)\b/i,
  /\b(medicaid|medicare)\s*(number|#|id)\b/i,
];

const BLOCKED_EXPLANATION_TERMS = [
  "time narrative section is blank", "time field", "date of birth", "dob field",
  "ssn field", "phone number", "address field", "checkbox", "select one",
  "select many", "boolean", "demographic", "relationship matrix", "signature field",
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

  let filtered = issues.filter(i => {
    if (isIssueAboutBlockedField(i)) { suppressed++; return false; }
    return true;
  });

  filtered = filtered.filter(i => {
    if (i.type === "consistency" && i.excerpt.length < 20) { suppressed++; return false; }
    return true;
  });

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

  parts.push("Scan the authored narrative language in the following completed case document for candidate problematic spans.\n");
  parts.push("IMPORTANT: You are a detection layer. Report each problematic span ONCE with your best category guess. A deterministic engine will handle final categorization, deduplication, and severity calibration.");
  parts.push("IMPORTANT: Distinguish between the caseworker's authored language and quoted/attributed speech. Do NOT flag quoted client statements for tone/bias unless the caseworker adopts that language.\n");

  if (body.language_trigger_metadata && Object.keys(body.language_trigger_metadata).length > 0) {
    const counts = Object.entries(body.language_trigger_metadata)
      .filter(([k]) => !k.startsWith("_"))
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    const quotedRegions = body.language_trigger_metadata._quoted_regions ?? 0;
    const attributionMarkers = body.language_trigger_metadata._attribution_markers ?? 0;
    if (counts) {
      parts.push(`LANGUAGE TRIGGER METADATA (deterministic pre-scan): ${counts}`);
    }
    if (quotedRegions > 0 || attributionMarkers > 0) {
      parts.push(`ATTRIBUTION CONTEXT: ${quotedRegions} quoted regions, ${attributionMarkers} attribution markers — exercise caution distinguishing caseworker voice from quoted speech.`);
    }
    parts.push("");
  }

  if (body.reconciliation_context) {
    const rc = body.reconciliation_context;
    parts.push("NARRATIVE RECONCILIATION CONTEXT (narrative fields only):");
    parts.push("Use CONSERVATIVELY — only flag meaningful narrative contradictions.");
    if (rc.reconciliation_summary) {
      const s = rc.reconciliation_summary;
      parts.push(`  Parse confidence: ${s.template_parse_confidence}`);
      parts.push(`  Matches: ${s.matches}, Corrections: ${s.likely_corrections}, Discrepancies: ${s.possible_discrepancies}, Omissions: ${s.likely_omissions}`);
    }
    if (rc.confirmed_fields && rc.confirmed_fields.length > 0) {
      parts.push(`  CONFIRMED (do NOT flag): ${rc.confirmed_fields.join(", ")}`);
    }
    if (rc.likely_corrections && rc.likely_corrections.length > 0) {
      parts.push("  CORRECTIONS (NOT errors):");
      for (const c of rc.likely_corrections.slice(0, 15)) {
        parts.push(`    ${c.field_key}: notes="${(c.notes || "").slice(0, 40)}" → form="${(c.form || "").slice(0, 40)}"`);
      }
    }
    if (rc.discrepancies && rc.discrepancies.length > 0) {
      parts.push("  DISCREPANCIES (report as consistency if meaningful):");
      for (const d of rc.discrepancies.slice(0, 15)) {
        parts.push(`    ${d.field_key} [${d.section}]: notes="${(d.notes || "").slice(0, 40)}" ≠ form="${(d.form || "").slice(0, 40)}"`);
      }
    }
    if (rc.omissions && rc.omissions.length > 0) {
      parts.push("  OMISSIONS (report as completeness):");
      for (const o of rc.omissions.slice(0, 15)) {
        parts.push(`    ${o.field_key} [${o.section}]: "${(o.notes_value || "").slice(0, 50)}"`);
      }
    }
    parts.push("");
  }

  const reviewWorthy = body.review_worthy_answers ?? [];
  if (reviewWorthy.length > 0) {
    parts.push("AUTHORED NARRATIVE TEXT (primary targets):");
    for (const a of reviewWorthy) {
      if (a.requires_human_review) continue;
      const conf = a.recovery_confidence === "low" ? " [low confidence]" : "";
      const val = a.missing ? "(blank)" : (a.answer || "(blank)");
      parts.push(`  ${a.label}: ${val}${conf}`);
    }
    parts.push("");
  }

  if (body.structured_answers && body.structured_answers.length > 0) {
    parts.push("CONTEXT FIELDS (do NOT flag checkbox/date/boolean/demographic/identifier fields):");
    for (const a of body.structured_answers) {
      if (a.requires_human_review) continue;
      const status = a.missing ? "[BLANK]" : `[${a.recovery_confidence}]`;
      parts.push(`  ${status} ${a.label}: ${a.answer || "(blank)"}`);
    }
    parts.push("");
  }

  if (body.unanswered_fields && body.unanswered_fields.length > 0) {
    parts.push("BLANK NARRATIVE SECTIONS (report ONE completeness issue per field):");
    for (const f of body.unanswered_fields) {
      parts.push(`  - ${f.label} (field_key: ${f.field_key})`);
    }
    parts.push("");
  }

  if (body.human_review_fields && body.human_review_fields.length > 0) {
    parts.push("HUMAN-REVIEW-ONLY FIELDS (do NOT flag):");
    for (const f of body.human_review_fields) {
      parts.push(`  - ${f.label}: ${f.reason}`);
    }
    parts.push("");
  }

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
  const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
  // Fallback to OPENAI_API_KEY for backward compatibility
  const openaiKey = Deno.env.get("OPENAI_API_KEY");

  const apiKey = lovableApiKey || openaiKey;
  if (!apiKey) return errJson(500, "CONFIG_ERROR", "No AI API key configured (LOVABLE_API_KEY or OPENAI_API_KEY)");

  const useGateway = !!lovableApiKey;
  const llmUrl = useGateway ? LOVABLE_AI_GATEWAY : "https://api.openai.com/v1/chat/completions";
  const model = useGateway ? "google/gemini-2.5-flash" : "gpt-4o-mini";

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

  // ── Authenticate caller and authorize the session before any privileged access ──
  const auth = await requireUser(req, supabase);
  if (!auth.ok) return errJson(auth.status, "UNAUTHORIZED", auth.error);
  const access = await assertSessionAccess(supabase, auth.caller, v2.session_id, { allowSupervisor: true });
  if (!access.ok) return errJson(access.status, "SESSION_ACCESS_DENIED", access.error);

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

    // ── Diagnostics: Initialize ──────────────────────────────────────
    const runId = createRunId();
    const stages: ReviewerStageSnapshot[] = [];
    const timestamps: Record<string, number> = { start: Date.now() };

    const hasReconciliation = !!v2.reconciliation_context;
    const reviewWorthyCount = v2.review_worthy_answers?.length ?? 0;

    // ── Diagnostics: Input fingerprint ───────────────────────────────
    const docTextHash = await hashDocumentText(v2.document_text);
    const reviewWorthyKeys = (v2.review_worthy_answers ?? [])
      .map(a => a.field_key).sort();
    const unansweredKeys = (v2.unanswered_fields ?? [])
      .map(f => f.field_key).sort();
    const triggerCategories = v2.language_trigger_metadata
      ? Object.keys(v2.language_trigger_metadata).filter(k => !k.startsWith("_")).sort()
      : [];

    stages.push({
      stage: "input_validated",
      hash: docTextHash,
      counts: {
        doc_text_length: v2.document_text.length,
        review_worthy: reviewWorthyCount,
        structured_answers: v2.structured_answers?.length ?? 0,
        unanswered: v2.unanswered_fields?.length ?? 0,
        human_review: v2.human_review_fields?.length ?? 0,
      },
      metadata: {
        has_reconciliation: hasReconciliation,
        has_triggers: !!v2.language_trigger_metadata,
        template_id: v2.template_id ?? null,
      },
    });
    timestamps.input_validated = Date.now();

    await eye(supabase, v2.session_id, "reviewer_v3.started", {
      tenant_id: session.tenant_id,
      version: "3.3",
      run_id: runId,
      doc_text_length: v2.document_text.length,
      doc_text_hash: docTextHash,
      structured_answers_count: v2.structured_answers?.length ?? 0,
      review_worthy_count: reviewWorthyCount,
      unanswered_count: v2.unanswered_fields?.length ?? 0,
      human_review_count: v2.human_review_fields?.length ?? 0,
      has_reconciliation: hasReconciliation,
      reconciliation_parse_confidence: v2.reconciliation_context?.reconciliation_summary?.template_parse_confidence ?? null,
      has_trigger_metadata: !!v2.language_trigger_metadata,
      llm_provider: useGateway ? "lovable_gateway" : "openai_direct",
      model,
    });

    const userMessage = buildUserMessage(v2);
    const reviewPacketHash = await hashReviewPacket(userMessage);

    stages.push({
      stage: "prompt_assembled",
      hash: reviewPacketHash,
      counts: { prompt_length: userMessage.length },
      metadata: { model, temperature: 0, provider: useGateway ? "lovable_gateway" : "openai_direct" },
    });
    timestamps.prompt_assembled = Date.now();

    // ── Stage 1: LLM candidate span detection ─────────────────────────

    const llmResponse = await fetch(llmUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: "system", content: REVIEWER_V3_SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        ...(useGateway ? {} : { response_format: { type: "json_object" } }),
      }),
    });

    timestamps.llm_response_received = Date.now();

    if (!llmResponse.ok) {
      const errText = await llmResponse.text();
      if (llmResponse.status === 429) {
        return errJson(429, "RATE_LIMITED", "AI service rate limit exceeded, please try again later.");
      }
      if (llmResponse.status === 402) {
        return errJson(402, "PAYMENT_REQUIRED", "AI service payment required. Please add credits.");
      }
      throw new Error(`AI API error ${llmResponse.status}: ${errText.slice(0, 300)}`);
    }

    const llmData = await llmResponse.json();
    const rawContent = llmData?.choices?.[0]?.message?.content;

    if (!rawContent || typeof rawContent !== "string") {
      throw new Error("AI response missing message content");
    }

    // Extract JSON from potential markdown fences
    let jsonContent = rawContent.trim();
    const fenceMatch = jsonContent.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch) {
      jsonContent = fenceMatch[1].trim();
    }

    let report: unknown;
    try {
      report = JSON.parse(jsonContent);
    } catch {
      throw new Error("LLM output is not valid JSON");
    }

    if (!validateReviewReport(report)) {
      throw new Error("LLM output does not match expected review report schema");
    }

    const reportObj = report as Record<string, any>;
    const rawIssues = [...reportObj.issues];
    const rawCandidateHash = await hashCandidates(rawIssues);

    stages.push({
      stage: "llm_response_parsed",
      hash: rawCandidateHash,
      counts: {
        raw_candidate_count: rawIssues.length,
        response_length: rawContent.length,
      },
      metadata: {
        finish_reason: llmData?.choices?.[0]?.finish_reason ?? "unknown",
        llm_confidence: reportObj.summary?.review_confidence ?? "unknown",
        llm_coverage: reportObj.summary?.narrative_coverage ?? "unknown",
        llm_risk: reportObj.summary?.overall_risk ?? "unknown",
      },
    });
    timestamps.llm_parsed = Date.now();

    // ── Stage 2: Filter blocked fields (pre-DCE safety net) ──────────

    const { filtered: prefilteredIssues, suppressed: serverSuppressed } = dedupeAndFilterIssues(reportObj.issues);
    const prefilteredHash = await hashCandidates(prefilteredIssues);

    stages.push({
      stage: "prefiltered",
      hash: prefilteredHash,
      counts: {
        prefiltered_count: prefilteredIssues.length,
        server_suppressed: serverSuppressed,
      },
    });
    timestamps.prefiltered = Date.now();

    // ── Stage 3-7: Deterministic Classification Engine ───────────────

    const candidateIssues: CandidateIssue[] = prefilteredIssues.map((i: any) => ({
      type: i.type,
      severity: i.severity,
      excerpt: i.excerpt,
      explanation: i.explanation,
      field_key: i.field_key,
    }));

    const dceResult = classifyAndDeduplicate(candidateIssues);
    const dceOutputHash = await hashIssuesArray(dceResult.issues);

    stages.push({
      stage: "dce_completed",
      hash: dceOutputHash,
      counts: {
        dce_input: dceResult.stats.input_count,
        dce_output: dceResult.stats.output_count,
        deduplicated: dceResult.stats.deduplicated,
        category_overrides: dceResult.stats.category_overrides,
        severity_adjustments: dceResult.stats.severity_adjustments,
        overlap_merges: dceResult.stats.overlap_merges,
        borderline_suppressed: dceResult.stats.borderline_suppressed,
      },
    });
    timestamps.dce_completed = Date.now();

    // ── Stage 8: Final issue emission ────────────────────────────────

    reportObj.issues = dceResult.issues.map((ci: ClassifiedIssue) => ({
      type: ci.type,
      severity: ci.severity,
      excerpt: ci.excerpt,
      explanation: ci.explanation,
      field_key: ci.field_key,
      finding_track: assignFindingTrack(ci.type),
      category_source: ci.category_source,
      severity_adjusted: ci.severity_adjusted,
      matched_rules: ci.matched_rules,
    }));

    // ── Confidence/Coverage caps ─────────────────────────────────────

    const { coverageCap, confidenceCap } = computeDeterministicCaps(
      v2.document_text.length,
      reviewWorthyCount,
      hasReconciliation,
    );

    const summary = reportObj.summary as Record<string, any>;
    summary.review_confidence = capConfidence(summary.review_confidence, confidenceCap);
    summary.narrative_coverage = capCoverage(summary.narrative_coverage, coverageCap);

    // ── Recalculate metrics ──────────────────────────────────────────

    const primaryIssues = reportObj.issues.filter((i: any) => i.finding_track === "primary");
    const secondaryIssues = reportObj.issues.filter((i: any) => i.finding_track === "secondary");

    reportObj.metrics = {
      issue_count: reportObj.issues.length,
      high_severity_count: reportObj.issues.filter((i: any) => i.severity === "high").length,
    };

    const primaryHighCount = primaryIssues.filter((i: any) => i.severity === "high").length;
    const primaryMedCount = primaryIssues.filter((i: any) => i.severity === "medium").length;

    if (primaryHighCount > 0) {
      summary.overall_risk = "high";
    } else if (primaryMedCount > 0) {
      summary.overall_risk = "medium";
    } else {
      const anySecondaryHigh = secondaryIssues.some((i: any) => i.severity === "high");
      summary.overall_risk = anySecondaryHigh ? "medium" : "low";
    }

    const finalIssuesHash = await hashIssuesArray(reportObj.issues);

    stages.push({
      stage: "final_emission",
      hash: finalIssuesHash,
      counts: {
        final_total: reportObj.issues.length,
        final_primary: primaryIssues.length,
        final_secondary: secondaryIssues.length,
        high_severity: reportObj.metrics.high_severity_count,
      },
      metadata: {
        overall_risk: summary.overall_risk,
        confidence: summary.review_confidence,
        coverage: summary.narrative_coverage,
      },
    });
    timestamps.final_emission = Date.now();

    // ── Build full diagnostics object ────────────────────────────────

    const diagnostics: ReviewerRunDiagnostics = {
      run_id: runId,
      pipeline_version: "3.3",
      timestamps,
      stages,
      input_fingerprint: {
        document_text_length: v2.document_text.length,
        document_text_hash: docTextHash,
        review_worthy_count: reviewWorthyCount,
        review_worthy_field_keys: reviewWorthyKeys,
        structured_answer_count: v2.structured_answers?.length ?? 0,
        unanswered_field_count: v2.unanswered_fields?.length ?? 0,
        unanswered_field_keys: unansweredKeys,
        has_reconciliation: hasReconciliation,
        reconciliation_match_count: v2.reconciliation_context?.reconciliation_summary?.matches ?? null,
        reconciliation_discrepancy_count: v2.reconciliation_context?.reconciliation_summary?.possible_discrepancies ?? null,
        has_trigger_metadata: !!v2.language_trigger_metadata,
        trigger_categories: triggerCategories,
        template_id: v2.template_id ?? null,
        session_id: v2.session_id,
      },
      llm_config: {
        provider: useGateway ? "lovable_gateway" : "openai_direct",
        model,
        temperature: 0,
        uses_json_mode: !useGateway,
        gateway: useGateway,
      },
      output_fingerprint: {
        raw_candidate_count: rawIssues.length,
        prefiltered_count: prefilteredIssues.length,
        dce_input_count: dceResult.stats.input_count,
        dce_output_count: dceResult.stats.output_count,
        final_primary_count: primaryIssues.length,
        final_secondary_count: secondaryIssues.length,
        final_risk: summary.overall_risk,
        final_confidence: summary.review_confidence,
        final_coverage: summary.narrative_coverage,
        final_issues_hash: finalIssuesHash,
      },
      // Candidate-level data for merge/split drift detection (dev only)
      candidate_excerpts: rawIssues.map((i: any) => (i.excerpt || "").slice(0, 100)),
      candidate_types: rawIssues.map((i: any) => i.type || "unknown"),
    };

    // ── Eye completion event with diagnostics ────────────────────────

    await eye(supabase, v2.session_id, "reviewer_v3.completed", {
      tenant_id: session.tenant_id,
      version: "3.3",
      run_id: runId,
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
      doc_text_hash: docTextHash,
      review_packet_hash: reviewPacketHash,
      raw_candidate_hash: rawCandidateHash,
      final_issues_hash: finalIssuesHash,
      dce_stats: {
        input_count: dceResult.stats.input_count,
        output_count: dceResult.stats.output_count,
        deduplicated: dceResult.stats.deduplicated,
        category_overrides: dceResult.stats.category_overrides,
        severity_adjustments: dceResult.stats.severity_adjustments,
        overlap_merges: dceResult.stats.overlap_merges,
        borderline_suppressed: dceResult.stats.borderline_suppressed,
      },
      llm_provider: useGateway ? "lovable_gateway" : "openai_direct",
      model,
    });

    return json(200, {
      success: true,
      review_report: reportObj,
      // Diagnostics returned to frontend for dev comparison tooling
      _diagnostics: diagnostics,
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
