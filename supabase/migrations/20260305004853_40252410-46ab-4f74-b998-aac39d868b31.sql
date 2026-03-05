
-- =========================================================
-- Table: tenant_users (multi-tenant user membership)
-- =========================================================

create table public.tenant_users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

-- Indexes
create index idx_tenant_users_user_id on public.tenant_users(user_id);
create index idx_tenant_users_tenant_id on public.tenant_users(tenant_id);

-- RLS
alter table public.tenant_users enable row level security;

-- Users can read their own memberships
create policy "Users can read own tenant memberships"
  on public.tenant_users
  for select
  to authenticated
  using (user_id = auth.uid());

-- Service role manages memberships (inserts/updates/deletes)
create policy "Service role manages tenant_users"
  on public.tenant_users
  for all
  to service_role
  using (true)
  with check (true);
