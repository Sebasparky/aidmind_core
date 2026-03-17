
-- Create reusable Phase 2 extraction schema table
CREATE TABLE public.template_phase2_schemas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id UUID NOT NULL REFERENCES public.kb_templates(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  schema_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
  is_active BOOLEAN NOT NULL DEFAULT false,
  schema_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  model TEXT,
  source_template_hash TEXT,
  generation_notes TEXT,
  generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique constraint: only one active schema per template
CREATE UNIQUE INDEX idx_template_phase2_schemas_active 
  ON public.template_phase2_schemas (template_id) 
  WHERE is_active = true;

-- Index for lookup by template
CREATE INDEX idx_template_phase2_schemas_template 
  ON public.template_phase2_schemas (template_id, is_active);

-- Enable RLS
ALTER TABLE public.template_phase2_schemas ENABLE ROW LEVEL SECURITY;

-- Tenant-scoped read for authenticated users
CREATE POLICY "Users can read own tenant schemas"
  ON public.template_phase2_schemas
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM tenant_users tu
    WHERE tu.tenant_id = template_phase2_schemas.tenant_id
      AND tu.user_id = auth.uid()
  ));

-- Service role full access
CREATE POLICY "Service role manages schemas"
  ON public.template_phase2_schemas
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Add phase2_schema_id to sessions
ALTER TABLE public.sessions 
  ADD COLUMN phase2_schema_id UUID REFERENCES public.template_phase2_schemas(id);

-- Trigger for updated_at
CREATE TRIGGER update_template_phase2_schemas_updated_at
  BEFORE UPDATE ON public.template_phase2_schemas
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
