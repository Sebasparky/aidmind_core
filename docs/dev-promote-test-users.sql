-- =============================================================
-- DEV / MVP TESTING ONLY — Do NOT run in production
-- =============================================================
-- Promotes test users by email lookup. Safe to re-run (idempotent).
-- Does NOT create users — only updates existing rows.
-- =============================================================

-- 1. Activate the three test users (skip pending.test)
UPDATE public.profiles
SET status = 'active', updated_at = now()
WHERE user_id IN (
  SELECT id FROM auth.users
  WHERE email IN (
    'caseworker.test@aidmind.dev',
    'supervisor.test@aidmind.dev',
    'auditor.test@aidmind.dev'
  )
)
AND status <> 'active';

-- 2. Assign correct roles (upsert-safe via ON CONFLICT)
-- Caseworker (already default, but explicit for clarity)
UPDATE public.user_roles
SET role = 'caseworker'
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'caseworker.test@aidmind.dev')
  AND role <> 'caseworker';

UPDATE public.user_roles
SET role = 'supervisor'
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'supervisor.test@aidmind.dev')
  AND role <> 'supervisor';

UPDATE public.user_roles
SET role = 'auditor'
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'auditor.test@aidmind.dev')
  AND role <> 'auditor';

-- 3. Verify results
SELECT
  u.email,
  p.status,
  ur.role
FROM auth.users u
JOIN public.profiles p ON p.user_id = u.id
LEFT JOIN public.user_roles ur ON ur.user_id = u.id
WHERE u.email LIKE '%.test@aidmind.dev'
ORDER BY u.email;
