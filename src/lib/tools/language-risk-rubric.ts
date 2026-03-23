/**
 * Language Risk Rubric — Deterministic Trigger Scanner
 *
 * Provides metadata-only trigger scanning for language risk categories.
 * Used to inform the LLM reviewer with category-level scrutiny hints.
 *
 * CRITICAL CONSTRAINTS:
 * - Output is metadata only (category + count). No text excerpts.
 * - Must run only on reviewer-eligible authored narrative, not full document text.
 * - Triggers are assistive — they do not produce automatic findings.
 * - All patterns are domain-neutral (not child-welfare-specific).
 */

// ── Risk Categories ─────────────────────────────────────────────────────

export type TriggerCategory =
  | "bias_stigma"
  | "judgmental_tone"
  | "unsupported_conclusion"
  | "policy_inconsistent";

export interface TriggerCategoryMeta {
  label: string;
  description: string;
  patterns: RegExp[];
}

const TRIGGER_CATEGORIES: Record<TriggerCategory, TriggerCategoryMeta> = {
  bias_stigma: {
    label: "Bias & Stigma",
    description: "Labeling, stereotyping, or dehumanizing language applied to people",
    patterns: [
      // Labeling patterns — "the [label]" applied to a person
      /\bthe\s+(addict|abuser|offender|perpetrator|criminal|delinquent|druggie|junkie|alcoholic|homeless|mentally\s+ill)\b/gi,
      // Stigmatizing shorthand
      /\b(substance\s+abuser|welfare\s+queen|deadbeat|crack\s+baby|frequent\s+flyer)\b/gi,
      // Dehumanizing language
      /\b(these\s+people|those\s+types|that\s+kind\s+of)\b/gi,
    ],
  },
  judgmental_tone: {
    label: "Judgmental Tone",
    description: "Moralizing, shaming, blaming, or unprofessional phrasing",
    patterns: [
      // Judgmental adjectives applied to people/behavior
      /\b(uncooperative|manipulative|hostile|noncompliant|defiant|belligerent|aggressive|combative|lazy|irresponsible)\b/gi,
      // Motive attribution — inferring intent without evidence
      /\b(refused\s+to|chose\s+not\s+to|failed\s+to\s+cooperate|unwilling\s+to|would\s+not\s+comply)\b/gi,
      // Moralizing/shaming
      /\b(should\s+have\s+known|has\s+no\s+excuse|clearly\s+doesn'?t\s+care|doesn'?t\s+seem\s+to\s+care)\b/gi,
    ],
  },
  unsupported_conclusion: {
    label: "Unsupported Conclusion",
    description: "Certainty intensifiers, overclaiming, or conclusions presented as fact without evidence",
    patterns: [
      // Certainty intensifiers
      /\b(clearly|obviously|undeniably|without\s+question|undoubtedly|certainly|definitely|absolutely)\b/gi,
      // Unsupported clinical/legal language
      /\b(diagnosed\s+with|guilty\s+of|suffering\s+from|is\s+(?:an?\s+)?(?:narcissist|sociopath|psychopath|borderline))\b/gi,
      // Overclaiming
      /\b(it\s+is\s+(?:clear|evident|obvious)\s+that|there\s+is\s+no\s+doubt|without\s+a\s+doubt)\b/gi,
      // Intent stated as fact
      /\b(intentionally|deliberately|knowingly|willfully)\s+(?!lied\b)/gi,
    ],
  },
  policy_inconsistent: {
    label: "Policy-Inconsistent Language",
    description: "Prohibited terminology or phrasing that conflicts with documentation standards",
    patterns: [
      // Common prohibited terms in professional documentation
      /\b(alleged\s+perpetrator|alleged\s+victim)\b/gi,
      // Informal/unprofessional shorthand
      /\b(gonna|wanna|gotta|ain'?t|dunno|kinda|sorta)\b/gi,
      // Emotionally loaded qualifiers in formal documentation
      /\b(tragically|heartbreakingly|shockingly|disturbingly|horrifyingly)\b/gi,
    ],
  },
};

// ── Attribution Markers (authored-vs-quoted detection) ────────────────────

const ATTRIBUTION_MARKERS: RegExp[] = [
  /\bclient\s+(?:stated|reported|indicated|disclosed|explained|mentioned|denied|claimed|expressed|shared)\b/gi,
  /\bmother\s+(?:stated|reported|indicated|said|explained|shared)\b/gi,
  /\bfather\s+(?:stated|reported|indicated|said|explained|shared)\b/gi,
  /\bparent\s+(?:stated|reported|indicated|said|explained|shared)\b/gi,
  /\b(?:source|informant|reporter|caller|referral\s+source)\s+(?:stated|reported|indicated|said)\b/gi,
  /\baccording\s+to\b/gi,
  /\b(?:school|teacher|counselor|therapist|doctor|physician|nurse|provider)\s+(?:reported|stated|indicated|noted)\b/gi,
  /\b(?:he|she|they)\s+(?:stated|reported|said|indicated|claimed|denied|explained)\b/gi,
  /\bworker\s+(?:observed|noted)\s+that\s+(?:client|mother|father|parent)\s+said\b/gi,
  /\bas\s+(?:reported|stated|described)\s+by\b/gi,
];

const QUOTED_REGION_RE = /[""\u201C\u201D]([^""\u201C\u201D]{10,}?)[""\u201C\u201D]/g;

// ── Public API ───────────────────────────────────────────────────────────

export interface TriggerScanResult {
  category: TriggerCategory;
  hitCount: number;
}

/**
 * Scan authored narrative text for language risk triggers.
 * Returns metadata only — category-level counts, no text excerpts.
 */
export function scanForLanguageTriggers(text: string): TriggerScanResult[] {
  if (!text || text.trim().length < 20) return [];

  const results: TriggerScanResult[] = [];

  for (const [category, meta] of Object.entries(TRIGGER_CATEGORIES) as [TriggerCategory, TriggerCategoryMeta][]) {
    let hitCount = 0;
    for (const pattern of meta.patterns) {
      // Reset lastIndex for global regex
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        hitCount++;
        // Safety: prevent infinite loops on zero-length matches
        if (match[0].length === 0) pattern.lastIndex++;
      }
    }
    if (hitCount > 0) {
      results.push({ category, hitCount });
    }
  }

  return results;
}

export interface AttributionContext {
  quotedRegionCount: number;
  attributionMarkerCount: number;
}

/**
 * Detect likely quoted or attributed content in text.
 * Returns metadata only — counts, no text excerpts.
 */
export function detectAttributionContext(text: string): AttributionContext {
  if (!text || text.trim().length < 20) {
    return { quotedRegionCount: 0, attributionMarkerCount: 0 };
  }

  // Count quoted regions
  QUOTED_REGION_RE.lastIndex = 0;
  let quotedRegionCount = 0;
  while (QUOTED_REGION_RE.exec(text) !== null) {
    quotedRegionCount++;
    if (QUOTED_REGION_RE.lastIndex === 0) break;
  }

  // Count attribution markers
  let attributionMarkerCount = 0;
  for (const marker of ATTRIBUTION_MARKERS) {
    marker.lastIndex = 0;
    while (marker.exec(text) !== null) {
      attributionMarkerCount++;
      if (marker.lastIndex === 0) break;
    }
  }

  return { quotedRegionCount, attributionMarkerCount };
}

/**
 * Naive sentence splitter for caseworker prose.
 * Splits on period + space/newline, question marks, and double newlines.
 */
export function splitIntoSentences(text: string): string[] {
  if (!text || text.trim().length === 0) return [];

  return text
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map(s => s.trim())
    .filter(s => s.length > 5);
}

/**
 * Build metadata-only trigger payload for the edge function.
 * No text excerpts — just category counts.
 */
export function buildTriggerMetadata(
  triggerResults: TriggerScanResult[],
  attributionContext: AttributionContext,
): Record<string, number> {
  const metadata: Record<string, number> = {};
  for (const r of triggerResults) {
    metadata[r.category] = r.hitCount;
  }
  metadata._quoted_regions = attributionContext.quotedRegionCount;
  metadata._attribution_markers = attributionContext.attributionMarkerCount;
  return metadata;
}

export { TRIGGER_CATEGORIES };
