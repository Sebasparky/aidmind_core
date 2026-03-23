# Reviewer Post-Run Results: Findings-First Redesign

## Summary

Restructure the `ResultsMode` component so the Findings tab is a complete decision screen showing configuration, vault status, verdict, primary findings, and a comparison CTA — all in one scroll. Use plain-English everywhere possible. In the Findings tab CTA, prefer “notes-to-template observations” over “comparison observations.” In Comparison Details cards, use a stacked layout with clearly labeled “Case notes” and “Final template” sections, not compressed inline text.

## Changes to `src/pages/Reviewer.tsx`

### 1. ResultsMode receives additional props

Pass `schemaFields`, `parserArtifact`, `artifactStatus`, `reviewTier`, `toolState`, `onUnlockClick`, `onRelockClick` into `ResultsMode` so it can render ReviewConfigCard and VaultSection.

### 2. Findings tab content order (top to bottom)

Replace the current Findings tab content with this order inside the ScrollArea:

1. **ReviewConfigCard** — same component already exists, rendered with `toolState="success"`
2. **VaultSection** — same component, shows lock/unlock/timer/relock
3. **Verdict card** — existing verdict, but adjusted:
  - If `primaryCount > 0`, the verdict headline is dominant ("2 language concerns found")
  - Coverage/confidence become small metadata badges *below* the headline, not the headline itself
  - Even if coverage is `insufficient`, if `primaryCount > 0`, show "X language concerns found" as the headline, with a subtitle noting limited coverage
  - Only use "Limited review coverage" as the *headline* when `primaryCount === 0` AND coverage is insufficient
4. **Primary Language Findings** — existing grouped cards, unchanged behavior (expanded by default)
5. **Comparison observations CTA** — new bordered card:
  - Only shown if `hasComparison` is true
  - Title: "More comparison observations"
  - Subtitle: "See notes-to-form comparison details in the Comparison Details tab"
  - Small count badge showing secondary issue count + reconciliation field count
  - This replaces the current inline secondary findings collapsible on the Findings tab
6. **Secondary comparison observations** — REMOVE from Findings tab entirely. Move them to Comparison Details tab only. The Findings tab should only show primary language findings.
7. **What to do next** — existing section, keep as-is
8. **Disclaimer** — existing, keep

### 3. Verdict card logic fix

The key logic change:

```
// Headline priority:
if (primaryCount > 0) → "X language concern(s) found"
else if (isInsufficient) → "Limited review coverage"
else if (isLimited) → "No high-confidence language concerns detected"
else → "No language concerns detected"

// Sub-line when primaryCount > 0 AND isLimited/isInsufficient:
"Review coverage was limited. These findings were detected in the analyzed sections."
```

### 4. Comparison Details tab: plain-English labels

Rewrite `ReconciliationPanel` resolution labels. Instead of modifying the shared component, override the labels in the Comparison Details tab by wrapping the panel with context or by creating a new `ComparisonDetailsTab` sub-component that renders reconciliation data with friendlier labels.

Since `ReconciliationPanel` uses `RESOLUTION_CONFIG` internally, the cleanest approach is to update `src/components/session/ReconciliationPanel.tsx` directly:


| Current label          | New label                                       |
| ---------------------- | ----------------------------------------------- |
| Possible Discrepancies | Final Template Differs From Case Notes          |
| Likely Omissions       | Present In Case Notes But Missing From Template |
| Needs Review           | Could Not Be Determined Automatically           |
| Likely Corrections     | Final Template Likely Intentionally Changed     |
| Matches                | Final Template Matches Case Notes               |


Also add a one-line `description` to each resolution config and render it below the group header as muted helper text.

Update the individual field cards in ReconciliationPanel to have more padding (`p-4` instead of current), bolder title, and stacked layout for notes/template values.

### 5. Remove secondary findings from Findings tab

The secondary `Collapsible` section (lines ~841-881) is removed from the Findings tab. Secondary issues are only visible on the Comparison Details tab. The Comparison Details tab will now also render secondary `ReviewIssue` items (consistency/completeness) above the ReconciliationPanel, with the same plain-English treatment.

### Files changed

- `src/pages/Reviewer.tsx` — ResultsMode restructure, prop additions, verdict logic, comparison CTA, remove secondary from Findings
- `src/components/session/ReconciliationPanel.tsx` — Plain-English labels, descriptions, card padding

### What stays the same

- All backend logic, edge function, security model
- IssueCard component design
- Source Document and Extracted Text tabs
- Pre-run workspace layout
- VaultSection and ReviewConfigCard components (reused, not modified)
- Dev diagnostics panel