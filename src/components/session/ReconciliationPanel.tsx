/**
 * ReconciliationPanel — Structured comparison view for notes vs completed form
 *
 * Shows matches, corrections, discrepancies, missing fields with source excerpts.
 * Displayed before/alongside Reviewer findings.
 */

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  CheckCircle2, AlertTriangle, XCircle, ArrowRightLeft, HelpCircle,
  ChevronDown, Info, ShieldAlert, FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  ReconciliationResult,
  FieldReconciliation,
  ReconciliationResolution,
  ParseConfidence,
} from "@/lib/tools/parser-artifact-types";

// ── Resolution config ────────────────────────────────────────────────────

const RESOLUTION_CONFIG: Record<ReconciliationResolution, {
  label: string;
  icon: typeof CheckCircle2;
  badgeClass: string;
  order: number;
}> = {
  possible_discrepancy: {
    label: "Possible Discrepancies",
    icon: AlertTriangle,
    badgeClass: "text-[hsl(var(--status-warning))] border-[hsl(var(--status-warning))]/30 bg-[hsl(var(--status-warning-muted))]",
    order: 0,
  },
  likely_omission: {
    label: "Likely Omissions",
    icon: XCircle,
    badgeClass: "text-[hsl(var(--status-danger))] border-[hsl(var(--status-danger))]/30 bg-[hsl(var(--status-danger-muted))]",
    order: 1,
  },
  unresolved: {
    label: "Needs Review",
    icon: HelpCircle,
    badgeClass: "text-muted-foreground border-muted bg-muted/30",
    order: 2,
  },
  likely_correction: {
    label: "Likely Corrections",
    icon: ArrowRightLeft,
    badgeClass: "text-[hsl(var(--status-info))] border-[hsl(var(--status-info))]/30 bg-[hsl(var(--status-info-muted))]",
    order: 3,
  },
  confirmed_match: {
    label: "Matches",
    icon: CheckCircle2,
    badgeClass: "text-[hsl(var(--status-success))] border-[hsl(var(--status-success))]/30 bg-[hsl(var(--status-success-muted))]",
    order: 4,
  },
};

const CONFIDENCE_BADGE: Record<ParseConfidence, string> = {
  high: "text-[hsl(var(--status-success))]",
  medium: "text-[hsl(var(--status-warning))]",
  low: "text-[hsl(var(--status-danger))]",
};

// ── Component ────────────────────────────────────────────────────────────

interface ReconciliationPanelProps {
  result: ReconciliationResult;
  notesSource?: "case_notes" | "field_recovery";
  artifactStatus?: "loading" | "ready" | "missing" | "generating";
}

export function ReconciliationPanel({ result, notesSource, artifactStatus }: ReconciliationPanelProps) {
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

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-medium text-foreground">Notes ↔ Form Comparison</span>
        </div>
        <div className="flex items-center gap-1.5">
          {notesSource && (
            <Badge variant="outline" className="text-[9px] px-1.5 h-4 text-muted-foreground">
              <FileText className="h-2.5 w-2.5 mr-0.5" />
              {notesSource === "case_notes" ? "Case Notes" : "Recovery"}
            </Badge>
          )}
          <Badge
            variant="outline"
            className={cn(
              "text-[10px]",
              result.template_parse_confidence === "high"
                ? CONFIDENCE_BADGE.high
                : result.template_parse_confidence === "medium"
                  ? CONFIDENCE_BADGE.medium
                  : CONFIDENCE_BADGE.low,
            )}
          >
            Parse: {result.template_parse_confidence}
          </Badge>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex flex-wrap gap-1.5">
        {actionableCount > 0 && (
          <Badge variant="outline" className="text-[10px] px-1.5 h-5 text-[hsl(var(--status-warning))] border-[hsl(var(--status-warning))]/30 font-medium">
            {actionableCount} need attention
          </Badge>
        )}
        <Badge variant="outline" className="text-[10px] px-1.5 h-5">
          {result.matches} matches
        </Badge>
        {result.likely_corrections > 0 && (
          <Badge variant="outline" className="text-[10px] px-1.5 h-5 text-[hsl(var(--status-info))] border-[hsl(var(--status-info))]/30">
            {result.likely_corrections} corrections
          </Badge>
        )}
        {result.possible_discrepancies > 0 && (
          <Badge variant="outline" className="text-[10px] px-1.5 h-5 text-[hsl(var(--status-warning))] border-[hsl(var(--status-warning))]/30">
            {result.possible_discrepancies} discrepancies
          </Badge>
        )}
        {result.likely_omissions > 0 && (
          <Badge variant="outline" className="text-[10px] px-1.5 h-5 text-[hsl(var(--status-danger))] border-[hsl(var(--status-danger))]/30">
            {result.likely_omissions} omissions
          </Badge>
        )}
        {result.unresolved > 0 && (
          <Badge variant="outline" className="text-[10px] px-1.5 h-5">
            {result.unresolved} unresolved
          </Badge>
        )}
      </div>

      {/* Low confidence warning */}
      {result.template_parse_confidence === "low" && (
        <div className="flex items-start gap-2 p-2 rounded-lg bg-[hsl(var(--status-warning-muted))] border border-[hsl(var(--status-warning))]/20">
          <ShieldAlert className="h-3.5 w-3.5 text-[hsl(var(--status-warning))] shrink-0 mt-0.5" />
          <p className="text-[11px] text-[hsl(var(--status-warning-muted-foreground))]">
            Form parsing confidence is low. Some findings may need manual verification.
          </p>
        </div>
      )}

      {/* Not reliable warning */}
      {!result.reliable_for_review && result.template_parse_confidence !== "low" && (
        <div className="flex items-start gap-2 p-2 rounded-lg bg-muted/50 border border-border">
          <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-[11px] text-muted-foreground">
            Reconciliation is partial — not enough fields resolved for strong completeness claims.
          </p>
        </div>
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
            <CollapsibleTrigger className="flex items-center gap-2 w-full group py-1">
              <ChevronDown className={cn(
                "h-3 w-3 text-muted-foreground transition-transform",
                !isExpanded && "-rotate-90",
              )} />
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-foreground">{config.label}</span>
              <Badge variant="secondary" className="text-[10px] px-1.5 h-4">{fields.length}</Badge>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-1.5 mt-1.5 ml-5">
                {fields.map((field) => (
                  <FieldComparisonRow key={field.field_key} field={field} />
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}

// ── Field comparison row ─────────────────────────────────────────────────

function FieldComparisonRow({ field }: { field: FieldReconciliation }) {
  const [expanded, setExpanded] = useState(false);

  const statusIcon = field.status === "match"
    ? <CheckCircle2 className="h-3 w-3 text-[hsl(var(--status-success))]" />
    : field.status === "mismatch"
      ? <AlertTriangle className="h-3 w-3 text-[hsl(var(--status-warning))]" />
      : field.status === "missing_in_template"
        ? <XCircle className="h-3 w-3 text-[hsl(var(--status-danger))]" />
        : field.status === "missing_in_notes"
          ? <ArrowRightLeft className="h-3 w-3 text-[hsl(var(--status-info))]" />
          : <HelpCircle className="h-3 w-3 text-muted-foreground" />;

  return (
    <div
      className={cn(
        "p-2 rounded-lg border text-xs cursor-pointer transition-colors",
        field.needs_review ? "bg-[hsl(var(--status-warning-muted))]/50 border-[hsl(var(--status-warning))]/20" : "bg-muted/20",
      )}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5 shrink-0">{statusIcon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-medium text-foreground truncate">
              {field.field_key.replace(/_/g, " ")}
            </span>
            {field.section && (
              <Badge variant="outline" className="text-[9px] px-1 h-3.5 text-muted-foreground">
                {field.section}
              </Badge>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{field.diff_summary}</p>
        </div>
      </div>

      {expanded && (
        <div className="mt-2 pt-2 border-t border-border/50 space-y-1.5">
          <div className="flex gap-2">
            <span className="text-[10px] text-muted-foreground shrink-0 w-12">Notes:</span>
            <span className="text-[11px] text-foreground break-words">
              {field.notes_value ? (
                <>
                  "{field.notes_value.slice(0, 150)}"
                  {field.notes_confidence && (
                    <span className={cn("ml-1 text-[9px]", CONFIDENCE_BADGE[field.notes_confidence])}>
                      ({field.notes_confidence})
                    </span>
                  )}
                </>
              ) : (
                <span className="text-muted-foreground italic">(not available)</span>
              )}
            </span>
          </div>
          <div className="flex gap-2">
            <span className="text-[10px] text-muted-foreground shrink-0 w-12">Form:</span>
            <span className="text-[11px] text-foreground break-words">
              {field.template_value ? (
                <>
                  "{field.template_value.slice(0, 150)}"
                  {field.template_confidence && (
                    <span className={cn("ml-1 text-[9px]", CONFIDENCE_BADGE[field.template_confidence])}>
                      ({field.template_confidence})
                    </span>
                  )}
                </>
              ) : (
                <span className="text-muted-foreground italic">(not found)</span>
              )}
            </span>
          </div>
          {field.notes_source_excerpt && (
            <div className="text-[10px] text-muted-foreground/70 italic border-l-2 border-border pl-2">
              Notes source: "{field.notes_source_excerpt.slice(0, 80)}"
            </div>
          )}
          {field.template_source_excerpt && (
            <div className="text-[10px] text-muted-foreground/70 italic border-l-2 border-border pl-2">
              Form source: "{field.template_source_excerpt.slice(0, 80)}"
            </div>
          )}
        </div>
      )}
    </div>
  );
}
