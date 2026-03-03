
-- Enable pgcrypto (Supabase convention)
create extension if not exists pgcrypto with schema extensions;

-- Create tenants table
create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes
create index idx_tenants_is_active on public.tenants (is_active);
create index idx_tenants_updated_at on public.tenants (updated_at);

-- Enable RLS (no policies yet — access is service-role only until explicit policies are added)
alter table public.tenants enable row level security;

-- Auto-update updated_at
create trigger update_tenants_updated_at
  before update on public.tenants
  for each row
  execute function public.update_updated_at_column();
