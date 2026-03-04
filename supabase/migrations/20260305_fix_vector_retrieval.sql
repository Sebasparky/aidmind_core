-- =========================================
-- Fix vector retrieval pipeline
-- =========================================

-- Remove old overloaded RPC version
drop function if exists public.match_document_chunks(uuid, vector, integer, real);

-- Ensure embedding column uses correct vector type
alter table public.document_chunks
alter column embedding
type vector(1536)
using embedding::vector;

-- Recreate canonical retrieval RPC
create or replace function public.match_document_chunks(
  p_tenant_id uuid,
  p_query_embedding vector,
  p_match_count integer default 30,
  p_min_similarity double precision default 0.28
)
returns table(
  id uuid,
  document_id uuid,
  chunk_index integer,
  content text,
  metadata jsonb,
  similarity double precision
)
language plpgsql
as $$
begin
  return query
  select
    dc.id,
    dc.document_id,
    dc.chunk_index,
    dc.content,
    dc.metadata,
    (1 - (dc.embedding <=> p_query_embedding))::double precision as similarity
  from public.document_chunks dc
  where dc.tenant_id = p_tenant_id
    and dc.embedding is not null
    and (1 - (dc.embedding <=> p_query_embedding)) >= p_min_similarity
  order by dc.embedding <=> p_query_embedding
  limit p_match_count;
end;
$$;