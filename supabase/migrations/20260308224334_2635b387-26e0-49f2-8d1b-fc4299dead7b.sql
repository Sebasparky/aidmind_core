
-- Add GIN index for full-text search on document_chunks.content
CREATE INDEX IF NOT EXISTS idx_document_chunks_content_fts
ON public.document_chunks
USING GIN (to_tsvector('english', content));

-- Lexical search function for Records Room hybrid recall
CREATE OR REPLACE FUNCTION public.search_document_chunks_lexical(
  p_tenant_id uuid,
  p_search_query text,
  p_match_count integer DEFAULT 30
)
RETURNS TABLE(
  id uuid,
  document_id uuid,
  chunk_index integer,
  content text,
  metadata jsonb,
  rank real
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
    SELECT
      dc.id,
      dc.document_id,
      dc.chunk_index,
      dc.content,
      dc.metadata,
      ts_rank_cd(to_tsvector('english', dc.content), plainto_tsquery('english', p_search_query))::real AS rank
    FROM public.document_chunks dc
    WHERE dc.tenant_id = p_tenant_id
      AND to_tsvector('english', dc.content) @@ plainto_tsquery('english', p_search_query)
    ORDER BY rank DESC
    LIMIT p_match_count;
END;
$$;
