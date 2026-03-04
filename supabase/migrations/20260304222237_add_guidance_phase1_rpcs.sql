-- =========================================================
-- RPC: get_policy_snippets_for_session
-- =========================================================

create or replace function public.get_policy_snippets_for_session(
  session_id_input uuid
)
returns table(
  snippet_id uuid,
  chunk_text text
)
language sql
stable
as $$
  select
    cpc.chunk_id as snippet_id,
    dc.content as chunk_text
  from public.sessions s
  join public.compiled_policy_pack_chunks cpc
    on cpc.compiled_policy_pack_id = s.policy_pack_id
  join public.document_chunks dc
    on dc.id = cpc.chunk_id
  where s.id = session_id_input
  order by cpc.rank asc
  limit 40;
$$;


-- =========================================================
-- RPC: update_session_guidance_phase1
-- =========================================================

create or replace function public.update_session_guidance_phase1(
  session_id_input uuid,
  guidance_json jsonb
)
returns boolean
language plpgsql
security definer
as $$
begin

  update public.sessions
  set
    metadata =
      coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object('guidance_phase1', guidance_json),

    status = case
      when status = 'guidance_generating' then 'guidance_ready'
      else status
    end,

    updated_at = now()

  where id = session_id_input;

  if not found then
    raise exception 'Session % not found', session_id_input;
  end if;

  return true;

end;
$$;