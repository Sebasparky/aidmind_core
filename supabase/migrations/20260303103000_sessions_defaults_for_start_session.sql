alter table public.sessions
  alter column session_id set default gen_random_uuid()::text;

alter table public.sessions
  alter column case_id set default gen_random_uuid()::text;
