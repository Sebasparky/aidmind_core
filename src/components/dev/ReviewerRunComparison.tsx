/**
 * ReviewerRunComparison — Dev-only panel for comparing two Reviewer runs
 * 
 * Displays stage-by-stage hash comparison to pinpoint exactly where
 * divergence between runs begins.
 * 
 * SECURITY: Only shows hashes, counts, and metadata. No text content.
 * Gated by import.meta.env.DEV.
 */

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, GitCompare, Check, X, AlertTriangle, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Mirror the diagnostics type from the edge function
export interface ReviewerStageSnapshot {
  stage: string;
  hash: string;
  counts?: Record<string, number>;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface ReviewerRunDiagnostics {
  run_id: string;
  pipeline_version: string;
  timestamps: Record<string, number>;
  stages: ReviewerStageSnapshot[];
  input_fingerprint: {
    document_text_length: number;
    document_text_hash: string;
    review_worthy_count: number;
    review_worthy_field_keys: string[];
    structured_answer_count: number;
    unanswered_field_count: number;
    unanswered_field_keys: string[];
    has_reconciliation: boolean;
    reconciliation_match_count: number | null;
    reconciliation_discrepancy_count: number | null;
    has_trigger_metadata: boolean;
    trigger_categories: string[];
    template_id: string | null;
    session_id: string;
  };
  llm_config: {
    provider: string;
    model: string;
    temperature: number;
    uses_json_mode: boolean;
    gateway: boolean;
  };
  output_fingerprint: {
    raw_candidate_count: number;
    prefiltered_count: number;
    dce_input_count: number;
    dce_output_count: number;
    final_primary_count: number;
    final_secondary_count: number;
    final_risk: string;
    final_confidence: string;
    final_coverage: string;
    final_issues_hash: string;
  };
}

const STAGE_LABELS: Record<string, string> = {
  input_validated: "1. Input Validated",
  prompt_assembled: "2. Prompt Assembled",
  llm_response_parsed: "3. LLM Response Parsed",
  prefiltered: "4. Pre-filtered",
  dce_completed: "5. DCE Completed",
  final_emission: "6. Final Emission",
};

function StageComparison({
  stageName,
  runA,
  runB,
}: {
  stageName: string;
  runA?: ReviewerStageSnapshot;
  runB?: ReviewerStageSnapshot;
}) {
  const label = STAGE_LABELS[stageName] || stageName;
  const hashMatch = runA && runB && runA.hash === runB.hash;
  const hasBoth = !!runA && !!runB;

  return (
    <div className="flex items-start gap-3 py-2">
      <div className="mt-0.5 shrink-0">
        {!hasBoth ? (
          <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground/40" />
        ) : hashMatch ? (
          <Check className="h-3.5 w-3.5 text-[hsl(var(--status-success))]" />
        ) : (
          <X className="h-3.5 w-3.5 text-[hsl(var(--status-danger))]" />
        )}
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-foreground">{label}</span>
          {hasBoth && (
            <Badge
              variant={hashMatch ? "secondary" : "destructive"}
              className="text-[9px] px-1.5"
            >
              {hashMatch ? "MATCH" : "DIVERGED"}
            </Badge>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="text-[10px] font-mono text-muted-foreground truncate">
            A: {runA?.hash || "—"}
          </div>
          <div className="text-[10px] font-mono text-muted-foreground truncate">
            B: {runB?.hash || "—"}
          </div>
        </div>
        {runA?.counts && runB?.counts && (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            {Object.keys({ ...runA.counts, ...runB.counts }).map((key) => {
              const a = runA.counts?.[key];
              const b = runB.counts?.[key];
              const match = a === b;
              return (
                <span key={key} className={cn("text-[9px]", match ? "text-muted-foreground" : "text-[hsl(var(--status-danger))]")}>
                  {key}: {a ?? "—"}{!match ? ` → ${b ?? "—"}` : ""}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function DiagnosticsSummary({ diag, label }: { diag: ReviewerRunDiagnostics; label: string }) {
  const totalMs = (diag.timestamps.final_emission ?? 0) - (diag.timestamps.start ?? 0);

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
        {label} — Run {diag.run_id}
      </p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] text-muted-foreground">
        <span>Provider: <span className="text-foreground">{diag.llm_config.provider}</span></span>
        <span>Model: <span className="text-foreground">{diag.llm_config.model}</span></span>
        <span>Temp: <span className="text-foreground">{diag.llm_config.temperature}</span></span>
        <span>JSON mode: <span className="text-foreground">{diag.llm_config.uses_json_mode ? "yes" : "no"}</span></span>
        <span>Duration: <span className="text-foreground">{totalMs}ms</span></span>
        <span>Pipeline: <span className="text-foreground">v{diag.pipeline_version}</span></span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] text-muted-foreground">
        <span>Doc hash: <span className="font-mono text-foreground">{diag.input_fingerprint.document_text_hash}</span></span>
        <span>Issues hash: <span className="font-mono text-foreground">{diag.output_fingerprint.final_issues_hash}</span></span>
        <span>Raw candidates: <span className="text-foreground">{diag.output_fingerprint.raw_candidate_count}</span></span>
        <span>Final issues: <span className="text-foreground">{diag.output_fingerprint.final_primary_count}P + {diag.output_fingerprint.final_secondary_count}S</span></span>
        <span>Risk: <span className="text-foreground capitalize">{diag.output_fingerprint.final_risk}</span></span>
        <span>Confidence: <span className="text-foreground capitalize">{diag.output_fingerprint.final_confidence}</span></span>
      </div>
    </div>
  );
}

export function ReviewerRunComparison() {
  const [runs, setRuns] = useState<ReviewerRunDiagnostics[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  if (!import.meta.env.DEV) return null;

  // Expose global setter for the Reviewer page to push diagnostics
  if (typeof window !== "undefined") {
    (window as any).__aidmind_push_reviewer_diagnostics = (diag: ReviewerRunDiagnostics) => {
      setRuns((prev) => {
        const next = [...prev, diag];
        // Keep last 5 runs
        return next.slice(-5);
      });
    };
  }

  const hasComparison = runs.length >= 2;
  const runA = hasComparison ? runs[runs.length - 2] : null;
  const runB = hasComparison ? runs[runs.length - 1] : null;

  // Identify first divergence point
  let firstDivergence: string | null = null;
  if (runA && runB) {
    const allStages = ["input_validated", "prompt_assembled", "llm_response_parsed", "prefiltered", "dce_completed", "final_emission"];
    for (const stage of allStages) {
      const a = runA.stages.find(s => s.stage === stage);
      const b = runB.stages.find(s => s.stage === stage);
      if (a && b && a.hash !== b.hash) {
        firstDivergence = stage;
        break;
      }
    }
  }

  // Input identity check
  const sameInput = runA && runB &&
    runA.input_fingerprint.document_text_hash === runB.input_fingerprint.document_text_hash;

  return (
    <Card className="border-dashed border-[hsl(var(--status-warning))]/30 bg-card/50">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="py-3 px-4">
          <CollapsibleTrigger className="flex items-center gap-2 w-full">
            <GitCompare className="h-4 w-4 text-[hsl(var(--status-warning))]" />
            <CardTitle className="text-xs font-semibold">
              Run Comparison ({runs.length} runs captured)
            </CardTitle>
            {hasComparison && (
              <Badge
                variant={firstDivergence ? "destructive" : "secondary"}
                className="text-[9px] ml-auto mr-2"
              >
                {firstDivergence
                  ? `Diverged at: ${STAGE_LABELS[firstDivergence] || firstDivergence}`
                  : "Identical outputs"}
              </Badge>
            )}
            <ChevronDown className={cn("h-3 w-3 transition-transform", isOpen && "rotate-180")} />
          </CollapsibleTrigger>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="px-4 pb-4 space-y-4">
            {runs.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Run Reviewer at least once to capture diagnostics. Run twice on the same document to compare.
              </p>
            )}

            {runs.length === 1 && (
              <>
                <DiagnosticsSummary diag={runs[0]} label="Run 1" />
                <p className="text-xs text-muted-foreground">
                  Run Reviewer again on the same document to compare outputs.
                </p>
              </>
            )}

            {hasComparison && runA && runB && (
              <>
                {/* Input identity */}
                <div className="flex items-center gap-2 p-2 rounded-md bg-muted/30">
                  {sameInput ? (
                    <Check className="h-3.5 w-3.5 text-[hsl(var(--status-success))]" />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5 text-[hsl(var(--status-danger))]" />
                  )}
                  <span className="text-xs font-medium">
                    {sameInput
                      ? "Same normalized document input (hashes match)"
                      : "DIFFERENT document input — runs are not comparable"}
                  </span>
                </div>

                {/* Diagnosis */}
                {sameInput && firstDivergence && (
                  <div className="p-3 rounded-md border border-[hsl(var(--status-danger))]/20 bg-[hsl(var(--status-danger-muted))]/20 space-y-1.5">
                    <p className="text-xs font-semibold text-foreground">
                      🔍 Divergence Analysis
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {firstDivergence === "input_validated" && "Input hashes differ despite same document — check field recovery, reconciliation, or trigger scanner."}
                      {firstDivergence === "prompt_assembled" && "Prompt assembly produced different text — check language trigger metadata, reconciliation context, or field ordering."}
                      {firstDivergence === "llm_response_parsed" && "LLM returned different candidates for the same prompt. The model's response varied between calls despite temperature=0. This may indicate provider-side nondeterminism."}
                      {firstDivergence === "prefiltered" && "Pre-filtering produced different results despite same LLM output — check blocked field logic."}
                      {firstDivergence === "dce_completed" && "DCE produced different results from same input candidates — this would be a classifier bug."}
                      {firstDivergence === "final_emission" && "Final emission diverged despite DCE match — check risk/confidence/coverage recalculation."}
                    </p>
                    {firstDivergence === "llm_response_parsed" && (
                      <p className="text-[10px] text-muted-foreground/70">
                        Raw candidates: {runA.output_fingerprint.raw_candidate_count} → {runB.output_fingerprint.raw_candidate_count} | 
                        Final: {runA.output_fingerprint.final_primary_count}P+{runA.output_fingerprint.final_secondary_count}S → {runB.output_fingerprint.final_primary_count}P+{runB.output_fingerprint.final_secondary_count}S
                      </p>
                    )}
                  </div>
                )}

                {sameInput && !firstDivergence && (
                  <div className="p-3 rounded-md border border-[hsl(var(--status-success))]/20 bg-[hsl(var(--status-success-muted))]/20">
                    <p className="text-xs font-medium text-foreground">
                      ✅ Fully deterministic — all stages produced identical hashes
                    </p>
                  </div>
                )}

                <Separator />

                {/* Side-by-side summaries */}
                <div className="grid grid-cols-2 gap-4">
                  <DiagnosticsSummary diag={runA} label="Run A (previous)" />
                  <DiagnosticsSummary diag={runB} label="Run B (latest)" />
                </div>

                <Separator />

                {/* Stage-by-stage comparison */}
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Stage-by-Stage Hash Comparison
                  </p>
                  {["input_validated", "prompt_assembled", "llm_response_parsed", "prefiltered", "dce_completed", "final_emission"].map((stage) => (
                    <StageComparison
                      key={stage}
                      stageName={stage}
                      runA={runA.stages.find(s => s.stage === stage)}
                      runB={runB.stages.find(s => s.stage === stage)}
                    />
                  ))}
                </div>
              </>
            )}

            {runs.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-[10px] text-muted-foreground gap-1"
                onClick={() => setRuns([])}
              >
                <Trash2 className="h-3 w-3" /> Clear run history
              </Button>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
