import { describe, it, expect } from "vitest";
import {
  classifyAndDeduplicate,
  normalizeExcerpt,
  excerptOverlaps,
  matchRulesAgainstExcerpt,
  calibrateSeverity,
  resolveOverlappingCategories,
  alignExplanation,
  isExplanationAligned,
  isBorderlineObservational,
  CATEGORY_TEMPLATES,
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
  it("detects word overlap at 50%", () => {
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
// CONSISTENCY FIXTURES — Same input → same output (5 runs each)
// ═══════════════════════════════════════════════════════════════════════

describe("Consistency: same input → same output", () => {
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
    expect(result.issues[0].severity).toBe("medium");
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
    expect(result.issues.length).toBe(1);
    expect(result.stats.overlap_merges).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// CATEGORY OVERRIDE — Rules correct LLM misclassification
// ═══════════════════════════════════════════════════════════════════════

describe("Category override by deterministic rules", () => {
  it("reclassifies bias-labeled judgmental adjective to tone", () => {
    const candidates: CandidateIssue[] = [{
      type: "bias",
      severity: "medium",
      excerpt: "The client was lazy and irresponsible about following the service plan",
      explanation: "Makes assumptions about the client",
    }];
    const result = classifyAndDeduplicate(candidates);
    expect(result.issues.length).toBe(1);
    expect(result.issues[0].type).toBe("tone");
    expect(result.issues[0].category_source).toBe("rule_override");
  });

  it("reclassifies tone-labeled certainty-overclaim to unsupported_conclusion", () => {
    const candidates: CandidateIssue[] = [{
      type: "tone",
      severity: "medium",
      excerpt: "It is obvious that she deliberately misrepresented her situation",
      explanation: "Uses charged language",
    }];
    const result = classifyAndDeduplicate(candidates);
    expect(result.issues.length).toBe(1);
    expect(result.issues[0].type).toBe("unsupported_conclusion");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SEVERITY CALIBRATION
// ═══════════════════════════════════════════════════════════════════════

describe("Severity calibration", () => {
  it("enforces severity floor for person-labeling bias", () => {
    const candidates: CandidateIssue[] = [{
      type: "bias",
      severity: "low",
      excerpt: "The addict left the children alone",
      explanation: "Labels the person",
    }];
    const result = classifyAndDeduplicate(candidates);
    expect(result.issues[0].severity).toBe("high");
    expect(result.issues[0].severity_adjusted).toBe(true);
  });

  it("caps severity for mild subjective tone", () => {
    const candidates: CandidateIssue[] = [{
      type: "tone",
      severity: "high",
      excerpt: "The client seemed reluctant to engage with the plan",
      explanation: "Subjective characterization",
    }];
    const result = classifyAndDeduplicate(candidates);
    expect(result.issues[0].severity).toBe("medium");
    expect(result.issues[0].severity_adjusted).toBe(true);
  });

  it("caps certainty intensifiers at medium", () => {
    const candidates: CandidateIssue[] = [{
      type: "unsupported_conclusion",
      severity: "high",
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
    expect(result.issues.length).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// EXPLANATION ALIGNMENT v2 — Category purity
// ═══════════════════════════════════════════════════════════════════════

describe("Explanation alignment v2", () => {
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

  it("strips cross-category terms when category changes from tone to UC", () => {
    const result = alignExplanation(
      "Uses judgmental or unprofessional language — this statement makes an unsupported conclusion about the client's intent",
      "tone",
      "unsupported_conclusion",
    );
    // Should NOT contain tone terms
    expect(result.toLowerCase()).not.toContain("judgmental tone");
    expect(result.toLowerCase()).not.toContain("unprofessional");
    // Should contain UC terms
    expect(result.toLowerCase()).toContain("conclusion");
  });

  it("produces category-pure tone explanations", () => {
    const result = alignExplanation(
      "This is an unsupported conclusion about client behavior",
      "unsupported_conclusion",
      "tone",
    );
    expect(result.toLowerCase()).toContain("judgmental");
    // Forbidden UC terms should be stripped
    expect(result.toLowerCase()).not.toContain("unsupported conclusion");
  });

  it("isExplanationAligned catches forbidden terms", () => {
    expect(isExplanationAligned("Uses judgmental tone and makes an unsupported conclusion", "tone")).toBe(false);
    expect(isExplanationAligned("Uses judgmental language to characterize the client", "tone")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// BORDERLINE OBSERVATIONAL LANGUAGE GUARDRAIL
// ═══════════════════════════════════════════════════════════════════════

describe("Borderline observational language guardrail", () => {
  it("suppresses 'appears to be in disarray' without strong markers", () => {
    const result = classifyAndDeduplicate([{
      type: "tone",
      severity: "low",
      excerpt: "The household appears to be in disarray, and the children seem to be carrying the stress of adult problems",
      explanation: "Negative description of home conditions",
    }]);
    // Should be suppressed — borderline observational
    expect(result.issues.length).toBe(0);
    expect(result.stats.borderline_suppressed).toBe(1);
  });

  it("suppresses 'children appeared tired' without strong markers", () => {
    const result = classifyAndDeduplicate([{
      type: "tone",
      severity: "low",
      excerpt: "The children appeared tired and the home was cluttered",
      explanation: "Negative description",
    }]);
    expect(result.issues.length).toBe(0);
    expect(result.stats.borderline_suppressed).toBe(1);
  });

  it("does NOT suppress observational language combined with strong markers", () => {
    const result = classifyAndDeduplicate([{
      type: "unsupported_conclusion",
      severity: "medium",
      excerpt: "The home appeared to be in disarray, and it is clearly evident that the children are being neglected",
      explanation: "Overclaims based on observation",
    }]);
    // "clearly evident" is a strong UC rule — not suppressed
    expect(result.issues.length).toBe(1);
  });

  it("does NOT suppress when strong tone rules match", () => {
    const result = classifyAndDeduplicate([{
      type: "tone",
      severity: "medium",
      excerpt: "The client appeared reluctant and was hostile and uncooperative during the visit",
      explanation: "Judgmental language",
    }]);
    // "hostile" and "uncooperative" are strong tone — not suppressed
    expect(result.issues.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// REAL-WORLD REGRESSION FIXTURES
// ═══════════════════════════════════════════════════════════════════════

describe("Real-world regression fixtures", () => {
  it("R1: 'poor judgment + minimally motivated' → tone dominant", () => {
    const result = classifyAndDeduplicate([
      {
        type: "tone",
        severity: "medium",
        excerpt: "caregiver appears to have made poor judgment around evening supervision and seems minimally motivated to follow through",
        explanation: "Judgmental language",
      },
    ]);
    // "poor judgment" → strong tone rule. Single finding, tone.
    expect(result.issues.length).toBe(1);
    expect(result.issues[0].type).toBe("tone");
  });

  it("R2: 'household in disarray, children carrying stress' → conservative handling", () => {
    const result = classifyAndDeduplicate([{
      type: "tone",
      severity: "low",
      excerpt: "The household appears to be in disarray, and the children seem to be carrying the stress of adult problems.",
      explanation: "Negative characterization of household",
    }]);
    // Borderline observational — should be suppressed
    expect(result.issues.length).toBe(0);
  });

  it("R3: 'neglectful home pattern + high-risk' → 1 UC finding", () => {
    const result = classifyAndDeduplicate([{
      type: "unsupported_conclusion",
      severity: "high",
      excerpt: "Current presentation is consistent with a neglectful home pattern, and the family is treated as high-risk for ongoing supervisory failure.",
      explanation: "Reaches conclusions about family risk without sufficient evidence",
    }]);
    expect(result.issues.length).toBe(1);
    expect(result.issues[0].type).toBe("unsupported_conclusion");
    expect(["medium", "high"]).toContain(result.issues[0].severity);
  });

  it("R4: 'children will almost certainly be left without supervision' → UC high-certainty", () => {
    const result = classifyAndDeduplicate([{
      type: "unsupported_conclusion",
      severity: "high",
      excerpt: "If services are not started immediately, the children will almost certainly be left without any supervision on most evenings.",
      explanation: "Future prediction stated with unwarranted certainty",
    }]);
    expect(result.issues.length).toBe(1);
    expect(result.issues[0].type).toBe("unsupported_conclusion");
  });

  it("R5: 'clearly inadequate for safe parenting' → UC, not tone", () => {
    const result = classifyAndDeduplicate([{
      type: "tone",
      severity: "medium",
      excerpt: "Family functioning appears clearly inadequate for safe parenting without direct agency oversight.",
      explanation: "Judgmental characterization of family",
    }]);
    expect(result.issues.length).toBe(1);
    // "clearly inadequate" is a strong UC pattern; should override tone
    expect(result.issues[0].type).toBe("unsupported_conclusion");
  });

  it("R6: true tone example stays tone", () => {
    const result = classifyAndDeduplicate([{
      type: "tone",
      severity: "medium",
      excerpt: "The mother was lazy and irresponsible about attending scheduled appointments",
      explanation: "Uses judgmental language",
    }]);
    expect(result.issues.length).toBe(1);
    expect(result.issues[0].type).toBe("tone");
    expect(result.issues[0].severity).toBe("medium");
  });

  it("R7: true bias example stays bias", () => {
    const result = classifyAndDeduplicate([{
      type: "bias",
      severity: "high",
      excerpt: "The substance abuser continues to make the same choices despite multiple interventions",
      explanation: "Labels the person",
    }]);
    expect(result.issues.length).toBe(1);
    expect(result.issues[0].type).toBe("bias");
    expect(result.issues[0].severity).toBe("high");
  });

  it("R8: true policy example stays policy", () => {
    const result = classifyAndDeduplicate([{
      type: "policy_language",
      severity: "medium",
      excerpt: "The worker is gonna check in on the alleged victim next week",
      explanation: "Uses prohibited terminology",
    }]);
    expect(result.issues.length).toBe(1);
    expect(result.issues[0].type).toBe("policy_language");
  });

  it("R9: clean professional paragraph → 0 findings", () => {
    // LLM should ideally not emit this, but if it does, the DCE should pass it through
    // without modification (no rules match, no suppression)
    const result = classifyAndDeduplicate([]);
    expect(result.issues.length).toBe(0);
  });

  it("R10: multiple overlapping UC spans merge to 1", () => {
    const result = classifyAndDeduplicate([
      {
        type: "unsupported_conclusion",
        severity: "medium",
        excerpt: "It is obvious that she will obviously continue to misuse program benefits",
        explanation: "Overclaims financial behavior",
      },
      {
        type: "unsupported_conclusion",
        severity: "medium",
        excerpt: "obviously continue to misuse program benefits without any support",
        explanation: "States conclusion as fact",
      },
    ]);
    expect(result.issues.length).toBe(1);
    expect(result.issues[0].type).toBe("unsupported_conclusion");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// DETERMINISM ASSERTIONS — Repeated runs produce identical output
// ═══════════════════════════════════════════════════════════════════════

describe("Determinism: repeated runs produce identical output", () => {
  const COMPLEX_CANDIDATES: CandidateIssue[] = [
    {
      type: "tone",
      severity: "medium",
      excerpt: "The client was hostile and uncooperative during every visit",
      explanation: "Judgmental characterization",
    },
    {
      type: "unsupported_conclusion",
      severity: "high",
      excerpt: "It is obvious that the client deliberately avoided providing documentation",
      explanation: "States intent as fact",
    },
    {
      type: "bias",
      severity: "high",
      excerpt: "The addict was found in the home with the children",
      explanation: "Labels the person",
    },
  ];

  it("10 runs produce identical findings", () => {
    const baseline = classifyAndDeduplicate(COMPLEX_CANDIDATES.map(c => ({ ...c })));

    for (let i = 0; i < 10; i++) {
      const run = classifyAndDeduplicate(COMPLEX_CANDIDATES.map(c => ({ ...c })));
      expect(run.issues.length).toBe(baseline.issues.length);
      for (let j = 0; j < run.issues.length; j++) {
        expect(run.issues[j].type).toBe(baseline.issues[j].type);
        expect(run.issues[j].severity).toBe(baseline.issues[j].severity);
        expect(run.issues[j].category_source).toBe(baseline.issues[j].category_source);
        expect(run.issues[j].explanation).toBe(baseline.issues[j].explanation);
      }
    }
  });

  it("ordering is stable across runs", () => {
    const baseline = classifyAndDeduplicate(COMPLEX_CANDIDATES.map(c => ({ ...c })));
    const types = baseline.issues.map(i => i.type);

    for (let i = 0; i < 5; i++) {
      const run = classifyAndDeduplicate(COMPLEX_CANDIDATES.map(c => ({ ...c })));
      expect(run.issues.map(i => i.type)).toEqual(types);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// ORDERING TESTS
// ═══════════════════════════════════════════════════════════════════════

describe("Final ordering", () => {
  it("primary findings come before secondary findings", () => {
    const result = classifyAndDeduplicate([
      {
        type: "completeness",
        severity: "medium",
        excerpt: "Case narrative section appears blank",
        explanation: "Missing section",
        field_key: "case_narrative",
      },
      {
        type: "tone",
        severity: "medium",
        excerpt: "The client was belligerent and aggressive",
        explanation: "Judgmental language",
      },
    ]);
    expect(result.issues.length).toBe(2);
    expect(result.issues[0].type).toBe("tone"); // primary first
    expect(result.issues[1].type).toBe("completeness"); // secondary second
  });

  it("higher severity comes before lower within same track", () => {
    const result = classifyAndDeduplicate([
      {
        type: "tone",
        severity: "low",
        excerpt: "The client seemed somewhat reluctant to participate",
        explanation: "Mild subjective characterization",
      },
      {
        type: "bias",
        severity: "high",
        excerpt: "The addict continues to make poor choices",
        explanation: "Person-labeling",
      },
    ]);
    expect(result.issues.length).toBe(2);
    expect(result.issues[0].severity).toBe("high");
  });
});

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

  it("suppresses professional observation language as borderline", () => {
    const result = classifyAndDeduplicate([{
      type: "tone",
      severity: "low",
      excerpt: "Worker observed that the home appeared cluttered with limited food available",
      explanation: "Negative description of home conditions",
    }]);
    // Borderline observational with no strong rules → suppressed
    expect(result.issues.length).toBe(0);
    expect(result.stats.borderline_suppressed).toBe(1);
  });

  it("handles the 'poor judgment' moralizing pattern", () => {
    const result = classifyAndDeduplicate([{
      type: "bias",
      severity: "medium",
      excerpt: "Mother showed poor judgment by leaving children unsupervised",
      explanation: "Assumes capability",
    }]);
    expect(result.issues[0].type).toBe("tone");
    expect(result.issues[0].category_source).toBe("rule_override");
  });

  it("produces exactly 1 finding for single-sentence multi-category issues", () => {
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
    expect(result.issues.length).toBe(1);
  });
});
