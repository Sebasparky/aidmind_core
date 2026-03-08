/**
 * useKbDocuments — Fetches KB documents with their ingestion status for the active tenant.
 */

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "./useTenant";

export type IngestionStatus =
  | "uploaded"
  | "queued"
  | "extracting"
  | "extracted"
  | "chunking"
  | "embedding"
  | "indexing"
  | "ready"
  | "failed"
  | "indexing_failed"
  | "needs_review"
  | "unknown";

export interface KbDocumentRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  metadata: Record<string, any>;
  ingestionStatus: IngestionStatus;
  ingestionError: string | null;
  chunkCount: number | null;
}

export function useKbDocuments() {
  const { tenant } = useTenant();
  const [documents, setDocuments] = useState<KbDocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDocs = useCallback(async () => {
    if (!tenant?.tenantId) {
      setLoading(false);
      return;
    }

    try {
      setError(null);
      setLoading(true);

      // Fetch documents
      const { data: docs, error: docsErr } = await supabase
        .from("kb_documents")
        .select("id, title, created_at, updated_at, metadata")
        .eq("tenant_id", tenant.tenantId)
        .order("created_at", { ascending: false });

      if (docsErr) throw docsErr;

      // For each doc, get chunk counts (batch via single query)
      const docIds = (docs || []).map((d) => d.id);
      let chunkCounts: Record<string, number> = {};

      if (docIds.length > 0) {
        // Get chunk counts per document
        const { data: chunks, error: chunkErr } = await supabase
          .from("document_chunks")
          .select("document_id")
          .eq("tenant_id", tenant.tenantId)
          .in("document_id", docIds);

        if (!chunkErr && chunks) {
          for (const c of chunks) {
            chunkCounts[c.document_id] = (chunkCounts[c.document_id] || 0) + 1;
          }
        }
      }

      const rows: KbDocumentRow[] = (docs || []).map((d) => {
        const meta = (d.metadata as Record<string, any>) || {};
        const ingestion = meta.ingestion || {};
        const status: IngestionStatus = ingestion.status || "unknown";
        const count = chunkCounts[d.id] ?? null;

        // Cross-check: if status says "ready" but chunks = 0, flag it
        let effectiveStatus = status;
        if (status === "ready" && count === 0) {
          effectiveStatus = "failed";
        }

        return {
          id: d.id,
          title: d.title,
          created_at: d.created_at,
          updated_at: d.updated_at,
          metadata: meta,
          ingestionStatus: effectiveStatus,
          ingestionError: ingestion.error || ingestion.indexing_error || null,
          chunkCount: count,
        };
      });

      setDocuments(rows);
    } catch (err) {
      console.error("[useKbDocuments] Error:", err);
      setError(err instanceof Error ? err.message : "Failed to load documents");
    } finally {
      setLoading(false);
    }
  }, [tenant?.tenantId]);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  return { documents, loading, error, refresh: fetchDocs };
}
