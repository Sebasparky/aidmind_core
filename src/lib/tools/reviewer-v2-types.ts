/**
 * Reviewer v2 — Typed interfaces for the schema-aware transient reviewer.
 *
 * Architecture:
 *   1. Client extracts text locally from uploaded PDF/DOCX
 *   2. Client runs schema-aware field recovery (deterministic heuristics)
 *   3. Client sends transient payload to run-reviewer v2
 *   4. Backend runs LLM reviewer on structured packet (not raw blob)
 *   5. Only the review report is persisted; source text is never stored
 */

// ── Recovery types (client-side) ──────────────────────────────────────────

export type RecoveryConfidence = "high" | "medium" | "low" | "unrecovered";

export interface RecoveredField {
  field_key: string;
  label: string;
  template_prompt: string;
  answer: string | null;
  recovery_confidence: RecoveryConfidence;
  source_excerpt: string | null;
  matching_mode: string;
  requires_human_review: boolean;
  missing: boolean;
}

export interface UnansweredField {
  field_key: string;
  label: string;
  matching_mode: string;
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
}

// ── Reviewer v2 request payload (sent to run-reviewer) ───────────────────

export interface ReviewerV2Request {
  session_id: string;         // UUID (resolved)
  template_id: string;        // UUID
  phase2_schema_id: string;   // UUID
  document_text: string;      // raw extracted text (transient, not persisted)
  structured_answers: RecoveredField[];
  unanswered_fields: UnansweredField[];
  human_review_fields: HumanReviewField[];
}

// ── Reviewer v2 response (new structured report) ─────────────────────────

export type ReviewIssueType =
  | "completeness"
  | "policy_language"
  | "tone"
  | "bias"
  | "consistency";

export type ReviewSeverity = "low" | "medium" | "high";

export interface ReviewIssue {
  type: ReviewIssueType;
  severity: ReviewSeverity;
  excerpt: string;
  explanation: string;
  /** Optional: which field_key this issue relates to */
  field_key?: string;
}

export interface ReviewerV2Report {
  summary: {
    overall_risk: ReviewSeverity;
    key_findings: string[];
    fields_reviewed: number;
    fields_missing: number;
    fields_human_review: number;
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
