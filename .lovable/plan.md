

## Root Cause

The dashboard completion state fails because **`eye_events` has only RESTRICTIVE RLS policies and zero PERMISSIVE policies**. In PostgreSQL RLS, with no permissive policy granting access, all operations are denied by default — even when restrictive policies evaluate to `true`.

This means:
- The `useEyeLogger` INSERT silently fails (error is caught and swallowed)
- The `useSessionToolUsage` SELECT returns zero rows every time
- The dashboard never sees any completion events, regardless of what the Guidance page writes

The entire `eye_events`-based approach for dashboard completion is fundamentally broken for regular caseworker users.

## Solution

**Stop inferring completion from analytics events. Read it directly from session data already being fetched.**

The backend `update_session_guidance_phase1` DB function already writes `metadata.guidance_phase1` (with questions array) into the `sessions` table when guidance succeeds. The `useRecentNotes` hook already fetches `sessions.*` including `metadata`. We just need to surface that data to the dashboard cards.

### Changes

**1. `src/hooks/useRecentNotes.ts`**
- Add `guidanceCompleted` and `reviewerCompleted` booleans to `RecentNote` interface
- In `sessionToNote`, derive `guidanceCompleted` from `metadata.guidance_phase1.questions` existing
- Derive `reviewerCompleted` from `review_document_id` being non-null

**2. `src/components/dashboard/ActiveSessionsPanel.tsx`**
- Remove the `useSessionToolUsage` import and hook call
- Read `guidanceCompleted` / `reviewerCompleted` directly from each session's note data
- Keep the existing green "View Guidance" / "View Review" button styling (already looks good)

**3. `src/pages/Guidance.tsx`**
- Remove the `handleDone` eye event logging (it was silently failing anyway)
- Simplify `handleDone` to just navigate back to dashboard
- The completion signal is already persisted by the backend edge function — no client-side write needed

This eliminates the fragile event inference entirely. Completion state is durable, survives refresh, and updates via the existing realtime subscription on the `sessions` table.

### What stays the same
- All existing UI improvements (toast position, template dedup, scroll behavior, grounding badges)
- The green emerald "View Guidance" / "View Review" button styling
- The "Done" button on the Guidance page
- Eye event logging in `useGuidanceSession` for audit purposes (that uses service_role via edge functions, which works fine)

