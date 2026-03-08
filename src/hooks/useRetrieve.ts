/**
 * useRetrieve — Hook for the Retrieve / Records Room pipeline.
 * Calls the records-room edge function and manages result state.
 */

import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";

/* ── Types (mirror edge function response) ── */

export interface EvidenceItem {
  document_title: string;
  section_heading: string | null;
  excerpt_text: string;
  citation_label: string;
  page_or_location: string | null;
  expandable_context: string;
  source_type: string | null;
  is_official: boolean;
  chunk_id: string;
  document_id: string;
  similarity: number;
  composite_score: number;
  /** URL to view the original source document, if available */
  source_url: string | null;
  /** URL to download the original source document, if available */
  download_url: string | null;
}

export type RetrieveStatus = "idle" | "loading" | "success" | "no_results" | "clarification_needed" | "error";

export interface RetrieveResult {
  status: "success" | "no_results" | "clarification_needed" | "error";
  query_type: string;
  clarification_question: string | null;
  strong_evidence: EvidenceItem[];
  supporting_materials: EvidenceItem[];
  failure_state: string | null;
  failure_message: string | null;
}

export function useRetrieve() {
  const { tenant } = useTenant();
  const [status, setStatus] = useState<RetrieveStatus>("idle");
  const [result, setResult] = useState<RetrieveResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (query: string) => {
    if (!query.trim()) return;
    if (!tenant?.tenantId) {
      setError("No tenant context available");
      setStatus("error");
      return;
    }

    setStatus("loading");
    setError(null);
    setResult(null);

    try {
      const { data, error: fnErr } = await supabase.functions.invoke("records-room", {
        body: {
          query: query.trim(),
          tenant_id: tenant.tenantId,
        },
      });

      if (fnErr) throw new Error(fnErr.message ?? "Retrieve failed");

      const res = data as RetrieveResult;
      setResult(res);
      setStatus(res.status === "success" ? "success" : res.status === "clarification_needed" ? "clarification_needed" : "no_results");
    } catch (err) {
      console.error("[useRetrieve] Error:", err);
      setError(err instanceof Error ? err.message : "An error occurred");
      setStatus("error");
    }
  }, [tenant?.tenantId]);

  const reset = useCallback(() => {
    setStatus("idle");
    setResult(null);
    setError(null);
  }, []);

  return { status, result, error, search, reset };
}
