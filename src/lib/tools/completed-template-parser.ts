/**
 * Completed-Template Parser — Deterministic multi-pass parser
 *
 * Consumes:
 *   - Extracted text from a completed form
 *   - Template parser artifacts (section map, skeleton, checkbox groups)
 *   - Phase 2 schema fields
 *
 * Produces:
 *   - Structured per-field parse results with confidence and source excerpts
 *
 * Passes:
 *   1. Skeleton subtraction — remove known static scaffold
 *   2. Section slicing — split text into known sections
 *   3. Section-specific extraction — per-section parser dispatch
 *   4. Garbage rejection + confidence scoring
 *   5. Normalized field output
 */

import type { Phase2SchemaField } from "./reviewer-v2-types";
import type {
  TemplateParserArtifact,
  SectionDefinition,
  CompletedTemplateParse,
  ParsedFieldResult,
  ParseConfidence,
  ParseStatus,
} from "./parser-artifact-types";

const PARSER_VERSION = "1.0.0";

// ── Scaffold patterns to reject ──────────────────────────────────────────

const SCAFFOLD_PATTERNS = [
  /^\s*page\s+\|?\s*\d+/i,
  /^\s*\d+\s*\|\s*page/i,
  /^\s*general\s+instructions/i,
  /^\s*confidential/i,
  /^\s*revised\s+\d/i,
  /^\s*approved\s+by/i,
  /^\s*form\s+#?\d/i,
  /^\s*draft\b/i,
  /^\s*appendix\s/i,
  /^-{3,}\s*$/,
  /^={3,}\s*$/,
  /^_{3,}\s*$/,
];

const GARBAGE_VALUE_PATTERNS = [
  /^page\s+\|?\s*\d+/i,
  /^\d+\s*\|\s*page/i,
  /^section\s+\d/i,
  /^part\s+[ivx\d]/i,
  /^general\s+instructions/i,
  /^appendix/i,
  /^table\s+of\s+contents/i,
];

// ── Hash helper for scaffold line matching ───────────────────────────────

function simpleLineHash(line: string): string {
  return line.trim().toLowerCase().replace(/\s+/g, " ");
}

// ── Pass 1: Skeleton subtraction ─────────────────────────────────────────

function subtractSkeleton(
  completedText: string,
  artifact: TemplateParserArtifact,
): string {
  const scaffoldSet = new Set(artifact.scaffold_line_hashes);
  const lines = completedText.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    const hash = simpleLineHash(line);
    // Keep section headers even if they match scaffold
    const isSectionHeader = Object.keys(artifact.section_header_map).some(
      (h) => hash.includes(h.toLowerCase()),
    );
    // Keep field label lines (contain colons after text)
    const looksLikeLabel = /^[A-Za-z].*:/.test(line.trim()) && line.trim().length < 60;

    if (scaffoldSet.has(hash) && !isSectionHeader && !looksLikeLabel) {
      continue; // Suppress known scaffold
    }

    // Also suppress lines matching scaffold patterns
    const isScaffold = SCAFFOLD_PATTERNS.some((p) => p.test(line));
    if (isScaffold && !isSectionHeader) continue;

    result.push(line);
  }

  return result.join("\n");
}

// ── Pass 2: Section slicing ──────────────────────────────────────────────

interface SectionSlice {
  section: SectionDefinition;
  startIndex: number;
  endIndex: number;
  text: string;
}

function sliceIntoSections(
  text: string,
  artifact: TemplateParserArtifact,
): SectionSlice[] {
  const lowerText = text.toLowerCase();
  const slices: SectionSlice[] = [];

  // Find all section boundaries
  const boundaries: Array<{ section: SectionDefinition; index: number }> = [];

  for (const section of artifact.sections) {
    let bestIndex = -1;

    // Try start_patterns (stored as regex strings)
    for (const patStr of section.start_patterns) {
      try {
        const re = new RegExp(patStr, "im");
        const m = re.exec(text);
        if (m && (bestIndex === -1 || m.index < bestIndex)) {
          bestIndex = m.index;
        }
      } catch {
        // Invalid regex, skip
      }
    }

    // Try section header map
    for (const [header, sectionName] of Object.entries(artifact.section_header_map)) {
      if (sectionName === section.name) {
        const idx = lowerText.indexOf(header.toLowerCase());
        if (idx !== -1 && (bestIndex === -1 || idx < bestIndex)) {
          bestIndex = idx;
        }
      }
    }

    // Try section name directly
    const nameIdx = lowerText.indexOf(section.name.toLowerCase());
    if (nameIdx !== -1 && (bestIndex === -1 || nameIdx < bestIndex)) {
      bestIndex = nameIdx;
    }

    if (bestIndex !== -1) {
      boundaries.push({ section, index: bestIndex });
    }
  }

  // Sort by position
  boundaries.sort((a, b) => a.index - b.index);

  // Create slices
  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i].index;
    const end = i + 1 < boundaries.length ? boundaries[i + 1].index : text.length;
    slices.push({
      section: boundaries[i].section,
      startIndex: start,
      endIndex: end,
      text: text.slice(start, end),
    });
  }

  return slices;
}

// ── Pass 3: Section-specific extraction ──────────────────────────────────

function extractFieldFromSection(
  field: Phase2SchemaField,
  sectionText: string,
  sectionDef: SectionDefinition,
  artifact: TemplateParserArtifact,
): { value: string | null; confidence: ParseConfidence; method: string; excerpt: string | null; warnings: string[] } {
  const lowerSection = sectionText.toLowerCase();
  const lowerLabel = field.label.toLowerCase();
  const lowerPrompt = field.template_prompt.toLowerCase();
  const warnings: string[] = [];

  // Find anchor within section
  let anchorIdx = lowerSection.indexOf(lowerLabel);
  let anchorText = field.label;
  if (anchorIdx === -1) {
    anchorIdx = lowerSection.indexOf(lowerPrompt);
    anchorText = field.template_prompt;
  }
  if (anchorIdx === -1) {
    // Partial match
    const words = lowerLabel.split(/\s+/).filter((w) => w.length > 2);
    if (words.length >= 2) {
      const partial = words.slice(0, 3).join(".*?");
      try {
        const re = new RegExp(partial, "i");
        const m = re.exec(lowerSection);
        if (m) {
          anchorIdx = m.index;
          anchorText = m[0];
        }
      } catch { /* skip */ }
    }
  }

  // Dispatch by content type / matching mode
  switch (field.matching_mode) {
    case "select_many":
      return extractCheckboxGroup(field, sectionText, lowerSection, sectionDef, artifact, warnings);
    case "select_one":
      return extractSelectOne(field, sectionText, lowerSection, anchorIdx, anchorText, warnings);
    case "boolean_decision":
      return extractBoolean(sectionText, lowerSection, anchorIdx, anchorText, sectionDef, warnings);
    case "extract_date":
      return extractDate(sectionText, anchorIdx, anchorText, warnings);
    case "extract_number":
      return extractNumber(sectionText, anchorIdx, anchorText, warnings);
    default:
      return extractText(field, sectionText, anchorIdx, anchorText, sectionDef, warnings);
  }
}

// ── Checkbox group extractor (section-wide) ──────────────────────────────

function extractCheckboxGroup(
  field: Phase2SchemaField,
  sectionText: string,
  lowerSection: string,
  _sectionDef: SectionDefinition,
  artifact: TemplateParserArtifact,
  warnings: string[],
): { value: string | null; confidence: ParseConfidence; method: string; excerpt: string | null; warnings: string[] } {
  if (!field.allowed_values || field.allowed_values.length === 0) {
    return { value: null, confidence: "low", method: "no_allowed_values", excerpt: null, warnings };
  }

  // Find the relevant checkbox group definition from artifact
  const groupDef = artifact.checkbox_groups.find(
    (cg) => cg.group_name.toLowerCase() === field.label.toLowerCase() ||
      cg.group_name.toLowerCase() === (field.field_group || "").toLowerCase(),
  );

  const markerSelected: string[] = [];
  const inclusionSelected: string[] = [];

  for (const val of field.allowed_values) {
    const lv = val.toLowerCase();
    const valIdx = lowerSection.indexOf(lv);
    if (valIdx === -1) continue;

    // Check for selection markers near the value
    const regionStart = Math.max(0, valIdx - 12);
    const regionEnd = Math.min(sectionText.length, valIdx + lv.length + 8);
    const markerRegion = sectionText.slice(regionStart, regionEnd);

    const hasMarker = /[xX✓☑✗☒■▣]/.test(markerRegion) ||
      /\\[\s*[xX✓]\s*\\]/.test(markerRegion) ||
      /\(\s*[xX✓]\s*\)/.test(markerRegion);

    if (hasMarker) {
      markerSelected.push(val);
    } else {
      inclusionSelected.push(val);
    }
  }

  const hasAnyMarkers = markerSelected.length > 0;
  let matched = hasAnyMarkers ? markerSelected : inclusionSelected;

  // Contamination guard: if no markers and most values match, it's the option list not selections
  if (!hasAnyMarkers && matched.length > field.allowed_values.length * 0.7) {
    warnings.push("Likely option list contamination — most allowed values found without selection markers");
    matched = [];
  }

  // "Other" overselection guard
  if (!hasAnyMarkers && matched.includes("Other") && matched.length > 1) {
    // Only keep Other if there's a marker or specific free-text after it
    const otherIdx = lowerSection.indexOf("other");
    if (otherIdx !== -1) {
      const afterOther = sectionText.slice(otherIdx + 5, otherIdx + 80).trim();
      const hasSpecificText = afterOther.length > 3 && !/^\s*[:\-]?\s*$/.test(afterOther);
      if (!hasSpecificText && groupDef?.has_other_option) {
        matched = matched.filter((v) => v !== "Other");
        warnings.push("Removed 'Other' — no specific free-text found after it");
      }
    }
  }

  if (matched.length === 0) {
    return { value: null, confidence: "low", method: "checkbox_section_scan", excerpt: null, warnings };
  }

  return {
    value: matched.join(", "),
    confidence: hasAnyMarkers ? "high" : "medium",
    method: hasAnyMarkers ? "checkbox_marker_match" : "checkbox_inclusion_match",
    excerpt: sectionText.trim().slice(0, 120),
    warnings,
  };
}

// ── Select-one extractor ─────────────────────────────────────────────────

function extractSelectOne(
  field: Phase2SchemaField,
  sectionText: string,
  lowerSection: string,
  anchorIdx: number,
  _anchorText: string,
  warnings: string[],
): { value: string | null; confidence: ParseConfidence; method: string; excerpt: string | null; warnings: string[] } {
  if (!field.allowed_values || anchorIdx === -1) {
    return { value: null, confidence: "low", method: "no_anchor", excerpt: null, warnings };
  }

  const afterAnchor = lowerSection.slice(anchorIdx);
  for (const val of field.allowed_values) {
    const lv = val.toLowerCase();
    const idx = afterAnchor.indexOf(lv);
    if (idx !== -1 && idx < 200) {
      return {
        value: val,
        confidence: idx < 80 ? "high" : "medium",
        method: "select_one_local_match",
        excerpt: sectionText.slice(anchorIdx, anchorIdx + idx + lv.length + 20).trim().slice(0, 80),
        warnings,
      };
    }
  }

  return { value: null, confidence: "low", method: "select_one_not_found", excerpt: null, warnings };
}

// ── Boolean extractor (section-level) ────────────────────────────────────

function extractBoolean(
  sectionText: string,
  lowerSection: string,
  anchorIdx: number,
  _anchorText: string,
  _sectionDef: SectionDefinition,
  warnings: string[],
): { value: string | null; confidence: ParseConfidence; method: string; excerpt: string | null; warnings: string[] } {
  if (anchorIdx === -1) {
    return { value: null, confidence: "low", method: "no_anchor", excerpt: null, warnings };
  }

  // Check broader area after anchor (section-level, not same-line only)
  const afterAnchor = lowerSection.slice(anchorIdx, anchorIdx + 300);

  // Look for yes/no with markers
  const yesPatterns = [/\[\s*[xX✓]\s*\]\s*yes/i, /yes\s*[✓☑xX]/i, /\byes\b/i, /\btrue\b/i, /\b✓\b/, /☑/];
  const noPatterns = [/\[\s*[xX✓]\s*\]\s*no\b/i, /no\s*[✓☑xX]/i, /\bno\b/i, /\bfalse\b/i, /☐/];

  // Check for marker-based yes
  for (const pat of yesPatterns.slice(0, 2)) {
    if (pat.test(afterAnchor)) {
      return { value: "Yes", confidence: "high", method: "boolean_marker_match", excerpt: afterAnchor.slice(0, 60), warnings };
    }
  }
  // Check for marker-based no
  for (const pat of noPatterns.slice(0, 2)) {
    if (pat.test(afterAnchor)) {
      return { value: "No", confidence: "high", method: "boolean_marker_match", excerpt: afterAnchor.slice(0, 60), warnings };
    }
  }

  // Fallback to keyword match (lower confidence)
  if (/\byes\b/i.test(afterAnchor.slice(0, 60))) {
    return { value: "Yes", confidence: "medium", method: "boolean_keyword_match", excerpt: afterAnchor.slice(0, 60), warnings };
  }
  if (/\bno\b/i.test(afterAnchor.slice(0, 60))) {
    return { value: "No", confidence: "medium", method: "boolean_keyword_match", excerpt: afterAnchor.slice(0, 60), warnings };
  }

  return { value: null, confidence: "low", method: "boolean_not_found", excerpt: null, warnings };
}

// ── Date extractor ───────────────────────────────────────────────────────

function extractDate(
  sectionText: string,
  anchorIdx: number,
  _anchorText: string,
  warnings: string[],
): { value: string | null; confidence: ParseConfidence; method: string; excerpt: string | null; warnings: string[] } {
  if (anchorIdx === -1) {
    return { value: null, confidence: "low", method: "no_anchor", excerpt: null, warnings };
  }

  const afterAnchor = sectionText.slice(anchorIdx, anchorIdx + 100);
  const datePatterns = [
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/,
    /(\d{4})-(\d{2})-(\d{2})/,
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})(?!\d)/,
  ];

  for (const pat of datePatterns) {
    const m = afterAnchor.match(pat);
    if (m) {
      return { value: m[0], confidence: "high", method: "date_regex", excerpt: afterAnchor.slice(0, 60), warnings };
    }
  }

  return { value: null, confidence: "low", method: "date_not_found", excerpt: null, warnings };
}

// ── Number extractor ─────────────────────────────────────────────────────

function extractNumber(
  sectionText: string,
  anchorIdx: number,
  _anchorText: string,
  warnings: string[],
): { value: string | null; confidence: ParseConfidence; method: string; excerpt: string | null; warnings: string[] } {
  if (anchorIdx === -1) {
    return { value: null, confidence: "low", method: "no_anchor", excerpt: null, warnings };
  }

  const afterAnchor = sectionText.slice(anchorIdx, anchorIdx + 100);
  const m = afterAnchor.match(/:\\s*(\d[\d,]*\.?\d*)/);
  if (m) {
    return { value: m[1].replace(/,/g, ""), confidence: "high", method: "number_regex", excerpt: afterAnchor.slice(0, 60), warnings };
  }

  return { value: null, confidence: "low", method: "number_not_found", excerpt: null, warnings };
}

// ── Text/narrative extractor (section-aware) ─────────────────────────────

function extractText(
  field: Phase2SchemaField,
  sectionText: string,
  anchorIdx: number,
  _anchorText: string,
  sectionDef: SectionDefinition,
  warnings: string[],
): { value: string | null; confidence: ParseConfidence; method: string; excerpt: string | null; warnings: string[] } {
  if (anchorIdx === -1) {
    // For narrative sections, try to capture the whole section content (minus headers)
    if (sectionDef.type === "narrative" || field.content_type === "narrative") {
      const lines = sectionText.split("\n");
      // Skip first line (likely section header) and collect content
      const contentLines = lines.slice(1).filter((l) => {
        const trimmed = l.trim();
        if (trimmed.length === 0) return false;
        // Skip scaffold
        return !GARBAGE_VALUE_PATTERNS.some((p) => p.test(trimmed));
      });
      const content = contentLines.join("\n").trim();
      if (content.length > 10) {
        return {
          value: content.slice(0, 2000),
          confidence: "medium",
          method: "narrative_section_capture",
          excerpt: content.slice(0, 120),
          warnings: [...warnings, "No specific anchor found; captured section content"],
        };
      }
    }
    return { value: null, confidence: "low", method: "no_anchor", excerpt: null, warnings };
  }

  const afterAnchor = sectionText.slice(anchorIdx);

  if (field.content_type === "narrative" || sectionDef.type === "narrative") {
    // For narrative fields, capture text from anchor to next field label or section end
    const lines = afterAnchor.split("\n");
    const contentLines: string[] = [];
    let started = false;

    for (const line of lines) {
      if (!started) {
        // Skip the anchor line itself
        started = true;
        // Include rest of anchor line after colon
        const colonIdx = line.indexOf(":");
        if (colonIdx !== -1) {
          const rest = line.slice(colonIdx + 1).trim();
          if (rest.length > 0) contentLines.push(rest);
        }
        continue;
      }

      const trimmed = line.trim();
      // Stop at next field label (Title Case: pattern) or scaffold
      if (/^[A-Z][a-zA-Z\s]+:/.test(trimmed) && trimmed.length < 60) break;
      if (GARBAGE_VALUE_PATTERNS.some((p) => p.test(trimmed))) continue;
      if (trimmed.length === 0 && contentLines.length > 0) {
        // Allow one blank line in narrative, stop at two consecutive
        const lastLine = contentLines[contentLines.length - 1];
        if (lastLine === "") break;
      }
      contentLines.push(trimmed);
    }

    const content = contentLines.join("\n").trim();
    if (content.length > 3) {
      return {
        value: content.slice(0, 2000),
        confidence: content.length > 30 ? "high" : "medium",
        method: "narrative_anchor_capture",
        excerpt: content.slice(0, 120),
        warnings,
      };
    }
    return { value: null, confidence: "low", method: "narrative_empty", excerpt: null, warnings };
  }

  // Standard text extraction: same-line then next-line
  const firstNewline = afterAnchor.indexOf("\n");
  const sameLine = (firstNewline !== -1 ? afterAnchor.slice(0, firstNewline) : afterAnchor.slice(0, 200));
  const colonIdx = sameLine.indexOf(":");
  const valueAfterColon = colonIdx !== -1 ? sameLine.slice(colonIdx + 1).trim() : sameLine.trim();

  // Strip leading separators
  const cleaned = valueAfterColon.replace(/^[\-–—|>\s]+/, "").trim();

  if (cleaned.length >= 1 && cleaned.length < 500) {
    // Garbage check
    if (GARBAGE_VALUE_PATTERNS.some((p) => p.test(cleaned))) {
      warnings.push("Extracted value looks like scaffold");
      return { value: null, confidence: "low", method: "garbage_rejected", excerpt: cleaned.slice(0, 80), warnings };
    }
    return {
      value: cleaned,
      confidence: cleaned.length < 80 ? "high" : "medium",
      method: "text_same_line",
      excerpt: sameLine.trim().slice(0, 80),
      warnings,
    };
  }

  // Try next line
  if (firstNewline !== -1) {
    const nextLine = afterAnchor.slice(firstNewline + 1, afterAnchor.indexOf("\n", firstNewline + 1));
    const nextCleaned = nextLine.trim().replace(/^[\-–—|>\s]+/, "").trim();
    if (nextCleaned.length >= 1 && nextCleaned.length < 500) {
      if (GARBAGE_VALUE_PATTERNS.some((p) => p.test(nextCleaned))) {
        return { value: null, confidence: "low", method: "garbage_rejected", excerpt: nextCleaned.slice(0, 80), warnings };
      }
      return {
        value: nextCleaned,
        confidence: "medium",
        method: "text_next_line",
        excerpt: nextLine.trim().slice(0, 80),
        warnings,
      };
    }
  }

  return { value: null, confidence: "low", method: "text_not_found", excerpt: null, warnings };
}

// ── Pass 4: Confidence scoring ───────────────────────────────────────────

function computeOverallConfidence(fields: ParsedFieldResult[]): ParseConfidence {
  if (fields.length === 0) return "low";
  const extracted = fields.filter((f) => f.parse_status === "extracted");
  const ratio = extracted.length / fields.length;
  const highConfCount = extracted.filter((f) => f.template_confidence === "high").length;

  if (ratio >= 0.7 && highConfCount >= fields.length * 0.4) return "high";
  if (ratio >= 0.4) return "medium";
  return "low";
}

// ── Main entry point ─────────────────────────────────────────────────────

export function parseCompletedTemplate(
  completedText: string,
  artifact: TemplateParserArtifact,
  schemaFields: Phase2SchemaField[],
): CompletedTemplateParse {
  const warnings: string[] = [];

  // Pass 1: Skeleton subtraction
  const cleanedText = subtractSkeleton(completedText, artifact);
  const skeletonLinesRemoved = completedText.split("\n").length - cleanedText.split("\n").length;
  if (skeletonLinesRemoved > 0) {
    warnings.push(`Removed ${skeletonLinesRemoved} scaffold lines`);
  }

  // Pass 2: Section slicing
  const sectionSlices = sliceIntoSections(cleanedText, artifact);
  const sectionsParsed = sectionSlices.map((s) => s.section.name);
  const allSectionNames = artifact.sections.map((s) => s.name);
  const sectionsUnresolved = allSectionNames.filter((n) => !sectionsParsed.includes(n));

  if (sectionSlices.length === 0) {
    warnings.push("No sections detected — falling back to full-text parsing");
  }

  // Pass 3: Section-specific extraction
  const fields: ParsedFieldResult[] = [];

  for (const field of schemaFields) {
    const fieldSection = field.section || "";

    // Find the matching section slice
    let matchedSlice = sectionSlices.find(
      (s) => s.section.name.toLowerCase() === fieldSection.toLowerCase(),
    );

    // Fallback: try partial match
    if (!matchedSlice) {
      matchedSlice = sectionSlices.find(
        (s) => s.section.name.toLowerCase().includes(fieldSection.toLowerCase()) ||
          fieldSection.toLowerCase().includes(s.section.name.toLowerCase()),
      );
    }

    // Fallback: search all text if no section match
    const searchText = matchedSlice?.text || cleanedText;
    const searchSection = matchedSlice?.section || {
      name: "Unknown",
      order: 0,
      type: "general" as const,
      field_anchors: [],
      start_patterns: [],
      has_repeated_blocks: false,
    };

    const result = extractFieldFromSection(field, searchText, searchSection, artifact);

    let parseStatus: ParseStatus;
    if (result.value && result.confidence !== "low") {
      parseStatus = "extracted";
    } else if (result.value) {
      parseStatus = "partial";
    } else if (result.warnings.some((w) => w.includes("garbage") || w.includes("scaffold"))) {
      parseStatus = "garbage_rejected";
    } else {
      parseStatus = "missing";
    }

    fields.push({
      field_key: field.field_key,
      section: fieldSection,
      template_value: result.value,
      template_confidence: result.confidence,
      template_extraction_method: result.method,
      template_source_excerpt: result.excerpt,
      template_section: matchedSlice?.section.name || fieldSection,
      parse_status: parseStatus,
      parse_warnings: result.warnings,
    });
  }

  // Pass 4: Overall confidence
  const overallConfidence = computeOverallConfidence(fields);
  const extractedCount = fields.filter((f) => f.parse_status === "extracted").length;

  return {
    overall_confidence: overallConfidence,
    sections_parsed: sectionsParsed,
    sections_unresolved: sectionsUnresolved,
    repeated_blocks_found: sectionSlices.filter((s) => s.section.has_repeated_blocks).length,
    warnings,
    reliable_for_completeness: overallConfidence !== "low" && extractedCount >= fields.length * 0.3,
    fields,
    parse_timestamp: new Date().toISOString(),
    parser_version: PARSER_VERSION,
  };
}
