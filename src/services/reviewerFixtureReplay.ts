/**
 * reviewerFixtureReplay.ts — FIXTURE REPLAY for the Reviewer demo. NOT a model run.
 *
 * What this is:
 *   This module replays a small, hand-written list of candidate problematic
 *   spans (REVIEWER_FIXTURE_CANDIDATES) authored for the synthetic demo document
 *   scripts/demo-stack/demo-document.html ("Housing Stability Check-In", fictional
 *   client "J. Rivera"). It exists so the deterministic classification engine,
 *   confidence/coverage caps and the Reviewer UI can be demonstrated on a machine
 *   that has no local model (no Ollama) and without any hosted AI call.
 *
 * What this is NOT:
 *   - It is NOT a language model and performs no inference of any kind.
 *   - It does not read the document for new issues: a candidate is only kept when
 *     its excerpt is an exact substring of the uploaded document text, so a
 *     different document yields no findings (not fabricated ones).
 *   - It never imports localModel.ts and never reaches the live pipeline
 *     (runLocalReviewer). Only the shared deterministic post-processing
 *     (finalizeReviewReport) is reused, exactly as the live path uses it.
 *
 * Activation and disclosure:
 *   Enabled only when VITE_REVIEWER_MODEL_SOURCE=fixture at build time. When on,
 *   Reviewer.tsx shows "Fixture replay — no live model" badges and reports the
 *   audit event with tool_name "run_reviewer_v2_fixture".
 */

import {
  finalizeReviewReport,
  validateReviewReport,
  type LocalReviewerResponse,
  type ReviewerPayload,
} from "./localReviewer";

export function isFixtureReplayEnabled(): boolean {
  return import.meta.env.VITE_REVIEWER_MODEL_SOURCE === "fixture";
}

export interface FixtureCandidate {
  type: "tone" | "bias" | "unsupported_conclusion" | "policy_language" | "completeness" | "consistency";
  severity: "low" | "medium" | "high";
  /** Must be an exact, verbatim substring of the demo document text. */
  excerpt: string;
  explanation: string;
  field_key?: string;
}

/**
 * Canned candidate spans for scripts/demo-stack/demo-document.html.
 * Categories and severities are best-guess starting points; the deterministic
 * classification engine (finalizeReviewReport) decides the final category,
 * severity and deduplication exactly as it does for live model output.
 */
export const REVIEWER_FIXTURE_CANDIDATES: readonly FixtureCandidate[] = [
  {
    type: "unsupported_conclusion",
    severity: "high",
    excerpt: "Client is clearly lying about her income.",
    explanation:
      "Asserts deception as an established fact without documenting the evidence; \"clearly\" presents a conclusion with more certainty than the record supports.",
    field_key: "housing_narrative",
  },
  {
    type: "bias",
    severity: "medium",
    excerpt: "She will never follow through with the housing plan.",
    explanation:
      "Predicts future behavior as certain; an unsupported assumption about the client rather than a documented observation.",
    field_key: "worker_assessment",
  },
  {
    type: "tone",
    severity: "medium",
    excerpt: "The client was rude and difficult during the whole visit.",
    explanation:
      "Judgmental characterization of the client; describe the observed behavior instead of labeling the person.",
    field_key: "worker_assessment",
  },
];

/**
 * Replays the fixture candidates against `payload.document_text` and runs the
 * same deterministic post-processing as the live path. No model is called.
 */
export async function runFixtureReviewer(payload: ReviewerPayload): Promise<LocalReviewerResponse> {
  if (!payload.document_text?.trim() || payload.document_text.trim().length < 50) {
    throw new Error("Document text must be at least 50 characters.");
  }

  const documentText = payload.document_text;
  const kept = REVIEWER_FIXTURE_CANDIDATES.filter((c) => documentText.includes(c.excerpt));

  const rawReport = {
    summary: {
      overall_risk: kept.some((c) => c.severity === "high") ? "high" : kept.length > 0 ? "medium" : "low",
      key_findings: kept.map((c) => c.explanation),
      fields_reviewed: payload.review_worthy_answers?.length ?? 0,
      fields_missing: payload.unanswered_fields?.length ?? 0,
      fields_human_review: payload.human_review_fields?.length ?? 0,
      review_confidence: "medium",
      narrative_coverage: "partial",
    },
    issues: kept.map((c) => ({
      type: c.type,
      severity: c.severity,
      excerpt: c.excerpt,
      explanation: c.explanation,
      ...(c.field_key ? { field_key: c.field_key } : {}),
    })),
    metrics: {
      issue_count: kept.length,
      high_severity_count: kept.filter((c) => c.severity === "high").length,
    },
  };

  if (!validateReviewReport(rawReport)) {
    throw new Error("Fixture replay produced an invalid review report shape.");
  }

  return finalizeReviewReport(rawReport, payload);
}
