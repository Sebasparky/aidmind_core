import { AlertCircle, Clock, FileWarning, ChevronRight, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Derived Signals: Informational indicators derived from policy and session context.
 * 
 * IMPORTANT: This is NOT a task manager or compliance engine.
 * - Signals are DERIVED, not user-created
 * - Every signal must have a clear source/provenance
 * - No manual addition or dismissal of signals
 * - Informational only — does not replace professional judgment
 */

export interface DerivedSignalItem {
  id: string;
  /** The obligation text */
  obligation: string;
  /** Why this exists - source provenance */
  source: {
    type: "session" | "policy" | "timeline";
    label: string;
    id?: string;
  };
  /** Time context (e.g., "Due in 48 hours", "Overdue by 2 days") */
  timeContext?: string;
  /** Urgency level */
  urgency: "low" | "medium" | "high";
}

/** @deprecated Use DerivedSignalItem instead */
export type WorkRadarItem = DerivedSignalItem;

interface DerivedSignalsPanelProps {
  className?: string;
  items?: DerivedSignalItem[];
  onItemClick?: (item: DerivedSignalItem) => void;
}

// Placeholder data for v1 demonstration
const placeholderItems: DerivedSignalItem[] = [
  {
    id: "1",
    obligation: "Consent form still missing",
    source: { type: "session", label: "Intake session #4821", id: "4821" },
    timeContext: "Triggered 2 days ago",
    urgency: "high",
  },
  {
    id: "2",
    obligation: "Supervisor sign-off required",
    source: { type: "policy", label: "Policy threshold reached" },
    timeContext: "Due within 24 hours",
    urgency: "high",
  },
  {
    id: "3",
    obligation: "Follow-up documentation due",
    source: { type: "timeline", label: "Timeline event confirmed" },
    timeContext: "Due in 48 hours",
    urgency: "medium",
  },
];

function getUrgencyStyles(urgency: DerivedSignalItem["urgency"]) {
  switch (urgency) {
    case "high":
      return "border-l-destructive bg-destructive/5";
    case "medium":
      return "border-l-warning bg-warning/5";
    case "low":
    default:
      return "border-l-muted-foreground bg-muted/30";
  }
}

function getSourceIcon(type: DerivedSignalItem["source"]["type"]) {
  switch (type) {
    case "session":
      return FileWarning;
    case "policy":
      return AlertCircle;
    case "timeline":
      return Clock;
    default:
      return AlertCircle;
  }
}

function getSourceBadgeVariant(type: DerivedSignalItem["source"]["type"]) {
  switch (type) {
    case "session":
      return "secondary";
    case "policy":
      return "outline";
    case "timeline":
      return "secondary";
    default:
      return "secondary";
  }
}

export function DerivedSignalsPanel({ className, items, onItemClick }: DerivedSignalsPanelProps) {
  // Use placeholder data for v1, will be replaced with derived data later
  const displayItems = items ?? placeholderItems;

  return (
    <TooltipProvider>
      <div className={cn("flex flex-col h-full overflow-hidden bg-card rounded-xl border border-border", className)}>
        {/* Header */}
        <div className="p-5 border-b border-border">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-foreground">Derived Signals</h2>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="About derived signals"
                >
                  <Info className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs">
                <p className="text-xs">
                  Derived signals are informational indicators based on current policy context. They do not replace official documentation requirements or professional judgment.
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Signals derived from available policy and session context to support documentation readiness.
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3">
          {displayItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center px-4">
              <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                <AlertCircle className="h-6 w-6 text-muted-foreground/50" />
              </div>
              <p className="text-sm text-muted-foreground">
                No derived signals at this time.
              </p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Available policy context does not indicate outstanding documentation considerations.
              </p>
            </div>
        ) : (
          <div className="space-y-2">
            {displayItems.map((item) => {
              const SourceIcon = getSourceIcon(item.source.type);
              return (
                <button
                  key={item.id}
                  onClick={() => onItemClick?.(item)}
                  className={cn(
                    "w-full text-left p-4 rounded-lg border-l-4 transition-colors hover:bg-accent/50",
                    getUrgencyStyles(item.urgency)
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {item.obligation}
                      </p>
                      
                      {/* Source provenance badge - answers "Why does this exist?" */}
                      <div className="flex items-center gap-2 mt-2">
                        <Badge 
                          variant={getSourceBadgeVariant(item.source.type)}
                          className="text-xs gap-1"
                        >
                          <SourceIcon className="h-3 w-3" />
                          {item.source.label}
                        </Badge>
                      </div>
                      
                      {/* Time context */}
                      {item.timeContext && (
                        <p className="text-xs text-muted-foreground mt-2">
                          {item.timeContext}
                        </p>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                  </div>
                </button>
              );
            })}
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}

/** @deprecated Use DerivedSignalsPanel instead */
export const WorkRadarPanel = DerivedSignalsPanel;
