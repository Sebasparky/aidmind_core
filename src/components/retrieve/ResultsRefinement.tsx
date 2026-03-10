/**
 * ResultsRefinement — Post-results feedback and refinement controller.
 *
 * UI state is owned by the parent (Retrieve page) so it persists across
 * chip switches and only resets on a brand-new search.
 */

import { useCallback, useMemo } from "react";
import { Check, SlidersHorizontal, RotateCcw, Loader2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EvidenceItem, RefinementHints, RefinementMode } from "@/hooks/useRetrieve";

/* ── Public UI-state type ── */

export type RefinementUIState =
  | "initial_prompt"   // first-time question after a fresh search
  | "confirmed"        // user said "Yes, this looks right"
  | "chips_open"       // user opened refinement but hasn't picked yet
  | "refined_active";  // a refinement mode is active

/* ── Chip definitions ── */

interface RefinementChip {
  mode: RefinementMode;
  label: string;
  description: string;
}

const CORE_CHIPS: RefinementChip[] = [
  { mode: "main_rule", label: "Show the main rule", description: "Prioritize clean governing provisions" },
  { mode: "direct_matches", label: "Most direct matches", description: "Surface the most directly relevant results" },
  { mode: "broader_related", label: "Broader related materials", description: "Keep all relevant related content visible" },
  { mode: "strong_only", label: "Strong evidence only", description: "Hide supporting materials" },
];

const CONDITIONAL_CHIPS: RefinementChip[] = [
  { mode: "procedural", label: "Procedural details", description: "Focus on procedural requirements and steps" },
  { mode: "exceptions", label: "Exceptions & waivers", description: "Surface exceptions and waiver provisions" },
  { mode: "notices_deadlines", label: "Notices & deadlines", description: "Focus on notice requirements and time limits" },
  { mode: "eligibility", label: "Eligibility & requirements", description: "Focus on eligibility criteria and qualifications" },
];

const REFINEMENT_LABELS: Record<string, string> = {
  main_rule: "Main rule",
  direct_matches: "Most direct matches",
  broader_related: "Broader related materials",
  strong_only: "Strong evidence only",
  procedural: "Procedural details",
  exceptions: "Exceptions & waivers",
  notices_deadlines: "Notices & deadlines",
  eligibility: "Eligibility & requirements",
};

/* ── Props ── */

interface ResultsRefinementProps {
  query: string;
  strongEvidence: EvidenceItem[];
  supportingMaterials: EvidenceItem[];
  hints: RefinementHints | null;
  activeMode: RefinementMode;
  refining: boolean;
  uiState: RefinementUIState;
  onUIStateChange: (state: RefinementUIState) => void;
  onRefine: (mode: RefinementMode) => void;
}

/* ── Component ── */

export function ResultsRefinement({
  query,
  strongEvidence,
  supportingMaterials,
  hints,
  activeMode,
  refining,
  uiState,
  onUIStateChange,
  onRefine,
}: ResultsRefinementProps) {
  const totalResults = strongEvidence.length + supportingMaterials.length;

  const availableChips = useMemo(() => {
    const chips = [...CORE_CHIPS];
    if (strongEvidence.length === 0) {
      const idx = chips.findIndex(c => c.mode === "strong_only");
      if (idx >= 0) chips.splice(idx, 1);
    }
    if (hints?.has_procedural_content) chips.push(CONDITIONAL_CHIPS.find(c => c.mode === "procedural")!);
    if (hints?.has_exception_content) chips.push(CONDITIONAL_CHIPS.find(c => c.mode === "exceptions")!);
    if (hints?.has_notice_deadline_content) chips.push(CONDITIONAL_CHIPS.find(c => c.mode === "notices_deadlines")!);
    if (hints?.has_eligibility_content) chips.push(CONDITIONAL_CHIPS.find(c => c.mode === "eligibility")!);
    return chips;
  }, [hints, strongEvidence.length]);

  const handleConfirm = useCallback(() => {
    onUIStateChange("confirmed");
    console.log("[retrieve-refinement]", JSON.stringify({
      action: "confirmed", query: query.slice(0, 200),
      strong_count: strongEvidence.length, supporting_count: supportingMaterials.length,
      timestamp: new Date().toISOString(),
    }));
  }, [query, strongEvidence.length, supportingMaterials.length, onUIStateChange]);

  const handleNotExactly = useCallback(() => {
    onUIStateChange("chips_open");
    console.log("[retrieve-refinement]", JSON.stringify({
      action: "opened_refinement", query: query.slice(0, 200),
      timestamp: new Date().toISOString(),
    }));
  }, [query, onUIStateChange]);

  const handleChipClick = useCallback((mode: RefinementMode) => {
    onUIStateChange("refined_active");
    onRefine(mode);
    console.log("[retrieve-refinement]", JSON.stringify({
      action: "refined", query: query.slice(0, 200), mode,
      timestamp: new Date().toISOString(),
    }));
  }, [query, onRefine, onUIStateChange]);

  const handleBackToOriginal = useCallback(() => {
    onRefine("none");
    onUIStateChange("chips_open"); // stay in refinement controller, don't reset to initial prompt
    console.log("[retrieve-refinement]", JSON.stringify({
      action: "back_to_original", query: query.slice(0, 200),
      timestamp: new Date().toISOString(),
    }));
  }, [query, onRefine, onUIStateChange]);

  if (totalResults === 0) return null;

  /* ── Confirmed state ── */
  if (uiState === "confirmed") {
    return (
      <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 px-4 py-2.5 mb-6">
        <div className="flex items-center gap-2">
          <Check className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Using original results</span>
        </div>
        <button
          onClick={handleNotExactly}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
        >
          Refine results
        </button>
      </div>
    );
  }

  /* ── Refined active state or chips_open with active mode ── */
  if (uiState === "refined_active" || (uiState === "chips_open" && activeMode !== "none")) {
    const isRefined = activeMode !== "none";
    const activeLabel = REFINEMENT_LABELS[activeMode] ?? activeMode;

    return (
      <div className="rounded-lg border border-border bg-card px-5 py-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {refining ? (
              <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />
            ) : (
              <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span className="text-xs text-muted-foreground">
              {refining ? (
                <>Narrowing results…</>
              ) : isRefined ? (
                <>Viewing: <span className="font-medium text-foreground">{activeLabel}</span></>
              ) : (
                <>Viewing: <span className="font-medium text-foreground">Original results</span></>
              )}
            </span>
          </div>
          {isRefined && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBackToOriginal}
              className="h-7 text-xs text-muted-foreground gap-1.5"
              disabled={refining}
            >
              <ArrowLeft className="h-3 w-3" />
              Back to original results
            </Button>
          )}
        </div>
        {/* Chip row */}
        <div className="flex flex-wrap gap-2">
          {availableChips.map(chip => (
            <button
              key={chip.mode}
              onClick={() => handleChipClick(chip.mode)}
              disabled={refining}
              className={`inline-flex items-center rounded-md border px-3 py-1.5 text-xs transition-colors ${
                chip.mode === activeMode
                  ? "border-primary/30 bg-primary/10 text-primary font-medium"
                  : "border-border bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground"
              } ${refining ? "opacity-50 cursor-not-allowed" : ""}`}
              title={chip.description}
            >
              {chip.mode === activeMode && refining && (
                <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
              )}
              {chip.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  /* ── Chips open (no active mode yet) ── */
  if (uiState === "chips_open") {
    return (
      <div className="rounded-lg border border-border bg-card px-5 py-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-medium text-foreground mb-0.5">Narrow these results</p>
            <p className="text-xs text-muted-foreground">
              Each option re-searches with a focused lens — no new AI call.
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
              disabled={refining}
              className={`inline-flex items-center rounded-md border border-border bg-secondary/50 px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors ${
                refining ? "opacity-50 cursor-not-allowed" : ""
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

  /* ── Initial prompt state ── */
  return (
    <div className="rounded-lg border border-border bg-card px-5 py-4 mb-6">
      <p className="text-sm font-medium text-foreground mb-1">
        Is this what you were looking for?
      </p>
      <p className="text-xs text-muted-foreground mb-3">
        You can keep these results, or narrow them using a different lens.
      </p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={handleConfirm} className="text-xs gap-1.5">
          <Check className="h-3 w-3" />
          Yes, this looks right
        </Button>
        <Button variant="ghost" size="sm" onClick={handleNotExactly} className="text-xs text-muted-foreground gap-1.5">
          <SlidersHorizontal className="h-3 w-3" />
          Not exactly — narrow it down
        </Button>
      </div>
    </div>
  );
}
