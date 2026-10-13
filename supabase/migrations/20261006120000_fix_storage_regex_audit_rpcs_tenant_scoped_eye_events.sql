-- ============================================================
-- Corrective migration for the 20261005 security migrations
-- (additive: the applied 20261005* files are left untouched)
--
-- Found by scripts/runtime-verify-local.ts against the local stack.
--
-- 1. storage_key_is_clean (20261005220000) used the regex bound {1,512}.
--    PostgreSQL ARE repetition bounds are limited to 255 (RE_DUP_MAX), so
--    every evaluation raised SQLSTATE 2201B "invalid regular expression:
--    invalid repetition count(s)". Both kb-documents policies call it, so
--    canonical uploads failed with an SQL error rather than being authorised
--    (and malformed keys were "rejected" by the same error, not by policy).
--    The length limit moves to length(); the character allowlist and
--    segment rules are unchanged. The kb filename pattern
--    ^[A-Za-z0-9_-][A-Za-z0-9._-]{0,203}\.pdf$ is within the bound and is
--    not changed.
--
-- 2. report_client_event / record_governance_event (20261005240000) used
--    min(tu.tenant_id). PostgreSQL has no min(uuid) aggregate, so the
--    sessionless client-event path and every governance event raised 42883
--    "function min(uuid) does not exist". Replaced with
--    (array_agg(tu.tenant_id ORDER BY tu.tenant_id))[1]; the result is only
--    used when exactly one membership exists. No other logic changes:
--    event allowlists, metadata validation, role checks and stamping are
--    byte-for-byte the 20261005240000 bodies.
--
-- 3. eye_events SELECT (20260210184141) was role-only: any active
--    supervisor/auditor could read every tenant's audit rows. Replaced by a
--    tenant-scoped policy backed by eye_event_visible_to_caller():
--      * caller must be authenticated, profile active, role supervisor or
--        auditor;
--      * event bound to a session that exists: the session's tenant is
--        authoritative; a uuid event_data.tenant_id that disagrees with it
--        hides the row (non-uuid values such as "default" are ignored);
--      * otherwise (no session, or session no longer exists): a canonical
--        uuid event_data.tenant_id is required;
--      * the caller must belong to the resolved tenant (tenant_users);
--      * rows with no resolvable tenant (legacy rows, malformed tenant_id,
--        unknown session without tenant) are visible to the service role
--        only.
--    SECURITY DEFINER so the lookup is not filtered by the owner-only
--    sessions RLS; it only ever evaluates auth.uid().
-- ============================================================

-- 1. storage_key_is_clean ------------------------------------------------
CREATE OR REPLACE FUNCTION public.storage_key_is_clean(key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public
AS $$
  SELECT length(key) BETWEEN 1 AND 512
     AND key ~ '^[A-Za-z0-9._/-]+$'
     AND key !~ '^/'
     AND key !~ '/$'
     AND key !~ '//'
     AND key !~ '(^|/)\.\.?(/|$)'
$$;

REVOKE ALL ON FUNCTION public.storage_key_is_clean(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storage_key_is_clean(text) TO authenticated, service_role;

-- 2. Audit RPCs: replace min(uuid) ----------------------------------------
CREATE OR REPLACE FUNCTION public.report_client_event(
  p_event_type text,
  p_session_id text    DEFAULT NULL,
  p_request_id text    DEFAULT NULL,
  p_metadata   jsonb   DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role public.app_role;
  v_tenant_id uuid;
  v_session_tenant uuid;
  v_session_owner uuid;
  v_membership_count int;
  v_key text; v_val jsonb;
  v_result text;
  v_event_data jsonb;
  v_id uuid;
  c_allowed_events constant text[] := ARRAY[
    'tool.run.started','tool.run.completed','tool.run.failed',
    'guidance.step.completed','guidance.step.skipped',
    'session.completed','session.closed_early','SESSION_HEARTBEAT'];
  c_allowed_keys constant text[] := ARRAY[
    'tool_name','result','step','error_code','recovered_from',
    'question_count','file_size_bytes','page_count','text_length',
    'structured_answers_count','review_worthy_count','unanswered_count',
    'human_review_count','review_tier','notes_source',
    'issue_count','high_severity_count','overall_risk','reconciliation_filtered'];
  -- Mirror of PHI_DENYLIST_KEYS in supabase/functions/_shared/eye.ts
  c_denied_keys constant text[] := ARRAY[
    'text','transcript','prompt','completion','audio_url','raw_text',
    'minimized_text','draft_text','note_content','message','content','body',
    'response_text','input_text','output_text'];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'EYE_UNAUTHENTICATED' USING ERRCODE = '28000'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_uid AND status = 'active') THEN
    RAISE EXCEPTION 'EYE_PROFILE_NOT_ACTIVE' USING ERRCODE = '42501';
  END IF;
  SELECT role INTO v_role FROM public.user_roles WHERE user_id = v_uid LIMIT 1;
  IF v_role IS NULL THEN RAISE EXCEPTION 'EYE_NO_ROLE' USING ERRCODE = '42501'; END IF;

  IF p_event_type IS NULL OR NOT (p_event_type = ANY (c_allowed_events)) THEN
    RAISE EXCEPTION 'EYE_EVENT_TYPE_NOT_ALLOWED' USING ERRCODE = '22023';
  END IF;
  IF p_request_id IS NOT NULL AND (length(p_request_id) > 128 OR p_request_id !~ '^[A-Za-z0-9_.:-]+$') THEN
    RAISE EXCEPTION 'EYE_REQUEST_ID_INVALID' USING ERRCODE = '22023';
  END IF;

  IF p_metadata IS NULL THEN p_metadata := '{}'::jsonb; END IF;
  IF jsonb_typeof(p_metadata) <> 'object' THEN
    RAISE EXCEPTION 'EYE_METADATA_NOT_OBJECT' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_metadata)) > 16 THEN
    RAISE EXCEPTION 'EYE_METADATA_TOO_MANY_KEYS' USING ERRCODE = '22023';
  END IF;
  FOR v_key, v_val IN SELECT key, value FROM jsonb_each(p_metadata) LOOP
    IF lower(v_key) = ANY (c_denied_keys) THEN
      RAISE EXCEPTION 'EYE_METADATA_KEY_DENIED: %', v_key USING ERRCODE = '22023';
    END IF;
    IF NOT (v_key = ANY (c_allowed_keys)) THEN
      RAISE EXCEPTION 'EYE_METADATA_KEY_NOT_ALLOWED: %', v_key USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_val) NOT IN ('string','number','boolean','null') THEN
      RAISE EXCEPTION 'EYE_METADATA_VALUE_NOT_PRIMITIVE: %', v_key USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_val) = 'string' AND length(v_val #>> '{}') > 200 THEN
      RAISE EXCEPTION 'EYE_METADATA_VALUE_TOO_LONG: %', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;
  v_result := COALESCE(p_metadata->>'result', 'success');
  IF v_result NOT IN ('success','failure','partial') THEN
    RAISE EXCEPTION 'EYE_RESULT_INVALID' USING ERRCODE = '22023';
  END IF;

  -- Tenant resolution: from the referenced session, never from caller input
  IF p_session_id IS NOT NULL THEN
    IF length(p_session_id) > 128 THEN RAISE EXCEPTION 'EYE_SESSION_ID_INVALID' USING ERRCODE = '22023'; END IF;
    SELECT s.tenant_id, s.user_id INTO v_session_tenant, v_session_owner
    FROM public.sessions s WHERE s.session_id = p_session_id;
    IF NOT FOUND OR v_session_tenant IS NULL THEN
      RAISE EXCEPTION 'EYE_SESSION_NOT_FOUND' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.tenant_users tu
                   WHERE tu.user_id = v_uid AND tu.tenant_id = v_session_tenant) THEN
      RAISE EXCEPTION 'EYE_SESSION_NOT_FOUND' USING ERRCODE = '42501';
    END IF;
    IF v_role = 'caseworker' AND v_session_owner IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'EYE_SESSION_NOT_OWNED' USING ERRCODE = '42501';
    END IF;
    v_tenant_id := v_session_tenant;
  ELSE
    SELECT count(*), (array_agg(tu.tenant_id ORDER BY tu.tenant_id))[1] INTO v_membership_count, v_tenant_id
    FROM public.tenant_users tu WHERE tu.user_id = v_uid;
    IF v_membership_count = 0 THEN
      RAISE EXCEPTION 'EYE_NO_TENANT' USING ERRCODE = '42501';
    ELSIF v_membership_count > 1 THEN
      RAISE EXCEPTION 'EYE_TENANT_AMBIGUOUS_REQUIRES_SESSION' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_event_data := p_metadata
    || jsonb_build_object(
         'event_version', 1,
         'tenant_id',     v_tenant_id::text,
         'actor_type',    'user',
         'actor_id',      v_uid::text,
         'actor_role',    v_role::text,
         'source',        'client_reported',
         'verified',      false,
         'result',        v_result,
         'severity',      'INFO',
         'resource_type', CASE WHEN p_session_id IS NULL THEN 'tool' ELSE 'session' END,
         'resource_id',   COALESCE(p_session_id, p_request_id, gen_random_uuid()::text))
    || CASE WHEN p_request_id IS NULL THEN '{}'::jsonb
            ELSE jsonb_build_object('request_id', p_request_id) END;

  -- Idempotency: restate the partial-index predicate from 20260107033836
  INSERT INTO public.eye_events (session_id, event_type, event_data)
  VALUES (p_session_id, p_event_type, v_event_data)
  ON CONFLICT (session_id, event_type, request_id_text)
    WHERE request_id_text IS NOT NULL AND request_id_text <> ''
  DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL AND p_request_id IS NOT NULL THEN
    SELECT id INTO v_id FROM public.eye_events
    WHERE session_id = p_session_id AND event_type = p_event_type AND request_id_text = p_request_id
    LIMIT 1;
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.report_client_event(text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_client_event(text, text, text, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_governance_event(
  p_event_type text,
  p_subject_id text        DEFAULT NULL,   -- auditor user id, export id, policy id
  p_scope      text        DEFAULT 'organization',
  p_expires_at timestamptz DEFAULT NULL,
  p_metadata   jsonb       DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role public.app_role;
  v_tenant_id uuid;
  v_membership_count int;
  v_key text; v_val jsonb;
  v_severity text; v_resource_type text;
  v_event_data jsonb;
  v_id uuid;
  c_supervisor_events constant text[] := ARRAY[
    'AI_USAGE_APPROVED_BY_SUPERVISOR','AI_USAGE_APPROVAL_REVOKED',
    'AUDITOR_ACCESS_GRANTED','AUDITOR_ACCESS_REVOKED'];
  c_export_events constant text[] := ARRAY[
    'COMPLIANCE_EXPORT_GENERATED','COMPLIANCE_EXPORT_DOWNLOADED'];
  c_allowed_keys constant text[] := ARRAY[
    'export_hash','export_id','event_count','time_range_start','time_range_end','approval_policy_id'];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'EYE_UNAUTHENTICATED' USING ERRCODE = '28000'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_uid AND status = 'active') THEN
    RAISE EXCEPTION 'EYE_PROFILE_NOT_ACTIVE' USING ERRCODE = '42501';
  END IF;
  SELECT role INTO v_role FROM public.user_roles WHERE user_id = v_uid LIMIT 1;
  IF v_role IS NULL THEN RAISE EXCEPTION 'EYE_NO_ROLE' USING ERRCODE = '42501'; END IF;

  IF p_event_type = ANY (c_supervisor_events) THEN
    IF NOT public.has_role(v_uid, 'supervisor') THEN
      RAISE EXCEPTION 'EYE_SUPERVISOR_REQUIRED' USING ERRCODE = '42501';
    END IF;
    v_severity := CASE WHEN p_event_type = 'AI_USAGE_APPROVAL_REVOKED' THEN 'HIGH' ELSE 'NOTICE' END;
    v_resource_type := CASE WHEN p_event_type LIKE 'AUDITOR_%' THEN 'credential' ELSE 'policy' END;
  ELSIF p_event_type = ANY (c_export_events) THEN
    IF NOT (public.has_role(v_uid, 'supervisor') OR public.has_role(v_uid, 'auditor')) THEN
      RAISE EXCEPTION 'EYE_SUPERVISOR_OR_AUDITOR_REQUIRED' USING ERRCODE = '42501';
    END IF;
    v_severity := CASE WHEN p_event_type = 'COMPLIANCE_EXPORT_GENERATED' THEN 'NOTICE' ELSE 'INFO' END;
    v_resource_type := 'export';
  ELSE
    RAISE EXCEPTION 'EYE_EVENT_TYPE_NOT_ALLOWED' USING ERRCODE = '22023';
  END IF;

  IF p_scope IS NULL OR p_scope NOT IN ('organization','workflow','session') THEN
    RAISE EXCEPTION 'EYE_SCOPE_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_subject_id IS NOT NULL AND (length(p_subject_id) > 128 OR p_subject_id !~ '^[A-Za-z0-9_.:-]+$') THEN
    RAISE EXCEPTION 'EYE_SUBJECT_ID_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_event_type LIKE 'AUDITOR_ACCESS_%' THEN
    IF p_subject_id IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.user_roles WHERE user_id::text = p_subject_id AND role = 'auditor') THEN
      RAISE EXCEPTION 'EYE_SUBJECT_NOT_AUDITOR' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT count(*), (array_agg(tu.tenant_id ORDER BY tu.tenant_id))[1] INTO v_membership_count, v_tenant_id
  FROM public.tenant_users tu WHERE tu.user_id = v_uid;
  IF v_membership_count <> 1 THEN
    RAISE EXCEPTION 'EYE_TENANT_UNRESOLVED' USING ERRCODE = '42501';
  END IF;

  IF p_metadata IS NULL THEN p_metadata := '{}'::jsonb; END IF;
  IF jsonb_typeof(p_metadata) <> 'object' THEN
    RAISE EXCEPTION 'EYE_METADATA_NOT_OBJECT' USING ERRCODE = '22023';
  END IF;
  FOR v_key, v_val IN SELECT key, value FROM jsonb_each(p_metadata) LOOP
    IF NOT (v_key = ANY (c_allowed_keys)) THEN
      RAISE EXCEPTION 'EYE_METADATA_KEY_NOT_ALLOWED: %', v_key USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_val) NOT IN ('string','number','boolean','null')
       OR (jsonb_typeof(v_val) = 'string' AND length(v_val #>> '{}') > 200) THEN
      RAISE EXCEPTION 'EYE_METADATA_VALUE_INVALID: %', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;

  v_event_data := p_metadata || jsonb_build_object(
      'event_version', 1,
      'tenant_id',     v_tenant_id::text,
      'scope',         p_scope,
      'actor_type',    'user',
      'actor_id',      v_uid::text,
      'actor_role',    v_role::text,
      'operator_id',   v_uid::text,
      'source',        'server_observed',
      'verified',      true,
      'confidence',    'explicit_user_action',
      'request_id',    gen_random_uuid()::text,
      'result',        'success',
      'severity',      v_severity,
      'resource_type', v_resource_type,
      'resource_id',   COALESCE(p_subject_id, p_event_type));
  IF p_expires_at IS NOT NULL THEN
    v_event_data := v_event_data || jsonb_build_object('expires_at', p_expires_at);
  END IF;

  INSERT INTO public.eye_events (session_id, event_type, event_data)
  VALUES (NULL, p_event_type, v_event_data)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_governance_event(text, text, text, timestamptz, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_governance_event(text, text, text, timestamptz, jsonb) TO authenticated, service_role;

-- 3. eye_events: tenant-scoped supervisor/auditor reads ------------------
CREATE OR REPLACE FUNCTION public.eye_event_visible_to_caller(p_session_id text, p_event_data jsonb)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_attr text;
  v_attr_tenant uuid;
  v_tenant uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_uid AND status = 'active') THEN
    RETURN false;
  END IF;
  IF NOT (public.has_role(v_uid, 'supervisor') OR public.has_role(v_uid, 'auditor')) THEN
    RETURN false;
  END IF;

  v_attr := CASE WHEN jsonb_typeof(p_event_data -> 'tenant_id') = 'string'
                 THEN p_event_data ->> 'tenant_id' END;
  IF v_attr IS NOT NULL THEN
    v_attr_tenant := public.storage_uuid_segment(lower(v_attr));  -- NULL unless a canonical uuid
  END IF;

  IF p_session_id IS NOT NULL AND p_session_id <> '' THEN
    SELECT s.tenant_id INTO v_tenant FROM public.sessions s WHERE s.session_id = p_session_id LIMIT 1;
    IF v_tenant IS NULL AND p_session_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
      SELECT s.tenant_id INTO v_tenant FROM public.sessions s WHERE s.id = p_session_id::uuid LIMIT 1;
    END IF;
    IF v_tenant IS NOT NULL AND v_attr_tenant IS NOT NULL AND v_attr_tenant <> v_tenant THEN
      RETURN false;  -- conflicting attribution
    END IF;
  END IF;

  v_tenant := COALESCE(v_tenant, v_attr_tenant);
  IF v_tenant IS NULL THEN RETURN false; END IF;  -- no clear tenant attribution

  RETURN EXISTS (
    SELECT 1 FROM public.tenant_users tu
    WHERE tu.user_id = v_uid AND tu.tenant_id = v_tenant
  );
END;
$$;

REVOKE ALL ON FUNCTION public.eye_event_visible_to_caller(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eye_event_visible_to_caller(text, jsonb) TO authenticated, service_role;

DROP POLICY IF EXISTS "Active supervisors and auditors can read eye_events" ON public.eye_events;
DROP POLICY IF EXISTS "Tenant supervisors and auditors can read eye_events" ON public.eye_events;
CREATE POLICY "Tenant supervisors and auditors can read eye_events"
  ON public.eye_events
  FOR SELECT
  TO authenticated
  USING (public.eye_event_visible_to_caller(session_id, event_data));
