
-- claim_next_kb_job: atomically claim one queued job using FOR UPDATE SKIP LOCKED
CREATE OR REPLACE FUNCTION public.claim_next_kb_job(p_worker_id text)
RETURNS TABLE(
  id bigint,
  tenant_id uuid,
  kb_document_id uuid,
  priority integer,
  attempts integer,
  max_attempts integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_job record;
BEGIN
  SELECT j.id, j.tenant_id, j.kb_document_id, j.priority, j.attempts, j.max_attempts
  INTO v_job
  FROM public.kb_ingestion_jobs j
  WHERE j.status = 'queued'
  ORDER BY j.priority ASC, j.created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.kb_ingestion_jobs
  SET status = 'running',
      locked_at = now(),
      locked_by = p_worker_id,
      started_at = now(),
      attempts = kb_ingestion_jobs.attempts + 1
  WHERE kb_ingestion_jobs.id = v_job.id;

  id := v_job.id;
  tenant_id := v_job.tenant_id;
  kb_document_id := v_job.kb_document_id;
  priority := v_job.priority;
  attempts := v_job.attempts + 1;
  max_attempts := v_job.max_attempts;
  RETURN NEXT;
END;
$$;

-- Revoke public, grant to authenticated + service_role
REVOKE ALL ON FUNCTION public.claim_next_kb_job(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_next_kb_job(text) TO service_role;

-- complete_kb_job: finalize a job with status and optional error
CREATE OR REPLACE FUNCTION public.complete_kb_job(p_job_id bigint, p_status text, p_error text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.kb_ingestion_jobs
  SET status = p_status,
      finished_at = now(),
      error = p_error
  WHERE id = p_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_kb_job(bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_kb_job(bigint, text, text) TO service_role;
