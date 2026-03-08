-- Allow tenant members to read their own templates
CREATE POLICY "kb_templates_select_tenant"
  ON public.kb_templates
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_users tu
      WHERE tu.tenant_id = kb_templates.tenant_id
        AND tu.user_id = auth.uid()
    )
  );