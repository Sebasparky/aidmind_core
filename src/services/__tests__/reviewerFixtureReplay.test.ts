import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  REVIEWER_FIXTURE_CANDIDATES,
  runFixtureReviewer,
} from "../reviewerFixtureReplay";
import type { ReviewerPayload } from "../localReviewer";

// vitest runs from the repo root (vite.config.ts); jsdom's URL is not a Node file URL
const DEMO_DOCUMENT_PATH = path.resolve(process.cwd(), "scripts/demo-stack/demo-document.html");

/** Strip tags and collapse whitespace the way a text-layer extraction would. */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const demoHtml = readFileSync(DEMO_DOCUMENT_PATH, "utf8");
const demoText = htmlToText(demoHtml);

const ATTRIBUTED_QUOTE = 'Client stated "I am worried about the rent increase."';

function payloadFor(documentText: string): ReviewerPayload {
  return {
    session_id: "test-session",
    document_text: documentText,
    structured_answers: [],
    review_worthy_answers: [
      { field_key: "housing_narrative", label: "Housing Narrative", answer: "x", recovery_confidence: "high", missing: false, requires_human_review: false },
      { field_key: "worker_assessment", label: "Worker Assessment", answer: "x", recovery_confidence: "high", missing: false, requires_human_review: false },
      { field_key: "next_steps", label: "Next Steps", answer: "x", recovery_confidence: "high", missing: false, requires_human_review: false },
    ],
    unanswered_fields: [],
    human_review_fields: [],
  };
}

describe("reviewerFixtureReplay", () => {
  it("drops candidates whose excerpt is absent from the document text", async () => {
    const unrelated =
      "Home visit completed. The client reported that the lease is current and that rent was paid on time this month. " +
      "Worker reviewed the household budget worksheet with the client and scheduled a follow-up visit for next month.";
    const result = await runFixtureReviewer(payloadFor(unrelated));
    expect(result.success).toBe(true);
    expect(result.review_report.issues).toHaveLength(0);
    expect(result.review_report.metrics.issue_count).toBe(0);
    expect(result.review_report.summary.overall_risk).toBe("low");
  });

  it("keeps and classifies all three demo sentences, never flags the attributed quote, and is deterministic", async () => {
    expect(demoText).toContain(ATTRIBUTED_QUOTE);

    const first = await runFixtureReviewer(payloadFor(demoText));
    const second = await runFixtureReviewer(payloadFor(demoText));

    expect(first.success).toBe(true);
    const excerpts = first.review_report.issues.map((i) => i.excerpt);
    for (const candidate of REVIEWER_FIXTURE_CANDIDATES) {
      expect(excerpts).toContain(candidate.excerpt);
    }
    expect(first.review_report.issues).toHaveLength(REVIEWER_FIXTURE_CANDIDATES.length);

    for (const issue of first.review_report.issues) {
      expect(["tone", "bias", "unsupported_conclusion", "policy_language"]).toContain(issue.type);
      expect(issue.finding_track).toBe("primary");
      expect(issue.category_source).toBeDefined();
      expect(issue.excerpt).not.toContain("I am worried about the rent increase");
    }
    expect(first.review_report.summary.key_findings.join(" ")).not.toContain("I am worried about the rent increase");
    expect(first.review_report.metrics.issue_count).toBe(REVIEWER_FIXTURE_CANDIDATES.length);
    expect(["medium", "high"]).toContain(first.review_report.summary.overall_risk);

    // Deterministic: identical output across runs
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("has every fixture excerpt verbatim in scripts/demo-stack/demo-document.html", () => {
    for (const candidate of REVIEWER_FIXTURE_CANDIDATES) {
      expect(demoHtml).toContain(candidate.excerpt);
      expect(demoText).toContain(candidate.excerpt);
    }
  });
});
