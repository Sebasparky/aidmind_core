# Reviewer v3.1 Revised Implementation Plan

## Key Revisions from Prior v3.1 Plan


| Prior Plan                                              | This Revision                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Model assigns `finding_track` per issue                 | Server assigns `finding_track` deterministically based on issue type            |
| Triggers scan full extracted text                       | Triggers scan only reviewer-eligible narrative fields                           |
| Confidence/coverage called "floor" (LLM bounded upward) | Renamed to "cap" — deterministic logic sets ceiling, LLM can only lower         |
| `unsupported_conclusion` left ambiguous                 | First-class issue type added to taxonomy                                        |
| No authored-vs-quoted heuristic                         | Deterministic attribution markers detect likely quoted content                  |
| Secondary findings mixed with primary                   | UI separates into primary (always visible) and secondary (collapsed by default) |
| Eval fixtures missing subtle-but-acceptable cases       | Added professional-but-firm, quoted-not-adopted, quoted-adopted fixtures        |


---

## Files to Create

### 1. `src/lib/tools/language-risk-rubric.ts` (NEW)

**Deterministic trigger scanner + authored-vs-quoted heuristic + sentence splitter.**

- **Trigger categories**: `bias_stigma`, `judgmental_tone`, `unsupported_conclusion`, `policy_inconsistent`
- **Trigger patterns** (regex, domain-neutral):
  - Certainty intensifiers: `clearly`, `obviously`, `undeniably`, `without question`
  - Judgmental adjectives: `uncooperative`, `manipulative`, `hostile`, `noncompliant`, `defiant`
  - Labeling patterns: `the addict`, `the abuser`, `the offender`
  - Motive attribution: `refused to`, `chose not to`, `failed to cooperate`
  - Unsupported clinical/legal: `diagnosed with`, `guilty of`, `suffering from`
- `**scanForLanguageTriggers(text: string)**` → returns `{ category: string, hitCount: number }[]` — metadata only, no text excerpts
- **Attribution markers** for authored-vs-quoted detection:
  - Regex patterns: `"client stated"`, `"mother reported"`, `"according to"`, `"source indicated"`, `"[person] said"`, etc.
  - `**detectAttributionContext(text: string)**` → returns `{ quotedRegionCount: number, attributionMarkerCount: number }` — metadata only
- `**splitIntoSentences(text: string)**` — naive period/newline splitter

**Critical constraint**: No raw text excerpts in trigger output. Metadata only.

### 2. `src/lib/tools/__tests__/language-risk-rubric.test.ts` (NEW)

Unit tests for triggers, attribution detection, sentence splitting. Verifies clean professional text → 0 hits.

### 3. `src/lib/tools/__tests__/reviewer-eval-fixtures.ts` (NEW)

10 fixtures:

1. Clean professional narrative → 0 findings
2. Subtle but acceptable professional wording → 0 findings (false-positive guard)
3. **Professional but firm / boundary-setting** → 0 findings
4. Subtle tone drift → 1-2 findings
5. Obvious bias/stigma → 1+ findings
6. Unsupported conclusion → 1+ findings
7. Policy-language violation → 1+ findings
8. Low narrative content → coverage = insufficient
9. Quoted problematic language NOT adopted → 0 findings expected
10. Quoted language adopted uncritically → 1+ findings expected
11. clean factual but dense caseworker narrative” → should remain 0 findings

---

## Files to Modify

### 4. `src/lib/tools/reviewer-v2-types.ts`

Add:

```ts
export type ReviewIssueType = "completeness" | "policy_language" | "tone" | "bias" | "consistency" | "unsupported_conclusion";

export type FindingTrack = "primary" | "secondary";

export interface ReviewIssue {
  // ...existing fields
  finding_track?: FindingTrack;  // assigned server-side, not by model
}

export interface ReviewerV2Report {
  summary: {
    // ...existing fields
    review_confidence: "high" | "medium" | "low";
    narrative_coverage: "sufficient" | "partial" | "insufficient";
  };
  // ...rest unchanged
}
```

### 5. `supabase/functions/run-reviewer/index.ts`

**Prompt changes:**

- Add authored-vs-quoted instruction block: "Distinguish between caseworker-authored narrative and quoted/attributed speech. Do not flag quoted material for tone/bias unless the caseworker adopts or amplifies it."
- Add `unsupported_conclusion` as explicit issue type in the prompt schema
- Add stricter finding threshold instruction: "Each finding MUST have a clear anchored text span, a clear risk category, and a direct explanation. Prefer zero findings over weak findings."
- Add `review_confidence` and `narrative_coverage` to output schema (model reports, server caps)

**Server-side post-processing changes:**

- After LLM response, assign `finding_track` deterministically:
  - `tone, bias, policy_language, unsupported_conclusion → "primary"`
  - `consistency → "secondary"`
  - `completeness → "secondary" only if it is true narrative completeness, not structured/form completeness`
- Deterministic confidence/coverage caps:
  - `narrative_coverage` cap: `insufficient` if docText < 200 chars or reviewWorthyCount === 0; `partial` if docText < 1000 or reviewWorthyCount < 3; else `sufficient`
  - `review_confidence` cap: `low` if coverage is insufficient; `medium` if no reconciliation and reviewWorthyCount < 5; else `high`
  - Server applies: `final = min(llmValue, deterministicCap)` using ordering insufficient < partial < sufficient and low < medium < high
- Stronger comparison noise suppression: suppress `consistency` issues with excerpt < 20 chars
- If there are zero primary findings, overall_risk must not be driven to high by secondary findings alone unless there is an explicit severe narrative contradiction
- Add `unsupported_conclusion` to `VALID_ISSUE_TYPES`
- Accept optional `language_trigger_metadata` in request body; append one-line scrutiny note to user message if present
- Update `validateReviewReport` to accept new summary fields

**Input body change:**

- Accept optional `language_trigger_metadata: Record<string, number>` (category counts only)

### 6. `src/pages/Reviewer.tsx`

**Trigger pre-scan** (in `handleRun`):

- Import `scanForLanguageTriggers`, `detectAttributionContext` from rubric
- Run triggers on reviewer-eligible narrative text only, and exclude clearly quoted/attributed spans from trigger counting when possible, NOT full `extractedFullText`
- Build `language_trigger_metadata` as `{ [category]: hitCount }` — pass in payload
- Also compute `attributionContext` metadata (quotedRegionCount, attributionMarkerCount) — pass in payload

**Finding track separation in results UI:**

- Split `output.issues` into `primaryFindings` (finding_track === "primary") and `secondaryFindings` (finding_track === "secondary")
- Primary findings: render as current prominent treatment
- Secondary findings: render in a `Collapsible` section, **collapsed by default**, titled "Comparison-based observations" with subtitle "Lower-priority notes-to-form observations"
- If zero primary findings, show clean-result prominently; secondary section still available but subordinate

**Confidence-aware clean result:**

- Replace the current "No issues found / Documentation looks good" with:
  - `sufficient` + `high`: "No language issues detected in reviewed narrative."
  - `partial` or `medium`: "No high-confidence language issues detected. Limited review coverage."
  - `insufficient`: "Limited authored narrative found — review coverage is insufficient for a confident assessment."

**Dev diagnostics additions:**

- `triggerCounts`, `attributionMarkerCount`, `reviewConfidence`, `narrativeCoverage`, `primaryFindingCount`, `secondaryFindingCount`

### 7. `src/lib/tools/reviewer-eligibility.ts`

Review for any assumptions that ReviewIssueType is exhaustive and update those references for unsupported_conclusion

---

## What Will NOT Change

- Encrypted vault model, reauth flow, auto-relock
- Parser artifact infrastructure
- Reconciliation engine internals
- Field recovery logic
- ReconciliationPanel component
- Security model (in-memory only, no persistence)
- No database changes

## What Reviewer Will Now Catch That It Missed Before

- Unsupported conclusions (first-class type)
- Better sensitivity to quoted-vs-authored distinction
- Stronger threshold prevents weak speculative findings

## What Reviewer Will Intentionally Suppress

- Consistency findings with excerpts < 20 chars (server-side)
- Secondary findings no longer visually compete with primary

## Remaining Limitations

- Authored-vs-quoted distinction ultimately relies on LLM judgment; deterministic heuristic is assistive only
- Confidence caps use text-length heuristics, not semantic analysis
- Eval fixtures test triggers locally but cannot round-trip through the edge function automatically
- Sentence splitting is naive (period-based)
- All trigger patterns are English-only