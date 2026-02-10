# AidMind MVP — Auth + Role Routing Acceptance Test Plan

> **Purpose:** Prove that login, profile resolution, role routing, route guards, RLS enforcement, and onboarding all work correctly before merge.
>
> **How to use:** Work through each section. Mark ✅ or ❌ next to each check. If any ❌, capture the failure detail inline.

---

## Prerequisites

### Create test users in Supabase Auth

Create 4 users via the Supabase dashboard (**Authentication → Users → Add user**) or via `supabase.auth.admin.createUser()`:

| Email | Password | Intended Role | Intended Status |
|---|---|---|---|
| `caseworker.test@aidmind.dev` | `Test1234!` | caseworker | active |
| `supervisor.test@aidmind.dev` | `Test1234!` | supervisor | active |
| `auditor.test@aidmind.dev` | `Test1234!` | auditor | active |
| `pending.test@aidmind.dev` | `Test1234!` | caseworker (default) | pending |

After signup, the `handle_new_user` trigger auto-creates:
- A `profiles` row with `status = 'pending'`
- A `user_roles` row with `role = 'caseworker'`

### Verify provisioning

Run in **SQL Editor**:

```sql
SELECT p.user_id, p.display_name, p.status, ur.role
FROM public.profiles p
LEFT JOIN public.user_roles ur ON ur.user_id = p.user_id
ORDER BY p.created_at DESC;
```

- [ ] All 4 users appear with `pending` status and `caseworker` role

### Activate & assign roles

Replace UUIDs with actual values from the query above:

```sql
-- Activate 3 users
UPDATE public.profiles
SET status = 'active'
WHERE user_id IN (
  '<CASEWORKER_UUID>',
  '<SUPERVISOR_UUID>',
  '<AUDITOR_UUID>'
);

-- Keep pending user as-is (already pending)

-- Assign supervisor role
UPDATE public.user_roles SET role = 'supervisor' WHERE user_id = '<SUPERVISOR_UUID>';

-- Assign auditor role
UPDATE public.user_roles SET role = 'auditor' WHERE user_id = '<AUDITOR_UUID>';

-- Caseworker keeps default role (no change needed)
```

### Post-setup verification

```sql
SELECT p.user_id, p.display_name, p.status, ur.role
FROM public.profiles p
LEFT JOIN public.user_roles ur ON ur.user_id = p.user_id
ORDER BY p.created_at DESC;
```

- [ ] caseworker.test → status=active, role=caseworker
- [ ] supervisor.test → status=active, role=supervisor
- [ ] auditor.test → status=active, role=auditor
- [ ] pending.test → status=pending, role=caseworker
- [ ] Exactly 1 role row per user (no duplicates)

---

## STEP 1 — Login + Profile Resolution

| # | Test | Expected | Result |
|---|---|---|---|
| 1.1 | Navigate to `/login` (unauthenticated) | Login screen renders with email/password fields | ☐ |
| 1.2 | Submit invalid credentials | Error message shown, no redirect | ☐ |
| 1.3 | Login as `caseworker.test` | Redirects to `/dashboard` | ☐ |
| 1.4 | Logout, login as `supervisor.test` | Redirects to `/supervisor` | ☐ |
| 1.5 | Logout, login as `auditor.test` | Redirects to `/auditor` | ☐ |
| 1.6 | Logout, login as `pending.test` | Redirects to `/access-pending` | ☐ |
| 1.7 | User menu shows correct `display_name` | Matches profile display_name | ☐ |

---

## STEP 2 — Route Guards

### Caseworker (logged in as `caseworker.test`)

| # | Test | Expected | Result |
|---|---|---|---|
| 2.1 | Lands on `/dashboard` | ✅ Renders dashboard | ☐ |
| 2.2 | Navigate to `/supervisor` | Redirected to `/dashboard` | ☐ |
| 2.3 | Navigate to `/auditor` | Redirected to `/dashboard` | ☐ |
| 2.4 | Navigate to `/calendar` | ✅ Renders calendar | ☐ |

### Supervisor (logged in as `supervisor.test`)

| # | Test | Expected | Result |
|---|---|---|---|
| 2.5 | Lands on `/supervisor` | ✅ Renders supervisor view | ☐ |
| 2.6 | Navigate to `/dashboard` | Redirected to `/supervisor` | ☐ |
| 2.7 | Navigate to `/auditor` | Redirected to `/supervisor` | ☐ |

### Auditor (logged in as `auditor.test`)

| # | Test | Expected | Result |
|---|---|---|---|
| 2.8 | Lands on `/auditor` | ✅ Renders auditor view | ☐ |
| 2.9 | Navigate to `/dashboard` | Redirected to `/auditor` | ☐ |
| 2.10 | Navigate to `/supervisor` | Redirected to `/auditor` | ☐ |

### Pending user (logged in as `pending.test`)

| # | Test | Expected | Result |
|---|---|---|---|
| 2.11 | Lands on `/access-pending` | ✅ Shows pending message | ☐ |
| 2.12 | Navigate to `/dashboard` | Redirected to `/access-pending` | ☐ |
| 2.13 | Navigate to `/supervisor` | Redirected to `/access-pending` | ☐ |
| 2.14 | Navigate to `/auditor` | Redirected to `/access-pending` | ☐ |

---

## STEP 3 — Access Pending Screen

| # | Test | Expected | Result |
|---|---|---|---|
| 3.1 | Pending user sees correct message | "Your AidMind account is pending activation…" | ☐ |
| 3.2 | Log out button works | Returns to `/login` | ☐ |

---

## STEP 4 — RLS Enforcement (Critical)

> Use the **DEV-only QA panel** (bottom-right corner in dev mode) or browser console.

### Caseworker attempting to read `eye_events`

| # | Test | Expected | Result |
|---|---|---|---|
| 4.1 | Login as caseworker, open QA panel, click "Test eye_events" | `0 rows` or RLS error | ☐ |
| 4.2 | Alternatively in console: `await supabase.from('eye_events').select('*')` | Empty data or error | ☐ |

### Supervisor reading `eye_events`

| # | Test | Expected | Result |
|---|---|---|---|
| 4.3 | Login as supervisor, run same query | Query succeeds (may be 0 rows if no events yet) | ☐ |

### Inserting a test event (optional, for supervisor visibility)

```sql
-- Run with service_role in SQL Editor
INSERT INTO public.eye_events (event_type, session_id, event_data)
VALUES ('test.qa_verification', 'qa-test-session', '{"note": "QA test event"}');
```

| # | Test | Expected | Result |
|---|---|---|---|
| 4.4 | Supervisor sees the test event in query results | ≥1 row returned | ☐ |
| 4.5 | Caseworker still sees 0 rows | Confirmed blocked | ☐ |

---

## STEP 5 — Role-Missing User (Negative Test)

Create a 5th user OR delete the role for an existing test user:

```sql
-- Delete role row to simulate missing role
DELETE FROM public.user_roles WHERE user_id = '<TARGET_UUID>';
```

| # | Test | Expected | Result |
|---|---|---|---|
| 5.1 | Login as role-missing user | Redirected to `/access-pending` | ☐ |
| 5.2 | Access pending shows role-missing message | "Your account is not yet assigned to a role." | ☐ |
| 5.3 | Navigate to `/dashboard` | Redirected to `/access-pending` | ☐ |

**Restore after test:**
```sql
INSERT INTO public.user_roles (user_id, role)
VALUES ('<TARGET_UUID>', 'caseworker');
```

---

## STEP 6 — Onboarding

| # | Test | Expected | Result |
|---|---|---|---|
| 6.1 | First login → Welcome modal appears | Modal with AidMind principles | ☐ |
| 6.2 | Dismiss modal → does not reappear on next page load | localStorage flag set | ☐ |
| 6.3 | Contextual tooltips appear on landing page | 2–4 role-specific tips | ☐ |
| 6.4 | "Replay onboarding" in user menu → modal reappears | Welcome modal + tooltips reset | ☐ |

---

## STEP 7 — Dev Role Override

| # | Test | Expected | Result |
|---|---|---|---|
| 7.1 | DEV mode: toggle visible (bottom-left corner) | Shows role buttons | ☐ |
| 7.2 | Switch role via toggle → UI updates | Navigates to new role's home | ☐ |
| 7.3 | After toggle, check DB role hasn't changed | `SELECT role FROM user_roles WHERE user_id = '...'` unchanged | ☐ |
| 7.4 | Production build: toggle does NOT render | `import.meta.env.DEV` is false | ☐ |

---

## STEP 8 — Merge Readiness Checks

| # | Check | Expected | Result |
|---|---|---|---|
| 8.1 | `DevRoleToggle` gated by `import.meta.env.DEV` | ✅ Present in source | ☐ |
| 8.2 | `DevRlsCheck` gated by `import.meta.env.DEV` | ✅ Present in source | ☐ |
| 8.3 | No mock auth codepaths in prod routes | No `MOCK_USERS`, no hardcoded roles | ☐ |
| 8.4 | `UserSwitcher` returns `null` (no-op) | ✅ Confirmed | ☐ |
| 8.5 | No `localStorage` role/status used for auth decisions | Auth comes from Supabase only | ☐ |

---

## Summary

| Section | Pass/Fail | Notes |
|---|---|---|
| Login + Profile | ☐ | |
| Route Guards | ☐ | |
| Access Pending | ☐ | |
| RLS Enforcement | ☐ | |
| Role-Missing | ☐ | |
| Onboarding | ☐ | |
| Dev Role Override | ☐ | |
| Merge Readiness | ☐ | |

**Sign-off:** ___________________ Date: ___________
