import { useState, useMemo, useCallback } from "react";
import { AlertCircle, Clock, FileWarning, ChevronRight, ChevronDown, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ObligationPanel, type ObligationData, type ObligationStatus } from "./ObligationPanel";
import { toast } from "@/hooks/use-toast";
import { useDashboard } from "@/contexts/DashboardContext";

/**
 * Derived Signals: Informational indicators derived from policy and session context.
 * 
 * Clicking a signal opens the Obligation Detail Panel (right slide-over).
 * Flow: Radar → Obligation → Action → Resolution
 */

export interface DerivedSignalItem {
  id: string;
  obligation: string;
  source: {
    type: "session" | "policy" | "timeline";
    label: string;
    id?: string;
  };
  timeContext?: string;
  /** Due/SLA context string, e.g. "Due in 48 hours", "Overdue by 3 hours" */
  dueContext?: string;
  urgency: "low" | "medium" | "high";
  obligationDetail?: {
    description: string;
    relatedSession?: {
      label: string;
      caseLabel?: string;
      sessionId?: string;
    };
    allowedActions?: {
      canOpenSession: boolean;
    };
  };
}

/** @deprecated Use DerivedSignalItem instead */
export type WorkRadarItem = DerivedSignalItem;

interface ResolvedObligation {
  id: string;
  title: string;
  relatedSessionLabel?: string;
  resolvedAt: Date;
  originalItem: DerivedSignalItem;
  originalIndex: number;
}

interface DerivedSignalsPanelProps {
  className?: string;
  items?: DerivedSignalItem[];
  onItemClick?: (item: DerivedSignalItem) => void;
  searchQuery?: string;
}

/**
 * Placeholder data for v1 demonstration.
 * 
 * IMPORTANT: relatedSession.sessionId values must match canonical IDs
 * used in ActiveSessionsPanel and SessionHistoryPanel demo data.
 */
const placeholderItems: DerivedSignalItem[] = [
  {
    id: "1",
    obligation: "Consent form still missing",
    source: { type: "session", label: "Intake session #4821", id: "session_4821" },
    timeContext: "Triggered 2 days ago",
    dueContext: "Overdue by 2 days",
    urgency: "high",
    obligationDetail: {
      description: "This intake session is missing a required consent form under Policy 4.2. Documentation cannot be finalized until consent is recorded.",
      relatedSession: {
        label: "Intake session #4821",
        caseLabel: "Smith Family Intake",
        sessionId: "session_4821",
      },
      allowedActions: { canOpenSession: true },
    },
  },
  {
    id: "2",
    obligation: "Supervisor sign-off required",
    source: { type: "policy", label: "Policy threshold reached" },
    timeContext: "Triggered 1 day ago",
    dueContext: "Due in 24 hours",
    urgency: "high",
    obligationDetail: {
      description: "A policy threshold has been reached that requires supervisor sign-off before the case can proceed. This is a mandatory compliance step under Policy 7.1.",
      allowedActions: { canOpenSession: false },
    },
  },
  {
    id: "3",
    obligation: "Follow-up documentation due",
    source: { type: "timeline", label: "Follow-up session #4823", id: "session_4823" },
    timeContext: "Triggered 3 days ago",
    dueContext: "Due in 48 hours",
    urgency: "medium",
    obligationDetail: {
      description: "A scheduled follow-up is approaching. Documentation should be prepared to ensure continuity of care and compliance with the established timeline.",
      relatedSession: {
        label: "Follow-up session #4823",
        caseLabel: "Job placement review",
        sessionId: "session_4823",
      },
      allowedActions: { canOpenSession: true },
    },
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
    case "session": return FileWarning;
    case "policy": return AlertCircle;
    case "timeline": return Clock;
    default: return AlertCircle;
  }
}

function getSourceBadgeVariant(type: DerivedSignalItem["source"]["type"]) {
  switch (type) {
    case "session": return "secondary";
    case "policy": return "outline";
    case "timeline": return "secondary";
    default: return "secondary";
  }
}

function signalToObligation(item: DerivedSignalItem): ObligationData {
  return {
    id: item.id,
    title: item.obligation,
    status: "open" as ObligationStatus,
    severity: item.urgency,
    description: item.obligationDetail?.description ?? item.obligation,
    relatedSession: item.obligationDetail?.relatedSession,
    policySource: item.source.label,
    triggeredAt: item.timeContext ?? "Unknown",
    allowedActions: item.obligationDetail?.allowedActions ?? { canOpenSession: false },
  };
}

function formatResolvedTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 1000 / 60);
  const diffHours = Math.floor(diffMinutes / 60);

  if (diffMinutes < 1) return "Resolved just now";
  if (diffMinutes < 60) return `Resolved ${diffMinutes}m ago`;
  if (diffHours < 24) return `Resolved ${diffHours}h ago`;
  return `Resolved ${Math.floor(diffHours / 24)}d ago`;
}

export function DerivedSignalsPanel({ className, items, onItemClick, searchQuery = "" }: DerivedSignalsPanelProps) {
  const { requestSessionHighlight } = useDashboard();
  const [allItems, setAllItems] = useState<DerivedSignalItem[]>(items ?? placeholderItems);
  const [selectedObligation, setSelectedObligation] = useState<ObligationData | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [resolvedItems, setResolvedItems] = useState<ResolvedObligation[]>([]);
  const [resolvedExpanded, setResolvedExpanded] = useState(false);
  const [fadingOutId, setFadingOutId] = useState<string | null>(null);

  const displayItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allItems;
    return allItems.filter((item) =>
      item.obligation.toLowerCase().includes(q) ||
      item.source.label.toLowerCase().includes(q) ||
      (item.timeContext?.toLowerCase().includes(q)) ||
      (item.obligationDetail?.relatedSession?.label.toLowerCase().includes(q)) ||
      (item.obligationDetail?.relatedSession?.caseLabel?.toLowerCase().includes(q))
    );
  }, [allItems, searchQuery]);

  const handleCardClick = (item: DerivedSignalItem) => {
    onItemClick?.(item);
    setSelectedObligation(signalToObligation(item));
    setPanelOpen(true);
  };

  const handleResolve = useCallback((id: string) => {
    const itemIndex = allItems.findIndex((i) => i.id === id);
    const item = itemIndex >= 0 ? allItems[itemIndex] : null;
    setPanelOpen(false);
    setSelectedObligation(null);

    setFadingOutId(id);
    setTimeout(() => {
      setAllItems((prev) => prev.filter((i) => i.id !== id));
      setFadingOutId(null);

      const resolvedEntry: ResolvedObligation | null = item
        ? {
            id: item.id,
            title: item.obligation,
            relatedSessionLabel: item.obligationDetail?.relatedSession?.label,
            resolvedAt: new Date(),
            originalItem: item,
            originalIndex: itemIndex,
          }
        : null;

      if (resolvedEntry) {
        setResolvedItems((prev) => [resolvedEntry, ...prev]);
      }

      const { dismiss } = toast({
        title: "Marked as resolved",
        action: item ? (
          <button
            onClick={() => {
              setAllItems((prev) => {
                const restored = [...prev];
                const insertAt = Math.min(itemIndex, restored.length);
                restored.splice(insertAt, 0, item);
                return restored;
              });
              setResolvedItems((prev) => prev.filter((r) => r.id !== id));
              dismiss();
            }}
            className="text-sm font-medium text-primary hover:text-primary/80 transition-colors px-3 py-1 rounded-md bg-primary/10 hover:bg-primary/20"
          >
            Undo
          </button>
        ) : undefined,
        duration: 12000,
      });
    }, 250);
  }, [allItems]);

  const handleOpenSession = useCallback((sessionId: string) => {
    setPanelOpen(false);
    setSelectedObligation(null);

    // Use context-based registry lookup instead of DOM scraping
    setTimeout(() => {
      requestSessionHighlight(sessionId);
    }, 200);
  }, [requestSessionHighlight]);

  return (
    <TooltipProvider>
      <div className={cn("flex flex-col h-full overflow-hidden bg-card rounded-xl border border-border", className)}>
        {/* Header */}
        <div className="p-5 border-b border-border">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-foreground">Work Radar</h2>
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
            Active ({displayItems.length})
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3">
          {displayItems.length === 0 && !fadingOutId ? (
            <div className="flex flex-col items-center justify-center py-12 text-center px-4">
              <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                <AlertCircle className="h-6 w-6 text-muted-foreground/50" />
              </div>
              <p className="text-sm text-muted-foreground">
                {searchQuery.trim() ? "No matches in Derived Signals" : "No derived signals at this time."}
              </p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                {searchQuery.trim()
                  ? "Try adjusting your search"
                  : "Available policy context does not indicate outstanding documentation considerations."}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {displayItems.map((item) => {
                const SourceIcon = getSourceIcon(item.source.type);
                const isFading = fadingOutId === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleCardClick(item)}
                    className={cn(
                      "w-full text-left p-4 rounded-lg border-l-4 transition-all cursor-pointer",
                      "hover:bg-accent/50 hover:shadow-sm",
                      getUrgencyStyles(item.urgency),
                      isFading && "opacity-0 max-h-0 overflow-hidden py-0 my-0 border-0"
                    )}
                    style={{
                      transition: "opacity 250ms ease, max-height 250ms ease 100ms, padding 250ms ease 100ms, margin 250ms ease 100ms",
                      maxHeight: isFading ? 0 : 200,
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">
                          {item.obligation}
                        </p>
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <Badge 
                            variant={getSourceBadgeVariant(item.source.type)}
                            className="text-xs gap-1"
                          >
                            <SourceIcon className="h-3 w-3" />
                            {item.source.label}
                          </Badge>
                          {item.dueContext && (
                            <Badge
                              variant={item.dueContext.toLowerCase().startsWith("overdue") ? "destructive" : "warning"}
                              className="text-xs gap-1"
                            >
                              <Clock className="h-3 w-3" />
                              {item.dueContext}
                            </Badge>
                          )}
                        </div>
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

          {/* Recently Resolved Section */}
          {resolvedItems.length > 0 && (
            <div className="mt-4">
              <div className="border-t border-border pt-3">
                <button
                  onClick={() => setResolvedExpanded((v) => !v)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors w-full text-left"
                >
                  <ChevronDown
                    className={cn(
                      "h-3 w-3 transition-transform",
                      !resolvedExpanded && "-rotate-90"
                    )}
                  />
                  Recently resolved ({resolvedItems.length})
                </button>

                {resolvedExpanded && (
                  <div className="mt-2 space-y-1.5">
                    {resolvedItems.map((r) => (
                      <div
                        key={r.id}
                        className="px-3 py-2 rounded-md bg-muted/30 text-xs text-muted-foreground"
                      >
                        <p className="font-medium text-muted-foreground/80">{r.title}</p>
                        {r.relatedSessionLabel && (
                          <p className="text-muted-foreground/60 mt-0.5">
                            {r.relatedSessionLabel}
                          </p>
                        )}
                        <p className="text-muted-foreground/50 mt-0.5">
                          {formatResolvedTime(r.resolvedAt)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Obligation Detail Panel */}
      <ObligationPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        obligation={selectedObligation}
        onOpenSession={handleOpenSession}
        onResolve={handleResolve}
      />
    </TooltipProvider>
  );
}

/** @deprecated Use DerivedSignalsPanel instead */
export const WorkRadarPanel = DerivedSignalsPanel;
