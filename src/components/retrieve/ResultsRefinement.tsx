/**
 * ResultsRefinement — Post-results feedback and refinement module for Retrieve.
 *
 * Provides:
 * 1. "Is this what you were looking for?" confirmation prompt
 * 2. Deterministic refinement chips that locally re-rank/filter results (no AI call)
 * 3. Analytics logging for user refinement actions
 */

import { useState, useCallback, useMemo } from "react";
import { Check, SlidersHorizontal, RotateCcw, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { EvidenceItem, RefinementHints } from "@/hooks/useRetrieve";
import { supabase } from "@/integrations/supabase/client";

/* ── Refinement modes ── */

export type RefinementMode =
  | "none"
  | "confirmed"
  | "main_rule"
  | "direct_matches"
  | "broader_related"
  | "exceptions"
  | "procedural"
  | "notices_deadlines"
  | "eligibility"
  | "strong_only";

interface RefinementChip {
  mode: RefinementMode;
  label: string;
  description: string;
  conditional?: boolean; // only show if hints support it
}

const CORE_CHIPS: RefinementChip[] = [
  {
    mode: "main_rule",
    label: "Show the main rule",
    description: "Prioritize clean governing provisions",
  },
  {
    mode: "direct_matches",
    label: "Most direct matches",
    description: "Surface the most directly relevant results",
  },
  {
    mode: "broader_related",
    label: "Broader related materials",
    description: "Keep all relevant related content visible",
  },
  {
    mode: "strong_only",
    label: "Strong evidence only",
    description: "Hide supporting materials",
  },
];

const CONDITIONAL_CHIPS: RefinementChip[] = [
  {
    mode: "procedural",
    label: "Procedural details",
    description: "Focus on procedural requirements and steps",
    conditional: true,
  },
  {
    mode: "exceptions",
    label: "Exceptions & waivers",
    description: "Surface exceptions and waiver provisions",
    conditional: true,
  },
  {
    mode: "notices_deadlines",
    label: "Notices & deadlines",
    description: "Focus on notice requirements and time limits",
    conditional: true,
  },
  {
    mode: "eligibility",
    label: "Eligibility & requirements",
    description: "Focus on eligibility criteria and qualifications",
    conditional: true,
  },
];

/* ── Local re-ranking logic ── */

function localRerankScore(item: EvidenceItem, mode: RefinementMode): number {
  // Base composite score
  let score = item.composite_score;

  switch (mode) {
    case "main_rule":
      // Boost clean governing provisions
      if (item.primary_boost) score += 0.25;
      score += item.directness_score * 0.20;
      score += item.concept_anchor_score * 0.15;
      // Penalize collateral-heavy items
      score -= item.collateral_labels.length * 0.12;
      if (item.bucket === "strong_evidence") score += 0.10;
      break;

    case "direct_matches":
      // Boost directness and section match
      score += item.directness_score * 0.30;
      score += item.section_match_score * 0.15;
      score += item.concept_anchor_score * 0.15;
      score += item.exact_phrase_score * 0.10;
      // Penalize lexical-only low-sim
      if (item.recall_origin === "lexical" && item.similarity < 0.25) score -= 0.15;
      break;

    case "broader_related":
      // Keep original ranking mostly intact, slight supporting boost
      if (item.bucket === "supporting_material") score += 0.05;
      break;

    case "procedural":
      // (Re-rank based on the item's content signals — done via excerpt keyword check below)
      score += item.directness_score * 0.10;
      break;

    case "exceptions":
      score += item.directness_score * 0.10;
      break;

    case "notices_deadlines":
      score += item.directness_score * 0.10;
      break;

    case "eligibility":
      score += item.directness_score * 0.10;
      break;

    default:
      break;
  }

  return score;
}

/** Content-signal boost for conditional modes */
const CONTENT_KEYWORDS: Record<string, string[]> = {
  procedural: ["hearing", "appeal", "file", "submit", "respond", "appear", "motion", "petition", "proceedings"],
  exceptions: ["exception", "waiver", "exempt", "unless", "notwithstanding", "provided that"],
  notices_deadlines: ["notice", "deadline", "within", "days", "calendar days", "must file", "time limit"],
  eligibility: ["eligib", "qualifying", "requirements", "criteria", "entitled", "may apply"],
};

function contentSignalBoost(item: EvidenceItem, mode: RefinementMode): number {
  const keywords = CONTENT_KEYWORDS[mode];
  if (!keywords) return 0;
  const text = (item.excerpt_text + " " + item.expandable_context).toLowerCase();
  const hits = keywords.filter(k => text.includes(k)).length;
  return hits * 0.06;
}

/* ── Apply refinement ── */

export function applyRefinement(
  strongEvidence: EvidenceItem[],
  supportingMaterials: EvidenceItem[],
  mode: RefinementMode,
): { strong: EvidenceItem[]; supporting: EvidenceItem[] } {
  if (mode === "none" || mode === "confirmed") {
    return { strong: strongEvidence, supporting: supportingMaterials };
  }

  if (mode === "strong_only") {
    // Simple filter: show backend strong evidence only, preserve order
    return { strong: [...strongEvidence], supporting: [] };
  }

  // Re-rank within each bucket independently — never cross-promote
  const sortByRefined = (items: EvidenceItem[]) =>
    [...items]
      .map(item => ({ item, score: localRerankScore(item, mode) + contentSignalBoost(item, mode) }))
      .sort((a, b) => b.score - a.score)
      .map(a => a.item);

  const strong = sortByRefined(strongEvidence);

  // For supporting, optionally filter out weak items in focused modes
  let supporting = sortByRefined(supportingMaterials);
  if (mode === "main_rule" || mode === "direct_matches") {
    // In focused modes, suppress the weakest supporting items
    supporting = supporting.filter(item => {
      const score = localRerankScore(item, mode) + contentSignalBoost(item, mode);
      return score >= item.composite_score * 0.85; // only keep items that didn't lose value under this lens
    });
  }

  return { strong, supporting };
}

/* ── Analytics helper ── */

function logRefinementEvent(
  action: string,
  query: string,
  mode: RefinementMode | null,
  strongCount: number,
  supportingCount: number,
) {
  try {
    supabase.functions.invoke("records-room", {
      // We don't actually call the edge function — just log locally for now
    }).catch(() => {});
    // Log via eye_events pattern — but since we don't have a direct insert path from frontend,
    // we'll use console for now and this can be wired to a logging endpoint later
    console.log("[retrieve-refinement]", JSON.stringify({
      action,
      query: query.slice(0, 200),
      mode,
      strong_count: strongCount,
      supporting_count: supportingCount,
      timestamp: new Date().toISOString(),
    }));
  } catch { /* non-critical */ }
}

/* ── Component ── */

interface ResultsRefinementProps {
  query: string;
  strongEvidence: EvidenceItem[];
  supportingMaterials: EvidenceItem[];
  hints: RefinementHints | null;
  activeMode: RefinementMode;
  onModeChange: (mode: RefinementMode) => void;
}

export function ResultsRefinement({
  query,
  strongEvidence,
  supportingMaterials,
  hints,
  activeMode,
  onModeChange,
}: ResultsRefinementProps) {
  const [dismissed, setDismissed] = useState(false);
  const [showChips, setShowChips] = useState(false);

  const totalResults = strongEvidence.length + supportingMaterials.length;

  // Build available chips based on hints
  const availableChips = useMemo(() => {
    const chips = [...CORE_CHIPS];

    // Only show strong_only if there are actually strong results
    if (strongEvidence.length === 0) {
      const idx = chips.findIndex(c => c.mode === "strong_only");
      if (idx >= 0) chips.splice(idx, 1);
    }

    // Add conditional chips based on hints
    if (hints?.has_procedural_content) {
      chips.push(CONDITIONAL_CHIPS.find(c => c.mode === "procedural")!);
    }
    if (hints?.has_exception_content) {
      chips.push(CONDITIONAL_CHIPS.find(c => c.mode === "exceptions")!);
    }
    if (hints?.has_notice_deadline_content) {
      chips.push(CONDITIONAL_CHIPS.find(c => c.mode === "notices_deadlines")!);
    }
    if (hints?.has_eligibility_content) {
      chips.push(CONDITIONAL_CHIPS.find(c => c.mode === "eligibility")!);
    }

    return chips;
  }, [hints, strongEvidence.length]);

  const handleConfirm = useCallback(() => {
    setDismissed(true);
    onModeChange("confirmed");
    logRefinementEvent("confirmed", query, "confirmed", strongEvidence.length, supportingMaterials.length);
  }, [query, strongEvidence.length, supportingMaterials.length, onModeChange]);

  const handleNotExactly = useCallback(() => {
    setShowChips(true);
    logRefinementEvent("opened_refinement", query, null, strongEvidence.length, supportingMaterials.length);
  }, [query, strongEvidence.length, supportingMaterials.length]);

  const handleChipClick = useCallback((mode: RefinementMode) => {
    onModeChange(mode);
    logRefinementEvent("refined", query, mode, strongEvidence.length, supportingMaterials.length);
  }, [query, strongEvidence.length, supportingMaterials.length, onModeChange]);

  const handleReset = useCallback(() => {
    onModeChange("none");
    setShowChips(false);
    setDismissed(false);
    logRefinementEvent("reset", query, "none", strongEvidence.length, supportingMaterials.length);
  }, [query, strongEvidence.length, supportingMaterials.length, onModeChange]);

  const handleReopenRefinement = useCallback(() => {
    setDismissed(false);
    setShowChips(true);
    onModeChange("none");
  }, [onModeChange]);

  if (totalResults === 0) return null;

  // ── Dismissed / confirmed state ──
  if (dismissed && activeMode === "confirmed") {
    return (
      <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 px-4 py-2.5 mb-6">
        <div className="flex items-center gap-2">
          <Check className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Using current results</span>
        </div>
        <button
          onClick={handleReopenRefinement}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
        >
          Refine results
        </button>
      </div>
    );
  }

  // ── Active refinement mode indicator ──
  if (activeMode !== "none" && activeMode !== "confirmed") {
    const activeChip = [...CORE_CHIPS, ...CONDITIONAL_CHIPS].find(c => c.mode === activeMode);
    return (
      <div className="rounded-lg border border-border bg-card px-5 py-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              Showing: <span className="font-medium text-foreground">{activeChip?.label ?? activeMode}</span>
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            className="h-7 text-xs text-muted-foreground gap-1.5"
          >
            <RotateCcw className="h-3 w-3" />
            Show all results
          </Button>
        </div>
        {/* Chip row for switching */}
        <div className="flex flex-wrap gap-2">
          {availableChips.map(chip => (
            <button
              key={chip.mode}
              onClick={() => handleChipClick(chip.mode)}
              className={`inline-flex items-center rounded-md border px-3 py-1.5 text-xs transition-colors ${
                chip.mode === activeMode
                  ? "border-primary/30 bg-primary/10 text-primary font-medium"
                  : "border-border bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
              title={chip.description}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Initial question state ──
  return (
    <div className="rounded-lg border border-border bg-card px-5 py-4 mb-6">
      {!showChips ? (
        <>
          <p className="text-sm font-medium text-foreground mb-1">
            Is this what you were looking for?
          </p>
          <p className="text-xs text-muted-foreground mb-3">
            You can keep these results, or narrow them without running a new search.
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleConfirm}
              className="text-xs gap-1.5"
            >
              <Check className="h-3 w-3" />
              Yes, this looks right
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleNotExactly}
              className="text-xs text-muted-foreground gap-1.5"
            >
              <SlidersHorizontal className="h-3 w-3" />
              Not exactly — narrow it down
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-medium text-foreground mb-0.5">
                Refine these results
              </p>
              <p className="text-xs text-muted-foreground">
                Choose what you meant most — results update instantly.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleConfirm}
              className="h-7 text-xs text-muted-foreground"
            >
              Keep as-is
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {availableChips.map(chip => (
              <button
                key={chip.mode}
                onClick={() => handleChipClick(chip.mode)}
                className="inline-flex items-center rounded-md border border-border bg-secondary/50 px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                title={chip.description}
              >
                {chip.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
