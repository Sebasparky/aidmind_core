/**
 * useRetrieve — Hook for the Retrieve / Records Room pipeline.
 * Calls the records-room edge function and manages result state.
 * Persists last search state in sessionStorage for navigation resilience.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";

/* ── Types (mirror edge function response) ── */

export type RecallOrigin = "semantic" | "lexical" | "both";

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
  source_url: string | null;
  download_url: string | null;
  /* Scoring fields for frontend refinement */
  directness_score: number;
  concept_anchor_score: number;
  section_match_score: number;
  exact_phrase_score: number;
  primary_boost: boolean;
  collateral_labels: string[];
  recall_origin: RecallOrigin;
  chunk_index: number;
  bucket: "strong_evidence" | "supporting_material";
}

export interface RefinementHints {
  has_procedural_content: boolean;
  has_exception_content: boolean;
  has_notice_deadline_content: boolean;
  has_review_appeal_content: boolean;
  has_eligibility_content: boolean;
  strong_count: number;
  supporting_count: number;
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
  refinement_hints: RefinementHints | null;
}

/* ── SessionStorage persistence ── */

const STORAGE_KEY = "aidmind_retrieve_state";

interface PersistedState {
  query: string;
  status: RetrieveStatus;
  result: RetrieveResult | null;
  error: string | null;
  timestamp: number;
}

function saveState(state: PersistedState) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* quota exceeded — non-critical */ }
}

function loadState(): PersistedState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState;
    // Basic shape validation
    if (typeof parsed.query !== "string" || typeof parsed.status !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearStoredState() {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ok */ }
}

export function useRetrieve() {
  const { tenant } = useTenant();
  const hydrated = useRef(false);

  // Try to hydrate from sessionStorage on first render
  const initial = !hydrated.current ? loadState() : null;

  const [query, setQuery] = useState(initial?.query ?? "");
  const [status, setStatus] = useState<RetrieveStatus>(initial?.status === "loading" ? "idle" : (initial?.status ?? "idle"));
  const [result, setResult] = useState<RetrieveResult | null>(initial?.result ?? null);
  const [error, setError] = useState<string | null>(initial?.error ?? null);

  useEffect(() => { hydrated.current = true; }, []);

  // Persist state changes (debounced by React batching)
  useEffect(() => {
    if (!hydrated.current) return;
    if (status === "loading") return; // don't persist transient loading state
    saveState({ query, status, result, error, timestamp: Date.now() });
  }, [query, status, result, error]);

  const search = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) return;
    if (!tenant?.tenantId) {
      setError("No tenant context available");
      setStatus("error");
      return;
    }

    setQuery(searchQuery);
    setStatus("loading");
    setError(null);
    setResult(null);

    try {
      const { data, error: fnErr } = await supabase.functions.invoke("records-room", {
        body: {
          query: searchQuery.trim(),
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
    setQuery("");
    setStatus("idle");
    setResult(null);
    setError(null);
    clearStoredState();
  }, []);

  return { query, status, result, error, search, reset };
}
