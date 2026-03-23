import { describe, it, expect } from "vitest";
import {
  scanForLanguageTriggers,
  detectAttributionContext,
  splitIntoSentences,
  buildTriggerMetadata,
} from "../language-risk-rubric";

describe("scanForLanguageTriggers", () => {
  it("returns empty array for clean professional text", () => {
    const text = "The family was referred for services following a report to the department. Worker conducted a home visit and observed the children in the care of their mother. The home was clean and well-maintained. Food was available in the pantry and refrigerator.";
    const result = scanForLanguageTriggers(text);
    expect(result).toEqual([]);
  });

  it("returns empty for very short text", () => {
    expect(scanForLanguageTriggers("")).toEqual([]);
    expect(scanForLanguageTriggers("short")).toEqual([]);
  });

  it("detects bias_stigma triggers", () => {
    const text = "The addict was found in the home with the children. These people do not understand consequences.";
    const result = scanForLanguageTriggers(text);
    const biasHits = result.find(r => r.category === "bias_stigma");
    expect(biasHits).toBeDefined();
    expect(biasHits!.hitCount).toBeGreaterThanOrEqual(1);
  });

  it("detects judgmental_tone triggers", () => {
    const text = "The client was uncooperative and refused to provide documentation. She failed to cooperate with the investigation.";
    const result = scanForLanguageTriggers(text);
    const toneHits = result.find(r => r.category === "judgmental_tone");
    expect(toneHits).toBeDefined();
    expect(toneHits!.hitCount).toBeGreaterThanOrEqual(2);
  });

  it("detects unsupported_conclusion triggers", () => {
    const text = "The client is clearly unable to manage her finances. It is obvious that she deliberately misrepresented her income.";
    const result = scanForLanguageTriggers(text);
    const conclusionHits = result.find(r => r.category === "unsupported_conclusion");
    expect(conclusionHits).toBeDefined();
    expect(conclusionHits!.hitCount).toBeGreaterThanOrEqual(2);
  });

  it("detects policy_inconsistent triggers", () => {
    const text = "The alleged perpetrator was tragically found at the scene. The worker is gonna follow up next week.";
    const result = scanForLanguageTriggers(text);
    const policyHits = result.find(r => r.category === "policy_inconsistent");
    expect(policyHits).toBeDefined();
    expect(policyHits!.hitCount).toBeGreaterThanOrEqual(2);
  });

  it("does not flag professional but firm language", () => {
    const text = "Worker explained the program requirements clearly and directly. The client was informed that noncompliance with the service plan may result in a change to the case status. Worker provided written notice of the next review date. The client acknowledged understanding of the requirements.";
    const result = scanForLanguageTriggers(text);
    // "clearly" will trigger unsupported_conclusion — that's the heuristic nature.
    // But "noncompliant" as part of formal explanation shouldn't over-trigger.
    const biasHits = result.find(r => r.category === "bias_stigma");
    expect(biasHits).toBeUndefined();
  });

  it("returns metadata only — no text excerpts in output", () => {
    const text = "The hostile client refused to cooperate with the investigation.";
    const result = scanForLanguageTriggers(text);
    for (const r of result) {
      expect(r).toHaveProperty("category");
      expect(r).toHaveProperty("hitCount");
      expect(Object.keys(r)).toEqual(["category", "hitCount"]);
    }
  });
});

describe("detectAttributionContext", () => {
  it("detects quoted regions", () => {
    const text = 'The client stated "I never touched the child" during the interview. Mother reported "he comes home late every night."';
    const result = detectAttributionContext(text);
    expect(result.quotedRegionCount).toBe(2);
    expect(result.attributionMarkerCount).toBeGreaterThanOrEqual(2);
  });

  it("detects attribution markers without quotes", () => {
    const text = "According to the school, the child has been absent frequently. The teacher reported that academic performance has declined.";
    const result = detectAttributionContext(text);
    expect(result.attributionMarkerCount).toBeGreaterThanOrEqual(2);
  });

  it("returns zeros for clean authored text", () => {
    const text = "Worker conducted a home visit on March 15. The home was clean and organized. Children appeared healthy and well-nourished.";
    const result = detectAttributionContext(text);
    expect(result.attributionMarkerCount).toBe(0);
  });

  it("returns zeros for empty text", () => {
    const result = detectAttributionContext("");
    expect(result.quotedRegionCount).toBe(0);
    expect(result.attributionMarkerCount).toBe(0);
  });
});

describe("splitIntoSentences", () => {
  it("splits on periods", () => {
    const text = "First sentence here. Second sentence here. Third sentence here.";
    const sentences = splitIntoSentences(text);
    expect(sentences.length).toBe(3);
  });

  it("splits on double newlines", () => {
    const text = "First paragraph with content\n\nSecond paragraph with content";
    const sentences = splitIntoSentences(text);
    expect(sentences.length).toBe(2);
  });

  it("filters out very short fragments", () => {
    const text = "A. B. This is a real sentence. C.";
    const sentences = splitIntoSentences(text);
    expect(sentences.every(s => s.length > 5)).toBe(true);
  });

  it("returns empty for empty input", () => {
    expect(splitIntoSentences("")).toEqual([]);
    expect(splitIntoSentences("   ")).toEqual([]);
  });
});

describe("buildTriggerMetadata", () => {
  it("builds metadata object from scan results", () => {
    const triggers = [
      { category: "bias_stigma" as const, hitCount: 2 },
      { category: "judgmental_tone" as const, hitCount: 1 },
    ];
    const attribution = { quotedRegionCount: 3, attributionMarkerCount: 5 };
    const metadata = buildTriggerMetadata(triggers, attribution);
    expect(metadata.bias_stigma).toBe(2);
    expect(metadata.judgmental_tone).toBe(1);
    expect(metadata._quoted_regions).toBe(3);
    expect(metadata._attribution_markers).toBe(5);
  });
});
