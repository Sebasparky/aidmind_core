
-- Create kb_ingestion_jobs table
CREATE TABLE public.kb_ingestion_jobs (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL,
  kb_document_id uuid NOT NULL REFERENCES public.kb_documents(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued',
  priority int NOT NULL DEFAULT 50,
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  locked_at timestamptz,
  locked_by text,
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for worker pickup and document lookup
CREATE INDEX idx_kb_ingestion_jobs_pickup ON public.kb_ingestion_jobs (status, priority, created_at);
CREATE INDEX idx_kb_ingestion_jobs_document ON public.kb_ingestion_jobs (kb_document_id);

-- Auto-update updated_at trigger (reuse pattern from project)
CREATE OR REPLACE FUNCTION public.update_kb_ingestion_jobs_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_kb_ingestion_jobs_updated_at
  BEFORE UPDATE ON public.kb_ingestion_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_kb_ingestion_jobs_updated_at();

-- Enable RLS
ALTER TABLE public.kb_ingestion_jobs ENABLE ROW LEVEL SECURITY;

-- RLS policies: tenant-scoped via tenant_users membership
CREATE POLICY "Users can insert jobs for own tenant"
  ON public.kb_ingestion_jobs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tenant_users tu
      WHERE tu.user_id = auth.uid() AND tu.tenant_id = kb_ingestion_jobs.tenant_id
    )
  );

CREATE POLICY "Users can select jobs for own tenant"
  ON public.kb_ingestion_jobs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_users tu
      WHERE tu.user_id = auth.uid() AND tu.tenant_id = kb_ingestion_jobs.tenant_id
    )
  );

CREATE POLICY "Users can update jobs for own tenant"
  ON public.kb_ingestion_jobs
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_users tu
      WHERE tu.user_id = auth.uid() AND tu.tenant_id = kb_ingestion_jobs.tenant_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tenant_users tu
      WHERE tu.user_id = auth.uid() AND tu.tenant_id = kb_ingestion_jobs.tenant_id
    )
  );

-- Create kb-documents storage bucket if not exists
INSERT INTO storage.buckets (id, name, public)
VALUES ('kb-documents', 'kb-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: authenticated users can upload to their tenant path
CREATE POLICY "Tenant users can upload kb docs"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'kb-documents'
    AND (storage.foldername(name))[1] = 'tenants'
    AND EXISTS (
      SELECT 1 FROM public.tenant_users tu
      WHERE tu.user_id = auth.uid() AND tu.tenant_id = ((storage.foldername(name))[2])::uuid
    )
  );

CREATE POLICY "Tenant users can read kb docs"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'kb-documents'
    AND (storage.foldername(name))[1] = 'tenants'
    AND EXISTS (
      SELECT 1 FROM public.tenant_users tu
      WHERE tu.user_id = auth.uid() AND tu.tenant_id = ((storage.foldername(name))[2])::uuid
    )
  );
