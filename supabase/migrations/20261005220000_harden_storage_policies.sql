-- ============================================================
-- Storage hardening: canonical object keys + tenant membership
-- (additive; historical migrations untouched; not yet executed)
--
-- Findings addressed (see dev-artifacts/recruiter-release/storage-authorization.md):
--   A. audio-uploads: three policies with no TO clause (role PUBLIC) let anyone
--      upload/list/download/delete; the transcription feature is disabled (410).
--   B. kb-documents: policies checked only foldername[1..2] (prefix match),
--      allowed unbounded depth/filename, cast junk to uuid (raises), and
--      accepted non-canonical uuid forms.
--   C. templates: any authenticated user could read every tenant's templates
--      and upload any file to any key. Nothing in src/ reads this bucket and
--      select-template writes with the service role, so no client policy is
--      needed.
--   D. review-documents: used by code but never declared in a migration.
-- ============================================================

-- 0. Helpers ---------------------------------------------------

-- Strict lower-case hyphenated UUID; returns NULL (never raises) otherwise.
CREATE OR REPLACE FUNCTION public.storage_uuid_segment(seg text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public
AS $$
  SELECT CASE
    WHEN seg ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN seg::uuid
    ELSE NULL
  END
$$;

-- Whole-key sanity: printable ASCII allowlist, no backslash/percent,
-- no leading/trailing slash, no empty, "." or ".." segments.
CREATE OR REPLACE FUNCTION public.storage_key_is_clean(key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public
AS $$
  SELECT key ~ '^[A-Za-z0-9._/-]{1,512}$'
     AND key !~ '^/'
     AND key !~ '/$'
     AND key !~ '//'
     AND key !~ '(^|/)\.\.?(/|$)'
$$;

-- Membership check for the calling user only (auth.uid()); SECURITY DEFINER so
-- storage policies do not depend on tenant_users RLS. Cannot widen access:
-- it never takes a user id.
CREATE OR REPLACE FUNCTION public.is_tenant_member(p_tenant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_tenant IS NOT NULL
     AND auth.uid() IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.tenant_users tu
       WHERE tu.tenant_id = p_tenant
         AND tu.user_id = auth.uid()
     )
$$;

REVOKE ALL ON FUNCTION public.storage_uuid_segment(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.storage_key_is_clean(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_tenant_member(uuid)     FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storage_uuid_segment(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.storage_key_is_clean(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_tenant_member(uuid)     TO authenticated, service_role;

-- A. audio-uploads: remove anonymous access (feature disabled in v1) --------
DROP POLICY IF EXISTS "Allow upload to audio-uploads bucket" ON storage.objects;
DROP POLICY IF EXISTS "Allow read from audio-uploads bucket"   ON storage.objects;
DROP POLICY IF EXISTS "Allow delete from audio-uploads bucket" ON storage.objects;
-- The bucket itself is left in place; deleting objects/buckets is irreversible
-- and must be an explicit operator decision after confirming it is empty.

-- B. kb-documents: canonical tenants/<tenant>/kb_documents/<doc>/<file>.pdf --
UPDATE storage.buckets
   SET file_size_limit    = 157286400,                 -- 150 MB (worker MAX_PDF_BYTES)
       allowed_mime_types = ARRAY['application/pdf']
 WHERE id = 'kb-documents';

DROP POLICY IF EXISTS "Tenant users can upload kb docs" ON storage.objects;
DROP POLICY IF EXISTS "Tenant users can read kb docs"   ON storage.objects;

CREATE POLICY "kb_documents_insert_canonical_tenant_member"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'kb-documents'
    AND public.storage_key_is_clean(name)
    AND array_length(storage.foldername(name), 1) = 4
    AND (storage.foldername(name))[1] = 'tenants'
    AND (storage.foldername(name))[3] = 'kb_documents'
    AND public.storage_uuid_segment((storage.foldername(name))[2]) IS NOT NULL
    AND public.storage_uuid_segment((storage.foldername(name))[4]) IS NOT NULL
    -- First char must not be '.', so '.pdf', '..pdf', '.hidden.pdf' are rejected
    -- (mirrors PDF_NAME_RE in supabase/functions/_shared/storage-path-authorization.ts).
    AND storage.filename(name) ~ '^[A-Za-z0-9_-][A-Za-z0-9._-]{0,203}\.pdf$'
    AND public.is_tenant_member(public.storage_uuid_segment((storage.foldername(name))[2]))
  );

CREATE POLICY "kb_documents_select_canonical_tenant_member"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'kb-documents'
    AND public.storage_key_is_clean(name)
    AND array_length(storage.foldername(name), 1) = 4
    AND (storage.foldername(name))[1] = 'tenants'
    AND (storage.foldername(name))[3] = 'kb_documents'
    AND public.storage_uuid_segment((storage.foldername(name))[2]) IS NOT NULL
    AND public.storage_uuid_segment((storage.foldername(name))[4]) IS NOT NULL
    AND public.is_tenant_member(public.storage_uuid_segment((storage.foldername(name))[2]))
  );
-- No UPDATE / DELETE policies: clients cannot overwrite or delete.

-- C. templates: service role writes only; no client policies ----------------
UPDATE storage.buckets
   SET file_size_limit    = 20971520,                  -- 20 MB (select-template MAX)
       allowed_mime_types = ARRAY['application/pdf']
 WHERE id = 'templates';

DROP POLICY IF EXISTS "Authenticated users can upload templates" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can read templates"   ON storage.objects;
-- A tenant-scoped SELECT policy can be added when a client read path exists;
-- its shape is documented in storage-authorization.md.

-- D. review-documents: declare the bucket; service-role only ----------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('review-documents', 'review-documents', false, 52428800,
        ARRAY['application/pdf','text/plain','text/markdown',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
ON CONFLICT (id) DO UPDATE
  SET public = false;   -- correct a dashboard-created public bucket if one exists
-- Intentionally no anon/authenticated policies: upload-review-document and
-- extract-case-note-text use the service role after their own authorization.
