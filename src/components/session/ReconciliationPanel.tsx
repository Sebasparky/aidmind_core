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
  description: string;
  icon: typeof CheckCircle2;
  badgeClass: string;
}> = {
  possible_discrepancy: {
    label: "Final Template Differs From Case Notes",
    singularLabel: "Differs",
    description: "These fields appear to have different content between the case notes and the final template.",
    icon: AlertTriangle,
    badgeClass: "text-[hsl(var(--status-warning))] border-[hsl(var(--status-warning))]/30 bg-[hsl(var(--status-warning-muted))]",
  },
  likely_omission: {
    label: "Present In Case Notes But Missing From Template",
    singularLabel: "Missing",
    description: "Information found in case notes that does not appear in the final template.",
    icon: XCircle,
    badgeClass: "text-[hsl(var(--status-danger))] border-[hsl(var(--status-danger))]/30 bg-[hsl(var(--status-danger-muted))]",
  },
  unresolved: {
    label: "Could Not Be Determined Automatically",
    singularLabel: "Undetermined",
    description: "These fields could not be confidently compared — manual review is recommended.",
    icon: HelpCircle,
    badgeClass: "text-muted-foreground border-muted bg-muted/30",
  },
  likely_correction: {
    label: "Final Template Likely Intentionally Changed",
    singularLabel: "Changed",
    description: "These fields differ from case notes but appear to be intentional corrections or updates.",
    icon: ArrowRightLeft,
    badgeClass: "text-[hsl(var(--status-info))] border-[hsl(var(--status-info))]/30 bg-[hsl(var(--status-info-muted))]",
  },
  confirmed_match: {
    label: "Final Template Matches Case Notes",
    singularLabel: "Matches",
    description: "These fields have consistent content between the case notes and the final template.",
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
  // Actionable groups start expanded; matches/corrections start collapsed
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
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="h-3.5 w-3.5 text-primary" />
          <span className="text-sm font-medium text-foreground">Field-Level Comparison</span>
        </div>
        <Badge variant="outline" className={cn("text-[10px]", confidence.className)}>
          Parse confidence: {confidence.text}
        </Badge>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-2">
        {actionableCount > 0 && (
          <div className="col-span-3 rounded-lg bg-[hsl(var(--status-warning-muted))]/50 px-3 py-2 flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-[hsl(var(--status-warning))]" />
            <span className="text-xs font-medium text-[hsl(var(--status-warning-muted-foreground))]">
              {actionableCount} narrative {actionableCount === 1 ? "field needs" : "fields need"} attention
            </span>
          </div>
        )}
        <StatCell count={result.matches} label="Matched" />
        <StatCell count={result.likely_corrections} label="Changed" />
        <StatCell count={result.possible_discrepancies + result.likely_omissions} label="Needs attention" />
      </div>

      {/* Low confidence warning */}
      {result.template_parse_confidence === "low" && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-[hsl(var(--status-warning-muted))] border border-[hsl(var(--status-warning))]/20">
          <ShieldAlert className="h-3.5 w-3.5 text-[hsl(var(--status-warning))] shrink-0 mt-0.5" />
          <p className="text-xs text-[hsl(var(--status-warning-muted-foreground))]">
            Form parsing confidence is low — comparison results may need manual verification.
          </p>
        </div>
      )}

      {/* Partial reconciliation notice */}
      {!result.reliable_for_review && result.template_parse_confidence !== "low" && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 border border-border">
          <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
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
            <div className="space-y-2">
              <CollapsibleTrigger className="flex items-center gap-2 w-full group py-1.5 hover:bg-muted/30 rounded-md px-2 -mx-2 transition-colors">
                <ChevronDown className={cn(
                  "h-3.5 w-3.5 text-muted-foreground transition-transform",
                  !isExpanded && "-rotate-90",
                )} />
                <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium text-foreground text-left flex-1">{config.label}</span>
                <Badge variant="secondary" className="text-[10px] px-1.5 h-5 ml-auto shrink-0">{fields.length}</Badge>
              </CollapsibleTrigger>
              {isExpanded && (
                <p className="text-xs text-muted-foreground/60 ml-10 -mt-1">{config.description}</p>
              )}
              <CollapsibleContent>
                <div className="space-y-2 mt-1 ml-6">
                  {fields.map((field) => (
                    <FieldRow key={field.field_key} field={field} resolution={resolution} />
                  ))}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        );
      })}
    </div>
  );
}

// ── Stat cell ────────────────────────────────────────────
function StatCell({ count, label }: { count: number; label: string }) {
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2 text-center">
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
  const fieldLabel = field.field_key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

  return (
    <div
      className={cn(
        "p-4 rounded-lg border text-sm transition-colors",
        field.needs_review
          ? "bg-[hsl(var(--status-warning-muted))]/30 border-[hsl(var(--status-warning))]/15"
          : "bg-card/50 border-border/50",
        hasDetail && "cursor-pointer hover:bg-muted/30",
      )}
      onClick={() => hasDetail && setExpanded(!expanded)}
    >
      <div className="flex items-center gap-2">
        <span className="text-foreground font-semibold flex-1 min-w-0">
          {fieldLabel}
        </span>
        {field.section && (
          <span className="text-[10px] text-muted-foreground/60 shrink-0">
            {field.section}
          </span>
        )}
        <Badge variant="outline" className={cn("text-[9px] px-1.5 h-5 shrink-0", config.badgeClass)}>
          {config.singularLabel}
        </Badge>
      </div>

      {field.diff_summary && (
        <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{field.diff_summary}</p>
      )}

      {expanded && hasDetail && (
        <div className="mt-3 pt-3 border-t border-border/30 space-y-3">
          {field.notes_value && (
            <ValueBlock label="Case notes" value={field.notes_value} confidence={field.notes_confidence} />
          )}
          {field.template_value && (
            <ValueBlock label="Final template" value={field.template_value} confidence={field.template_confidence} />
          )}
          {field.template_source_excerpt && (
            <div className="text-[11px] text-muted-foreground/60 italic border-l-2 border-border/30 pl-3 mt-1">
              Source: "{field.template_source_excerpt.slice(0, 150)}"
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Value block (stacked layout) ─────────────────────────
function ValueBlock({ label, value, confidence }: { label: string; value: string; confidence?: ParseConfidence | null }) {
  const conf = confidence ? CONFIDENCE_LABEL[confidence] : null;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
        {conf && (
          <span className={cn("text-[9px]", conf.className)}>({conf.text} confidence)</span>
        )}
      </div>
      <p className="text-xs text-foreground leading-relaxed bg-muted/30 rounded-md px-3 py-2">
        {value.length > 200 ? `${value.slice(0, 200)}…` : value}
      </p>
    </div>
  );
}
