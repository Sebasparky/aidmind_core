# Reviewer Post-Run UX Fixes

## 6 Changes

### 1. Remove duplicate Comparison Details tab

Lines 1020-1054 in `Reviewer.tsx` are a second `TabsContent value="comparison"` block — an exact duplicate of lines 940-1017. Delete lines 1020-1054.

### 2. Redesign comparison FieldRow cards (ReconciliationPanel.tsx)

Currently the `FieldRow` title is the field name (e.g. "Behavioral Concerns Child Issues"). Flip the hierarchy:

- **card title:** a human-readable issue sentence tied to the item
Example: “Child issues differ between case notes and final template”
- **subtitle:** section + field
Example: “Behavioral Concerns and Family Issues · Child Issues”
- **badge:** “Differs” / “Missing” / “Could not verify”
- Increase card padding
- Make the stacked "Case notes said:" / "Final template says:" labels more prominent with clear visual separation

### 3. Strengthen the comparison CTA on Findings tab

Replace the current subtle card (lines 881-905) with a more prominent design:

- Tinted background (`bg-primary/5` or `bg-muted`)
- Stronger border
- Larger text and clear "Open Comparison Details →" button
- Count badge more prominent
- Full-width click target preserved

### 4. Persist reviewer completion on Done

In handleBack:

```
•	Before navigating, update session metadata with:

•	reviewer_completed_at: new Date().toISOString()

•	session_completed_at: new Date().toISOString() when Reviewer is the final completed step

•	This should follow the same metadata update pattern already used by Guidance / Case Notes.
```

In useRecentNotes.ts:

```
•	Change reviewerCompleted from:

•	!![session.review](http://session.review)_document_id

•	To:

•	!!meta?.reviewer_completed_at || !![session.review](http://session.review)_document_id

•	Also add:

•	sessionCompleted = !!meta?.session_completed_at

•	Keep this backward-compatible with any older sessions.
```

Dashboard session card UI changes:

```
•	Do not stop at just marking Reviewer complete.

•	When sessionCompleted === true, update the session card into a more obvious final-complete state:

•	Make the card slightly taller than the in-progress version

•	Keep all prior completed steps visible

•	Show a full-width green completion bar/button at the bottom of the card

•	Label it something like:

•	Session complete

•	or Completed — move to history

•	This final state should visually communicate:

•	all required steps are done

•	the user can still review prior steps from the card

•	pressing the final completion action moves the session to history

•	Since Reviewer data is ephemeral, the card should still allow returning to Guidance, but not imply that full Reviewer results remain stored.
```

Important behavior note:

```
•	Reviewer completion should persist as workflow progress

•	Reviewer findings themselves should still remain ephemeral and cleared on exit / relock / unmount

•	The dashboard should reflect completion state without implying long-term storage of sensitive reviewer output5. Preserve tab state across switches (prevent remount)
```

**5. Preserve tab state across switches (prevent remount)**  
  
The current `<TabsContent>` uses Radix default behavior which unmounts inactive tabs. Fix by:

- Adding `forceMount` to all `TabsContent` components
- Using `hidden` class to hide inactive tabs instead of unmounting
- This preserves scroll position, iframe state, highlights, and vault timer across tab switches
- Ephemeral data still clears on Done/unmount/relock as before

### 6. Comparison CTA wording

Use "See differences between case notes and final template" as title with subtitle "Inspect notes-to-template differences, omissions, and unresolved items"

## Files Changed

- `src/pages/Reviewer.tsx` — remove duplicate tab, strengthen CTA, add `forceMount` to tabs, persist completion in `handleBack`
- `src/components/session/ReconciliationPanel.tsx` — flip FieldRow title to resolution label, field name as subtitle
- `src/hooks/useRecentNotes.ts` — add `reviewer_completed_at` metadata check

## What stays the same

- All backend logic, edge functions, security model
- No new database columns (uses existing metadata JSON)
- Vault relock/unmount/timeout behavior
- Pre-run workspace layout
- IssueCard component
- Dev diagnostics panel