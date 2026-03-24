import { useState, useEffect, useMemo, useRef } from "react";
import { History, CheckCircle2, XCircle, Clock, LogOut, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SessionDetailDrawer } from "./SessionDetailDrawer";
import { useRecentNotes } from "@/hooks/useRecentNotes";

import { cn } from "@/lib/utils";
import { useDashboard } from "@/contexts/DashboardContext";

export type SessionOutcome = "completed" | "closed_early" | "cancelled";

interface HistoricalSession {
  id: string;
  sessionId: string;
  caseLabel: string;
  interactionType: string;
  outcome: SessionOutcome;
  completedAt: Date;
  guidanceCompleted: boolean;
  guidanceSkipped: boolean;
  caseNotesCompleted: boolean;
  reviewerCompleted: boolean;
}

function formatDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / 1000 / 60 / 60 / 24);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getOutcomeIcon(outcome: SessionOutcome) {
  switch (outcome) {
    case "completed": return CheckCircle2;
    case "closed_early": return LogOut;
    case "cancelled": return XCircle;
    default: return History;
  }
}

function getOutcomeBadgeVariant(outcome: SessionOutcome) {
  switch (outcome) {
    case "completed": return "default" as const;
    case "closed_early": return "secondary" as const;
    case "cancelled": return "outline" as const;
    default: return "secondary" as const;
  }
}

function getOutcomeLabel(outcome: SessionOutcome) {
  switch (outcome) {
    case "completed": return "Completed";
    case "closed_early": return "Closed early";
    case "cancelled": return "Cancelled";
    default: return outcome;
  }
}

interface SessionHistoryPanelProps {
  className?: string;
  searchQuery?: string;
}

export function SessionHistoryPanel({ className, searchQuery: globalSearchQuery = "" }: SessionHistoryPanelProps) {
  const { notes, loading, error, refresh } = useRecentNotes(20);
  const { registerHistorySessionIds, sessionHighlightTarget, clearSessionHighlight } = useDashboard();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSession, setSelectedSession] = useState<HistoricalSession | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [highlightedSessionId, setHighlightedSessionId] = useState<string | null>(null);
  const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Build session list from real DB data
  const historicalSessions: HistoricalSession[] = useMemo(() => {
    return notes
      .filter((note) => note.status === "completed" || note.status === "closed_early" || note.status === "exported" || note.status === "cancelled")
      .map((note) => {
        let outcome: SessionOutcome;
        if (note.status === "completed") outcome = "completed";
        else if (note.status === "cancelled") outcome = "cancelled";
        else if (note.status === "closed_early") outcome = "closed_early";
        else outcome = "completed"; // legacy "exported" maps to completed

        return {
          id: note.id,
          sessionId: note.sessionId,
          caseLabel: note.title,
          interactionType: note.interactionType || "Documentation",
          outcome,
          completedAt: note.updatedAt,
        };
      });
  }, [notes]);

  // Derive tool usage from eye_events
  const sessionIds = useMemo(() => historicalSessions.map((s) => s.sessionId), [historicalSessions]);
  const { usageMap } = useSessionToolUsage(sessionIds);

  // Register history session IDs into context
  useEffect(() => {
    if (historicalSessions.length > 0) {
      registerHistorySessionIds(historicalSessions.map((s) => s.sessionId), "SessionHistoryPanel");
    }
  }, [historicalSessions, registerHistorySessionIds]);

  // React to highlight requests
  useEffect(() => {
    if (!sessionHighlightTarget || sessionHighlightTarget.location !== "history") return;

    const targetId = sessionHighlightTarget.sessionId;
    const historySession = historicalSessions.find((s) => s.sessionId === targetId);
    if (!historySession) return;

    setSelectedSession(historySession);
    setDrawerOpen(true);
    setHighlightedSessionId(targetId);

    requestAnimationFrame(() => {
      const el = rowRefs.current.get(targetId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });

    const timer = setTimeout(() => {
      setHighlightedSessionId(null);
      clearSessionHighlight();
    }, 1200);

    return () => clearTimeout(timer);
  }, [sessionHighlightTarget, historicalSessions, clearSessionHighlight]);

  const combinedQuery = (globalSearchQuery.trim() || searchQuery.trim()).toLowerCase();
  const filteredSessions = combinedQuery
    ? historicalSessions.filter((session) =>
        session.caseLabel.toLowerCase().includes(combinedQuery) ||
        session.interactionType.toLowerCase().includes(combinedQuery) ||
        getOutcomeLabel(session.outcome).toLowerCase().includes(combinedQuery) ||
        formatDate(session.completedAt).toLowerCase().includes(combinedQuery)
      )
    : historicalSessions;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refresh();
    setIsRefreshing(false);
  };

  const handleSessionClick = (session: HistoricalSession) => {
    setSelectedSession(session);
    setDrawerOpen(true);
  };

  return (
    <>
      <div className={cn("flex flex-col h-full overflow-hidden bg-card rounded-xl border border-border", className)}>
        {/* Header */}
        <div className="p-5 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-foreground">Session History</h2>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleRefresh}
                disabled={isRefreshing}
                title="Refresh history"
              >
                <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
              </Button>
            </div>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Closed sessions (read-only)
          </p>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search sessions..."
              className="pl-9 pr-9 h-9 bg-background"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-lg">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <div className="flex-1">
                    <Skeleton className="h-4 w-3/4 mb-1" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <p className="text-sm text-destructive">{error}</p>
              <Button variant="outline" size="sm" className="mt-2" onClick={handleRefresh}>
                Try again
              </Button>
            </div>
          ) : filteredSessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center px-4">
              <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                <History className="h-6 w-6 text-muted-foreground/50" />
              </div>
              <p className="text-sm text-muted-foreground">
                {combinedQuery ? "No matches in Session History" : "No session history yet"}
              </p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                {combinedQuery 
                  ? "Try adjusting your search" 
                  : "Completed sessions will appear here"}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredSessions.map((session) => {
                const OutcomeIcon = getOutcomeIcon(session.outcome);
                const usage = getToolUsage(usageMap, session.sessionId);
                return (
                  <button
                    key={session.id}
                    ref={(el) => {
                      if (el) rowRefs.current.set(session.sessionId, el);
                      else rowRefs.current.delete(session.sessionId);
                    }}
                    data-session-id={session.sessionId}
                    onClick={() => handleSessionClick(session)}
                    className={cn(
                      "w-full text-left p-3 rounded-lg hover:bg-accent/50 transition-all duration-300",
                      highlightedSessionId === session.sessionId && "ring-2 ring-primary/40 bg-primary/5"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
                        session.outcome === "completed" && "bg-primary/10 text-primary",
                        session.outcome === "closed_early" && "bg-muted text-muted-foreground",
                        session.outcome === "cancelled" && "bg-muted text-muted-foreground"
                      )}>
                        <OutcomeIcon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {session.caseLabel}
                        </p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <Badge variant={getOutcomeBadgeVariant(session.outcome)} className="text-xs">
                            {getOutcomeLabel(session.outcome)}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            Tools: {usage.toolCount}/2
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatDate(session.completedAt)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Read-only detail drawer */}
      <SessionDetailDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        session={selectedSession ? { ...selectedSession, ...getToolUsage(usageMap, selectedSession.sessionId) } : null}
      />
    </>
  );
}
