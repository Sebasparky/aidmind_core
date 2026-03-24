

# Root Cause Analysis: Reviewer Findings Lost on Tab Switch

## The Bug

The root cause is **not** in the Reviewer component or its internal tab logic. The internal tabs use `forceMount` and local state correctly — they cannot lose `output`.

## Root Cause: AuthContext loading flicker unmounts the entire page

**File**: `src/contexts/AuthContext.tsx`, lines 106-131

When Supabase fires `onAuthStateChange` (which happens on **token refresh**, **visibility change**, or **any auth event**), the handler does this for the **same already-authenticated user**:

```
setLoading(true);                                    // ← line 129
setTimeout(() => fetchProfile().finally(() =>
  setLoading(false)                                   // ← line 131
), 0);
```

This causes the following cascade:
1. `AuthContext.loading` becomes `true`
2. `RouteGuard` renders `<AuthLoadingScreen />` instead of `<Reviewer />`
3. **Reviewer unmounts** — cleanup effect (line 1256) fires, setting `output = null`
4. Profile resolves → `loading = false` → RouteGuard re-renders `<Reviewer />`
5. Fresh Reviewer mount reads `reviewer_completed_at` from metadata → `reviewerPreviouslyCompleted = true`
6. User sees the "Review completed" summary instead of their findings

The existing `suppressNextAuthReload` mechanism only covers vault reauth (manually armed). It does **not** cover routine Supabase token refreshes, which happen automatically every ~55 minutes and on browser tab visibility changes.

## Why forceMount didn't fix it

`forceMount` keeps tab content alive across **internal** tab switches within ResultsMode. But the unmount happens at the **RouteGuard level** — the entire `<Reviewer />` component tree is replaced by `<AuthLoadingScreen />`. No amount of internal tab persistence can survive that.

## Why it correlates with tab switching

Supabase's GoTrue client can trigger token refresh on browser visibility change (`visibilitychange` event). When a user switches browser tabs or focuses another window and returns, this fires `onAuthStateChange` → `loading=true` → unmount.

## The Fix

**File**: `src/contexts/AuthContext.tsx`

In the `onAuthStateChange` handler, when the incoming `session.user.id` matches the already-known `currentUserIdRef.current`, **do not set `loading=true`**. The user is already authenticated, the profile is already resolved. Just update the user object silently. Optionally refresh the profile in the background without gating routing.

```typescript
// BEFORE (current):
if (session?.user) {
  if (suppressAuthReloadRef.current && ...) { ... return; }
  setUser(session.user);
  currentUserIdRef.current = session.user.id;
  setLoading(true);  // PROBLEM: gates routing, unmounts pages
  setTimeout(() => fetchProfile().finally(() => setLoading(false)), 0);
}

// AFTER (fix):
if (session?.user) {
  if (suppressAuthReloadRef.current && ...) { ... return; }

  const isSameUser = currentUserIdRef.current === session.user.id;
  setUser(session.user);
  currentUserIdRef.current = session.user.id;

  if (isSameUser) {
    // Token refresh or re-auth for same user — update silently
    // Background profile refresh without loading gate
    fetchProfile();
  } else {
    // New user sign-in — gate routing while profile resolves
    setLoading(true);
    setTimeout(() => fetchProfile().finally(() => setLoading(false)), 0);
  }
}
```

## Files Changed

1. **`src/contexts/AuthContext.tsx`** — Single change in `onAuthStateChange` handler to skip loading gate for same-user auth events

## Confirmation

- Internal Reviewer tab switching no longer causes findings loss (the unmount no longer happens)
- Completed summary still appears correctly on explicit re-entry (navigate away → come back)
- No reviewer findings are persisted beyond page lifecycle (cleanup effect still fires on real unmount)
- Security posture unchanged — vault relock, idle timeout, and unmount scrubbing all remain intact
- The `suppressNextAuthReload` mechanism remains as an additional safety layer for vault reauth

