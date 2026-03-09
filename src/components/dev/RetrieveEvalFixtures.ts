/**
 * Records Room v4 Evaluation Fixtures
 * 
 * Dev-only test queries for manual ranking quality evaluation.
 * Gated by VITE_DEV_MODE.
 */

export interface EvalQuery {
  id: string;
  label: string;
  category: string;
  query: string;
  /** What a good top-1 result would contain (human-readable) */
  expected_signal: string;
}

export const EVAL_QUERIES: EvalQuery[] = [
  // ── Direct concept lookup ──
  {
    id: "nta-concept",
    label: "Notice to appear (concept)",
    category: "direct_concept",
    query: "notice to appear immigration court",
    expected_signal: "§1229 — notice to appear provision language",
  },
  {
    id: "removal-concept",
    label: "Removal proceedings (concept)",
    category: "direct_concept",
    query: "removal proceedings",
    expected_signal: "§1229a — removal proceedings provision",
  },
  {
    id: "voluntary-departure",
    label: "Voluntary departure (concept)",
    category: "direct_concept",
    query: "voluntary departure",
    expected_signal: "§1229c — voluntary departure provision",
  },
  {
    id: "inadmissibility",
    label: "Inadmissibility (concept)",
    category: "direct_concept",
    query: "grounds of inadmissibility",
    expected_signal: "§1182 — inadmissibility grounds",
  },

  // ── Section-specific ──
  {
    id: "section-1229",
    label: "Section 1229",
    category: "section_specific",
    query: "section 1229 notice to appear",
    expected_signal: "Exact §1229 content",
  },
  {
    id: "section-1229a",
    label: "Section 1229a",
    category: "section_specific",
    query: "section 1229a removal proceedings",
    expected_signal: "Exact §1229a content",
  },

  // ── Natural language / question ──
  {
    id: "nta-meaning",
    label: "What does NTA mean?",
    category: "natural_language",
    query: "What does a notice to appear mean?",
    expected_signal: "NTA definition or provision language",
  },
  {
    id: "removal-what",
    label: "What happens in removal?",
    category: "natural_language",
    query: "What happens in removal proceedings?",
    expected_signal: "Removal proceedings procedure/requirements",
  },
  {
    id: "inadmissible-what",
    label: "What makes someone inadmissible?",
    category: "natural_language",
    query: "What makes someone inadmissible?",
    expected_signal: "Inadmissibility grounds/criteria",
  },

  // ── Appeal / review (should NOT be penalized) ──
  {
    id: "judicial-review",
    label: "Judicial review query",
    category: "appeal_review",
    query: "judicial review of removal order",
    expected_signal: "Judicial review provisions, NOT base removal proceedings",
  },
  {
    id: "motion-reopen",
    label: "Motion to reopen",
    category: "appeal_review",
    query: "motion to reopen removal proceedings",
    expected_signal: "Motion to reopen provisions",
  },

  // ── Eligibility / standards ──
  {
    id: "adjustment-status",
    label: "Adjustment of status",
    category: "eligibility",
    query: "adjustment of status eligibility requirements",
    expected_signal: "Adjustment of status provision/criteria",
  },
  {
    id: "cancellation-removal",
    label: "Cancellation of removal",
    category: "eligibility",
    query: "cancellation of removal requirements",
    expected_signal: "Cancellation of removal criteria/provision",
  },

  // ── Deadline / procedural ──
  {
    id: "filing-deadline",
    label: "Filing deadline",
    category: "deadline",
    query: "deadline to file appeal of removal order",
    expected_signal: "Appeal deadline/timing provisions",
  },

  // ── Broad topic ──
  {
    id: "alien-registration",
    label: "Alien registration",
    category: "broad_topic",
    query: "alien registration requirements",
    expected_signal: "Registration provisions",
  },

  // ── Ambiguous short ──
  {
    id: "asylum-short",
    label: "Asylum (short)",
    category: "ambiguous_short",
    query: "asylum",
    expected_signal: "Asylum provisions or clarification prompt",
  },
  {
    id: "deportation-short",
    label: "Deportation (short)",
    category: "ambiguous_short",
    query: "deportation",
    expected_signal: "Deportation/removal provisions or clarification prompt",
  },
];

export interface EvalJudgment {
  query_id: string;
  top1_correct: boolean | null;
  top3_mostly_correct: boolean | null;
  collateral_outranked_primary: boolean | null;
  strong_supporting_split_correct: boolean | null;
  over_demoted: boolean | null;
  notes: string;
}

export function createEmptyJudgment(queryId: string): EvalJudgment {
  return {
    query_id: queryId,
    top1_correct: null,
    top3_mostly_correct: null,
    collateral_outranked_primary: null,
    strong_supporting_split_correct: null,
    over_demoted: null,
    notes: "",
  };
}
