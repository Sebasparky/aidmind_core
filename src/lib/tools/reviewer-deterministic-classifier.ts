/**
 * Reviewer Deterministic Classifier
 *
 * A rule-driven post-processing pipeline that governs final category
 * assignment, span normalization, overlap resolution, and severity
 * calibration for reviewer findings.
 *
 * Architecture:
 *   1. LLM identifies candidate problematic spans conservatively
 *   2. This module applies deterministic rules to those candidates:
 *      a. Normalize spans (whitespace, casing, near-duplicate detection)
 *      b. Apply pattern-based category assignment
 *      c. Resolve overlapping/conflicting categories
 *      d. Calibrate severity with rule-based logic
 *      e. Emit final deduplicated findings
 *
 * Design principles:
 *   - Prefer fewer, cleaner findings over many inconsistent ones
 *   - One span → one primary finding unless truly multi-category
 *   - Categories must be explainable by matching specific rules
 *   - Severity should be stable across runs for the same text
 */

// ── Types ────────────────────────────────────────────────────────────────

export type IssueType =
  | "tone"
  | "bias"
  | "unsupported_conclusion"
  | "policy_language"
  | "completeness"
  | "consistency";

export type Severity = "low" | "medium" | "high";

export interface CandidateIssue {
  type: IssueType;
  severity: Severity;
  excerpt: string;
  explanation: string;
  field_key?: string;
  finding_track?: string;
}

export interface ClassifiedIssue extends CandidateIssue {
  /** Whether the category was overridden by deterministic rules */
  category_source: "llm" | "rule_override" | "rule_confirmed";
  /** Whether severity was adjusted by deterministic rules */
  severity_adjusted: boolean;
  /** Matched rule IDs for audit trail */
  matched_rules: string[];
}

// ── Pattern Lexicons ─────────────────────────────────────────────────────

interface CategoryRule {
  id: string;
  category: IssueType;
  patterns: RegExp[];
  /** If true, this rule is strong enough to override the LLM category */
  override_strength: "strong" | "moderate" | "weak";
  /** Maximum severity this rule should produce */
  severity_cap?: Severity;
  /** Minimum severity this rule should produce */
  severity_floor?: Severity;
}

/**
 * Judgmental Tone rules — phrasing that is unprofessional, blaming,
 * shaming, moralizing, or emotionally charged
 */
const TONE_RULES: CategoryRule[] = [
  {
    id: "tone_judgmental_adjectives",
    category: "tone",
    patterns: [
      /\b(uncooperative|manipulative|hostile|noncompliant|defiant|belligerent|aggressive|combative)\b/i,
      /\b(lazy|irresponsible|careless|reckless|negligent|incompetent)\b/i,
      /\b(difficult|problematic|troublesome|disruptive)\b/i,
    ],
    override_strength: "strong",
    severity_floor: "medium",
  },
  {
    id: "tone_moralizing",
    category: "tone",
    patterns: [
      /\b(should\s+have\s+known|has\s+no\s+excuse|clearly\s+doesn'?t\s+care)\b/i,
      /\b(doesn'?t\s+seem\s+to\s+care|shows?\s+no\s+remorse|doesn'?t\s+care\s+about)\b/i,
      /\b(poor\s+judgment|bad\s+decision|terrible\s+choice)\b/i,
      /\b(can'?t\s+be\s+bothered|won'?t\s+listen|refuses?\s+to\s+learn)\b/i,
    ],
    override_strength: "strong",
    severity_floor: "medium",
  },
  {
    id: "tone_motive_attribution",
    category: "tone",
    patterns: [
      /\b(refused\s+to|chose\s+not\s+to|failed\s+to\s+cooperate)\b/i,
      /\b(unwilling\s+to|would\s+not\s+comply|will\s+not\s+cooperate)\b/i,
    ],
    override_strength: "moderate",
    severity_cap: "medium",
  },
  {
    id: "tone_mild_subjective",
    category: "tone",
    patterns: [
      /\b(seems?\s+(?:un)?willing|appeared?\s+reluctant|seemed?\s+disinterested)\b/i,
      /\b(somewhat\s+(?:un)?cooperative|not\s+(?:very\s+)?forthcoming)\b/i,
    ],
    override_strength: "weak",
    severity_cap: "medium",
  },
];

/**
 * Bias & Assumption rules — labeling, stereotyping, or framing
 * people through unsupported generalizations
 */
const BIAS_RULES: CategoryRule[] = [
  {
    id: "bias_person_labeling",
    category: "bias",
    patterns: [
      /\bthe\s+(addict|abuser|offender|perpetrator|criminal|delinquent)\b/i,
      /\bthe\s+(druggie|junkie|alcoholic|homeless|mentally\s+ill)\b/i,
      /\b(substance\s+abuser|welfare\s+queen|deadbeat|crack\s+baby|frequent\s+flyer)\b/i,
    ],
    override_strength: "strong",
    severity_floor: "high",
  },
  {
    id: "bias_dehumanizing",
    category: "bias",
    patterns: [
      /\b(these\s+people|those\s+types|that\s+kind\s+of\s+(?:person|family|parent))\b/i,
      /\b(people\s+like\s+(?:him|her|them|this))\b/i,
    ],
    override_strength: "strong",
    severity_floor: "high",
  },
  {
    id: "bias_capability_framing",
    category: "bias",
    patterns: [
      /\b(incapable\s+of|unable\s+to\s+(?:parent|care|provide|manage))\b/i,
      /\b(not\s+(?:fit|capable|able)\s+to\s+(?:parent|care|raise))\b/i,
      /\b(will\s+never\s+(?:change|improve|learn))\b/i,
    ],
    override_strength: "strong",
    severity_floor: "medium",
  },
  {
    id: "bias_cultural_assumption",
    category: "bias",
    patterns: [
      /\b(typical(?:ly)?\s+(?:of|for)\s+(?:this|their|that)\s+(?:culture|background|community))\b/i,
      /\b(as\s+(?:is\s+)?(?:common|typical|usual)\s+(?:in|for|with)\s+(?:this|their|that))\b/i,
    ],
    override_strength: "strong",
    severity_floor: "high",
  },
];

/**
 * Unsupported Conclusion rules — certainty markers, overclaiming,
 * conclusions stated as fact without evidence
 */
const UNSUPPORTED_CONCLUSION_RULES: CategoryRule[] = [
  {
    id: "uc_certainty_intensifiers",
    category: "unsupported_conclusion",
    patterns: [
      /\b(clearly|obviously|undeniably|without\s+question|undoubtedly|certainly|definitely|absolutely)\b/i,
    ],
    override_strength: "moderate",
    severity_cap: "medium",
  },
  {
    id: "uc_overclaiming",
    category: "unsupported_conclusion",
    patterns: [
      /\b(it\s+is\s+(?:clear|evident|obvious)\s+that)\b/i,
      /\b(there\s+is\s+no\s+doubt|without\s+a\s+doubt)\b/i,
      /\b(this\s+(?:clearly\s+)?(?:proves?|demonstrates?|shows?|confirms?)\s+that)\b/i,
    ],
    override_strength: "strong",
    severity_floor: "medium",
  },
  {
    id: "uc_intent_as_fact",
    category: "unsupported_conclusion",
    patterns: [
      /\b(intentionally|deliberately|knowingly|willfully)\s+\w+/i,
    ],
    override_strength: "strong",
    severity_floor: "medium",
  },
  {
    id: "uc_clinical_overclaim",
    category: "unsupported_conclusion",
    patterns: [
      /\b(diagnosed\s+with|suffering\s+from)\b/i,
      /\bis\s+(?:an?\s+)?(?:narcissist|sociopath|psychopath|borderline|bipolar|schizophrenic)\b/i,
    ],
    override_strength: "strong",
    severity_floor: "high",
  },
  {
    id: "uc_risk_assertion",
    category: "unsupported_conclusion",
    patterns: [
      /\b(poses?\s+(?:a\s+)?(?:significant|serious|imminent|clear)\s+(?:risk|danger|threat))\b/i,
      /\b(is\s+(?:a\s+)?(?:danger|threat|risk)\s+to)\b/i,
    ],
    override_strength: "strong",
    severity_floor: "high",
  },
];

/**
 * Policy Language rules — prohibited terminology, informal language
 */
const POLICY_RULES: CategoryRule[] = [
  {
    id: "policy_prohibited_terms",
    category: "policy_language",
    patterns: [
      /\b(alleged\s+perpetrator|alleged\s+victim)\b/i,
    ],
    override_strength: "strong",
    severity_floor: "medium",
  },
  {
    id: "policy_informal_language",
    category: "policy_language",
    patterns: [
      /\b(gonna|wanna|gotta|ain'?t|dunno|kinda|sorta)\b/i,
    ],
    override_strength: "strong",
    severity_floor: "medium",
  },
  {
    id: "policy_emotional_qualifiers",
    category: "policy_language",
    patterns: [
      /\b(tragically|heartbreakingly|shockingly|disturbingly|horrifyingly)\b/i,
    ],
    override_strength: "strong",
    severity_floor: "medium",
  },
];

const ALL_RULES: CategoryRule[] = [
  ...TONE_RULES,
  ...BIAS_RULES,
  ...UNSUPPORTED_CONCLUSION_RULES,
  ...POLICY_RULES,
];

// ── Span Normalization ───────────────────────────────────────────────────

/**
 * Normalize an excerpt for comparison purposes.
 * Strips whitespace, normalizes casing, removes edge punctuation.
 */
export function normalizeExcerpt(excerpt: string): string {
  return excerpt
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^["'""\u201C\u201D]+|["'""\u201C\u201D]+$/g, "") // strip edge quotes
    .replace(/^[.,;:!?]+|[.,;:!?]+$/g, "") // strip edge punctuation
    .trim();
}

/**
 * Check if two excerpts overlap significantly.
 * Returns true if one contains the other, or if they share >60% of words.
 */
export function excerptOverlaps(a: string, b: string): boolean {
  const na = normalizeExcerpt(a);
  const nb = normalizeExcerpt(b);

  if (!na || !nb) return false;

  // Direct containment
  if (na.includes(nb) || nb.includes(na)) return true;

  // Word overlap check
  const wordsA = new Set(na.split(/\s+/));
  const wordsB = new Set(nb.split(/\s+/));
  const intersection = [...wordsA].filter(w => wordsB.has(w));
  const smaller = Math.min(wordsA.size, wordsB.size);

  if (smaller > 0 && intersection.length / smaller >= 0.6) return true;

  return false;
}

// ── Pattern Matching ─────────────────────────────────────────────────────

interface RuleMatch {
  rule: CategoryRule;
  matchCount: number;
}

/**
 * Find all rules that match against an excerpt.
 */
function matchRulesAgainstExcerpt(excerpt: string): RuleMatch[] {
  const matches: RuleMatch[] = [];

  for (const rule of ALL_RULES) {
    let totalMatches = 0;
    for (const pattern of rule.patterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(excerpt)) !== null) {
        totalMatches++;
        if (match[0].length === 0) pattern.lastIndex++;
      }
    }
    if (totalMatches > 0) {
      matches.push({ rule, matchCount: totalMatches });
    }
  }

  return matches;
}

// ── Category Precedence ──────────────────────────────────────────────────

/**
 * Category priority for overlap resolution.
 * Higher number = takes precedence when spans overlap.
 *
 * Policy violations are highest because they're most objective.
 * Tone issues are next because they're the highest-priority language concern.
 * Bias follows because it's closely related to tone but more specific.
 * Unsupported conclusion is lower because it often co-occurs with tone/bias.
 */
const CATEGORY_PRIORITY: Record<IssueType, number> = {
  policy_language: 5,
  tone: 4,
  bias: 3,
  unsupported_conclusion: 2,
  completeness: 1,
  consistency: 1,
};

/**
 * Rules for when two categories on the same span should coexist vs. merge.
 *
 * Returns the single winning category, or null if both should survive.
 */
function resolveOverlappingCategories(
  typeA: IssueType,
  typeB: IssueType,
  ruleMatchesA: RuleMatch[],
  ruleMatchesB: RuleMatch[],
): IssueType | null {
  // Same category → always merge (dedup)
  if (typeA === typeB) return typeA;

  // completeness/consistency never overlap with primary types
  if (typeA === "completeness" || typeA === "consistency") return null;
  if (typeB === "completeness" || typeB === "consistency") return null;

  // tone + bias on same span: keep the one with stronger rule matches
  if ((typeA === "tone" && typeB === "bias") || (typeA === "bias" && typeB === "tone")) {
    const toneStrength = ruleMatchesA
      .filter(m => m.rule.category === "tone")
      .reduce((sum, m) => sum + m.matchCount, 0);
    const biasStrength = ruleMatchesB
      .filter(m => m.rule.category === "bias")
      .reduce((sum, m) => sum + m.matchCount, 0);
    // If one is clearly stronger, keep it; otherwise prefer tone
    return toneStrength >= biasStrength ? "tone" : "bias";
  }

  // unsupported_conclusion + tone: if there are certainty markers, keep UC;
  // if primarily judgmental language, keep tone
  if (
    (typeA === "unsupported_conclusion" && typeB === "tone") ||
    (typeA === "tone" && typeB === "unsupported_conclusion")
  ) {
    const hasUcStrong = [...ruleMatchesA, ...ruleMatchesB].some(
      m => m.rule.category === "unsupported_conclusion" && m.rule.override_strength === "strong"
    );
    return hasUcStrong ? "unsupported_conclusion" : "tone";
  }

  // unsupported_conclusion + bias: similar logic
  if (
    (typeA === "unsupported_conclusion" && typeB === "bias") ||
    (typeA === "bias" && typeB === "unsupported_conclusion")
  ) {
    const hasUcStrong = [...ruleMatchesA, ...ruleMatchesB].some(
      m => m.rule.category === "unsupported_conclusion" && m.rule.override_strength === "strong"
    );
    return hasUcStrong ? "unsupported_conclusion" : "bias";
  }

  // policy_language always wins against non-policy
  if (typeA === "policy_language") return typeA;
  if (typeB === "policy_language") return typeB;

  // Default: keep higher priority
  return CATEGORY_PRIORITY[typeA] >= CATEGORY_PRIORITY[typeB] ? typeA : typeB;
}

// ── Severity Calibration ─────────────────────────────────────────────────

const SEVERITY_ORDER: Record<Severity, number> = { low: 0, medium: 1, high: 2 };

function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_ORDER[a] >= SEVERITY_ORDER[b] ? a : b;
}

function minSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_ORDER[a] <= SEVERITY_ORDER[b] ? a : b;
}

/**
 * Apply deterministic severity rules based on matched patterns.
 */
function calibrateSeverity(
  llmSeverity: Severity,
  ruleMatches: RuleMatch[],
  _finalCategory: IssueType,
): { severity: Severity; adjusted: boolean } {
  if (ruleMatches.length === 0) {
    return { severity: llmSeverity, adjusted: false };
  }

  let adjustedSeverity = llmSeverity;
  let wasAdjusted = false;

  for (const { rule } of ruleMatches) {
    // Apply severity floor (minimum)
    if (rule.severity_floor && SEVERITY_ORDER[adjustedSeverity] < SEVERITY_ORDER[rule.severity_floor]) {
      adjustedSeverity = rule.severity_floor;
      wasAdjusted = true;
    }
    // Apply severity cap (maximum)
    if (rule.severity_cap && SEVERITY_ORDER[adjustedSeverity] > SEVERITY_ORDER[rule.severity_cap]) {
      adjustedSeverity = rule.severity_cap;
      wasAdjusted = true;
    }
  }

  return { severity: adjustedSeverity, adjusted: wasAdjusted };
}

// ── Explanation Alignment ────────────────────────────────────────────────

const CATEGORY_EXPLANATION_PREFIXES: Record<IssueType, string[]> = {
  tone: [
    "uses judgmental",
    "unprofessional",
    "emotionally charged",
    "blaming",
    "shaming",
    "condescending",
    "judgmental tone",
    "moralizing",
  ],
  bias: [
    "labels the person",
    "stigmatizing",
    "stereotype",
    "assumption",
    "unsupported generalization",
    "bias",
    "discriminatory",
  ],
  unsupported_conclusion: [
    "reaches a conclusion",
    "without sufficient evidence",
    "stated as fact",
    "certainty stronger than",
    "overclaims",
    "unsupported",
    "infers intent",
    "attributes motive",
  ],
  policy_language: [
    "prohibited term",
    "policy",
    "informal language",
    "unprofessional terminology",
  ],
  completeness: ["blank", "empty", "missing", "insufficient"],
  consistency: ["contradicts", "differs from", "inconsistent"],
};

/**
 * Check if an explanation reasonably aligns with its category.
 * Returns true if alignment is acceptable.
 */
function isExplanationAligned(explanation: string, category: IssueType): boolean {
  const prefixes = CATEGORY_EXPLANATION_PREFIXES[category] ?? [];
  const lower = explanation.toLowerCase();
  return prefixes.some(p => lower.includes(p));
}

/**
 * Generate a category-aligned explanation prefix when the original
 * explanation drifts from the final category.
 */
function alignExplanation(
  explanation: string,
  originalCategory: IssueType,
  finalCategory: IssueType,
): string {
  if (originalCategory === finalCategory) return explanation;
  if (isExplanationAligned(explanation, finalCategory)) return explanation;

  // Prepend a category-aligned framing
  const framings: Record<IssueType, string> = {
    tone: "Uses judgmental or unprofessional language —",
    bias: "Contains stigmatizing language or unsupported assumptions —",
    unsupported_conclusion: "Reaches a conclusion without sufficient supporting evidence —",
    policy_language: "Uses prohibited or policy-inconsistent terminology —",
    completeness: explanation, // No reframing needed
    consistency: explanation,
  };

  const prefix = framings[finalCategory];
  if (!prefix || prefix === explanation) return explanation;

  // Avoid double-prefixing
  if (explanation.toLowerCase().startsWith(prefix.toLowerCase().slice(0, 20))) {
    return explanation;
  }

  return `${prefix} ${explanation.charAt(0).toLowerCase()}${explanation.slice(1)}`;
}

// ── Main Pipeline ────────────────────────────────────────────────────────

export interface ClassificationResult {
  issues: ClassifiedIssue[];
  stats: {
    input_count: number;
    output_count: number;
    deduplicated: number;
    category_overrides: number;
    severity_adjustments: number;
    overlap_merges: number;
  };
}

/**
 * Run the full deterministic classification pipeline on LLM candidate issues.
 *
 * Stages:
 *   1. Normalize excerpts
 *   2. Match rules against each candidate
 *   3. Apply deterministic category assignment
 *   4. Group overlapping spans
 *   5. Resolve category conflicts within groups
 *   6. Calibrate severity
 *   7. Align explanations
 *   8. Emit final deduplicated findings
 */
export function classifyAndDeduplicate(
  candidates: CandidateIssue[],
): ClassificationResult {
  const stats = {
    input_count: candidates.length,
    output_count: 0,
    deduplicated: 0,
    category_overrides: 0,
    severity_adjustments: 0,
    overlap_merges: 0,
  };

  if (candidates.length === 0) {
    return { issues: [], stats };
  }

  // Stage 1+2: Analyze each candidate
  interface AnnotatedCandidate {
    candidate: CandidateIssue;
    normalizedExcerpt: string;
    ruleMatches: RuleMatch[];
    determinedCategory: IssueType;
    categorySource: "llm" | "rule_override" | "rule_confirmed";
  }

  const annotated: AnnotatedCandidate[] = candidates.map(candidate => {
    const normalizedExcerpt = normalizeExcerpt(candidate.excerpt);
    const ruleMatches = matchRulesAgainstExcerpt(candidate.excerpt);

    let determinedCategory = candidate.type;
    let categorySource: "llm" | "rule_override" | "rule_confirmed" = "llm";

    if (ruleMatches.length > 0) {
      // Find the strongest matching rule
      const strongMatches = ruleMatches.filter(m => m.rule.override_strength === "strong");
      const moderateMatches = ruleMatches.filter(m => m.rule.override_strength === "moderate");

      if (strongMatches.length > 0) {
        // Strong rule match — check if it agrees with or overrides the LLM
        const strongCategory = strongMatches
          .sort((a, b) => b.matchCount - a.matchCount)[0].rule.category;

        if (strongCategory === candidate.type) {
          categorySource = "rule_confirmed";
        } else {
          // Override: strong rule disagrees with LLM
          // But only override primary categories with other primary categories
          const isPrimaryOriginal = ["tone", "bias", "unsupported_conclusion", "policy_language"].includes(candidate.type);
          const isPrimaryNew = ["tone", "bias", "unsupported_conclusion", "policy_language"].includes(strongCategory);

          if (isPrimaryOriginal && isPrimaryNew) {
            determinedCategory = strongCategory;
            categorySource = "rule_override";
            stats.category_overrides++;
          } else if (!isPrimaryOriginal && isPrimaryNew) {
            // Upgrade secondary to primary if strong rule matches
            determinedCategory = strongCategory;
            categorySource = "rule_override";
            stats.category_overrides++;
          } else {
            categorySource = "rule_confirmed";
          }
        }
      } else if (moderateMatches.length > 0) {
        const moderateCategory = moderateMatches
          .sort((a, b) => b.matchCount - a.matchCount)[0].rule.category;
        if (moderateCategory === candidate.type) {
          categorySource = "rule_confirmed";
        }
        // Moderate rules don't override, they only confirm
      }
    }

    return {
      candidate,
      normalizedExcerpt,
      ruleMatches,
      determinedCategory,
      categorySource,
    };
  });

  // Stage 3: Group overlapping spans
  interface SpanGroup {
    members: AnnotatedCandidate[];
  }

  const groups: SpanGroup[] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < annotated.length; i++) {
    if (assigned.has(i)) continue;

    const group: SpanGroup = { members: [annotated[i]] };
    assigned.add(i);

    for (let j = i + 1; j < annotated.length; j++) {
      if (assigned.has(j)) continue;

      // Check if this candidate overlaps with any member of the group
      const overlapsWithGroup = group.members.some(member =>
        excerptOverlaps(member.candidate.excerpt, annotated[j].candidate.excerpt)
      );

      if (overlapsWithGroup) {
        group.members.push(annotated[j]);
        assigned.add(j);
      }
    }

    groups.push(group);
  }

  // Stage 4: Resolve each group into final findings
  const finalIssues: ClassifiedIssue[] = [];

  for (const group of groups) {
    if (group.members.length === 1) {
      // Single finding — just apply severity calibration and explanation alignment
      const member = group.members[0];
      const { severity, adjusted } = calibrateSeverity(
        member.candidate.severity,
        member.ruleMatches,
        member.determinedCategory,
      );
      if (adjusted) stats.severity_adjustments++;

      const explanation = alignExplanation(
        member.candidate.explanation,
        member.candidate.type,
        member.determinedCategory,
      );

      finalIssues.push({
        type: member.determinedCategory,
        severity,
        excerpt: member.candidate.excerpt,
        explanation,
        field_key: member.candidate.field_key,
        finding_track: member.candidate.finding_track,
        category_source: member.categorySource,
        severity_adjusted: adjusted,
        matched_rules: member.ruleMatches.map(m => m.rule.id),
      });
    } else {
      // Multiple overlapping findings — resolve to best representative
      stats.overlap_merges += group.members.length - 1;

      // Collect all unique categories in the group
      const categoryCounts = new Map<IssueType, { count: number; members: AnnotatedCandidate[] }>();
      for (const member of group.members) {
        const entry = categoryCounts.get(member.determinedCategory) ?? { count: 0, members: [] };
        entry.count++;
        entry.members.push(member);
        categoryCounts.set(member.determinedCategory, entry);
      }

      // Determine if categories should merge or coexist
      const uniqueCategories = [...categoryCounts.keys()];

      if (uniqueCategories.length === 1) {
        // All same category — deduplicate, keep best
        stats.deduplicated += group.members.length - 1;
        const best = group.members
          .sort((a, b) => {
            // Prefer higher severity
            const sevDiff = SEVERITY_ORDER[b.candidate.severity] - SEVERITY_ORDER[a.candidate.severity];
            if (sevDiff !== 0) return sevDiff;
            // Prefer longer (more specific) excerpts
            return b.candidate.excerpt.length - a.candidate.excerpt.length;
          })[0];

        const allRuleMatches = group.members.flatMap(m => m.ruleMatches);
        const { severity, adjusted } = calibrateSeverity(
          best.candidate.severity,
          allRuleMatches,
          best.determinedCategory,
        );
        if (adjusted) stats.severity_adjustments++;

        finalIssues.push({
          type: best.determinedCategory,
          severity,
          excerpt: best.candidate.excerpt,
          explanation: alignExplanation(
            best.candidate.explanation,
            best.candidate.type,
            best.determinedCategory,
          ),
          field_key: best.candidate.field_key,
          finding_track: best.candidate.finding_track,
          category_source: best.categorySource,
          severity_adjusted: adjusted,
          matched_rules: allRuleMatches.map(m => m.rule.id),
        });
      } else {
        // Multiple categories on overlapping spans — resolve
        const allRuleMatches = group.members.flatMap(m => m.ruleMatches);

        // Try to resolve all categories to a single winner
        let winnerCategory = uniqueCategories[0];
        for (let k = 1; k < uniqueCategories.length; k++) {
          const resolved = resolveOverlappingCategories(
            winnerCategory,
            uniqueCategories[k],
            allRuleMatches.filter(m => m.rule.category === winnerCategory),
            allRuleMatches.filter(m => m.rule.category === uniqueCategories[k]),
          );
          if (resolved) {
            winnerCategory = resolved;
            stats.deduplicated++;
          }
        }

        // Find the best representative for the winning category
        const winnersMembers = categoryCounts.get(winnerCategory)?.members ?? group.members;
        const best = winnersMembers.sort((a, b) => {
          const sevDiff = SEVERITY_ORDER[b.candidate.severity] - SEVERITY_ORDER[a.candidate.severity];
          if (sevDiff !== 0) return sevDiff;
          return b.candidate.excerpt.length - a.candidate.excerpt.length;
        })[0];

        const { severity, adjusted } = calibrateSeverity(
          best.candidate.severity,
          allRuleMatches,
          winnerCategory,
        );
        if (adjusted) stats.severity_adjustments++;

        finalIssues.push({
          type: winnerCategory,
          severity,
          excerpt: best.candidate.excerpt,
          explanation: alignExplanation(
            best.candidate.explanation,
            best.candidate.type,
            winnerCategory,
          ),
          field_key: best.candidate.field_key,
          finding_track: best.candidate.finding_track,
          category_source: winnerCategory === best.determinedCategory ? best.categorySource : "rule_override",
          severity_adjusted: adjusted,
          matched_rules: allRuleMatches.map(m => m.rule.id),
        });

        // Check if any non-winner categories should also survive
        // (only if they are truly independent — completeness/consistency)
        for (const cat of uniqueCategories) {
          if (cat === winnerCategory) continue;
          if (cat === "completeness" || cat === "consistency") {
            // These are independent — keep them
            const catMembers = categoryCounts.get(cat)!.members;
            const catBest = catMembers[0];
            const catRuleMatches = catBest.ruleMatches;
            const { severity: catSev, adjusted: catAdj } = calibrateSeverity(
              catBest.candidate.severity,
              catRuleMatches,
              cat,
            );

            finalIssues.push({
              type: cat,
              severity: catSev,
              excerpt: catBest.candidate.excerpt,
              explanation: catBest.candidate.explanation,
              field_key: catBest.candidate.field_key,
              finding_track: catBest.candidate.finding_track,
              category_source: catBest.categorySource,
              severity_adjusted: catAdj,
              matched_rules: catRuleMatches.map(m => m.rule.id),
            });
          }
        }
      }
    }
  }

  stats.output_count = finalIssues.length;
  return { issues: finalIssues, stats };
}

// ── Exports for testing ──────────────────────────────────────────────────

export {
  ALL_RULES,
  TONE_RULES,
  BIAS_RULES,
  UNSUPPORTED_CONCLUSION_RULES,
  POLICY_RULES,
  CATEGORY_PRIORITY,
  matchRulesAgainstExcerpt,
  calibrateSeverity,
  resolveOverlappingCategories,
  alignExplanation,
};
