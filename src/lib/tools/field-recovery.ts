/**
 * Schema-aware field recovery — hardened deterministic heuristic layer
 *
 * RULES:
 *   1. Every recovery REQUIRES a local anchor (label/prompt match)
 *   2. No global full-document fallback for structured fields
 *   3. Recovery searches only local block (same line, next line, small window)
 *   4. Each result includes recovery_method and anchor_used for debugging
 *   5. Fields are classified as review_worthy vs structure_only
 */

import type {
  Phase2SchemaField,
  RecoveredField,
  UnansweredField,
  HumanReviewField,
  RecoveryConfidence,
  RecoveryMethod,
  ReviewRelevance,
} from "./reviewer-v2-types";
import { classifyReviewRelevance } from "./reviewer-v2-types";

// ── Configuration ─────────────────────────────────────────────────────────

/** Max chars after anchor to inspect for structured fields */
const LOCAL_BLOCK_CHARS = 200;

/** Max chars after anchor for text span fields (slightly larger) */
const TEXT_BLOCK_CHARS = 300;

/** Max chars for a recovered answer */
const MAX_ANSWER_LENGTH = 500;

// ── Main entry point ──────────────────────────────────────────────────────

export interface FieldRecoveryResult {
  structured_answers: RecoveredField[];
  review_worthy_answers: RecoveredField[];
  unanswered_fields: UnansweredField[];
  human_review_fields: HumanReviewField[];
}

export function recoverFieldsFromDocument(
  documentText: string,
  schemaFields: Phase2SchemaField[],
): FieldRecoveryResult {
  const structured_answers: RecoveredField[] = [];
  const review_worthy_answers: RecoveredField[] = [];
  const unanswered_fields: UnansweredField[] = [];
  const human_review_fields: HumanReviewField[] = [];

  const normalizedText = documentText.replace(/\r\n/g, "\n");
  const lowerText = normalizedText.toLowerCase();

  for (const field of schemaFields) {
    const relevance = classifyReviewRelevance(field);

    // Human-review-only: include but mark
    if (field.requires_human_review) {
      const anchor = findAnchor(field, normalizedText, lowerText);
      const recovered = anchor ? attemptLocalRecovery(field, normalizedText, anchor) : null;

      human_review_fields.push({
        field_key: field.field_key,
        label: field.label,
        reason: field.human_review_reason || "Requires manual verification",
        recovered_value: recovered?.answer ?? null,
      });

      const entry: RecoveredField = {
        field_key: field.field_key,
        label: field.label,
        template_prompt: field.template_prompt,
        answer: recovered?.answer ?? null,
        recovery_confidence: "low",
        recovery_method: recovered?.method ?? "unresolved",
        anchor_used: anchor?.anchorText ?? null,
        source_excerpt: recovered?.excerpt ?? null,
        matching_mode: field.matching_mode,
        review_relevance: "structure_only",
        requires_human_review: true,
        missing: !recovered?.answer,
      };
      structured_answers.push(entry);
      continue;
    }

    // Find anchor first — no anchor = unresolved
    const anchor = findAnchor(field, normalizedText, lowerText);

    if (!anchor) {
      const unresolved: RecoveredField = {
        field_key: field.field_key,
        label: field.label,
        template_prompt: field.template_prompt,
        answer: null,
        recovery_confidence: "unrecovered",
        recovery_method: "unresolved",
        anchor_used: null,
        source_excerpt: null,
        matching_mode: field.matching_mode,
        review_relevance: relevance,
        requires_human_review: false,
        missing: true,
      };
      structured_answers.push(unresolved);
      if (relevance === "review_worthy") review_worthy_answers.push(unresolved);
      unanswered_fields.push({
        field_key: field.field_key,
        label: field.label,
        matching_mode: field.matching_mode,
        review_relevance: relevance,
      });
      continue;
    }

    const recovered = attemptLocalRecovery(field, normalizedText, anchor);

    if (recovered && recovered.answer) {
      const entry: RecoveredField = {
        field_key: field.field_key,
        label: field.label,
        template_prompt: field.template_prompt,
        answer: recovered.answer,
        recovery_confidence: recovered.confidence,
        recovery_method: recovered.method,
        anchor_used: anchor.anchorText,
        source_excerpt: recovered.excerpt,
        matching_mode: field.matching_mode,
        review_relevance: relevance,
        requires_human_review: false,
        missing: false,
      };
      structured_answers.push(entry);
      if (relevance === "review_worthy") review_worthy_answers.push(entry);
    } else {
      const unresolved: RecoveredField = {
        field_key: field.field_key,
        label: field.label,
        template_prompt: field.template_prompt,
        answer: null,
        recovery_confidence: "unrecovered",
        recovery_method: "unresolved",
        anchor_used: anchor.anchorText,
        source_excerpt: null,
        matching_mode: field.matching_mode,
        review_relevance: relevance,
        requires_human_review: false,
        missing: true,
      };
      structured_answers.push(unresolved);
      if (relevance === "review_worthy") review_worthy_answers.push(unresolved);
      unanswered_fields.push({
        field_key: field.field_key,
        label: field.label,
        matching_mode: field.matching_mode,
        review_relevance: relevance,
      });
    }
  }

  return { structured_answers, review_worthy_answers, unanswered_fields, human_review_fields };
}

// ── Anchor finding (strictly ordered) ─────────────────────────────────────

interface AnchorResult {
  /** Character index in full text where anchor starts */
  index: number;
  /** The text that matched as anchor */
  anchorText: string;
  /** How the anchor was found */
  anchorType: "exact_label" | "template_prompt" | "partial_label";
}

function findAnchor(
  field: Phase2SchemaField,
  _text: string,
  lowerText: string,
): AnchorResult | null {
  const lowerLabel = field.label.toLowerCase();
  const lowerPrompt = field.template_prompt.toLowerCase();

  // 1. Exact label match
  let idx = lowerText.indexOf(lowerLabel);
  if (idx !== -1) {
    return { index: idx, anchorText: field.label, anchorType: "exact_label" };
  }

  // 2. Template prompt match
  if (lowerPrompt !== lowerLabel) {
    idx = lowerText.indexOf(lowerPrompt);
    if (idx !== -1) {
      return { index: idx, anchorText: field.template_prompt, anchorType: "template_prompt" };
    }
  }

  // 3. Partial label (first 2-3 significant words, regex)
  const words = lowerLabel.split(/\s+/).filter((w) => w.length > 2);
  if (words.length >= 2) {
    const partial = words.slice(0, Math.min(3, words.length)).map(escapeRegExp).join("\\s+");
    const re = new RegExp(partial, "i");
    const m = re.exec(lowerText);
    if (m) {
      return { index: m.index, anchorText: m[0], anchorType: "partial_label" };
    }
  }

  return null;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Local block extraction ────────────────────────────────────────────────

function getLocalBlock(
  text: string,
  anchor: AnchorResult,
  windowSize: number,
): string {
  const afterAnchor = anchor.index + anchor.anchorText.length;
  return text.slice(afterAnchor, afterAnchor + windowSize);
}

function getSameLineText(text: string, anchor: AnchorResult): string {
  const afterAnchor = anchor.index + anchor.anchorText.length;
  const nextNewline = text.indexOf("\n", afterAnchor);
  const end = nextNewline !== -1 ? nextNewline : Math.min(text.length, afterAnchor + 200);
  return text.slice(afterAnchor, end);
}

function getNextLineText(text: string, anchor: AnchorResult): string {
  const afterAnchor = anchor.index + anchor.anchorText.length;
  const firstNewline = text.indexOf("\n", afterAnchor);
  if (firstNewline === -1) return "";
  const secondNewline = text.indexOf("\n", firstNewline + 1);
  const end = secondNewline !== -1 ? secondNewline : Math.min(text.length, firstNewline + 200);
  return text.slice(firstNewline + 1, end);
}

function cleanAnswer(raw: string): string {
  let cleaned = raw.trim();
  // Strip leading separators
  cleaned = cleaned.replace(/^[:\-–—|>\s]+/, "").trim();
  // Strip trailing punctuation noise
  cleaned = cleaned.replace(/[,;:]+$/, "").trim();
  return cleaned;
}

// ── Recovery dispatch (all modes require anchor) ──────────────────────────

interface LocalRecoveryResult {
  answer: string;
  confidence: RecoveryConfidence;
  method: RecoveryMethod;
  excerpt: string | null;
}

function attemptLocalRecovery(
  field: Phase2SchemaField,
  text: string,
  anchor: AnchorResult,
): LocalRecoveryResult | null {
  switch (field.matching_mode) {
    case "select_one":
      return recoverSelectOne(field, text, anchor);
    case "select_many":
      return recoverSelectMany(field, text, anchor);
    case "boolean_decision":
      return recoverBoolean(text, anchor);
    case "extract_number":
      return recoverNumber(text, anchor);
    case "extract_date":
      return recoverDate(text, anchor);
    case "extract_literal_span":
      return recoverTextSpan(text, anchor, true);
    case "extract_short_text":
      return recoverTextSpan(text, anchor, false);
    default:
      return recoverTextSpan(text, anchor, false);
  }
}

// ── Mode-specific recovery (local-only) ───────────────────────────────────

function recoverSelectOne(
  field: Phase2SchemaField,
  text: string,
  anchor: AnchorResult,
): LocalRecoveryResult | null {
  if (!field.allowed_values || field.allowed_values.length === 0) return null;

  // Search same line first, then local block
  const sameLine = getSameLineText(text, anchor).toLowerCase();
  const nextLine = getNextLineText(text, anchor).toLowerCase();
  const localBlock = getLocalBlock(text, anchor, LOCAL_BLOCK_CHARS).toLowerCase();

  for (const val of field.allowed_values) {
    const lv = val.toLowerCase();
    if (sameLine.includes(lv)) {
      return {
        answer: val,
        confidence: "high",
        method: "label_same_line",
        excerpt: sameLine.trim().slice(0, 80),
      };
    }
  }

  for (const val of field.allowed_values) {
    const lv = val.toLowerCase();
    if (nextLine.includes(lv)) {
      return {
        answer: val,
        confidence: "high",
        method: "label_next_line",
        excerpt: nextLine.trim().slice(0, 80),
      };
    }
  }

  // Broader local block (still anchored)
  for (const val of field.allowed_values) {
    const lv = val.toLowerCase();
    if (localBlock.includes(lv)) {
      return {
        answer: val,
        confidence: "medium",
        method: "allowed_value_local_match",
        excerpt: localBlock.trim().slice(0, 80),
      };
    }
  }

  return null;
}

function recoverSelectMany(
  field: Phase2SchemaField,
  text: string,
  anchor: AnchorResult,
): LocalRecoveryResult | null {
  if (!field.allowed_values || field.allowed_values.length === 0) return null;

  const localBlock = getLocalBlock(text, anchor, LOCAL_BLOCK_CHARS).toLowerCase();
  const matched: string[] = [];

  // Preserve schema order
  for (const val of field.allowed_values) {
    if (localBlock.includes(val.toLowerCase())) {
      matched.push(val);
    }
  }

  if (matched.length === 0) return null;

  return {
    answer: matched.join(", "),
    confidence: "high",
    method: "allowed_value_local_match",
    excerpt: localBlock.trim().slice(0, 100),
  };
}

function recoverBoolean(
  text: string,
  anchor: AnchorResult,
): LocalRecoveryResult | null {
  // Only check same line and next line — very tight
  const sameLine = cleanAnswer(getSameLineText(text, anchor)).toLowerCase();

  const yesRe = /^(yes|true|✓|☑|checked|x)\b/i;
  const noRe = /^(no|false|none|n\/a|☐|unchecked)\b/i;

  if (yesRe.test(sameLine)) {
    return { answer: "Yes", confidence: "high", method: "label_same_line", excerpt: sameLine.slice(0, 60) };
  }
  if (noRe.test(sameLine)) {
    return { answer: "No", confidence: "high", method: "label_same_line", excerpt: sameLine.slice(0, 60) };
  }

  const nextLine = cleanAnswer(getNextLineText(text, anchor)).toLowerCase();
  if (yesRe.test(nextLine)) {
    return { answer: "Yes", confidence: "medium", method: "label_next_line", excerpt: nextLine.slice(0, 60) };
  }
  if (noRe.test(nextLine)) {
    return { answer: "No", confidence: "medium", method: "label_next_line", excerpt: nextLine.slice(0, 60) };
  }

  return null;
}

function recoverNumber(
  text: string,
  anchor: AnchorResult,
): LocalRecoveryResult | null {
  const sameLine = cleanAnswer(getSameLineText(text, anchor));
  const numMatch = sameLine.match(/^(\d[\d,]*\.?\d*)/);

  if (numMatch) {
    return {
      answer: numMatch[1].replace(/,/g, ""),
      confidence: "high",
      method: "label_same_line",
      excerpt: sameLine.slice(0, 60),
    };
  }

  const nextLine = cleanAnswer(getNextLineText(text, anchor));
  const nextMatch = nextLine.match(/^(\d[\d,]*\.?\d*)/);
  if (nextMatch) {
    return {
      answer: nextMatch[1].replace(/,/g, ""),
      confidence: "medium",
      method: "label_next_line",
      excerpt: nextLine.slice(0, 60),
    };
  }

  return null;
}

function recoverDate(
  text: string,
  anchor: AnchorResult,
): LocalRecoveryResult | null {
  const sameLine = cleanAnswer(getSameLineText(text, anchor));
  const nextLine = cleanAnswer(getNextLineText(text, anchor));
  const candidates = [
    { text: sameLine, method: "label_same_line" as RecoveryMethod },
    { text: nextLine, method: "label_next_line" as RecoveryMethod },
  ];

  const patterns = [
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/,
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})(?!\d)/,
    /(\d{4})-(\d{2})-(\d{2})/,
  ];

  for (const candidate of candidates) {
    for (const pattern of patterns) {
      const m = candidate.text.match(pattern);
      if (!m) continue;

      try {
        let year: number, month: number, day: number;
        if (m[1].length === 4) {
          year = parseInt(m[1]); month = parseInt(m[2]); day = parseInt(m[3]);
        } else if (m[3].length === 4) {
          month = parseInt(m[1]); day = parseInt(m[2]); year = parseInt(m[3]);
        } else {
          month = parseInt(m[1]); day = parseInt(m[2]);
          const yr = parseInt(m[3]);
          year = yr < 50 ? 2000 + yr : 1900 + yr;
        }

        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
          const normalized = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          return {
            answer: normalized,
            confidence: "high",
            method: candidate.method,
            excerpt: candidate.text.slice(0, 60),
          };
        }
      } catch {
        // skip
      }
    }
  }

  return null;
}

function recoverTextSpan(
  text: string,
  anchor: AnchorResult,
  literalOnly: boolean,
): LocalRecoveryResult | null {
  const windowSize = literalOnly ? LOCAL_BLOCK_CHARS : TEXT_BLOCK_CHARS;

  // Try same line first
  const sameLine = cleanAnswer(getSameLineText(text, anchor));
  if (sameLine.length >= 1) {
    const answer = literalOnly
      ? sameLine.split(/\s{3,}|\t/)[0].trim() // smallest clean span
      : sameLine;

    if (answer.length >= 1) {
      return {
        answer: answer.slice(0, MAX_ANSWER_LENGTH),
        confidence: answer.length < 80 ? "high" : "medium",
        method: "label_same_line",
        excerpt: sameLine.slice(0, 80),
      };
    }
  }

  // Try next line
  const nextLine = cleanAnswer(getNextLineText(text, anchor));
  if (nextLine.length >= 1) {
    const answer = literalOnly
      ? nextLine.split(/\s{3,}|\t/)[0].trim()
      : nextLine;

    if (answer.length >= 1) {
      return {
        answer: answer.slice(0, MAX_ANSWER_LENGTH),
        confidence: "medium",
        method: "label_next_line",
        excerpt: nextLine.slice(0, 80),
      };
    }
  }

  // Try broader local block for text fields only (not literal spans)
  if (!literalOnly) {
    const block = cleanAnswer(getLocalBlock(text, anchor, windowSize));
    // Take up to first double newline or end
    const trimmed = block.split(/\n\n/)[0].trim();
    if (trimmed.length >= 1) {
      return {
        answer: trimmed.slice(0, MAX_ANSWER_LENGTH),
        confidence: "low",
        method: "partial_label_local_match",
        excerpt: trimmed.slice(0, 80),
      };
    }
  }

  return null;
}
