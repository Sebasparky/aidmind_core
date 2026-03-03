-- Create tenants table (required for KB tables FK)
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tenants_is_active_idx on public.tenants (is_active);
create index if not exists tenants_updated_at_idx on public.tenants (updated_at);

-- Safe default: RLS enabled, no policies yet (service-role only for now)
alter table public.tenants enable row level security;
