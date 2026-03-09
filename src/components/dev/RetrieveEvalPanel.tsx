/**
 * RetrieveEvalPanel — Dev-only evaluation harness for Records Room ranking.
 * 
 * Shows test queries, runs them, displays per-candidate scoring diagnostics,
 * and allows manual quality judgments.
 * 
 * Gated by VITE_DEV_MODE.
 */

import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EVAL_QUERIES, type EvalQuery, type EvalJudgment, createEmptyJudgment } from "./RetrieveEvalFixtures";
import { Play, CheckCircle, XCircle, MinusCircle, ChevronDown, ChevronUp, Loader2, Download, Trash2 } from "lucide-react";

const IS_DEV = import.meta.env.VITE_DEV_MODE === "true";

interface CandidateDiag {
  rank: number;
  bucket: string;
  admission_reason: string;
  primary_boost: boolean;
  collateral_labels: string[];
  chunk_id: string;
  chunk_index: number;
  document_id: string;
  similarity: number;
  lexical_score: number;
  section_match_score: number;
  exact_phrase_score: number;
  directness_score: number;
  concept_anchor_score: number;
  authority_score: number;
  metadata_match: number;
  composite_score: number;
  recall_origin: string;
}

interface QueryResult {
  query: EvalQuery;
  response: Record<string, unknown> | null;
  error: string | null;
  duration_ms: number;
  judgment: EvalJudgment;
}

function ScoreCell({ value, label }: { value: number; label: string }) {
  const color = value >= 0.6 ? "text-green-600" : value >= 0.3 ? "text-yellow-600" : "text-red-500";
  return (
    <td className="px-1.5 py-1 text-xs font-mono text-center" title={label}>
      <span className={color}>{value.toFixed(3)}</span>
    </td>
  );
}

function CandidateTable({ candidates }: { candidates: CandidateDiag[] }) {
  if (!candidates?.length) return <p className="text-xs text-muted-foreground">No candidates in diagnostics</p>;

  return (
    <div className="overflow-x-auto">
      <table className="text-xs w-full border-collapse">
        <thead>
          <tr className="border-b border-border">
            <th className="px-1.5 py-1 text-left">#</th>
            <th className="px-1.5 py-1 text-left">Bucket</th>
            <th className="px-1.5 py-1 text-center">Comp</th>
            <th className="px-1.5 py-1 text-center">Sem</th>
            <th className="px-1.5 py-1 text-center">Lex</th>
            <th className="px-1.5 py-1 text-center">Sec</th>
            <th className="px-1.5 py-1 text-center">Phr</th>
            <th className="px-1.5 py-1 text-center">Dir</th>
            <th className="px-1.5 py-1 text-center">Anc</th>
            <th className="px-1.5 py-1 text-center">Auth</th>
            <th className="px-1.5 py-1 text-center">Meta</th>
            <th className="px-1.5 py-1 text-left">Prim</th>
            <th className="px-1.5 py-1 text-left">Collateral</th>
            <th className="px-1.5 py-1 text-left">Reason</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((c) => (
            <tr key={c.chunk_id} className="border-b border-border/50 hover:bg-muted/30">
              <td className="px-1.5 py-1 font-mono">{c.rank}</td>
              <td className="px-1.5 py-1">
                <Badge variant={c.bucket === "strong_evidence" ? "default" : "secondary"} className="text-[10px] px-1">
                  {c.bucket === "strong_evidence" ? "strong" : "support"}
                </Badge>
              </td>
              <ScoreCell value={c.composite_score} label="composite" />
              <ScoreCell value={c.similarity} label="semantic" />
              <ScoreCell value={c.lexical_score} label="lexical" />
              <ScoreCell value={c.section_match_score} label="section" />
              <ScoreCell value={c.exact_phrase_score} label="phrase" />
              <ScoreCell value={c.directness_score} label="directness" />
              <ScoreCell value={c.concept_anchor_score} label="anchor" />
              <ScoreCell value={c.authority_score} label="authority" />
              <ScoreCell value={c.metadata_match} label="metadata" />
              <td className="px-1.5 py-1 text-center">
                {c.primary_boost ? "✓" : "—"}
              </td>
              <td className="px-1.5 py-1 text-xs max-w-[120px] truncate" title={c.collateral_labels?.join(", ")}>
                {c.collateral_labels?.length ? c.collateral_labels.join(", ") : "—"}
              </td>
              <td className="px-1.5 py-1 text-xs max-w-[200px] truncate font-mono" title={c.admission_reason}>
                {c.admission_reason}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TriStateButton({ value, onChange, labelTrue, labelFalse }: {
  value: boolean | null;
  onChange: (v: boolean | null) => void;
  labelTrue: string;
  labelFalse: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => onChange(value === true ? null : true)}
        className={`p-0.5 rounded ${value === true ? "text-green-600 bg-green-50" : "text-muted-foreground"}`}
        title={labelTrue}
      >
        <CheckCircle className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => onChange(value === false ? null : false)}
        className={`p-0.5 rounded ${value === false ? "text-red-500 bg-red-50" : "text-muted-foreground"}`}
        title={labelFalse}
      >
        <XCircle className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function QueryResultCard({ result, onJudgmentChange }: {
  result: QueryResult;
  onJudgmentChange: (j: EvalJudgment) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const diag = result.response?.diagnostics as Record<string, unknown> | undefined;
  const candidates = (diag?.top_candidates ?? []) as CandidateDiag[];
  const strongCount = (result.response?.strong_evidence as unknown[])?.length ?? 0;
  const supportCount = (result.response?.supporting_materials as unknown[])?.length ?? 0;
  const j = result.judgment;

  const updateJ = (patch: Partial<EvalJudgment>) => {
    onJudgmentChange({ ...j, ...patch });
  };

  return (
    <div className="border border-border rounded-lg bg-card">
      <div className="px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px]">{result.query.category}</Badge>
            <span className="text-sm font-medium truncate">{result.query.label}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{result.query.query}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {result.error ? (
            <Badge variant="destructive" className="text-[10px]">error</Badge>
          ) : (
            <>
              <Badge variant="default" className="text-[10px]">{strongCount}S</Badge>
              <Badge variant="secondary" className="text-[10px]">{supportCount}M</Badge>
              <span className="text-[10px] text-muted-foreground font-mono">{result.duration_ms}ms</span>
            </>
          )}
          <button onClick={() => setExpanded(!expanded)} className="p-1">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
          {result.error ? (
            <p className="text-xs text-destructive">{result.error}</p>
          ) : (
            <>
              <CandidateTable candidates={candidates} />

              {/* Judgment controls */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span>Top-1 correct?</span>
                  <TriStateButton value={j.top1_correct} onChange={(v) => updateJ({ top1_correct: v })} labelTrue="Yes" labelFalse="No" />
                </div>
                <div className="flex items-center justify-between">
                  <span>Top-3 mostly correct?</span>
                  <TriStateButton value={j.top3_mostly_correct} onChange={(v) => updateJ({ top3_mostly_correct: v })} labelTrue="Yes" labelFalse="No" />
                </div>
                <div className="flex items-center justify-between">
                  <span>Collateral outranked primary?</span>
                  <TriStateButton value={j.collateral_outranked_primary} onChange={(v) => updateJ({ collateral_outranked_primary: v })} labelTrue="Yes (bad)" labelFalse="No (good)" />
                </div>
                <div className="flex items-center justify-between">
                  <span>Strong/supporting split correct?</span>
                  <TriStateButton value={j.strong_supporting_split_correct} onChange={(v) => updateJ({ strong_supporting_split_correct: v })} labelTrue="Yes" labelFalse="No" />
                </div>
                <div className="flex items-center justify-between">
                  <span>Over-demoted relevant chunk?</span>
                  <TriStateButton value={j.over_demoted} onChange={(v) => updateJ({ over_demoted: v })} labelTrue="Yes (bad)" labelFalse="No (good)" />
                </div>
              </div>

              <textarea
                className="w-full text-xs border border-border rounded px-2 py-1.5 bg-background resize-none"
                rows={2}
                placeholder="Notes..."
                value={j.notes}
                onChange={(e) => updateJ({ notes: e.target.value })}
              />

              <p className="text-[10px] text-muted-foreground">
                Expected: {result.query.expected_signal}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function RetrieveEvalPanel() {
  if (!IS_DEV) return null;

  const { tenant } = useTenant();
  const [results, setResults] = useState<QueryResult[]>([]);
  const [running, setRunning] = useState(false);
  const [runningIdx, setRunningIdx] = useState(-1);

  const runSingle = useCallback(async (eq: EvalQuery): Promise<QueryResult> => {
    const start = Date.now();
    try {
      const { data, error } = await supabase.functions.invoke("records-room", {
        body: { query: eq.query, tenant_id: tenant?.tenantId },
      });
      if (error) throw new Error(error.message);
      return {
        query: eq,
        response: data as Record<string, unknown>,
        error: null,
        duration_ms: Date.now() - start,
        judgment: createEmptyJudgment(eq.id),
      };
    } catch (err) {
      return {
        query: eq,
        response: null,
        error: err instanceof Error ? err.message : "Unknown error",
        duration_ms: Date.now() - start,
        judgment: createEmptyJudgment(eq.id),
      };
    }
  }, [tenant?.tenantId]);

  const runAll = useCallback(async () => {
    if (!tenant?.tenantId) return;
    setRunning(true);
    setResults([]);
    const out: QueryResult[] = [];
    for (let i = 0; i < EVAL_QUERIES.length; i++) {
      setRunningIdx(i);
      const r = await runSingle(EVAL_QUERIES[i]);
      out.push(r);
      setResults([...out]);
    }
    setRunning(false);
    setRunningIdx(-1);
  }, [tenant?.tenantId, runSingle]);

  const runOne = useCallback(async (eq: EvalQuery) => {
    if (!tenant?.tenantId) return;
    setRunning(true);
    const r = await runSingle(eq);
    setResults((prev) => {
      const existing = prev.findIndex((p) => p.query.id === eq.id);
      if (existing >= 0) {
        const next = [...prev];
        next[existing] = r;
        return next;
      }
      return [...prev, r];
    });
    setRunning(false);
  }, [tenant?.tenantId, runSingle]);

  const updateJudgment = useCallback((queryId: string, j: EvalJudgment) => {
    setResults((prev) => prev.map((r) => r.query.id === queryId ? { ...r, judgment: j } : r));
  }, []);

  const exportResults = useCallback(() => {
    const summary = results.map((r) => ({
      query_id: r.query.id,
      query: r.query.query,
      category: r.query.category,
      expected: r.query.expected_signal,
      strong_count: (r.response?.strong_evidence as unknown[])?.length ?? 0,
      supporting_count: (r.response?.supporting_materials as unknown[])?.length ?? 0,
      duration_ms: r.duration_ms,
      error: r.error,
      top_candidates: ((r.response?.diagnostics as Record<string, unknown>)?.top_candidates ?? []),
      judgment: r.judgment,
    }));
    const blob = new Blob([JSON.stringify(summary, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `retrieve-eval-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [results]);

  // Summary stats
  const judged = results.filter((r) => r.judgment.top1_correct !== null);
  const top1Yes = judged.filter((r) => r.judgment.top1_correct === true).length;
  const collateralBad = judged.filter((r) => r.judgment.collateral_outranked_primary === true).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Records Room Eval Harness</h3>
          <p className="text-xs text-muted-foreground">{EVAL_QUERIES.length} test queries • v4 primary-provision ranking</p>
        </div>
        <div className="flex items-center gap-2">
          {results.length > 0 && (
            <>
              <span className="text-xs text-muted-foreground">
                {judged.length}/{results.length} judged • Top-1: {top1Yes}/{judged.length} ✓ • Collateral outrank: {collateralBad}
              </span>
              <Button size="sm" variant="outline" onClick={exportResults}>
                <Download className="w-3.5 h-3.5 mr-1" /> Export
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setResults([])}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </>
          )}
          <Button size="sm" onClick={runAll} disabled={running || !tenant?.tenantId}>
            {running ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Play className="w-3.5 h-3.5 mr-1" />}
            Run All ({EVAL_QUERIES.length})
          </Button>
        </div>
      </div>

      {running && runningIdx >= 0 && (
        <p className="text-xs text-muted-foreground">
          Running {runningIdx + 1}/{EVAL_QUERIES.length}: {EVAL_QUERIES[runningIdx]?.label}...
        </p>
      )}

      {/* Query list with run buttons when no results yet */}
      {results.length === 0 && !running && (
        <div className="space-y-1">
          {EVAL_QUERIES.map((eq) => (
            <div key={eq.id} className="flex items-center justify-between px-3 py-2 rounded border border-border/50 hover:bg-muted/30">
              <div className="flex items-center gap-2 min-w-0">
                <Badge variant="outline" className="text-[10px] flex-shrink-0">{eq.category}</Badge>
                <span className="text-xs truncate">{eq.query}</span>
              </div>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => runOne(eq)} disabled={!tenant?.tenantId}>
                <Play className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((r) => (
            <QueryResultCard
              key={r.query.id}
              result={r}
              onJudgmentChange={(j) => updateJudgment(r.query.id, j)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
