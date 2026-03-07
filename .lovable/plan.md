

## Add Tour Steps for Tool Completion, Session History Statuses, and Search Bar

### Changes

**1. `src/components/tour/tour-steps.ts`** — Add/update 3 steps in `caseworkerTour`:

- **Update "Close a session" step** (step index 3): Revise description to explain that once both tools (Guidance + Reviewer) are used, the session status changes to "Done" (shown as tool progress 2/2), and that closing gives two outcomes: "Completed" (both tools used) or "Closed early" (not all tools used).

- **Update "Session History" step** (step index 5): Revise description to mention that sessions appear here as either "Completed" or "Closed early" depending on tool usage at time of closing.

- **Add new "Search" step**: Insert a step (after "Start a new session", as step index 1) anchored to a `dashboard-search` data-tour attribute. Title: "Search across dashboard". Description explains it filters all three columns in real-time by keyword.

**2. `src/components/layout/Header.tsx`** — Add `data-tour="dashboard-search"` to the search input container so the tour can anchor to it.

### Updated step order

1. Start a new session (`create-session`)
2. Search across dashboard (`dashboard-search`) — **NEW**
3. Generate Guidance (`guidance-button`)
4. Run Reviewer (`reviewer-button`)
5. Close a session (`close-session`) — **UPDATED text**
6. Derived Signals (`derived-signals`)
7. Session History (`session-history`) — **UPDATED text**

