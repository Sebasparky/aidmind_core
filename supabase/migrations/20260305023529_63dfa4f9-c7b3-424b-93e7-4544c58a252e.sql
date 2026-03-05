
-- Add created_by and storage_path to kb_templates
ALTER TABLE public.kb_templates
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS storage_path text;

-- Add index on sessions(template_id) for fast lookup
CREATE INDEX IF NOT EXISTS idx_sessions_template_id ON public.sessions(template_id);

-- Add index on kb_templates(tenant_id, created_at desc) for listing
CREATE INDEX IF NOT EXISTS idx_kb_templates_tenant_created ON public.kb_templates(tenant_id, created_at DESC);

-- Create templates storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('templates', 'templates', false)
ON CONFLICT (id) DO NOTHING;

-- RLS: authenticated users can upload to templates bucket
CREATE POLICY "Authenticated users can upload templates"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'templates');

-- RLS: authenticated users can read their tenant's templates
CREATE POLICY "Authenticated users can read templates"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'templates');
