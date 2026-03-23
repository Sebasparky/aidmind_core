/**
 * Deterministic Classifier for Reviewer — Edge-function-safe version
 *
 * Mirrors src/lib/tools/reviewer-deterministic-classifier.ts for use
 * inside Supabase Edge Functions (Deno runtime, no src/ imports).
 *
 * Pipeline stages:
 *   1. Normalize excerpts
 *   2. Match rules against each candidate
 *   3. Apply deterministic category assignment
 *   4. Group overlapping spans
 *   5. Resolve category conflicts within groups
 *   6. Calibrate severity
 *   7. Align explanations
 *   8. Emit final deduplicated findings
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
  if (smaller > 0 && intersection.length / smaller >= 0.6) return true;
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
  tone: 4,
  bias: 3,
  unsupported_conclusion: 2,
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

  if ((typeA === "tone" && typeB === "bias") || (typeA === "bias" && typeB === "tone")) {
    const toneStrength = ruleMatchesA
      .filter(m => m.rule.category === "tone")
      .reduce((sum, m) => sum + m.matchCount, 0);
    const biasStrength = ruleMatchesB
      .filter(m => m.rule.category === "bias")
      .reduce((sum, m) => sum + m.matchCount, 0);
    return toneStrength >= biasStrength ? "tone" : "bias";
  }

  if (
    (typeA === "unsupported_conclusion" && typeB === "tone") ||
    (typeA === "tone" && typeB === "unsupported_conclusion")
  ) {
    const hasUcStrong = [...ruleMatchesA, ...ruleMatchesB].some(
      m => m.rule.category === "unsupported_conclusion" && m.rule.override_strength === "strong"
    );
    return hasUcStrong ? "unsupported_conclusion" : "tone";
  }

  if (
    (typeA === "unsupported_conclusion" && typeB === "bias") ||
    (typeA === "bias" && typeB === "unsupported_conclusion")
  ) {
    const hasUcStrong = [...ruleMatchesA, ...ruleMatchesB].some(
      m => m.rule.category === "unsupported_conclusion" && m.rule.override_strength === "strong"
    );
    return hasUcStrong ? "unsupported_conclusion" : "bias";
  }

  if (typeA === "policy_language") return typeA;
  if (typeB === "policy_language") return typeB;

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
  for (const { rule } of ruleMatches) {
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

// ── Explanation Alignment ────────────────────────────────────────────────

const CATEGORY_EXPLANATION_PREFIXES: Record<IssueType, string[]> = {
  tone: ["uses judgmental", "unprofessional", "emotionally charged", "blaming", "shaming", "condescending", "judgmental tone", "moralizing"],
  bias: ["labels the person", "stigmatizing", "stereotype", "assumption", "unsupported generalization", "bias", "discriminatory"],
  unsupported_conclusion: ["reaches a conclusion", "without sufficient evidence", "stated as fact", "certainty stronger than", "overclaims", "unsupported", "infers intent", "attributes motive"],
  policy_language: ["prohibited term", "policy", "informal language", "unprofessional terminology"],
  completeness: ["blank", "empty", "missing", "insufficient"],
  consistency: ["contradicts", "differs from", "inconsistent"],
};

function isExplanationAligned(explanation: string, category: IssueType): boolean {
  const prefixes = CATEGORY_EXPLANATION_PREFIXES[category] ?? [];
  const lower = explanation.toLowerCase();
  return prefixes.some(p => lower.includes(p));
}

function alignExplanation(
  explanation: string,
  originalCategory: IssueType,
  finalCategory: IssueType,
): string {
  if (originalCategory === finalCategory) return explanation;
  if (isExplanationAligned(explanation, finalCategory)) return explanation;

  const framings: Record<IssueType, string> = {
    tone: "Uses judgmental or unprofessional language —",
    bias: "Contains stigmatizing language or unsupported assumptions —",
    unsupported_conclusion: "Reaches a conclusion without sufficient supporting evidence —",
    policy_language: "Uses prohibited or policy-inconsistent terminology —",
    completeness: explanation,
    consistency: explanation,
  };

  const prefix = framings[finalCategory];
  if (!prefix || prefix === explanation) return explanation;
  if (explanation.toLowerCase().startsWith(prefix.toLowerCase().slice(0, 20))) return explanation;
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
    const norm = normalizeExcerpt(candidate.excerpt);
    const ruleMatches = matchRulesAgainstExcerpt(candidate.excerpt);

    let determinedCategory = candidate.type;
    let categorySource: "llm" | "rule_override" | "rule_confirmed" = "llm";

    if (ruleMatches.length > 0) {
      const strongMatches = ruleMatches.filter(m => m.rule.override_strength === "strong");
      const moderateMatches = ruleMatches.filter(m => m.rule.override_strength === "moderate");

      if (strongMatches.length > 0) {
        const strongCategory = strongMatches
          .sort((a, b) => b.matchCount - a.matchCount)[0].rule.category;

        if (strongCategory === candidate.type) {
          categorySource = "rule_confirmed";
        } else {
          const isPrimaryOriginal = ["tone", "bias", "unsupported_conclusion", "policy_language"].includes(candidate.type);
          const isPrimaryNew = ["tone", "bias", "unsupported_conclusion", "policy_language"].includes(strongCategory);

          if ((isPrimaryOriginal && isPrimaryNew) || (!isPrimaryOriginal && isPrimaryNew)) {
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
      }
    }

    return { candidate, normalizedExcerpt: norm, ruleMatches, determinedCategory, categorySource };
  });

  // Stage 3: Group overlapping spans
  interface SpanGroup { members: AnnotatedCandidate[] }
  const groups: SpanGroup[] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < annotated.length; i++) {
    if (assigned.has(i)) continue;
    const group: SpanGroup = { members: [annotated[i]] };
    assigned.add(i);
    for (let j = i + 1; j < annotated.length; j++) {
      if (assigned.has(j)) continue;
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
        const best = group.members.sort((a, b) => {
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
        const best = winnersMembers.sort((a, b) => {
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

  stats.output_count = finalIssues.length;
  return { issues: finalIssues, stats };
}
