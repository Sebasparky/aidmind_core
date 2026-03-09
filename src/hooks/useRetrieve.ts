/**
 * useRetrieve — Hook for the Retrieve / Records Room pipeline.
 * Calls the records-room edge function and manages result state.
 * Supports backend-powered refinement with per-mode caching.
 * Persists last search state in sessionStorage for navigation resilience.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";

/* ── Types (mirror edge function response) ── */

export type RecallOrigin = "semantic" | "lexical" | "both";

export type RefinementMode =
  | "none"
  | "main_rule"
  | "direct_matches"
  | "broader_related"
  | "strong_only"
  | "procedural"
  | "exceptions"
  | "notices_deadlines"
  | "eligibility";

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
  refinement_mode?: RefinementMode;
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

  const initial = !hydrated.current ? loadState() : null;

  const [query, setQuery] = useState(initial?.query ?? "");
  const [status, setStatus] = useState<RetrieveStatus>(initial?.status === "loading" ? "idle" : (initial?.status ?? "idle"));
  const [result, setResult] = useState<RetrieveResult | null>(initial?.result ?? null);
  const [error, setError] = useState<string | null>(initial?.error ?? null);

  // Base result (refinement_mode=none) — kept for instant "Show all results" reset
  const [baseResult, setBaseResult] = useState<RetrieveResult | null>(initial?.result ?? null);

  // Per-mode cache for current query
  const refinementCache = useRef<Map<RefinementMode, RetrieveResult>>(new Map());

  // Active refinement mode
  const [activeRefinementMode, setActiveRefinementMode] = useState<RefinementMode>("none");

  // Refinement loading state
  const [refining, setRefining] = useState(false);

  useEffect(() => { hydrated.current = true; }, []);

  // Persist state changes
  useEffect(() => {
    if (!hydrated.current) return;
    if (status === "loading") return;
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
    setBaseResult(null);
    setActiveRefinementMode("none");
    refinementCache.current = new Map();

    try {
      const { data, error: fnErr } = await supabase.functions.invoke("records-room", {
        body: {
          query: searchQuery.trim(),
          tenant_id: tenant.tenantId,
          refinement_mode: "none",
        },
      });

      if (fnErr) throw new Error(fnErr.message ?? "Retrieve failed");

      const res = data as RetrieveResult;
      setResult(res);
      setBaseResult(res);
      refinementCache.current.set("none", res);
      setStatus(res.status === "success" ? "success" : res.status === "clarification_needed" ? "clarification_needed" : "no_results");
    } catch (err) {
      console.error("[useRetrieve] Error:", err);
      setError(err instanceof Error ? err.message : "An error occurred");
      setStatus("error");
    }
  }, [tenant?.tenantId]);

  /**
   * Refine the current search with a specific mode.
   * "none" = reset to base results (instant, no network call).
   * "confirmed" = keep current results, no action.
   * Other modes = trigger backend refinement request.
   */
  const refine = useCallback(async (mode: RefinementMode) => {
    if (!tenant?.tenantId || !query.trim()) return;

    // "none" = instant reset to base
    if (mode === "none") {
      setActiveRefinementMode("none");
      if (baseResult) {
        setResult(baseResult);
      }
      return;
    }

    // "strong_only" = local filter of base results (no backend call needed)
    if (mode === "strong_only") {
      setActiveRefinementMode("strong_only");
      if (baseResult) {
        setResult({
          ...baseResult,
          supporting_materials: [],
          refinement_mode: "strong_only",
        });
      }
      return;
    }

    // Check cache first
    const cached = refinementCache.current.get(mode);
    if (cached) {
      setActiveRefinementMode(mode);
      setResult(cached);
      return;
    }

    // Real backend refinement request
    setRefining(true);
    setActiveRefinementMode(mode);

    try {
      const { data, error: fnErr } = await supabase.functions.invoke("records-room", {
        body: {
          query: query.trim(),
          tenant_id: tenant.tenantId,
          refinement_mode: mode,
        },
      });

      if (fnErr) throw new Error(fnErr.message ?? "Refinement failed");

      const res = data as RetrieveResult;
      refinementCache.current.set(mode, res);
      setResult(res);

      // Log refinement event
      console.log("[retrieve-refinement]", JSON.stringify({
        action: "backend_refined",
        query: query.slice(0, 200),
        mode,
        strong_count: res.strong_evidence.length,
        supporting_count: res.supporting_materials.length,
        timestamp: new Date().toISOString(),
      }));
    } catch (err) {
      console.error("[useRetrieve] Refinement error:", err);
      // On error, fall back to base results
      if (baseResult) setResult(baseResult);
      setActiveRefinementMode("none");
    } finally {
      setRefining(false);
    }
  }, [tenant?.tenantId, query, baseResult]);

  const reset = useCallback(() => {
    setQuery("");
    setStatus("idle");
    setResult(null);
    setBaseResult(null);
    setError(null);
    setActiveRefinementMode("none");
    refinementCache.current = new Map();
    clearStoredState();
  }, []);

  return {
    query,
    status,
    result,
    error,
    search,
    reset,
    refine,
    refining,
    activeRefinementMode,
    baseResult,
  };
}
