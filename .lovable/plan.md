

## Update: Remove "Timeline event confirmed" from Test File

The production code (`WorkRadarPanel.tsx`) already implements the correct behavior from the last edit:
- All three obligations have proper `dueContext` values ("Overdue by 2 days", "Due in 24 hours", "Due in 48 hours")
- The "Timeline event confirmed" label was already replaced with "Follow-up session #4823"
- The due/SLA chip renders correctly with overdue (destructive/red) and upcoming (warning) styling

The only remaining occurrence of "Timeline event confirmed" is in the test file `src/pages/__tests__/Dashboard.v1.test.tsx` (line 76), which still asserts that text exists on screen.

### Change

**File: `src/pages/__tests__/Dashboard.v1.test.tsx`** (line 76)
- Replace `expect(screen.getByText("Timeline event confirmed")).toBeInTheDocument();` with `expect(screen.getByText("Follow-up session #4823")).toBeInTheDocument();`

This is a one-line fix to align the test with the updated demo data.

