-- ============================================================
-- public.sessions: replace the bootstrap PUBLIC policy with owner-scoped RLS
-- (additive; historical migrations untouched; NOT YET EXECUTED anywhere)
--
-- Evidence (dev-artifacts/recruiter-release/session-authorization-matrix.md):
--   * 20251227062939 created "Allow all operations on sessions"
--     FOR ALL USING (true) WITH CHECK (true) with no TO clause (role PUBLIC).
--     No later migration dropped it. Anon and every authenticated user could
--     read, insert, update and delete every tenant's sessions.
--   * Every client path reads or writes only the caller's own sessions
--     (dashboard list, guidance, case notes, reviewer); the only client INSERT
--     (StartNoteModal) always sets tenant_id = active tenant and
--     user_id = auth.uid(); no client code deletes sessions; supervisor and
--     auditor pages read eye_events, not sessions.
--   * All edge functions use the service role (bypasses RLS) and are
--     unaffected by this change.
--
-- Known data caveat (verify before applying to a database with history):
--   tenant_id and user_id were added nullable in 20260303104000 with no
--   backfill. Rows with NULL user_id become invisible to clients under these
--   policies. Pre-flight (read-only):
--     SELECT count(*) total,
--            count(*) FILTER (WHERE tenant_id IS NULL) null_tenant,
--            count(*) FILTER (WHERE user_id   IS NULL) null_user
--     FROM public.sessions;
--   A fresh local stack has no such rows.
-- ============================================================

-- 1. Drop the surviving bootstrap policy
DROP POLICY IF EXISTS "Allow all operations on sessions" ON public.sessions;

-- 2. Indexes for the policy predicates and the dashboard ordering
CREATE INDEX IF NOT EXISTS idx_sessions_user_id   ON public.sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_tenant_id ON public.sessions (tenant_id);

-- 3. SELECT: active owner only
DROP POLICY IF EXISTS "Active owners can read own sessions" ON public.sessions;
CREATE POLICY "Active owners can read own sessions"
  ON public.sessions
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid() AND p.status = 'active'
    )
  );

-- 4. INSERT: active member of the target tenant, row owned by the caller
DROP POLICY IF EXISTS "Active tenant members can create own sessions" ON public.sessions;
CREATE POLICY "Active tenant members can create own sessions"
  ON public.sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND tenant_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid() AND p.status = 'active'
    )
    AND EXISTS (
      SELECT 1 FROM public.tenant_users tu
      WHERE tu.tenant_id = sessions.tenant_id
        AND tu.user_id = auth.uid()
    )
  );

-- 5. UPDATE: active owner; row must stay owned by the caller and inside a
--    tenant the caller belongs to (blocks re-homing a session).
DROP POLICY IF EXISTS "Active owners can update own sessions" ON public.sessions;
CREATE POLICY "Active owners can update own sessions"
  ON public.sessions
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid() AND p.status = 'active'
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tenant_users tu
      WHERE tu.tenant_id = sessions.tenant_id
        AND tu.user_id = auth.uid()
    )
  );

-- 6. DELETE: intentionally no policy for anon/authenticated. No client or
--    edge code deletes sessions; FK cascades remain reachable only via the
--    service role, which bypasses RLS (BYPASSRLS), so no service_role policy
--    is required and none with USING (true) is added here.

-- 7. get_policy_snippets_for_session is SECURITY INVOKER (honours these
--    policies) but was still executable by anon/authenticated; its only
--    caller is generate-guidance-phase1 with the service role.
REVOKE ALL ON FUNCTION public.get_policy_snippets_for_session(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_policy_snippets_for_session(uuid) TO service_role;
