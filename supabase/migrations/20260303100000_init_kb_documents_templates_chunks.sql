-- 000_init_kb_documents_templates_chunks.sql
-- Creates KB tables + pgvector + indexes + RLS
-- Embedding dimension: 1536
-- Extensions
create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;
-- -------------------------
-- kb_documents
-- -------------------------
create table if not exists public.kb_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  version text,
  source text,
  file_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists kb_documents_tenant_id_idx
  on public.kb_documents (tenant_id);
create index if not exists kb_documents_updated_at_idx
  on public.kb_documents (updated_at);
-- -------------------------
-- kb_templates
-- -------------------------
create table if not exists public.kb_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  version text not null,
  file_path text,
  content text not null default ''::text,
  content_type text not null default 'markdown'::text,
  extraction_status text not null default 'ready'::text,
  content_hash text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists kb_templates_tenant_id_idx
  on public.kb_templates (tenant_id);
create index if not exists kb_templates_active_idx
  on public.kb_templates (tenant_id, is_active);
-- -------------------------
-- document_chunks
-- -------------------------
create table if not exists public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  document_id uuid not null references public.kb_documents(id) on delete cascade,
  chunk_index integer not null,
  heading_path text,
  content text not null,
  token_count integer,
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(1536),
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);
create index if not exists document_chunks_tenant_id_idx
  on public.document_chunks (tenant_id);
create index if not exists document_chunks_document_id_idx
  on public.document_chunks (document_id);
-- Vector ANN index (cosine similarity). Use ivfflat for simplicity.
-- Note: ivfflat benefits from ANALYZE and reasonably sized lists.
create index if not exists document_chunks_embedding_ivfflat_idx
  on public.document_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);
-- Optional: full-text index for debugging / keyword search
create index if not exists document_chunks_content_fts_idx
  on public.document_chunks
  using gin (to_tsvector('english', content));
-- -------------------------
-- RLS (safe default)
-- -------------------------
alter table public.kb_documents enable row level security;
alter table public.kb_templates enable row level security;
alter table public.document_chunks enable row level security;
-- Default stance: no direct client access (authenticated users have no policies).
-- Edge Functions using the service role key bypass RLS.
-- If/when we add tenant membership tables, we can add tenant-scoped select/insert policies.
