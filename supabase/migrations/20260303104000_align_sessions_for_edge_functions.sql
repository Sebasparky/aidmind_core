-- Ensure sessions has columns expected by edge functions (idempotent)
alter table public.sessions
  add column if not exists tenant_id uuid,
  add column if not exists user_id uuid,
  add column if not exists template_id uuid,
  add column if not exists status text not null default 'initialized',
  add column if not exists interview_notes text,
  add column if not exists policy_pack_id uuid,
  add column if not exists metadata jsonb not null default '{}'::jsonb;
