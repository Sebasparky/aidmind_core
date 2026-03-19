/**
 * Schema-aware field recovery — deterministic heuristic layer
 *
 * Given raw extracted document text and a template schema, this module
 * attempts to recover structured field-value pairs using rule-based
 * matching. No AI/LLM is involved — this is pure heuristic parsing.
 *
 * The goal is NOT perfect extraction. The goal is to produce a strong
 * candidate structure that reduces the reviewer model's burden from
 * "parse + judge" to just "judge."
 */

import type {
  Phase2SchemaField,
  RecoveredField,
  UnansweredField,
  HumanReviewField,
  RecoveryConfidence,
} from "./reviewer-v2-types";

// ── Configuration ─────────────────────────────────────────────────────────

/** Max chars around a label match to search for answer text */
const CONTEXT_WINDOW = 300;

/** Max chars for a recovered answer */
const MAX_ANSWER_LENGTH = 500;

// ── Main entry point ──────────────────────────────────────────────────────

export interface FieldRecoveryResult {
  structured_answers: RecoveredField[];
  unanswered_fields: UnansweredField[];
  human_review_fields: HumanReviewField[];
}

export function recoverFieldsFromDocument(
  documentText: string,
  schemaFields: Phase2SchemaField[],
): FieldRecoveryResult {
  const structured_answers: RecoveredField[] = [];
  const unanswered_fields: UnansweredField[] = [];
  const human_review_fields: HumanReviewField[] = [];

  // Normalize text once
  const normalizedText = documentText.replace(/\r\n/g, "\n");
  const lowerText = normalizedText.toLowerCase();

  for (const field of schemaFields) {
    // Human-review-only fields: include but mark clearly
    if (field.requires_human_review) {
      const recovered = attemptRecovery(field, normalizedText, lowerText);
      human_review_fields.push({
        field_key: field.field_key,
        label: field.label,
        reason: field.human_review_reason || "Requires manual verification",
        recovered_value: recovered?.answer ?? null,
      });
      structured_answers.push({
        field_key: field.field_key,
        label: field.label,
        template_prompt: field.template_prompt,
        answer: recovered?.answer ?? null,
        recovery_confidence: "low",
        source_excerpt: recovered?.excerpt ?? null,
        matching_mode: field.matching_mode,
        requires_human_review: true,
        missing: !recovered?.answer,
      });
      continue;
    }

    const recovered = attemptRecovery(field, normalizedText, lowerText);

    if (recovered && recovered.answer) {
      structured_answers.push({
        field_key: field.field_key,
        label: field.label,
        template_prompt: field.template_prompt,
        answer: recovered.answer,
        recovery_confidence: recovered.confidence,
        source_excerpt: recovered.excerpt,
        matching_mode: field.matching_mode,
        requires_human_review: false,
        missing: false,
      });
    } else {
      unanswered_fields.push({
        field_key: field.field_key,
        label: field.label,
        matching_mode: field.matching_mode,
      });
      structured_answers.push({
        field_key: field.field_key,
        label: field.label,
        template_prompt: field.template_prompt,
        answer: null,
        recovery_confidence: "unrecovered",
        source_excerpt: null,
        matching_mode: field.matching_mode,
        requires_human_review: false,
        missing: true,
      });
    }
  }

  return { structured_answers, unanswered_fields, human_review_fields };
}

// ── Recovery dispatch ─────────────────────────────────────────────────────

interface RecoveryAttempt {
  answer: string;
  confidence: RecoveryConfidence;
  excerpt: string | null;
}

function attemptRecovery(
  field: Phase2SchemaField,
  text: string,
  lowerText: string,
): RecoveryAttempt | null {
  switch (field.matching_mode) {
    case "select_one":
      return recoverSelectOne(field, text, lowerText);
    case "select_many":
      return recoverSelectMany(field, text, lowerText);
    case "boolean_decision":
      return recoverBoolean(field, text, lowerText);
    case "extract_number":
      return recoverNumber(field, text, lowerText);
    case "extract_date":
      return recoverDate(field, text, lowerText);
    case "extract_literal_span":
    case "extract_short_text":
      return recoverTextSpan(field, text, lowerText);
    default:
      return recoverTextSpan(field, text, lowerText);
  }
}

// ── Label matching helpers ────────────────────────────────────────────────

function findLabelContext(
  label: string,
  prompt: string,
  text: string,
  lowerText: string,
): { index: number; context: string } | null {
  // Try exact label match first
  const lowerLabel = label.toLowerCase();
  let idx = lowerText.indexOf(lowerLabel);

  // Try prompt match if label not found
  if (idx === -1) {
    const lowerPrompt = prompt.toLowerCase();
    idx = lowerText.indexOf(lowerPrompt);
  }

  // Try partial label (first significant words)
  if (idx === -1) {
    const words = lowerLabel.split(/\s+/).filter((w) => w.length > 2);
    if (words.length >= 2) {
      const partial = words.slice(0, 3).join("\\s+");
      const re = new RegExp(partial, "i");
      const m = re.exec(lowerText);
      if (m) idx = m.index;
    }
  }

  if (idx === -1) return null;

  const start = idx;
  const end = Math.min(text.length, start + label.length + CONTEXT_WINDOW);
  const context = text.slice(start, end);

  return { index: idx, context };
}

function extractAnswerAfterLabel(context: string, label: string): string {
  // Find where the label ends, then grab text after separator (: or whitespace)
  const lowerCtx = context.toLowerCase();
  const lowerLabel = label.toLowerCase();
  const labelEnd = lowerCtx.indexOf(lowerLabel);
  if (labelEnd === -1) return "";

  let afterLabel = context.slice(labelEnd + label.length).trim();

  // Strip common separators
  afterLabel = afterLabel.replace(/^[:\-–—|>\s]+/, "").trim();

  // Take up to first newline or reasonable boundary
  const newlineIdx = afterLabel.indexOf("\n");
  if (newlineIdx !== -1 && newlineIdx < MAX_ANSWER_LENGTH) {
    afterLabel = afterLabel.slice(0, newlineIdx).trim();
  } else if (afterLabel.length > MAX_ANSWER_LENGTH) {
    afterLabel = afterLabel.slice(0, MAX_ANSWER_LENGTH).trim();
  }

  return afterLabel;
}

// ── Mode-specific recovery ────────────────────────────────────────────────

function recoverSelectOne(
  field: Phase2SchemaField,
  text: string,
  lowerText: string,
): RecoveryAttempt | null {
  if (!field.allowed_values || field.allowed_values.length === 0) return null;

  const ctx = findLabelContext(field.label, field.template_prompt, text, lowerText);
  const searchArea = ctx ? ctx.context.toLowerCase() : lowerText;

  for (const val of field.allowed_values) {
    if (searchArea.includes(val.toLowerCase())) {
      return {
        answer: val,
        confidence: ctx ? "high" : "medium",
        excerpt: ctx ? ctx.context.slice(0, 100) : null,
      };
    }
  }

  return null;
}

function recoverSelectMany(
  field: Phase2SchemaField,
  text: string,
  lowerText: string,
): RecoveryAttempt | null {
  if (!field.allowed_values || field.allowed_values.length === 0) return null;

  const ctx = findLabelContext(field.label, field.template_prompt, text, lowerText);
  const searchArea = ctx ? ctx.context.toLowerCase() : lowerText;

  const matched: string[] = [];
  for (const val of field.allowed_values) {
    if (searchArea.includes(val.toLowerCase())) {
      matched.push(val);
    }
  }

  if (matched.length === 0) return null;

  return {
    answer: matched.join(", "),
    confidence: ctx ? "high" : "medium",
    excerpt: ctx ? ctx.context.slice(0, 120) : null,
  };
}

function recoverBoolean(
  field: Phase2SchemaField,
  text: string,
  lowerText: string,
): RecoveryAttempt | null {
  const ctx = findLabelContext(field.label, field.template_prompt, text, lowerText);
  if (!ctx) return null;

  const afterText = extractAnswerAfterLabel(ctx.context, field.label).toLowerCase();

  const yesPatterns = /\b(yes|true|✓|☑|checked|x)\b/i;
  const noPatterns = /\b(no|false|none|n\/a|☐|unchecked)\b/i;

  if (yesPatterns.test(afterText)) {
    return { answer: "Yes", confidence: "high", excerpt: ctx.context.slice(0, 80) };
  }
  if (noPatterns.test(afterText)) {
    return { answer: "No", confidence: "high", excerpt: ctx.context.slice(0, 80) };
  }

  return null;
}

function recoverNumber(
  field: Phase2SchemaField,
  text: string,
  lowerText: string,
): RecoveryAttempt | null {
  const ctx = findLabelContext(field.label, field.template_prompt, text, lowerText);
  if (!ctx) return null;

  const afterText = extractAnswerAfterLabel(ctx.context, field.label);
  const numMatch = afterText.match(/(\d[\d,]*\.?\d*)/);
  if (numMatch) {
    return {
      answer: numMatch[1].replace(/,/g, ""),
      confidence: "medium",
      excerpt: ctx.context.slice(0, 80),
    };
  }

  return null;
}

function recoverDate(
  field: Phase2SchemaField,
  text: string,
  lowerText: string,
): RecoveryAttempt | null {
  const ctx = findLabelContext(field.label, field.template_prompt, text, lowerText);
  if (!ctx) return null;

  const afterText = extractAnswerAfterLabel(ctx.context, field.label);

  // Common date patterns
  const patterns = [
    // MM/DD/YYYY or MM-DD-YYYY
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/,
    // MM/DD/YY
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})(?!\d)/,
    // YYYY-MM-DD (ISO)
    /(\d{4})-(\d{2})-(\d{2})/,
  ];

  for (const pattern of patterns) {
    const m = afterText.match(pattern);
    if (!m) continue;

    try {
      let year: number, month: number, day: number;

      if (m[1].length === 4) {
        // ISO format: YYYY-MM-DD
        year = parseInt(m[1]);
        month = parseInt(m[2]);
        day = parseInt(m[3]);
      } else if (m[3].length === 4) {
        // MM/DD/YYYY
        month = parseInt(m[1]);
        day = parseInt(m[2]);
        year = parseInt(m[3]);
      } else {
        // MM/DD/YY
        month = parseInt(m[1]);
        day = parseInt(m[2]);
        let yr = parseInt(m[3]);
        year = yr < 50 ? 2000 + yr : 1900 + yr;
      }

      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const normalized = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        return {
          answer: normalized,
          confidence: "high",
          excerpt: ctx.context.slice(0, 80),
        };
      }
    } catch {
      // skip invalid
    }
  }

  return null;
}

function recoverTextSpan(
  field: Phase2SchemaField,
  text: string,
  lowerText: string,
): RecoveryAttempt | null {
  const ctx = findLabelContext(field.label, field.template_prompt, text, lowerText);
  if (!ctx) return null;

  const answer = extractAnswerAfterLabel(ctx.context, field.label);

  if (!answer || answer.length < 1) return null;

  // Clean up: remove trailing punctuation noise
  const cleaned = answer.replace(/[,;:]+$/, "").trim();
  if (!cleaned) return null;

  return {
    answer: cleaned.slice(0, MAX_ANSWER_LENGTH),
    confidence: cleaned.length < 80 ? "high" : "medium",
    excerpt: ctx.context.slice(0, 100),
  };
}
