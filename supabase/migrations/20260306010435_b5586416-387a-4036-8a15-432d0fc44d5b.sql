
-- Drop old claim function (return type changed)
DROP FUNCTION IF EXISTS public.claim_next_kb_job(text);

-- Recreate with new return fields
CREATE OR REPLACE FUNCTION public.claim_next_kb_job(p_worker_id text)
  RETURNS TABLE(
    id bigint,
    tenant_id uuid,
    kb_document_id uuid,
    priority integer,
    attempts integer,
    max_attempts integer,
    start_page integer,
    end_page integer,
    job_type text,
    dedupe_key text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  v_job record;
BEGIN
  SELECT j.id, j.tenant_id, j.kb_document_id, j.priority, j.attempts,
         j.max_attempts, j.start_page, j.end_page, j.job_type, j.dedupe_key
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
  start_page := v_job.start_page;
  end_page := v_job.end_page;
  job_type := v_job.job_type;
  dedupe_key := v_job.dedupe_key;
  RETURN NEXT;
END;
$$;

-- Idempotent continuation job enqueue
CREATE OR REPLACE FUNCTION public.enqueue_kb_continuation_job(
  p_kb_document_id uuid,
  p_tenant_id uuid,
  p_start_page integer,
  p_end_page integer,
  p_priority integer DEFAULT 50
)
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  v_dedupe text;
  v_id bigint;
BEGIN
  v_dedupe := p_kb_document_id::text || ':' || p_start_page::text || ':' || p_end_page::text;

  INSERT INTO public.kb_ingestion_jobs (
    kb_document_id, tenant_id, status, priority, start_page, end_page,
    job_type, dedupe_key
  )
  VALUES (
    p_kb_document_id, p_tenant_id, 'queued', p_priority, p_start_page,
    p_end_page, 'extract', v_dedupe
  )
  ON CONFLICT ((dedupe_key)) WHERE dedupe_key IS NOT NULL
  DO NOTHING;

  SELECT j.id INTO v_id
  FROM public.kb_ingestion_jobs j
  WHERE j.dedupe_key = v_dedupe
  LIMIT 1;

  RETURN v_id;
END;
$$;

-- Server-side content append
CREATE OR REPLACE FUNCTION public.append_kb_document_content(
  p_doc_id uuid,
  p_chunk text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.kb_documents
  SET content = COALESCE(content, '') || p_chunk,
      updated_at = now()
  WHERE id = p_doc_id;
END;
$$;
