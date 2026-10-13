-- Corrective migration: complete_kb_job was missed by 20261005210000.
--
-- 20260305232348 created public.complete_kb_job (SECURITY DEFINER, no tenant
-- check) and revoked EXECUTE only FROM PUBLIC. Supabase's default privileges
-- grant EXECUTE on public functions to anon and authenticated directly, so any
-- client could set status/error on any tenant's kb_ingestion_jobs row by id.
-- 20261005210000 closed the same gap for the sibling KB job functions
-- (claim_next_kb_job, enqueue_kb_continuation_job, ...) but not this one.
--
-- The only caller is workers/kb_extractor/main.py, which uses the service
-- role; nothing in src/ calls it.
REVOKE ALL ON FUNCTION public.complete_kb_job(bigint, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_kb_job(bigint, text, text) TO service_role;
