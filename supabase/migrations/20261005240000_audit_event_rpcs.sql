-- ============================================================
-- Audit events: constrained write paths replacing direct browser INSERTs
-- (additive; historical migrations untouched; NOT YET EXECUTED anywhere)
--
-- Context: 20261005210000 dropped the PUBLIC "Allow all operations on
-- eye_events" policy. Browser code had been inserting audit rows directly,
-- choosing its own actor_id / tenant_id / actor_role (and, since
-- 20260107033836, failing silently in useEyeLogger because it wrote the
-- GENERATED column request_id_text). No INSERT policy is added for
-- anon/authenticated. Instead:
--
--   report_client_event     — client-REPORTED lifecycle/tool events.
--                             Allowlisted event types and metadata keys,
--                             primitives only, PHI key denylist mirrored from
--                             _shared/eye.ts. Identity and tenant derive from
--                             auth.uid(), profiles, user_roles, tenant_users
--                             and the referenced session. Stamped
--                             source='client_reported', verified=false.
--                             These are NOT tamper-proof attestations.
--
--   record_governance_event — supervisor/auditor actions that other code
--                             treats as authorization evidence (AI usage
--                             approval, auditor access, compliance export).
--                             Role is checked server-side via has_role();
--                             stamped source='server_observed', verified=true.
--
-- Consumers (llm-authorization.ts, useAIAuthorization, useAuditorAccess,
-- verdict inputs) must require source='server_observed' AND verified=true.
-- ============================================================

-- ------------------------------------------------------------
-- A. report_client_event
-- ------------------------------------------------------------
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
    SELECT count(*), min(tu.tenant_id) INTO v_membership_count, v_tenant_id
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

-- ------------------------------------------------------------
-- B. record_governance_event
-- ------------------------------------------------------------
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

  SELECT count(*), min(tu.tenant_id) INTO v_membership_count, v_tenant_id
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
