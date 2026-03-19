/**
 * Template Parser Artifact Types
 *
 * Generated once per template, cached and reused across all sessions.
 * Provides structural intelligence for deterministic completed-template parsing.
 */

// ── Template-level parser artifact (generated once, cached) ──────────────

export interface SectionDefinition {
  /** Canonical section name */
  name: string;
  /** Index in the template's section ordering */
  order: number;
  /** Section type for parser dispatch */
  type: "header" | "checkbox_group" | "narrative" | "demographics" | "decision" | "signature" | "relationship_matrix" | "general";
  /** Known label anchors within this section */
  field_anchors: string[];
  /** Regex patterns that mark the start of this section */
  start_patterns: string[];
  /** Whether this section contains repeated entity blocks */
  has_repeated_blocks: boolean;
  /** Number of expected repeats (e.g., 2 for "Person 1" / "Person 2") */
  expected_repeat_count?: number;
}

export interface CheckboxGroupDefinition {
  /** Which section this group belongs to */
  section: string;
  /** Group label/name */
  group_name: string;
  /** All possible checkbox values */
  options: string[];
  /** Whether the group supports "Other" with free text */
  has_other_option: boolean;
  /** Subgroup key if these belong to a subdivided section (e.g., "child_issues" vs "caretaker_issues") */
  subgroup?: string;
}

export interface NarrativeRegionDefinition {
  /** Which section */
  section: string;
  /** Region label */
  label: string;
  /** Whether this narrative may span multiple pages */
  may_span_pages: boolean;
  /** Keywords that help identify narrative content vs scaffold */
  content_indicators: string[];
}

export interface RepeatedBlockDefinition {
  /** Section containing repeats */
  section: string;
  /** Block label pattern (e.g., "Person {n}") */
  label_pattern: string;
  /** Fields expected within each repeat */
  inner_fields: string[];
  /** Max expected repeats */
  max_repeats: number;
}

export interface TemplateParserArtifact {
  /** Version of the artifact schema */
  artifact_schema_version: number;
  /** Template name for reference */
  template_name: string;
  /** SHA256 of the template content at generation time */
  source_template_hash: string;

  /** Normalized blank template text (static scaffold) */
  blank_template_skeleton: string;
  /** Section definitions in order */
  sections: SectionDefinition[];
  /** Section header map: normalized header → section name */
  section_header_map: Record<string, string>;
  /** Checkbox group definitions */
  checkbox_groups: CheckboxGroupDefinition[];
  /** Narrative region definitions */
  narrative_regions: NarrativeRegionDefinition[];
  /** Repeated block definitions (demographics, etc.) */
  repeated_blocks: RepeatedBlockDefinition[];
  /** Decision/summary region markers */
  decision_regions: string[];
  /** Signature page markers */
  signature_markers: string[];
  /** Lines known to be static scaffold (to subtract from completed forms) */
  scaffold_line_hashes: string[];
  /** Parser hints for specific field types */
  parser_hints: Record<string, string>;
}

// ── Completed-template parse result (session-specific) ───────────────────

export type ParseConfidence = "high" | "medium" | "low";
export type ParseStatus = "extracted" | "partial" | "missing" | "garbage_rejected" | "scaffold_only";

export interface ParsedFieldResult {
  field_key: string;
  section: string;
  template_value: string | null;
  template_confidence: ParseConfidence;
  template_extraction_method: string;
  template_source_excerpt: string | null;
  template_page_number?: number;
  template_section: string;
  parse_status: ParseStatus;
  parse_warnings: string[];
}

export interface CompletedTemplateParse {
  /** Overall parse confidence */
  overall_confidence: ParseConfidence;
  /** Sections successfully parsed */
  sections_parsed: string[];
  /** Sections that could not be resolved */
  sections_unresolved: string[];
  /** Repeated blocks found */
  repeated_blocks_found: number;
  /** Parser warnings */
  warnings: string[];
  /** Whether parse is reliable enough for strong completeness review */
  reliable_for_completeness: boolean;
  /** Per-field parse results */
  fields: ParsedFieldResult[];
  /** Run-level metadata */
  parse_timestamp: string;
  parser_version: string;
}

// ── Reconciliation types ─────────────────────────────────────────────────

export type ReconciliationStatus =
  | "match"
  | "mismatch"
  | "missing_in_notes"
  | "missing_in_template"
  | "unresolved";

export type ReconciliationResolution =
  | "confirmed_match"
  | "likely_correction"
  | "possible_discrepancy"
  | "likely_omission"
  | "unresolved";

export type FieldTrustClass =
  | "low_risk_factual"
  | "high_risk_identifier"
  | "checkbox_group"
  | "narrative"
  | "decision_field"
  | "repeated_entity"
  | "manual_review_sensitive";

export type ComparisonType =
  | "exact"
  | "normalized"
  | "set_overlap"
  | "presence_check"
  | "semantic_rough";

export interface FieldReconciliation {
  field_key: string;
  section: string;
  notes_value: string | null;
  template_value: string | null;
  notes_confidence: ParseConfidence | null;
  template_confidence: ParseConfidence | null;
  notes_source_excerpt: string | null;
  template_source_excerpt: string | null;
  notes_source_method: string | null;
  template_source_method: string | null;
  status: ReconciliationStatus;
  resolution: ReconciliationResolution;
  comparison_type: ComparisonType;
  trust_class: FieldTrustClass;
  needs_review: boolean;
  diff_summary: string;
}

export interface ReconciliationResult {
  /** Overall reconciliation summary */
  total_fields: number;
  matches: number;
  mismatches: number;
  missing_in_notes: number;
  missing_in_template: number;
  unresolved: number;
  likely_corrections: number;
  possible_discrepancies: number;
  likely_omissions: number;
  /** Parse confidence from template parse */
  template_parse_confidence: ParseConfidence;
  /** Whether reconciliation is reliable enough for strong reviewer claims */
  reliable_for_review: boolean;
  /** Per-field reconciliation */
  fields: FieldReconciliation[];
  /** Timestamp */
  reconciled_at: string;
}

// ── Reviewer prepared packet ─────────────────────────────────────────────

export interface ReviewerPreparedPacket {
  /** Original field recovery from completed template */
  structured_answers: any[];
  review_worthy_answers: any[];
  unanswered_fields: any[];
  human_review_fields: any[];
  /** New reconciliation data */
  reconciliation?: ReconciliationResult;
  /** Template parse metadata */
  template_parse?: CompletedTemplateParse;
  /** Document text */
  document_text: string;
}
