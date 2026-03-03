-- Enable pgvector if not already enabled
create extension if not exists vector with schema extensions;

-- 1) Drop tables in dependency order
drop table if exists public.compiled_policy_pack_chunks cascade;
drop table if exists public.compiled_policy_packs cascade;
drop table if exists public.retrieval_runs cascade;

-- 2) Recreate retrieval_runs
create table public.retrieval_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  session_id uuid not null,
  template_id uuid not null,
  guardrails jsonb not null default '{}',
  params jsonb not null default '{}',
  query_count int not null default 0,
  selected_chunk_count int not null default 0,
  status text not null default 'started' check (status in ('started', 'completed', 'failed')),
  error text null,
  created_at timestamptz default now(),
  completed_at timestamptz null
);

-- 3) Recreate compiled_policy_packs
create table public.compiled_policy_packs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  session_id uuid not null,
  template_id uuid not null,
  retrieval_run_id uuid not null references public.retrieval_runs(id) on delete cascade,
  status text not null default 'compiled' check (status in ('compiled', 'failed')),
  metadata jsonb not null default '{}',
  created_at timestamptz default now()
);

-- 4) Recreate compiled_policy_pack_chunks
create table public.compiled_policy_pack_chunks (
  id uuid primary key default gen_random_uuid(),
  compiled_policy_pack_id uuid not null references public.compiled_policy_packs(id) on delete cascade,
  tenant_id uuid not null,
  document_id uuid not null,
  chunk_id uuid not null,
  chunk_index int not null,
  similarity real not null,
  rank int not null,
  metadata jsonb not null default '{}',
  created_at timestamptz default now()
);

-- 5) Create/replace match_document_chunks RPC
create or replace function public.match_document_chunks(
  p_tenant_id uuid,
  p_query_embedding vector(1536),
  p_match_count int,
  p_min_similarity real
)
returns table (
  id uuid,
  document_id uuid,
  chunk_index int,
  content text,
  metadata jsonb,
  similarity real
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
    select
      dc.id,
      dc.document_id,
      dc.chunk_index,
      dc.content,
      dc.metadata,
      (1 - (dc.embedding <=> p_query_embedding))::real as similarity
    from public.document_chunks dc
    where dc.tenant_id = p_tenant_id
      and (1 - (dc.embedding <=> p_query_embedding))::real >= p_min_similarity
    order by dc.embedding <=> p_query_embedding asc
    limit p_match_count;
end;
$$;
