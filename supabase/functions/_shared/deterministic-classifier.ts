/**
 * Deterministic Classifier v2 for Reviewer — Edge-function-safe version
 *
 * Mirrors src/lib/tools/reviewer-deterministic-classifier.ts for use
 * inside Supabase Edge Functions (Deno runtime, no src/ imports).
 *
 * v2 changes:
 *   - Category-pure explanation templates (no cross-category bleed)
 *   - Borderline observational language guardrail
 *   - Stronger overlap merging (50% threshold, same-field proximity)
 *   - Tighter dominant-category resolution (UC > tone when overclaiming)
 *   - Deterministic final ordering
 *   - Explanation validation pass
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
  category_source: "llm" | "rule_override" | "rule_confirmed";
  severity_adjusted: boolean;
  matched_rules: string[];
}

// ── Pattern Lexicons ─────────────────────────────────────────────────────

interface CategoryRule {
  id: string;
  category: IssueType;
  patterns: RegExp[];
  override_strength: "strong" | "moderate" | "weak";
  severity_cap?: Severity;
  severity_floor?: Severity;
}

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
  {
    id: "tone_unfit_label",
    category: "tone",
    patterns: [
      /\b(unfit\s+(?:parent|mother|father|caregiver))\b/i,
    ],
    override_strength: "strong",
    severity_floor: "medium",
  },
];

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
  {
    id: "uc_future_prediction",
    category: "unsupported_conclusion",
    patterns: [
      /\b(will\s+(?:almost\s+)?certainly|will\s+(?:undoubtedly|inevitably|definitely))\b/i,
      /\b(is\s+(?:destined|doomed|bound)\s+to)\b/i,
    ],
    override_strength: "strong",
    severity_floor: "medium",
  },
  {
    id: "uc_pattern_assertion",
    category: "unsupported_conclusion",
    patterns: [
      /\b(consistent\s+with\s+(?:a\s+)?(?:neglectful|abusive|dangerous|unsafe)\s+(?:home|household|family|environment|pattern))\b/i,
      /\b(treated\s+as\s+(?:high[- ]risk|dangerous|unsafe))\b/i,
      /\b((?:clearly|obviously)\s+inadequate)\b/i,
    ],
    override_strength: "strong",
    severity_floor: "medium",
  },
];

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

// ── Borderline Observational Language Guardrail ──────────────────────────

const OBSERVATIONAL_SAFE_PATTERNS: RegExp[] = [
  /\b(appears?\s+to\s+be)\b/i,
  /\b(seems?\s+to\s+be)\b/i,
  /\b(observed\s+that)\b/i,
  /\b(reported\s+that)\b/i,
  /\b((?:home|house|apartment|residence)\s+(?:was|appeared?)\s+(?:cluttered|messy|disorganized|untidy))\b/i,
  /\b(food\s+(?:was|appeared?)\s+limited)\b/i,
  /\b(children\s+(?:appeared?|seemed?)\s+(?:tired|quiet|withdrawn|upset|hungry))\b/i,
  /\b(appeared?\s+(?:to\s+have|stressed|anxious|upset|tired|overwhelmed))\b/i,
  /\b(seemed?\s+(?:stressed|anxious|upset|tired|overwhelmed|concerned|worried))\b/i,
  /\b(carrying\s+the\s+stress)\b/i,
  /\b(in\s+disarray)\b/i,
];

function isBorderlineObservational(excerpt: string, ruleMatches: RuleMatch[]): boolean {
  const hasObservational = OBSERVATIONAL_SAFE_PATTERNS.some(p => p.test(excerpt));
  if (!hasObservational) return false;
  const hasStrongMatch = ruleMatches.some(m => m.rule.override_strength === "strong");
  if (hasStrongMatch) return false;
  const hasModerateMatch = ruleMatches.some(m => m.rule.override_strength === "moderate");
  if (hasModerateMatch) return false;
  return true;
}

// ── Span Normalization ───────────────────────────────────────────────────

function normalizeExcerpt(excerpt: string): string {
  return excerpt
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^["'""\u201C\u201D]+|["'""\u201C\u201D]+$/g, "")
    .replace(/^[.,;:!?]+|[.,;:!?]+$/g, "")
    .trim();
}

function excerptOverlaps(a: string, b: string): boolean {
  const na = normalizeExcerpt(a);
  const nb = normalizeExcerpt(b);
  if (!na || !nb) return false;
  if (na.includes(nb) || nb.includes(na)) return true;
  const wordsA = new Set(na.split(/\s+/));
  const wordsB = new Set(nb.split(/\s+/));
  const intersection = [...wordsA].filter(w => wordsB.has(w));
  const smaller = Math.min(wordsA.size, wordsB.size);
  if (smaller > 0 && intersection.length / smaller >= 0.5) return true;
  return false;
}

function areSameOrAdjacentSentence(a: string, b: string): boolean {
  const na = normalizeExcerpt(a);
  const nb = normalizeExcerpt(b);
  if (!na || !nb) return false;
  const wordsA = na.split(/\s+/);
  const wordsB = nb.split(/\s+/);
  const prefixLen = Math.min(5, wordsA.length, wordsB.length);
  let commonPrefix = 0;
  for (let i = 0; i < prefixLen; i++) {
    if (wordsA[i] === wordsB[i]) commonPrefix++;
    else break;
  }
  if (commonPrefix >= 3) return true;
  return false;
}

// ── Pattern Matching ─────────────────────────────────────────────────────

interface RuleMatch {
  rule: CategoryRule;
  matchCount: number;
}

function matchRulesAgainstExcerpt(excerpt: string): RuleMatch[] {
  const matches: RuleMatch[] = [];
  for (const rule of ALL_RULES) {
    let totalMatches = 0;
    for (const pattern of rule.patterns) {
      const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
      let match: RegExpExecArray | null;
      while ((match = re.exec(excerpt)) !== null) {
        totalMatches++;
        if (match[0].length === 0) re.lastIndex++;
      }
    }
    if (totalMatches > 0) {
      matches.push({ rule, matchCount: totalMatches });
    }
  }
  return matches;
}

// ── Category Precedence ──────────────────────────────────────────────────

const CATEGORY_PRIORITY: Record<IssueType, number> = {
  policy_language: 5,
  unsupported_conclusion: 4,
  tone: 3,
  bias: 3,
  completeness: 1,
  consistency: 1,
};

function resolveOverlappingCategories(
  typeA: IssueType,
  typeB: IssueType,
  ruleMatchesA: RuleMatch[],
  ruleMatchesB: RuleMatch[],
): IssueType | null {
  if (typeA === typeB) return typeA;
  if (typeA === "completeness" || typeA === "consistency") return null;
  if (typeB === "completeness" || typeB === "consistency") return null;

  if (typeA === "policy_language") return typeA;
  if (typeB === "policy_language") return typeB;

  if (
    (typeA === "unsupported_conclusion" && typeB === "tone") ||
    (typeA === "tone" && typeB === "unsupported_conclusion")
  ) {
    const ucStrong = [...ruleMatchesA, ...ruleMatchesB].filter(
      m => m.rule.category === "unsupported_conclusion" && m.rule.override_strength === "strong"
    );
    const toneStrong = [...ruleMatchesA, ...ruleMatchesB].filter(
      m => m.rule.category === "tone" && m.rule.override_strength === "strong"
    );
    if (ucStrong.length > 0) {
      const ucHits = ucStrong.reduce((s, m) => s + m.matchCount, 0);
      const toneHits = toneStrong.reduce((s, m) => s + m.matchCount, 0);
      return ucHits >= toneHits ? "unsupported_conclusion" : "tone";
    }
    return "tone";
  }

  if (
    (typeA === "unsupported_conclusion" && typeB === "bias") ||
    (typeA === "bias" && typeB === "unsupported_conclusion")
  ) {
    const ucStrong = [...ruleMatchesA, ...ruleMatchesB].some(
      m => m.rule.category === "unsupported_conclusion" && m.rule.override_strength === "strong"
    );
    return ucStrong ? "unsupported_conclusion" : "bias";
  }

  if ((typeA === "tone" && typeB === "bias") || (typeA === "bias" && typeB === "tone")) {
    const allMatches = [...ruleMatchesA, ...ruleMatchesB];
    const toneHits = allMatches
      .filter(m => m.rule.category === "tone")
      .reduce((sum, m) => sum + m.matchCount, 0);
    const biasHits = allMatches
      .filter(m => m.rule.category === "bias")
      .reduce((sum, m) => sum + m.matchCount, 0);
    return toneHits >= biasHits ? "tone" : "bias";
  }

  return CATEGORY_PRIORITY[typeA] >= CATEGORY_PRIORITY[typeB] ? typeA : typeB;
}

// ── Severity Calibration ─────────────────────────────────────────────────

const SEVERITY_ORDER: Record<Severity, number> = { low: 0, medium: 1, high: 2 };

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

  const relevantMatches = ruleMatches.filter(m => m.rule.category === _finalCategory);
  const matchesToUse = relevantMatches.length > 0 ? relevantMatches : ruleMatches;

  for (const { rule } of matchesToUse) {
    if (rule.severity_floor && SEVERITY_ORDER[adjustedSeverity] < SEVERITY_ORDER[rule.severity_floor]) {
      adjustedSeverity = rule.severity_floor;
      wasAdjusted = true;
    }
    if (rule.severity_cap && SEVERITY_ORDER[adjustedSeverity] > SEVERITY_ORDER[rule.severity_cap]) {
      adjustedSeverity = rule.severity_cap;
      wasAdjusted = true;
    }
  }
  return { severity: adjustedSeverity, adjusted: wasAdjusted };
}

// ── Explanation Alignment v2 ─────────────────────────────────────────────

const CATEGORY_TEMPLATES: Record<IssueType, {
  prefix: string;
  allowed_terms: string[];
  forbidden_terms: string[];
}> = {
  tone: {
    prefix: "Uses judgmental or unprofessional language",
    allowed_terms: ["judgmental", "unprofessional", "emotionally charged", "blaming", "shaming", "condescending", "moralizing", "characterization", "loaded language", "tone"],
    forbidden_terms: ["unsupported conclusion", "overclaim", "without sufficient evidence", "certainty stronger", "stated as fact", "infers intent", "attributes motive", "stigmatizing label", "stereotype"],
  },
  bias: {
    prefix: "Contains stigmatizing or biased language",
    allowed_terms: ["stigmatizing", "labels the person", "stereotype", "assumption", "bias", "discriminatory", "dehumanizing", "person-labeling", "generalization"],
    forbidden_terms: ["judgmental tone", "unprofessional", "moralizing", "overclaim", "without sufficient evidence", "certainty stronger", "stated as fact"],
  },
  unsupported_conclusion: {
    prefix: "Reaches a conclusion without sufficient supporting evidence",
    allowed_terms: ["conclusion", "without sufficient evidence", "stated as fact", "certainty stronger", "overclaim", "unsupported", "infers intent", "attributes motive", "prediction", "assertion"],
    forbidden_terms: ["judgmental tone", "unprofessional", "moralizing", "blaming", "shaming", "stigmatizing label", "stereotype", "person-labeling"],
  },
  policy_language: {
    prefix: "Uses prohibited or policy-inconsistent terminology",
    allowed_terms: ["prohibited term", "policy", "informal language", "unprofessional terminology", "documentation standards"],
    forbidden_terms: [],
  },
  completeness: {
    prefix: "Required narrative section appears blank or incomplete",
    allowed_terms: ["blank", "empty", "missing", "insufficient", "incomplete"],
    forbidden_terms: [],
  },
  consistency: {
    prefix: "Information differs between sources",
    allowed_terms: ["contradicts", "differs from", "inconsistent", "discrepancy"],
    forbidden_terms: [],
  },
};

function isExplanationAligned(explanation: string, category: IssueType): boolean {
  const template = CATEGORY_TEMPLATES[category];
  if (!template) return true;
  const lower = explanation.toLowerCase();
  const hasAllowed = template.allowed_terms.some(t => lower.includes(t));
  const hasForbidden = template.forbidden_terms.some(t => lower.includes(t));
  return hasAllowed && !hasForbidden;
}

function alignExplanation(
  explanation: string,
  originalCategory: IssueType,
  finalCategory: IssueType,
): string {
  const template = CATEGORY_TEMPLATES[finalCategory];
  if (!template) return explanation;

  let cleaned = explanation;
  for (const term of template.forbidden_terms) {
    const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, "gi");
    cleaned = cleaned.replace(re, "").replace(/\s{2,}/g, " ").replace(/\s*[—–-]\s*$/, "").trim();
  }

  if (cleaned && isExplanationAligned(cleaned, finalCategory)) {
    return cleaned;
  }

  if (cleaned && cleaned.length > 10) {
    const existingPrefixes = Object.values(CATEGORY_TEMPLATES).map(t => t.prefix.toLowerCase());
    let unprefixed = cleaned;
    for (const p of existingPrefixes) {
      if (unprefixed.toLowerCase().startsWith(p.slice(0, 20))) {
        unprefixed = unprefixed.slice(p.length).replace(/^\s*[—–-]\s*/, "").trim();
        break;
      }
    }
    if (unprefixed.length > 5) {
      return `${template.prefix} — ${unprefixed.charAt(0).toLowerCase()}${unprefixed.slice(1)}`;
    }
  }

  return `${template.prefix}.`;
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
    borderline_suppressed: number;
  };
}

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
    borderline_suppressed: 0,
  };

  if (candidates.length === 0) {
    return { issues: [], stats };
  }

  interface AnnotatedCandidate {
    candidate: CandidateIssue;
    normalizedExcerpt: string;
    ruleMatches: RuleMatch[];
    determinedCategory: IssueType;
    categorySource: "llm" | "rule_override" | "rule_confirmed";
    suppressed: boolean;
  }

  const annotated: AnnotatedCandidate[] = candidates.map(candidate => {
    const normalizedExcerpt = normalizeExcerpt(candidate.excerpt);
    const ruleMatches = matchRulesAgainstExcerpt(candidate.excerpt);

    let determinedCategory = candidate.type;
    let categorySource: "llm" | "rule_override" | "rule_confirmed" = "llm";
    let suppressed = false;

    if (["tone", "bias", "unsupported_conclusion"].includes(candidate.type)) {
      if (isBorderlineObservational(candidate.excerpt, ruleMatches)) {
        suppressed = true;
        stats.borderline_suppressed++;
      }
    }

    if (!suppressed && ruleMatches.length > 0) {
      const strongMatches = ruleMatches.filter(m => m.rule.override_strength === "strong");
      const moderateMatches = ruleMatches.filter(m => m.rule.override_strength === "moderate");

      if (strongMatches.length > 0) {
        const categoryHits = new Map<IssueType, number>();
        for (const m of strongMatches) {
          categoryHits.set(m.rule.category, (categoryHits.get(m.rule.category) ?? 0) + m.matchCount);
        }
        const bestCategory = [...categoryHits.entries()]
          .sort((a, b) => b[1] - a[1])[0][0];

        if (bestCategory === candidate.type) {
          categorySource = "rule_confirmed";
        } else {
          const isPrimaryOriginal = ["tone", "bias", "unsupported_conclusion", "policy_language"].includes(candidate.type);
          const isPrimaryNew = ["tone", "bias", "unsupported_conclusion", "policy_language"].includes(bestCategory);

          if ((isPrimaryOriginal && isPrimaryNew) || (!isPrimaryOriginal && isPrimaryNew)) {
            determinedCategory = bestCategory;
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
      }
    }

    return { candidate, normalizedExcerpt, ruleMatches, determinedCategory, categorySource, suppressed };
  });

  const active = annotated.filter(a => !a.suppressed);

  interface SpanGroup { members: AnnotatedCandidate[] }
  const groups: SpanGroup[] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < active.length; i++) {
    if (assigned.has(i)) continue;
    const group: SpanGroup = { members: [active[i]] };
    assigned.add(i);

    for (let j = i + 1; j < active.length; j++) {
      if (assigned.has(j)) continue;
      const overlapsWithGroup = group.members.some(member => {
        if (excerptOverlaps(member.candidate.excerpt, active[j].candidate.excerpt)) return true;
        if (member.candidate.field_key && member.candidate.field_key === active[j].candidate.field_key) {
          if (areSameOrAdjacentSentence(member.candidate.excerpt, active[j].candidate.excerpt)) return true;
        }
        return false;
      });
      if (overlapsWithGroup) {
        group.members.push(active[j]);
        assigned.add(j);
      }
    }
    groups.push(group);
  }

  const finalIssues: ClassifiedIssue[] = [];

  for (const group of groups) {
    if (group.members.length === 1) {
      const member = group.members[0];
      const { severity, adjusted } = calibrateSeverity(member.candidate.severity, member.ruleMatches, member.determinedCategory);
      if (adjusted) stats.severity_adjustments++;

      finalIssues.push({
        type: member.determinedCategory,
        severity,
        excerpt: member.candidate.excerpt,
        explanation: alignExplanation(member.candidate.explanation, member.candidate.type, member.determinedCategory),
        field_key: member.candidate.field_key,
        finding_track: member.candidate.finding_track,
        category_source: member.categorySource,
        severity_adjusted: adjusted,
        matched_rules: member.ruleMatches.map(m => m.rule.id),
      });
    } else {
      stats.overlap_merges += group.members.length - 1;

      const categoryCounts = new Map<IssueType, { count: number; members: AnnotatedCandidate[] }>();
      for (const member of group.members) {
        const entry = categoryCounts.get(member.determinedCategory) ?? { count: 0, members: [] };
        entry.count++;
        entry.members.push(member);
        categoryCounts.set(member.determinedCategory, entry);
      }

      const uniqueCategories = [...categoryCounts.keys()];

      if (uniqueCategories.length === 1) {
        stats.deduplicated += group.members.length - 1;
        const best = [...group.members].sort((a, b) => {
          const sevDiff = SEVERITY_ORDER[b.candidate.severity] - SEVERITY_ORDER[a.candidate.severity];
          if (sevDiff !== 0) return sevDiff;
          return b.candidate.excerpt.length - a.candidate.excerpt.length;
        })[0];

        const allRuleMatches = group.members.flatMap(m => m.ruleMatches);
        const { severity, adjusted } = calibrateSeverity(best.candidate.severity, allRuleMatches, best.determinedCategory);
        if (adjusted) stats.severity_adjustments++;

        finalIssues.push({
          type: best.determinedCategory,
          severity,
          excerpt: best.candidate.excerpt,
          explanation: alignExplanation(best.candidate.explanation, best.candidate.type, best.determinedCategory),
          field_key: best.candidate.field_key,
          finding_track: best.candidate.finding_track,
          category_source: best.categorySource,
          severity_adjusted: adjusted,
          matched_rules: allRuleMatches.map(m => m.rule.id),
        });
      } else {
        const allRuleMatches = group.members.flatMap(m => m.ruleMatches);
        let winnerCategory = uniqueCategories[0];
        for (let k = 1; k < uniqueCategories.length; k++) {
          const resolved = resolveOverlappingCategories(
            winnerCategory, uniqueCategories[k],
            allRuleMatches.filter(m => m.rule.category === winnerCategory),
            allRuleMatches.filter(m => m.rule.category === uniqueCategories[k]),
          );
          if (resolved) { winnerCategory = resolved; stats.deduplicated++; }
        }

        const winnersMembers = categoryCounts.get(winnerCategory)?.members ?? group.members;
        const best = [...winnersMembers].sort((a, b) => {
          const sevDiff = SEVERITY_ORDER[b.candidate.severity] - SEVERITY_ORDER[a.candidate.severity];
          if (sevDiff !== 0) return sevDiff;
          return b.candidate.excerpt.length - a.candidate.excerpt.length;
        })[0];

        const { severity, adjusted } = calibrateSeverity(best.candidate.severity, allRuleMatches, winnerCategory);
        if (adjusted) stats.severity_adjustments++;

        finalIssues.push({
          type: winnerCategory,
          severity,
          excerpt: best.candidate.excerpt,
          explanation: alignExplanation(best.candidate.explanation, best.candidate.type, winnerCategory),
          field_key: best.candidate.field_key,
          finding_track: best.candidate.finding_track,
          category_source: winnerCategory === best.determinedCategory ? best.categorySource : "rule_override",
          severity_adjusted: adjusted,
          matched_rules: allRuleMatches.map(m => m.rule.id),
        });

        for (const cat of uniqueCategories) {
          if (cat === winnerCategory) continue;
          if (cat === "completeness" || cat === "consistency") {
            const catMembers = categoryCounts.get(cat)!.members;
            const catBest = catMembers[0];
            const catRuleMatches = catBest.ruleMatches;
            const { severity: catSev, adjusted: catAdj } = calibrateSeverity(catBest.candidate.severity, catRuleMatches, cat);

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

  // Deterministic ordering
  const CATEGORY_SORT_ORDER: Record<IssueType, number> = {
    unsupported_conclusion: 0,
    tone: 1,
    bias: 2,
    policy_language: 3,
    completeness: 4,
    consistency: 5,
  };

  finalIssues.sort((a, b) => {
    const trackA = ["tone", "bias", "unsupported_conclusion", "policy_language"].includes(a.type) ? 0 : 1;
    const trackB = ["tone", "bias", "unsupported_conclusion", "policy_language"].includes(b.type) ? 0 : 1;
    if (trackA !== trackB) return trackA - trackB;

    const sevDiff = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
    if (sevDiff !== 0) return sevDiff;

    const catDiff = CATEGORY_SORT_ORDER[a.type] - CATEGORY_SORT_ORDER[b.type];
    if (catDiff !== 0) return catDiff;

    if (a.excerpt.length !== b.excerpt.length) return b.excerpt.length - a.excerpt.length;
    return a.excerpt.localeCompare(b.excerpt);
  });

  // Final explanation validation pass
  for (const issue of finalIssues) {
    const template = CATEGORY_TEMPLATES[issue.type];
    if (!template) continue;
    const lower = issue.explanation.toLowerCase();
    const hasForbidden = template.forbidden_terms.some(t => lower.includes(t));
    if (hasForbidden) {
      issue.explanation = alignExplanation(issue.explanation, issue.type, issue.type);
    }
  }

  stats.output_count = finalIssues.length;
  return { issues: finalIssues, stats };
}
