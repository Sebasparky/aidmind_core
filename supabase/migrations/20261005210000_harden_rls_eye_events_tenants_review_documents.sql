-- ============================================================
-- Corrective RLS hardening (additive; historical migrations untouched)
--
-- 1. eye_events / transcription_jobs: the original bootstrap migration
--    (20251227062939) created `"Allow all operations on …"` policies with
--    no TO clause (role = PUBLIC, command = ALL, USING (true)). The later
--    hardening in 20260210184141 only dropped policies whose role array
--    contains `authenticated` AND whose command is INSERT/UPDATE/DELETE,
--    so these PUBLIC/ALL policies survived. Drop them explicitly.
--
--    Effect: browser clients can no longer INSERT/UPDATE/DELETE eye_events.
--    Server-side writers use the service role (bypasses RLS). The
--    supervisor/auditor SELECT policy from 20260210184141 is unchanged.
--    Client-side audit emits are intentionally NOT restored here.
--
-- 2. tenants: RLS has been enabled since 20260302_000 but no SELECT policy
--    was ever created, so `tenant_users → tenants` embeds resolve to null
--    for signed-in users (see src/hooks/useTenant.ts). Add a membership-
--    scoped SELECT policy. No write policies are added.
--
-- 3. review_documents, compiled_policy_packs, compiled_policy_pack_chunks,
--    retrieval_runs: created without RLS. They are only accessed with the
--    service role from edge functions (no client reads in src/), so enabling
--    RLS with no anon/authenticated policies closes PostgREST access without
--    changing application behaviour.
-- ============================================================

-- 1. Drop surviving permissive PUBLIC policies
DROP POLICY IF EXISTS "Allow all operations on eye_events" ON public.eye_events;
DROP POLICY IF EXISTS "Allow all operations on transcription_jobs" ON public.transcription_jobs;

-- 2. tenants: members may read their own tenant row(s)
DROP POLICY IF EXISTS "Tenant members can read own tenant" ON public.tenants;
CREATE POLICY "Tenant members can read own tenant"
  ON public.tenants
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tenant_users tu
      WHERE tu.tenant_id = tenants.id
        AND tu.user_id = auth.uid()
    )
  );

-- 3. Enable RLS on service-role-only tables (no policies => no anon/authenticated access)
ALTER TABLE IF EXISTS public.review_documents            ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.compiled_policy_packs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.compiled_policy_pack_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.retrieval_runs              ENABLE ROW LEVEL SECURITY;

-- 4. SECURITY DEFINER RPCs that must only be callable by server-side code.
--    20260305232348 revoked PUBLIC on claim_next_kb_job, but 20260306010435
--    DROPped and recreated it (and added enqueue_kb_continuation_job /
--    append_kb_document_content) without restoring the revocation, and
--    update_session_guidance_phase1 (20260304222237) and kb_has_queued_jobs
--    (20260306200514) never had one. Supabase's default privileges let anon
--    and authenticated EXECUTE functions in public, so any client could
--    overwrite guidance on any session, claim/enqueue jobs for any tenant, or
--    append text to any tenant's kb_documents.content.
--    All callers use the service role (generate-guidance-phase1 edge function,
--    workers/kb_extractor/main.py); nothing in src/ calls these.
REVOKE ALL ON FUNCTION public.update_session_guidance_phase1(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_session_guidance_phase1(uuid, jsonb) TO service_role;
ALTER FUNCTION public.update_session_guidance_phase1(uuid, jsonb) SET search_path = public;

REVOKE ALL ON FUNCTION public.claim_next_kb_job(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_kb_job(text) TO service_role;

REVOKE ALL ON FUNCTION public.enqueue_kb_continuation_job(uuid, uuid, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_kb_continuation_job(uuid, uuid, integer, integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.append_kb_document_content(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_kb_document_content(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.kb_has_queued_jobs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kb_has_queued_jobs() TO service_role;
