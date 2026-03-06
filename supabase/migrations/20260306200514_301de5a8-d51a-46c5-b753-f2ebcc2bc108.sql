
CREATE OR REPLACE FUNCTION public.kb_has_queued_jobs()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.kb_ingestion_jobs WHERE status = 'queued'
  )
$$;
