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

/**
 * Describes the relationship between refined and base results.
 * Used by the UI to decide what state to show.
 */
export type RefinementViewState =
  | "original"           // viewing base results
  | "refined"            // refined results differ meaningfully from base
  | "refined_empty"      // refined search returned no results
  | "refined_no_change"; // refined results are substantially the same as base

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

/* ── Overlap detection ── */

const OVERLAP_THRESHOLD = 0.80; // 80%+ overlap = "no meaningful change"

/**
 * Computes evidence identity overlap between two result sets.
 * Uses document_id + chunk_index as stable identity.
 */
function computeResultOverlap(base: RetrieveResult, refined: RetrieveResult): number {
  const baseIds = new Set<string>();
  for (const item of [...base.strong_evidence, ...base.supporting_materials]) {
    baseIds.add(`${item.document_id}:${item.chunk_index}`);
  }
  if (baseIds.size === 0) return 0;

  const refinedIds = new Set<string>();
  for (const item of [...refined.strong_evidence, ...refined.supporting_materials]) {
    refinedIds.add(`${item.document_id}:${item.chunk_index}`);
  }
  if (refinedIds.size === 0) return 0;

  let intersection = 0;
  for (const id of refinedIds) {
    if (baseIds.has(id)) intersection++;
  }

  // Overlap = fraction of refined items that were already in base
  return intersection / refinedIds.size;
}

/**
 * Determine the refinement view state by comparing refined results to base.
 */
function classifyRefinementResult(base: RetrieveResult | null, refined: RetrieveResult): RefinementViewState {
  const refinedTotal = refined.strong_evidence.length + refined.supporting_materials.length;

  // Empty refined results
  if (refinedTotal === 0) return "refined_empty";

  // No base to compare against
  if (!base) return "refined";

  const overlap = computeResultOverlap(base, refined);

  // Check both overlap AND order — if same items but different order, still counts as meaningful
  if (overlap >= OVERLAP_THRESHOLD) {
    // Also check if the order materially changed by comparing top 3
    const baseTopIds = [...base.strong_evidence, ...base.supporting_materials]
      .slice(0, 3)
      .map(i => `${i.document_id}:${i.chunk_index}`);
    const refinedTopIds = [...refined.strong_evidence, ...refined.supporting_materials]
      .slice(0, 3)
      .map(i => `${i.document_id}:${i.chunk_index}`);

    const sameTopOrder = baseTopIds.length === refinedTopIds.length &&
      baseTopIds.every((id, idx) => id === refinedTopIds[idx]);

    if (sameTopOrder) return "refined_no_change";
  }

  return "refined";
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

  // Refinement view state — describes how refined results compare to base
  const [refinementViewState, setRefinementViewState] = useState<RefinementViewState>("original");

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
    setRefinementViewState("original");
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
   * Other modes = trigger backend refinement request with wider recall.
   */
  const refine = useCallback(async (mode: RefinementMode) => {
    if (!tenant?.tenantId || !query.trim()) return;

    // "none" = instant reset to base
    if (mode === "none") {
      setActiveRefinementMode("none");
      setRefinementViewState("original");
      if (baseResult) {
        setResult(baseResult);
      }
      return;
    }

    // "strong_only" = local filter of base results (no backend call needed)
    if (mode === "strong_only") {
      setActiveRefinementMode("strong_only");
      if (baseResult) {
        const filtered: RetrieveResult = {
          ...baseResult,
          supporting_materials: [],
          refinement_mode: "strong_only",
        };
        setResult(filtered);
        // Classify: if base had no supporting, it's no_change; otherwise it's a real filter
        const viewState = baseResult.supporting_materials.length === 0 ? "refined_no_change" : "refined";
        setRefinementViewState(viewState);
      }
      return;
    }

    // Check cache first
    const cached = refinementCache.current.get(mode);
    if (cached) {
      setActiveRefinementMode(mode);
      setResult(cached);
      setRefinementViewState(classifyRefinementResult(baseResult, cached));
      return;
    }

    // Real backend refinement request — this is a true second-pass retrieval
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

      // Classify the refinement result
      const viewState = classifyRefinementResult(baseResult, res);
      setRefinementViewState(viewState);

      // Log refinement event
      console.log("[retrieve-refinement]", JSON.stringify({
        action: "backend_refined",
        query: query.slice(0, 200),
        mode,
        view_state: viewState,
        strong_count: res.strong_evidence.length,
        supporting_count: res.supporting_materials.length,
        overlap: baseResult ? computeResultOverlap(baseResult, res).toFixed(2) : "n/a",
        timestamp: new Date().toISOString(),
      }));
    } catch (err) {
      console.error("[useRetrieve] Refinement error:", err);
      // On error, fall back to base results
      if (baseResult) setResult(baseResult);
      setActiveRefinementMode("none");
      setRefinementViewState("original");
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
    setRefinementViewState("original");
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
    refinementViewState,
  };
}
