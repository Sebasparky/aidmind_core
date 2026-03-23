/**
 * Reviewer v2 — Typed interfaces for the schema-aware transient reviewer.
 *
 * Architecture:
 *   1. Client extracts text locally from uploaded PDF/DOCX
 *   2. Client runs schema-aware field recovery (deterministic heuristics)
 *   3. Client separates review_worthy_answers from structure-only fields
 *   4. Client sends transient payload to run-reviewer v2
 *   5. Backend runs LLM reviewer on structured packet (not raw blob)
 *   6. Only the review report is returned; source text is never stored
 */

// ── Recovery metadata ─────────────────────────────────────────────────────

export type RecoveryConfidence = "high" | "medium" | "low" | "unrecovered";

export type RecoveryMethod =
  | "label_same_line"
  | "label_next_line"
  | "allowed_value_local_match"
  | "template_prompt_local_match"
  | "partial_label_local_match"
  | "unresolved";

/**
 * Whether a field's content is worth tone/bias/policy-language analysis
 * or only useful for completeness/consistency checks.
 */
export type ReviewRelevance = "review_worthy" | "structure_only";

// ── Recovered field ───────────────────────────────────────────────────────

export interface RecoveredField {
  field_key: string;
  label: string;
  template_prompt: string;
  answer: string | null;
  recovery_confidence: RecoveryConfidence;
  recovery_method: RecoveryMethod;
  anchor_used: string | null;
  source_excerpt: string | null;
  matching_mode: string;
  review_relevance: ReviewRelevance;
  requires_human_review: boolean;
  missing: boolean;
}

export interface UnansweredField {
  field_key: string;
  label: string;
  matching_mode: string;
  review_relevance: ReviewRelevance;
}

export interface HumanReviewField {
  field_key: string;
  label: string;
  reason: string;
  recovered_value: string | null;
}

// ── Schema field shape (from template_phase2_schemas) ─────────────────────

export interface Phase2SchemaField {
  field_key: string;
  label: string;
  template_prompt: string;
  fact_based: boolean;
  answer_type: string;
  matching_mode: string;
  allowed_values: string[] | null;
  requires_direct_statement: boolean;
  return_null_if_missing: boolean;
  matching_guidance: string;
  examples: string[];
  requires_human_review: boolean;
  human_review_reason: string | null;
  sensitivity_level: "low" | "medium" | "high";
  ambiguity_level: "low" | "medium" | "high";
  extraction_priority: "high" | "medium" | "low";
  // v2.1 section-aware fields (optional for backward compat with older schemas)
  section?: string;
  field_group?: string | null;
  content_type?: "checkbox" | "narrative" | "factual" | "identifier" | "categorical";
  field_purpose?: string[];
}

// ── Review relevance classifier ──────────────────────────────────────────

const STRUCTURE_ONLY_MODES = new Set([
  "select_one",
  "select_many",
  "boolean_decision",
  "extract_number",
  "extract_date",
]);

export function classifyReviewRelevance(field: Phase2SchemaField): ReviewRelevance {
  if (field.requires_human_review) return "structure_only";
  // v2.1: Use content_type when available for more accurate classification
  if (field.content_type === "narrative") return "review_worthy";
  if (field.content_type === "checkbox" || field.content_type === "categorical" || field.content_type === "identifier") return "structure_only";
  // Fallback to matching_mode for older schemas without content_type
  if (STRUCTURE_ONLY_MODES.has(field.matching_mode)) return "structure_only";
  // extract_short_text and extract_literal_span contain authored language
  return "review_worthy";
}

// ── Reviewer v2 request payload (sent to run-reviewer) ───────────────────

export interface ReviewerV2Request {
  session_id: string;
  template_id?: string;
  phase2_schema_id?: string;
  document_text: string;
  structured_answers: RecoveredField[];
  review_worthy_answers: RecoveredField[];
  unanswered_fields: UnansweredField[];
  human_review_fields: HumanReviewField[];
}

// ── Reviewer v2 response (structured report) ─────────────────────────────

export type ReviewIssueType =
  | "completeness"
  | "policy_language"
  | "tone"
  | "bias"
  | "consistency"
  | "unsupported_conclusion";

export type ReviewSeverity = "low" | "medium" | "high";

/** Deterministic finding track — assigned server-side, never by the model */
export type FindingTrack = "primary" | "secondary";

/** Map issue types to finding tracks deterministically */
export function assignFindingTrack(type: ReviewIssueType): FindingTrack {
  switch (type) {
    case "tone":
    case "bias":
    case "policy_language":
    case "unsupported_conclusion":
      return "primary";
    case "consistency":
    case "completeness":
    default:
      return "secondary";
  }
}

export interface ReviewIssue {
  type: ReviewIssueType;
  severity: ReviewSeverity;
  excerpt: string;
  explanation: string;
  field_key?: string;
  /** Assigned server-side deterministically based on issue type */
  finding_track?: FindingTrack;
}

export type ReviewConfidence = "high" | "medium" | "low";
export type NarrativeCoverage = "sufficient" | "partial" | "insufficient";

export interface ReviewerV2Report {
  summary: {
    overall_risk: ReviewSeverity;
    key_findings: string[];
    fields_reviewed: number;
    fields_missing: number;
    fields_human_review: number;
    review_confidence?: ReviewConfidence;
    narrative_coverage?: NarrativeCoverage;
  };
  issues: ReviewIssue[];
  metrics: {
    issue_count: number;
    high_severity_count: number;
  };
}

export interface ReviewerV2Response {
  success: boolean;
  review_report: ReviewerV2Report;
}

export interface ReviewerV2ErrorResponse {
  error: {
    code: string;
    message: string;
  };
}
