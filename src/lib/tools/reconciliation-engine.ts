/**
 * Reconciliation / Diff Engine
 *
 * Compares Phase 2 note extraction (RecoveredField[]) with
 * completed-template parse results (ParsedFieldResult[]) to produce
 * a structured comparison packet with match/mismatch/correction/discrepancy status.
 */

import type { RecoveredField } from "./reviewer-v2-types";
import type {
  ParsedFieldResult,
  ParseConfidence,
  FieldReconciliation,
  ReconciliationResult,
  ReconciliationStatus,
  ReconciliationResolution,
  FieldTrustClass,
  ComparisonType,
} from "./parser-artifact-types";

// ── Field trust classification ───────────────────────────────────────────

function classifyFieldTrust(
  matchingMode: string,
  contentType?: string,
  label?: string,
): FieldTrustClass {
  if (contentType === "narrative") return "narrative";
  if (contentType === "checkbox") return "checkbox_group";
  if (contentType === "identifier") return "high_risk_identifier";

  if (matchingMode === "select_many") return "checkbox_group";
  if (matchingMode === "boolean_decision") return "decision_field";
  if (matchingMode === "extract_date" || matchingMode === "extract_number") return "low_risk_factual";

  // Heuristic from label
  const lowerLabel = (label || "").toLowerCase();
  if (/\b(name|ssn|dob|id|number|phone|address)\b/.test(lowerLabel)) return "high_risk_identifier";
  if (/\b(decision|summary|determination|recommendation)\b/.test(lowerLabel)) return "decision_field";
  if (/\b(narrative|description|reason|comment|notes)\b/.test(lowerLabel)) return "narrative";

  return "low_risk_factual";
}

// ── Comparison logic by trust class ──────────────────────────────────────

function normalizeForComparison(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?'"()[\]{}]/g, "")
    .trim();
}

function compareValues(
  notesValue: string | null,
  templateValue: string | null,
  trustClass: FieldTrustClass,
): { match: boolean; comparisonType: ComparisonType; similarity: number } {
  if (!notesValue && !templateValue) return { match: true, comparisonType: "exact", similarity: 1.0 };
  if (!notesValue || !templateValue) return { match: false, comparisonType: "exact", similarity: 0.0 };

  switch (trustClass) {
    case "checkbox_group": {
      // Set overlap comparison
      const notesSet = new Set(notesValue.split(",").map((v) => v.trim().toLowerCase()));
      const templateSet = new Set(templateValue.split(",").map((v) => v.trim().toLowerCase()));
      const intersection = new Set([...notesSet].filter((x) => templateSet.has(x)));
      const union = new Set([...notesSet, ...templateSet]);
      const overlap = union.size > 0 ? intersection.size / union.size : 0;
      return { match: overlap >= 0.8, comparisonType: "set_overlap", similarity: overlap };
    }

    case "narrative": {
      // Rough presence/consistency check — not exact text equality
      const nNorm = normalizeForComparison(notesValue);
      const tNorm = normalizeForComparison(templateValue);
      // Check if key terms from notes appear in template
      const noteWords = new Set(nNorm.split(" ").filter((w) => w.length > 3));
      const templateWords = new Set(tNorm.split(" ").filter((w) => w.length > 3));
      if (noteWords.size === 0) return { match: true, comparisonType: "presence_check", similarity: 0.5 };
      const overlap = [...noteWords].filter((w) => templateWords.has(w)).length;
      const similarity = overlap / noteWords.size;
      return { match: similarity >= 0.3, comparisonType: "semantic_rough", similarity };
    }

    case "high_risk_identifier": {
      // Normalized comparison but cautious
      const nNorm = normalizeForComparison(notesValue);
      const tNorm = normalizeForComparison(templateValue);
      return { match: nNorm === tNorm, comparisonType: "normalized", similarity: nNorm === tNorm ? 1.0 : 0.0 };
    }

    case "decision_field":
    case "low_risk_factual":
    default: {
      const nNorm = normalizeForComparison(notesValue);
      const tNorm = normalizeForComparison(templateValue);
      if (nNorm === tNorm) return { match: true, comparisonType: "normalized", similarity: 1.0 };
      // Check if one contains the other
      if (nNorm.includes(tNorm) || tNorm.includes(nNorm)) {
        return { match: true, comparisonType: "normalized", similarity: 0.85 };
      }
      return { match: false, comparisonType: "normalized", similarity: 0.0 };
    }
  }
}

// ── Resolution logic ─────────────────────────────────────────────────────

function determineResolution(
  status: ReconciliationStatus,
  notesConf: ParseConfidence | null,
  templateConf: ParseConfidence | null,
  trustClass: FieldTrustClass,
  similarity: number,
): ReconciliationResolution {
  if (status === "match") return "confirmed_match";

  if (status === "missing_in_notes") {
    // Template has it, notes don't — could be added during drafting
    return templateConf === "high" ? "likely_correction" : "unresolved";
  }

  if (status === "missing_in_template") {
    // Notes have it, template doesn't — likely omission
    return notesConf === "high" ? "likely_omission" : "unresolved";
  }

  if (status === "mismatch") {
    // Both present but different
    const notesStrength = notesConf === "high" ? 2 : notesConf === "medium" ? 1 : 0;
    const templateStrength = templateConf === "high" ? 2 : templateConf === "medium" ? 1 : 0;

    if (templateStrength > notesStrength) {
      // Template is stronger — likely intentional correction
      return "likely_correction";
    }
    if (notesStrength > templateStrength) {
      // Notes stronger, template different — possible discrepancy
      return "possible_discrepancy";
    }
    // Both equal strength
    if (similarity > 0.5) return "likely_correction";
    if (trustClass === "high_risk_identifier") return "possible_discrepancy";
    return "possible_discrepancy";
  }

  return "unresolved";
}

// ── Diff summary generator ───────────────────────────────────────────────

function generateDiffSummary(
  status: ReconciliationStatus,
  resolution: ReconciliationResolution,
  notesValue: string | null,
  templateValue: string | null,
): string {
  switch (status) {
    case "match":
      return "Values match";
    case "missing_in_notes":
      return `Present in completed form but not in notes: "${(templateValue || "").slice(0, 50)}"`;
    case "missing_in_template":
      return `Present in notes but missing from completed form: "${(notesValue || "").slice(0, 50)}"`;
    case "mismatch":
      if (resolution === "likely_correction") {
        return `Notes: "${(notesValue || "").slice(0, 30)}" → Form: "${(templateValue || "").slice(0, 30)}" (likely correction)`;
      }
      return `Notes: "${(notesValue || "").slice(0, 30)}" ≠ Form: "${(templateValue || "").slice(0, 30)}"`;
    case "unresolved":
      return "Could not determine match status";
    default:
      return "";
  }
}

// ── Main entry point ─────────────────────────────────────────────────────

export function reconcileNotesAndTemplate(
  notesRecovery: RecoveredField[],
  templateParse: ParsedFieldResult[],
  templateParseConfidence: ParseConfidence,
): ReconciliationResult {
  const fieldMap = new Map<string, RecoveredField>();
  for (const nr of notesRecovery) {
    fieldMap.set(nr.field_key, nr);
  }

  const fields: FieldReconciliation[] = [];
  let matches = 0, mismatches = 0, missingInNotes = 0, missingInTemplate = 0, unresolved = 0;
  let likelyCorrections = 0, possibleDiscrepancies = 0, likelyOmissions = 0;

  for (const tp of templateParse) {
    const notesField = fieldMap.get(tp.field_key);
    const notesValue = notesField?.answer ?? null;
    const templateValue = tp.template_value;
    const notesConf = notesField
      ? (notesField.recovery_confidence === "unrecovered" ? null : notesField.recovery_confidence as ParseConfidence)
      : null;
    const templateConf = tp.template_confidence;

    const trustClass = classifyFieldTrust(
      notesField?.matching_mode || "extract_short_text",
      undefined,
      notesField?.label || tp.field_key,
    );

    // Determine status
    let status: ReconciliationStatus;
    let similarity = 0;
    let comparisonType: ComparisonType = "exact";

    if (notesValue && templateValue) {
      const comparison = compareValues(notesValue, templateValue, trustClass);
      status = comparison.match ? "match" : "mismatch";
      similarity = comparison.similarity;
      comparisonType = comparison.comparisonType;
    } else if (!notesValue && templateValue) {
      status = "missing_in_notes";
    } else if (notesValue && !templateValue) {
      status = "missing_in_template";
    } else {
      status = "unresolved";
    }

    const resolution = determineResolution(status, notesConf, templateConf, trustClass, similarity);
    const needsReview = resolution === "possible_discrepancy" || resolution === "likely_omission" || status === "unresolved";

    // Count
    switch (status) {
      case "match": matches++; break;
      case "mismatch": mismatches++; break;
      case "missing_in_notes": missingInNotes++; break;
      case "missing_in_template": missingInTemplate++; break;
      case "unresolved": unresolved++; break;
    }
    switch (resolution) {
      case "likely_correction": likelyCorrections++; break;
      case "possible_discrepancy": possibleDiscrepancies++; break;
      case "likely_omission": likelyOmissions++; break;
    }

    fields.push({
      field_key: tp.field_key,
      section: tp.section,
      notes_value: notesValue,
      template_value: templateValue,
      notes_confidence: notesConf,
      template_confidence: templateConf,
      notes_source_excerpt: notesField?.source_excerpt ?? null,
      template_source_excerpt: tp.template_source_excerpt,
      notes_source_method: notesField?.recovery_method ?? null,
      template_source_method: tp.template_extraction_method,
      status,
      resolution,
      comparison_type: comparisonType,
      trust_class: trustClass,
      needs_review: needsReview,
      diff_summary: generateDiffSummary(status, resolution, notesValue, templateValue),
    });
  }

  // Also check for fields in notes that weren't in template parse
  for (const [key, notesField] of fieldMap) {
    if (!templateParse.find((tp) => tp.field_key === key)) {
      if (notesField.answer) {
        missingInTemplate++;
        likelyOmissions++;
        fields.push({
          field_key: key,
          section: notesField.label,
          notes_value: notesField.answer,
          template_value: null,
          notes_confidence: notesField.recovery_confidence === "unrecovered" ? null : notesField.recovery_confidence as ParseConfidence,
          template_confidence: null,
          notes_source_excerpt: notesField.source_excerpt,
          template_source_excerpt: null,
          notes_source_method: notesField.recovery_method,
          template_source_method: null,
          status: "missing_in_template",
          resolution: "likely_omission",
          comparison_type: "exact",
          trust_class: classifyFieldTrust(notesField.matching_mode, undefined, notesField.label),
          needs_review: true,
          diff_summary: `Present in notes but missing from completed form: "${(notesField.answer || "").slice(0, 50)}"`,
        });
      }
    }
  }

  const reliableForReview = templateParseConfidence !== "low" && (matches + mismatches) >= fields.length * 0.3;

  return {
    total_fields: fields.length,
    matches,
    mismatches,
    missing_in_notes: missingInNotes,
    missing_in_template: missingInTemplate,
    unresolved,
    likely_corrections: likelyCorrections,
    possible_discrepancies: possibleDiscrepancies,
    likely_omissions: likelyOmissions,
    template_parse_confidence: templateParseConfidence,
    reliable_for_review: reliableForReview,
    fields,
    reconciled_at: new Date().toISOString(),
  };
}
