/**
 * Reviewer Field Eligibility Layer
 *
 * Determines which fields are eligible for user-facing Reviewer findings.
 * Reviewer is a LANGUAGE-FIRST tool that audits authored narrative text.
 *
 * Two eligibility tiers:
 *   - Language Review: fields containing authored text eligible for
 *     tone, bias, policy-language, and clarity analysis
 *   - Narrative Completeness: a narrow allowlist of major narrative
 *     sections eligible for blank/missing checks
 *
 * Explicitly EXCLUDED from user-facing findings:
 *   - Checkbox groups, select-many, select-one categorical fields
 *   - Booleans / yes-no markers
 *   - Date-only, time-only, number-only fields
 *   - Source information microfields (phone, address, email, SSN, DOB)
 *   - Demographics blocks, repeated person blocks
 *   - Family relationship matrices
 *   - Signature mechanics (unless a narrative comment is present)
 *   - Administrative markers (application dates, internal IDs)
 */

import type { Phase2SchemaField, RecoveredField, ReviewRelevance } from "./reviewer-v2-types";
import type { FieldReconciliation } from "./parser-artifact-types";

// ── Excluded matching modes ──────────────────────────────────────────────

const EXCLUDED_MATCHING_MODES = new Set([
  "select_one",
  "select_many",
  "boolean_decision",
  "extract_number",
  "extract_date",
]);

// ── Excluded content types ───────────────────────────────────────────────

const EXCLUDED_CONTENT_TYPES = new Set([
  "checkbox",
  "categorical",
  "identifier",
]);

// ── Excluded field label patterns (case-insensitive) ─────────────────────

const EXCLUDED_LABEL_PATTERNS = [
  /\b(phone|telephone|fax|cell)\s*(number|#)?\b/i,
  /\b(address|street|city|state|zip|county)\b/i,
  /\b(email|e-mail)\b/i,
  /\b(ssn|social\s*security)\b/i,
  /\b(dob|date\s*of\s*birth|birth\s*date)\b/i,
  /\b(case\s*number|case\s*id|file\s*number|record\s*number)\b/i,
  /\b(worker\s*id|employee\s*id|badge)\b/i,
  /\b(signature|signed\s*by|date\s*signed)\b/i,
  /\b(application\s*date|received\s*date|entry\s*date)\b/i,
  /\b(age|gender|sex|race|ethnicity|marital\s*status)\b/i,
  /\b(relationship\s*to|relation\s*to|related\s*to)\b/i,
  /\bperson\s*\d/i,
  /\bchild\s*\d/i,
  /\b(height|weight)\b/i,
  /\b(medicaid|medicare)\s*(number|#|id)\b/i,
];

// ── Excluded trust classes ───────────────────────────────────────────────

const EXCLUDED_TRUST_CLASSES = new Set([
  "checkbox_group",
  "high_risk_identifier",
  "repeated_entity",
]);

// ── Narrative completeness allowlist ─────────────────────────────────────
// Only these field labels/keys are eligible for "is this section blank?" checks

const NARRATIVE_COMPLETENESS_PATTERNS = [
  /\bnarrative\b/i,
  /\bintake\s*narrative\b/i,
  /\breason\w*\s*(for|of)\s*(involvement|referral|concern|contact)\b/i,
  /\bdecision\s*summary\b/i,
  /\bdetermination\s*summary\b/i,
  /\bcase\s*summary\b/i,
  /\bassessment\s*narrative\b/i,
  /\bsensitive\s*case\s*comment/i,
  /\bpresenting\s*concern/i,
  /\bplan\s*(of|for)\s*(action|service|care)/i,
  /\bsafety\s*plan\b/i,
  /\bsupervisor\s*(comment|note|review)/i,
  /\bspecify\b/i,
  /\bexplain\b/i,
  /\bdescri(be|ption)\b/i,
  /\bcomment\w*\b/i,
  /\bnote\w*\b/i,
  /\bsummary\b/i,
];

// ── Core eligibility functions ───────────────────────────────────────────

/**
 * Whether a schema field is eligible for language review (tone, bias, policy).
 * Only authored narrative / free-text fields qualify.
 */
export function isReviewerLanguageField(field: Phase2SchemaField): boolean {
  // Explicit exclusions by content_type
  if (field.content_type && EXCLUDED_CONTENT_TYPES.has(field.content_type)) return false;

  // Explicit exclusions by matching_mode
  if (EXCLUDED_MATCHING_MODES.has(field.matching_mode)) return false;

  // Explicit exclusions by label
  for (const pat of EXCLUDED_LABEL_PATTERNS) {
    if (pat.test(field.label)) return false;
  }

  // Human-review-only fields are excluded from language review
  if (field.requires_human_review) return false;

  // Narrative content_type is always eligible
  if (field.content_type === "narrative") return true;

  // Factual content_type: only if the matching mode suggests authored text
  if (field.content_type === "factual") {
    return field.matching_mode === "extract_short_text" || field.matching_mode === "extract_literal_span";
  }

  // Fallback: extract_short_text and extract_literal_span are eligible
  return field.matching_mode === "extract_short_text" || field.matching_mode === "extract_literal_span";
}

/**
 * Whether a field is eligible for narrative completeness checks
 * (i.e., "is this major narrative section blank?").
 * This is a narrow allowlist — most fields are NOT eligible.
 */
export function isReviewerNarrativeCompletionField(field: Phase2SchemaField): boolean {
  // Must first pass basic language eligibility
  if (!isReviewerLanguageField(field)) return false;

  // Must be narrative content type or match allowlist
  if (field.content_type === "narrative") return true;

  // Check label against allowlist
  const label = field.label;
  const key = field.field_key;
  for (const pat of NARRATIVE_COMPLETENESS_PATTERNS) {
    if (pat.test(label) || pat.test(key)) return true;
  }

  return false;
}

/**
 * Whether a recovered field should be included in user-facing reviewer findings.
 * This is the primary gate — if this returns false, the field MUST NOT
 * generate any user-visible completeness, consistency, or discrepancy finding.
 */
export function isRecoveredFieldReviewerEligible(field: RecoveredField): boolean {
  // Exclude by matching mode
  if (EXCLUDED_MATCHING_MODES.has(field.matching_mode)) return false;

  // Exclude by review_relevance if already classified
  if (field.review_relevance === "structure_only") return false;

  // Exclude by label patterns
  for (const pat of EXCLUDED_LABEL_PATTERNS) {
    if (pat.test(field.label)) return false;
  }

  // Exclude human-review-only
  if (field.requires_human_review) return false;

  return true;
}

/**
 * Whether a reconciliation field result is eligible for user-facing findings.
 */
export function isReconciliationFieldEligible(field: FieldReconciliation): boolean {
  // Exclude structured trust classes
  if (EXCLUDED_TRUST_CLASSES.has(field.trust_class)) return false;

  // Exclude by field_key patterns (heuristic)
  for (const pat of EXCLUDED_LABEL_PATTERNS) {
    if (pat.test(field.field_key)) return false;
  }

  return true;
}

/**
 * Filter a list of RecoveredField[] to only reviewer-eligible fields.
 */
export function filterToReviewerEligible(fields: RecoveredField[]): RecoveredField[] {
  return fields.filter(isRecoveredFieldReviewerEligible);
}

/**
 * Filter unanswered fields to only those eligible for narrative completeness.
 * Uses the original schema fields to check eligibility.
 */
export function filterUnansweredToNarrativeOnly(
  unanswered: Array<{ field_key: string; label: string; matching_mode: string; review_relevance?: string }>,
  schemaFields?: Phase2SchemaField[] | null,
): typeof unanswered {
  if (!schemaFields) {
    // Without schema, use heuristic: only allow fields whose labels match narrative patterns
    return unanswered.filter((f) => {
      if (EXCLUDED_MATCHING_MODES.has(f.matching_mode)) return false;
      for (const pat of NARRATIVE_COMPLETENESS_PATTERNS) {
        if (pat.test(f.label) || pat.test(f.field_key)) return true;
      }
      return false;
    });
  }

  const schemaMap = new Map(schemaFields.map((sf) => [sf.field_key, sf]));
  return unanswered.filter((f) => {
    const sf = schemaMap.get(f.field_key);
    if (!sf) return false;
    return isReviewerNarrativeCompletionField(sf);
  });
}

/**
 * Filter reconciliation fields to only narrative-eligible ones.
 */
export function filterReconciliationToNarrative(
  fields: FieldReconciliation[],
): FieldReconciliation[] {
  return fields.filter(isReconciliationFieldEligible);
}

// ── Diagnostics ──────────────────────────────────────────────────────────

export interface EligibilityDiagnostics {
  total_schema_fields: number;
  language_eligible: number;
  narrative_completion_eligible: number;
  excluded_checkbox: number;
  excluded_categorical: number;
  excluded_identifier: number;
  excluded_boolean: number;
  excluded_date_number: number;
  excluded_label_pattern: number;
  excluded_human_review: number;
}

export function computeEligibilityDiagnostics(fields: Phase2SchemaField[]): EligibilityDiagnostics {
  let language_eligible = 0, narrative_completion_eligible = 0;
  let excluded_checkbox = 0, excluded_categorical = 0, excluded_identifier = 0;
  let excluded_boolean = 0, excluded_date_number = 0, excluded_label_pattern = 0;
  let excluded_human_review = 0;

  for (const f of fields) {
    if (isReviewerLanguageField(f)) language_eligible++;
    if (isReviewerNarrativeCompletionField(f)) narrative_completion_eligible++;

    if (!isReviewerLanguageField(f)) {
      if (f.content_type === "checkbox" || f.matching_mode === "select_many") excluded_checkbox++;
      else if (f.content_type === "categorical" || f.matching_mode === "select_one") excluded_categorical++;
      else if (f.content_type === "identifier") excluded_identifier++;
      else if (f.matching_mode === "boolean_decision") excluded_boolean++;
      else if (f.matching_mode === "extract_date" || f.matching_mode === "extract_number") excluded_date_number++;
      else if (f.requires_human_review) excluded_human_review++;
      else {
        for (const pat of EXCLUDED_LABEL_PATTERNS) {
          if (pat.test(f.label)) { excluded_label_pattern++; break; }
        }
      }
    }
  }

  return {
    total_schema_fields: fields.length,
    language_eligible,
    narrative_completion_eligible,
    excluded_checkbox,
    excluded_categorical,
    excluded_identifier,
    excluded_boolean,
    excluded_date_number,
    excluded_label_pattern,
    excluded_human_review,
  };
}
