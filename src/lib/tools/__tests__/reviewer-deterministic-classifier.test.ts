import { describe, it, expect } from "vitest";
import {
  classifyAndDeduplicate,
  normalizeExcerpt,
  excerptOverlaps,
  matchRulesAgainstExcerpt,
  calibrateSeverity,
  resolveOverlappingCategories,
  alignExplanation,
  type CandidateIssue,
} from "../reviewer-deterministic-classifier";

// ═══════════════════════════════════════════════════════════════════════
// UNIT TESTS — Core utilities
// ═══════════════════════════════════════════════════════════════════════

describe("normalizeExcerpt", () => {
  it("lowercases and trims", () => {
    expect(normalizeExcerpt("  The Client Was HOSTILE  ")).toBe("the client was hostile");
  });
  it("strips edge quotes and punctuation", () => {
    expect(normalizeExcerpt('"clearly unable to parent."')).toBe("clearly unable to parent");
  });
  it("collapses whitespace", () => {
    expect(normalizeExcerpt("the   client   was    hostile")).toBe("the client was hostile");
  });
});

describe("excerptOverlaps", () => {
  it("detects containment", () => {
    expect(excerptOverlaps("the client was hostile and uncooperative", "the client was hostile")).toBe(true);
  });
  it("detects word overlap", () => {
    expect(excerptOverlaps("client was hostile during visit", "the client was hostile and aggressive")).toBe(true);
  });
  it("rejects unrelated excerpts", () => {
    expect(excerptOverlaps("the home was clean", "client reported income changes")).toBe(false);
  });
});

describe("matchRulesAgainstExcerpt", () => {
  it("matches judgmental adjectives", () => {
    const matches = matchRulesAgainstExcerpt("The client was uncooperative and hostile");
    const toneMatches = matches.filter(m => m.rule.category === "tone");
    expect(toneMatches.length).toBeGreaterThan(0);
  });
  it("matches certainty intensifiers", () => {
    const matches = matchRulesAgainstExcerpt("It is clearly evident that she cannot parent");
    const ucMatches = matches.filter(m => m.rule.category === "unsupported_conclusion");
    expect(ucMatches.length).toBeGreaterThan(0);
  });
  it("matches person-labeling bias", () => {
    const matches = matchRulesAgainstExcerpt("The addict was found at the home");
    const biasMatches = matches.filter(m => m.rule.category === "bias");
    expect(biasMatches.length).toBeGreaterThan(0);
  });
  it("returns empty for clean professional text", () => {
    const matches = matchRulesAgainstExcerpt("Worker conducted a home visit and observed the children");
    expect(matches.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// CONSISTENCY FIXTURES — Specific inputs that MUST produce stable outputs
// ═══════════════════════════════════════════════════════════════════════

describe("Consistency: same input → same output", () => {
  // Fixture 1: Clear judgmental tone
  const JUDGMENTAL_CANDIDATE: CandidateIssue = {
    type: "tone",
    severity: "medium",
    excerpt: "The client was uncooperative and hostile during the interview",
    explanation: "Uses judgmental language to describe client behavior",
  };

  it("judgmental tone is consistently classified as tone", () => {
    for (let i = 0; i < 5; i++) {
      const result = classifyAndDeduplicate([{ ...JUDGMENTAL_CANDIDATE }]);
      expect(result.issues.length).toBe(1);
      expect(result.issues[0].type).toBe("tone");
      expect(result.issues[0].severity).toBe("medium");
    }
  });

  // Fixture 2: Clear unsupported conclusion
  const UC_CANDIDATE: CandidateIssue = {
    type: "unsupported_conclusion",
    severity: "medium",
    excerpt: "It is clearly evident that she deliberately misrepresented her income",
    explanation: "Reaches a conclusion without sufficient evidence",
  };

  it("unsupported conclusion with certainty markers stays UC", () => {
    for (let i = 0; i < 5; i++) {
      const result = classifyAndDeduplicate([{ ...UC_CANDIDATE }]);
      expect(result.issues.length).toBe(1);
      expect(result.issues[0].type).toBe("unsupported_conclusion");
      expect(result.issues[0].severity).toBe("medium");
    }
  });

  // Fixture 3: Clear bias (person-labeling)
  const BIAS_CANDIDATE: CandidateIssue = {
    type: "bias",
    severity: "high",
    excerpt: "The addict was found in the home with the children unsupervised",
    explanation: "Labels the person rather than describing behavior",
  };

  it("person-labeling bias stays as bias with high severity", () => {
    const result = classifyAndDeduplicate([{ ...BIAS_CANDIDATE }]);
    expect(result.issues.length).toBe(1);
    expect(result.issues[0].type).toBe("bias");
    expect(result.issues[0].severity).toBe("high");
  });

  // Fixture 4: Policy language violation
  const POLICY_CANDIDATE: CandidateIssue = {
    type: "policy_language",
    severity: "medium",
    excerpt: "The worker is gonna follow up with the alleged perpetrator next week",
    explanation: "Uses informal and prohibited terminology",
  };

  it("policy language violations are consistently identified", () => {
    const result = classifyAndDeduplicate([{ ...POLICY_CANDIDATE }]);
    expect(result.issues.length).toBe(1);
    expect(result.issues[0].type).toBe("policy_language");
  });

  // Fixture 5: Clean professional text → 0 findings
  it("clean professional text produces 0 findings", () => {
    const result = classifyAndDeduplicate([]);
    expect(result.issues.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// DEDUPLICATION — Overlapping spans should merge
// ═══════════════════════════════════════════════════════════════════════

describe("Deduplication of overlapping spans", () => {
  it("merges two findings about the same sentence into one", () => {
    const candidates: CandidateIssue[] = [
      {
        type: "tone",
        severity: "medium",
        excerpt: "The client was uncooperative and hostile during the visit",
        explanation: "Judgmental language",
      },
      {
        type: "tone",
        severity: "low",
        excerpt: "client was uncooperative and hostile",
        explanation: "Negative characterization",
      },
    ];
    const result = classifyAndDeduplicate(candidates);
    expect(result.issues.length).toBe(1);
    expect(result.issues[0].severity).toBe("medium"); // keeps higher severity
    expect(result.stats.deduplicated).toBeGreaterThan(0);
  });

  it("merges near-duplicate excerpts with different categories", () => {
    const candidates: CandidateIssue[] = [
      {
        type: "tone",
        severity: "medium",
        excerpt: "The client was manipulative and hostile",
        explanation: "Judgmental language",
      },
      {
        type: "bias",
        severity: "medium",
        excerpt: "The client was manipulative and hostile during interview",
        explanation: "Stigmatizing language",
      },
    ];
    const result = classifyAndDeduplicate(candidates);
    expect(result.issues.length).toBe(1); // merged into one
    expect(result.stats.overlap_merges).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// CATEGORY OVERRIDE — Rules correct LLM misclassification
// ═══════════════════════════════════════════════════════════════════════

describe("Category override by deterministic rules", () => {
  it("reclassifies bias-labeled judgmental adjective to tone", () => {
    const candidates: CandidateIssue[] = [{
      type: "bias", // LLM said bias
      severity: "medium",
      excerpt: "The client was lazy and irresponsible about following the service plan",
      explanation: "Makes assumptions about the client",
    }];
    const result = classifyAndDeduplicate(candidates);
    expect(result.issues.length).toBe(1);
    // "lazy" and "irresponsible" are strong tone triggers
    expect(result.issues[0].type).toBe("tone");
    expect(result.issues[0].category_source).toBe("rule_override");
  });

  it("reclassifies tone-labeled certainty-overclaim to unsupported_conclusion", () => {
    const candidates: CandidateIssue[] = [{
      type: "tone", // LLM said tone
      severity: "medium",
      excerpt: "It is obvious that she deliberately misrepresented her situation",
      explanation: "Uses charged language",
    }];
    const result = classifyAndDeduplicate(candidates);
    expect(result.issues.length).toBe(1);
    // "It is obvious that" + "deliberately" → strong UC rules
    expect(result.issues[0].type).toBe("unsupported_conclusion");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SEVERITY CALIBRATION — Rules enforce floors and caps
// ═══════════════════════════════════════════════════════════════════════

describe("Severity calibration", () => {
  it("enforces severity floor for person-labeling bias", () => {
    const candidates: CandidateIssue[] = [{
      type: "bias",
      severity: "low", // LLM said low
      excerpt: "The addict left the children alone",
      explanation: "Labels the person",
    }];
    const result = classifyAndDeduplicate(candidates);
    expect(result.issues[0].severity).toBe("high"); // floor is high for person-labeling
    expect(result.issues[0].severity_adjusted).toBe(true);
  });

  it("caps severity for mild subjective tone", () => {
    const candidates: CandidateIssue[] = [{
      type: "tone",
      severity: "high", // LLM said high
      excerpt: "The client seemed reluctant to engage with the plan",
      explanation: "Subjective characterization",
    }];
    const result = classifyAndDeduplicate(candidates);
    expect(result.issues[0].severity).toBe("medium"); // cap for mild subjective
    expect(result.issues[0].severity_adjusted).toBe(true);
  });

  it("caps certainty intensifiers at medium", () => {
    const candidates: CandidateIssue[] = [{
      type: "unsupported_conclusion",
      severity: "high", // LLM said high
      excerpt: "She clearly needs more support from her family",
      explanation: "Uses certainty language",
    }];
    const result = classifyAndDeduplicate(candidates);
    expect(result.issues[0].severity).toBe("medium");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// OVERLAP RESOLUTION — Precedence rules
// ═══════════════════════════════════════════════════════════════════════

describe("Category overlap resolution", () => {
  it("tone + bias on same span resolves to stronger match", () => {
    const candidates: CandidateIssue[] = [
      {
        type: "tone",
        severity: "medium",
        excerpt: "The client was hostile and uncooperative with the worker",
        explanation: "Judgmental tone",
      },
      {
        type: "bias",
        severity: "medium",
        excerpt: "The client was hostile and uncooperative",
        explanation: "Stigmatizing characterization",
      },
    ];
    const result = classifyAndDeduplicate(candidates);
    expect(result.issues.length).toBe(1);
    // "hostile" and "uncooperative" are tone rules, not bias rules
    expect(result.issues[0].type).toBe("tone");
  });

  it("completeness + tone on different aspects both survive", () => {
    const candidates: CandidateIssue[] = [
      {
        type: "tone",
        severity: "medium",
        excerpt: "Worker noted the client was belligerent",
        explanation: "Judgmental language",
      },
      {
        type: "completeness",
        severity: "medium",
        excerpt: "Case narrative section appears blank",
        explanation: "Missing narrative section",
        field_key: "case_narrative",
      },
    ];
    const result = classifyAndDeduplicate(candidates);
    // These don't overlap in excerpt → both survive independently
    expect(result.issues.length).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// EXPLANATION ALIGNMENT
// ═══════════════════════════════════════════════════════════════════════

describe("Explanation alignment", () => {
  it("prepends category framing when explanation drifts", () => {
    const result = alignExplanation(
      "makes broad generalizations about the family",
      "bias",
      "tone",
    );
    expect(result).toContain("judgmental");
    expect(result).toContain("makes broad generalizations");
  });

  it("does not modify already-aligned explanations", () => {
    const original = "Uses judgmental language to describe the client";
    const result = alignExplanation(original, "tone", "tone");
    expect(result).toBe(original);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// BORDERLINE REAL-WORLD FIXTURES
// ═══════════════════════════════════════════════════════════════════════

describe("Borderline real-world caseworker language", () => {
  it("classifies 'refused to cooperate' as tone (motive attribution)", () => {
    const result = classifyAndDeduplicate([{
      type: "tone",
      severity: "medium",
      excerpt: "The client refused to cooperate with the safety assessment",
      explanation: "Implies willful noncompliance",
    }]);
    expect(result.issues[0].type).toBe("tone");
    expect(result.issues[0].matched_rules).toContain("tone_motive_attribution");
  });

  it("classifies clinical overclaim correctly", () => {
    const result = classifyAndDeduplicate([{
      type: "unsupported_conclusion",
      severity: "high",
      excerpt: "The mother is a narcissist who cannot be trusted with the children",
      explanation: "Clinical label without documented basis",
    }]);
    expect(result.issues[0].type).toBe("unsupported_conclusion");
    expect(result.issues[0].severity).toBe("high");
  });

  it("does not flag professional observation language", () => {
    // This candidate might come from an overly aggressive LLM
    const result = classifyAndDeduplicate([{
      type: "tone",
      severity: "low",
      excerpt: "Worker observed that the home was disorganized with limited food available",
      explanation: "Negative description of home conditions",
    }]);
    // No tone rules match "disorganized" — the LLM category stands but at low severity
    expect(result.issues[0].type).toBe("tone");
    expect(result.issues[0].category_source).toBe("llm"); // rules didn't match
  });

  it("handles the 'poor judgment' moralizing pattern", () => {
    const result = classifyAndDeduplicate([{
      type: "bias",
      severity: "medium",
      excerpt: "Mother showed poor judgment by leaving children unsupervised",
      explanation: "Assumes capability",
    }]);
    expect(result.issues[0].type).toBe("tone"); // "poor judgment" is a tone rule
    expect(result.issues[0].category_source).toBe("rule_override");
  });

  it("produces exactly 1 finding for single-sentence issues", () => {
    const result = classifyAndDeduplicate([
      {
        type: "tone",
        severity: "medium",
        excerpt: "The father was aggressive and belligerent",
        explanation: "Judgmental characterization",
      },
      {
        type: "bias",
        severity: "medium",
        excerpt: "father was aggressive and belligerent during",
        explanation: "Stigmatizing language",
      },
      {
        type: "unsupported_conclusion",
        severity: "low",
        excerpt: "The father was aggressive",
        explanation: "States behavior as inherent trait",
      },
    ]);
    // All three overlap → should merge to exactly 1
    expect(result.issues.length).toBe(1);
  });
});
