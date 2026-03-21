/**
 * ReconciliationPanel — Structured comparison view for field recovery
 * vs completed-template parse.
 *
 * SECURITY: This panel displays only field-level comparison data derived
 * from the uploaded completed template. No case-note content is shown
 * or referenced — all values come from deterministic template parsing.
 *
 * Shows matches, corrections, discrepancies, missing fields with excerpts
 * from the completed template text only.
 */

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  CheckCircle2, AlertTriangle, XCircle, ArrowRightLeft, HelpCircle,
  ChevronDown, Info, ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  ReconciliationResult,
  FieldReconciliation,
  ReconciliationResolution,
  ParseConfidence,
} from "@/lib/tools/parser-artifact-types";

// ── Resolution config ────────────────────────────────────
const RESOLUTION_CONFIG: Record<ReconciliationResolution, {
  label: string;
  singularLabel: string;
  icon: typeof CheckCircle2;
  badgeClass: string;
}> = {
  possible_discrepancy: {
    label: "Possible Discrepancies",
    singularLabel: "Discrepancy",
    icon: AlertTriangle,
    badgeClass: "text-[hsl(var(--status-warning))] border-[hsl(var(--status-warning))]/30 bg-[hsl(var(--status-warning-muted))]",
  },
  likely_omission: {
    label: "Likely Omissions",
    singularLabel: "Omission",
    icon: XCircle,
    badgeClass: "text-[hsl(var(--status-danger))] border-[hsl(var(--status-danger))]/30 bg-[hsl(var(--status-danger-muted))]",
  },
  unresolved: {
    label: "Needs Review",
    singularLabel: "Unresolved",
    icon: HelpCircle,
    badgeClass: "text-muted-foreground border-muted bg-muted/30",
  },
  likely_correction: {
    label: "Likely Corrections",
    singularLabel: "Correction",
    icon: ArrowRightLeft,
    badgeClass: "text-[hsl(var(--status-info))] border-[hsl(var(--status-info))]/30 bg-[hsl(var(--status-info-muted))]",
  },
  confirmed_match: {
    label: "Matches",
    singularLabel: "Match",
    icon: CheckCircle2,
    badgeClass: "text-[hsl(var(--status-success))] border-[hsl(var(--status-success))]/30 bg-[hsl(var(--status-success-muted))]",
  },
};

const CONFIDENCE_LABEL: Record<ParseConfidence, { text: string; className: string }> = {
  high: { text: "High", className: "text-[hsl(var(--status-success))]" },
  medium: { text: "Medium", className: "text-[hsl(var(--status-warning))]" },
  low: { text: "Low", className: "text-[hsl(var(--status-danger))]" },
};

// ── Component ────────────────────────────────────────────
interface ReconciliationPanelProps {
  result: ReconciliationResult;
  notesSource?: "case_notes" | "field_recovery";
  artifactStatus?: "loading" | "ready" | "missing" | "generating";
}

export function ReconciliationPanel({ result, notesSource }: ReconciliationPanelProps) {
  // Actionable groups start expanded; matches start collapsed
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(["possible_discrepancy", "likely_omission", "unresolved"]),
  );

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const grouped = useMemo(() => {
    const groups: Record<ReconciliationResolution, FieldReconciliation[]> = {
      confirmed_match: [],
      likely_correction: [],
      possible_discrepancy: [],
      likely_omission: [],
      unresolved: [],
    };
    for (const field of result.fields) {
      groups[field.resolution].push(field);
    }
    return groups;
  }, [result]);

  const resolutionOrder: ReconciliationResolution[] = [
    "possible_discrepancy",
    "likely_omission",
    "unresolved",
    "likely_correction",
    "confirmed_match",
  ];

  const actionableCount = result.possible_discrepancies + result.likely_omissions + result.unresolved;
  const confidence = CONFIDENCE_LABEL[result.template_parse_confidence];

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-medium text-foreground">Narrative Comparison</span>
        </div>
        <Badge variant="outline" className={cn("text-[10px]", confidence.className)}>
          Parse confidence: {confidence.text}
        </Badge>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-1.5">
        {actionableCount > 0 && (
          <div className="col-span-3 rounded-md bg-[hsl(var(--status-warning-muted))]/50 px-2.5 py-1.5 flex items-center gap-1.5">
            <AlertTriangle className="h-3 w-3 text-[hsl(var(--status-warning))]" />
            <span className="text-[11px] font-medium text-[hsl(var(--status-warning-muted-foreground))]">
              {actionableCount} {actionableCount === 1 ? "field needs" : "fields need"} attention
            </span>
          </div>
        )}
        <StatCell count={result.matches} label="Matched" />
        <StatCell count={result.likely_corrections} label="Corrected" />
        <StatCell count={result.possible_discrepancies + result.likely_omissions} label="Issues" />
      </div>

      {/* Low confidence warning */}
      {result.template_parse_confidence === "low" && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-[hsl(var(--status-warning-muted))] border border-[hsl(var(--status-warning))]/20">
          <ShieldAlert className="h-3.5 w-3.5 text-[hsl(var(--status-warning))] shrink-0 mt-0.5" />
          <p className="text-[11px] text-[hsl(var(--status-warning-muted-foreground))]">
            Form parsing confidence is low — comparison results may need manual verification.
          </p>
        </div>
      )}

      {/* Partial reconciliation notice */}
      {!result.reliable_for_review && result.template_parse_confidence !== "low" && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-muted/50 border border-border">
          <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-[11px] text-muted-foreground">
            Partial comparison — not enough fields resolved for strong completeness claims.
          </p>
        </div>
      )}

      {/* Source indicator */}
      {notesSource && (
        <p className="text-[10px] text-muted-foreground/60">
          Comparison source: {notesSource === "case_notes"
            ? "Encrypted case notes (vault-unlocked)"
            : "Document-derived field recovery (template-only)"}
        </p>
      )}

      {/* Grouped fields */}
      {resolutionOrder.map((resolution) => {
        const fields = grouped[resolution];
        if (fields.length === 0) return null;
        const config = RESOLUTION_CONFIG[resolution];
        const Icon = config.icon;
        const isExpanded = expandedGroups.has(resolution);

        return (
          <Collapsible
            key={resolution}
            open={isExpanded}
            onOpenChange={() => toggleGroup(resolution)}
          >
            <CollapsibleTrigger className="flex items-center gap-2 w-full group py-1 hover:bg-muted/30 rounded-md px-1 -mx-1 transition-colors">
              <ChevronDown className={cn(
                "h-3 w-3 text-muted-foreground transition-transform",
                !isExpanded && "-rotate-90",
              )} />
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-foreground">{config.label}</span>
              <Badge variant="secondary" className="text-[10px] px-1.5 h-4 ml-auto">{fields.length}</Badge>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-1 mt-1 ml-5">
                {fields.map((field) => (
                  <FieldRow key={field.field_key} field={field} resolution={resolution} />
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}

// ── Stat cell ────────────────────────────────────────────
function StatCell({ count, label }: { count: number; label: string }) {
  return (
    <div className="rounded-md bg-muted/40 px-2.5 py-1.5 text-center">
      <p className="text-sm font-semibold text-foreground tabular-nums">{count}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

// ── Field row ────────────────────────────────────────────
function FieldRow({ field, resolution }: { field: FieldReconciliation; resolution: ReconciliationResolution }) {
  const [expanded, setExpanded] = useState(false);
  const config = RESOLUTION_CONFIG[resolution];

  const hasDetail = !!(field.template_value || field.notes_value || field.template_source_excerpt);

  return (
    <div
      className={cn(
        "px-2.5 py-2 rounded-md border text-xs transition-colors",
        field.needs_review
          ? "bg-[hsl(var(--status-warning-muted))]/30 border-[hsl(var(--status-warning))]/15"
          : "bg-card/50 border-border/50",
        hasDetail && "cursor-pointer hover:bg-muted/30",
      )}
      onClick={() => hasDetail && setExpanded(!expanded)}
    >
      <div className="flex items-center gap-2">
        <span className="text-foreground font-medium flex-1 min-w-0 truncate">
          {field.field_key.replace(/_/g, " ")}
        </span>
        {field.section && (
          <span className="text-[9px] text-muted-foreground/60 shrink-0">
            {field.section}
          </span>
        )}
        <Badge variant="outline" className={cn("text-[9px] px-1.5 h-4 shrink-0", config.badgeClass)}>
          {config.singularLabel}
        </Badge>
      </div>

      {field.diff_summary && (
        <p className="text-[10px] text-muted-foreground mt-1 line-clamp-1">{field.diff_summary}</p>
      )}

      {expanded && hasDetail && (
        <div className="mt-2 pt-2 border-t border-border/30 space-y-1.5">
          {field.notes_value && (
            <ValueRow label="Case Notes" value={field.notes_value} confidence={field.notes_confidence} />
          )}
          {field.template_value && (
            <ValueRow label="Completed Form" value={field.template_value} confidence={field.template_confidence} />
          )}
          {field.template_source_excerpt && (
            <div className="text-[10px] text-muted-foreground/60 italic border-l-2 border-border/30 pl-2 mt-1">
              Source: "{field.template_source_excerpt.slice(0, 100)}"
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Value row ────────────────────────────────────────────
function ValueRow({ label, value, confidence }: { label: string; value: string; confidence?: ParseConfidence | null }) {
  const conf = confidence ? CONFIDENCE_LABEL[confidence] : null;
  return (
    <div className="flex gap-2">
      <span className="text-[10px] text-muted-foreground shrink-0 w-16">{label}:</span>
      <span className="text-[11px] text-foreground break-words flex-1">
        {value.length > 120 ? `${value.slice(0, 120)}…` : value}
        {conf && (
          <span className={cn("ml-1 text-[9px]", conf.className)}>({conf.text})</span>
        )}
      </span>
    </div>
  );
}
