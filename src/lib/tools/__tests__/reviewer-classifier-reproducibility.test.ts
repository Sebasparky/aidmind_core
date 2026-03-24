/**
 * Deterministic Classifier Reproducibility Tests
 * 
 * Validates that the classifier produces IDENTICAL output when given
 * identical input across multiple invocations. This proves the classifier
 * itself is not a source of nondeterminism.
 */

import { describe, it, expect } from "vitest";
import {
  classifyAndDeduplicate,
  type CandidateIssue,
} from "../reviewer-deterministic-classifier";

// ── Test fixtures ────────────────────────────────────────────────────

const TONE_CANDIDATES: CandidateIssue[] = [
  {
    type: "tone",
    severity: "medium",
    excerpt: "The client was uncooperative and hostile during the interview.",
    explanation: "Uses judgmental language to characterize the client.",
    field_key: "narrative_summary",
  },
  {
    type: "bias",
    severity: "low",
    excerpt: "The client seemed disinterested in the process.",
    explanation: "Makes subjective assessment about engagement.",
  },
];

const OVERLAP_CANDIDATES: CandidateIssue[] = [
  {
    type: "tone",
    severity: "medium",
    excerpt: "The mother is clearly an unfit parent who refuses to cooperate.",
    explanation: "Judgmental tone in describing the parent.",
    field_key: "assessment",
  },
  {
    type: "unsupported_conclusion",
    severity: "high",
    excerpt: "clearly an unfit parent who refuses to cooperate",
    explanation: "Unsupported conclusion about parenting ability.",
    field_key: "assessment",
  },
  {
    type: "bias",
    severity: "medium",
    excerpt: "The mother is clearly an unfit parent",
    explanation: "Biased characterization of parenting capacity.",
    field_key: "assessment",
  },
];

const MIXED_CANDIDATES: CandidateIssue[] = [
  {
    type: "unsupported_conclusion",
    severity: "medium",
    excerpt: "It is clear that the family environment poses a significant risk to the children.",
    explanation: "Overclaiming risk without documented evidence.",
    field_key: "risk_assessment",
  },
  {
    type: "policy_language",
    severity: "low",
    excerpt: "The alleged perpetrator was questioned at the scene.",
    explanation: "Uses prohibited policy terminology.",
    field_key: "incident_narrative",
  },
  {
    type: "completeness",
    severity: "medium",
    excerpt: "",
    explanation: "The safety plan narrative section appears blank.",
    field_key: "safety_plan",
  },
  {
    type: "tone",
    severity: "low",
    excerpt: "Father appeared reluctant to discuss the situation.",
    explanation: "Mild subjective characterization.",
    field_key: "interview_notes",
  },
];

const EMPTY_CANDIDATES: CandidateIssue[] = [];

const SINGLE_CANDIDATE: CandidateIssue[] = [
  {
    type: "bias",
    severity: "high",
    excerpt: "The addict was found unresponsive in the home.",
    explanation: "Labels the person as 'the addict' which is stigmatizing.",
    field_key: "narrative",
  },
];

// ── Determinism tests ────────────────────────────────────────────────

describe("Classifier Reproducibility", () => {
  it("produces identical output across 10 consecutive runs — tone candidates", () => {
    const results = Array.from({ length: 10 }, () =>
      classifyAndDeduplicate([...TONE_CANDIDATES.map(c => ({ ...c }))])
    );

    const first = JSON.stringify(results[0]);
    for (let i = 1; i < results.length; i++) {
      expect(JSON.stringify(results[i])).toBe(first);
    }
  });

  it("produces identical output across 10 consecutive runs — overlap candidates", () => {
    const results = Array.from({ length: 10 }, () =>
      classifyAndDeduplicate([...OVERLAP_CANDIDATES.map(c => ({ ...c }))])
    );

    const first = JSON.stringify(results[0]);
    for (let i = 1; i < results.length; i++) {
      expect(JSON.stringify(results[i])).toBe(first);
    }
  });

  it("produces identical output across 10 consecutive runs — mixed candidates", () => {
    const results = Array.from({ length: 10 }, () =>
      classifyAndDeduplicate([...MIXED_CANDIDATES.map(c => ({ ...c }))])
    );

    const first = JSON.stringify(results[0]);
    for (let i = 1; i < results.length; i++) {
      expect(JSON.stringify(results[i])).toBe(first);
    }
  });

  it("produces identical output for empty input", () => {
    const results = Array.from({ length: 5 }, () =>
      classifyAndDeduplicate([])
    );
    for (const r of results) {
      expect(r.issues).toHaveLength(0);
      expect(r.stats.input_count).toBe(0);
    }
  });

  it("produces identical output for single strong-rule candidate", () => {
    const results = Array.from({ length: 10 }, () =>
      classifyAndDeduplicate([...SINGLE_CANDIDATE.map(c => ({ ...c }))])
    );

    const first = JSON.stringify(results[0]);
    for (let i = 1; i < results.length; i++) {
      expect(JSON.stringify(results[i])).toBe(first);
    }
  });

  it("is order-independent: different input orderings produce same output", () => {
    const original = classifyAndDeduplicate([...MIXED_CANDIDATES]);
    const reversed = classifyAndDeduplicate([...MIXED_CANDIDATES].reverse());
    
    // Same number of issues
    expect(reversed.issues.length).toBe(original.issues.length);
    
    // Same final ordering (deterministic sort)
    for (let i = 0; i < original.issues.length; i++) {
      expect(reversed.issues[i].type).toBe(original.issues[i].type);
      expect(reversed.issues[i].severity).toBe(original.issues[i].severity);
      expect(reversed.issues[i].excerpt).toBe(original.issues[i].excerpt);
    }
  });

  it("overlap resolution is deterministic: same winner every time", () => {
    const results = Array.from({ length: 10 }, () =>
      classifyAndDeduplicate([...OVERLAP_CANDIDATES.map(c => ({ ...c }))])
    );

    // All should produce same number of issues
    const counts = results.map(r => r.issues.length);
    expect(new Set(counts).size).toBe(1);

    // Winner type should be consistent
    const winnerTypes = results.map(r => r.issues[0]?.type);
    expect(new Set(winnerTypes).size).toBe(1);
  });

  it("stats are consistent across runs", () => {
    const results = Array.from({ length: 10 }, () =>
      classifyAndDeduplicate([...OVERLAP_CANDIDATES.map(c => ({ ...c }))])
    );

    const firstStats = JSON.stringify(results[0].stats);
    for (let i = 1; i < results.length; i++) {
      expect(JSON.stringify(results[i].stats)).toBe(firstStats);
    }
  });
});
