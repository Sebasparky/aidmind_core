
-- Template-level parser artifacts (generated once per template, reused across sessions)
CREATE TABLE public.template_parser_artifacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id UUID NOT NULL REFERENCES public.kb_templates(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  source_template_hash TEXT,
  artifact_version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'draft',
  artifact_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  generation_notes TEXT,
  generated_at TIMESTAMP WITH TIME ZONE,
  model TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.template_parser_artifacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages parser artifacts"
  ON public.template_parser_artifacts FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Users can read own tenant parser artifacts"
  ON public.template_parser_artifacts FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tenant_users tu
    WHERE tu.tenant_id = template_parser_artifacts.tenant_id AND tu.user_id = auth.uid()
  ));

-- Index for fast lookup by template
CREATE INDEX idx_template_parser_artifacts_template_active 
  ON public.template_parser_artifacts (template_id, is_active) WHERE is_active = true;
