import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { History, CheckCircle2, XCircle, Clock, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecentNotes } from "@/hooks/useRecentNotes";
import { cn } from "@/lib/utils";

/**
 * Session History: Closed sessions (completed, cancelled, abandoned).
 * 
 * IMPORTANT: This is NOT a system of record.
 * - Read-only view of closed sessions
 * - No editing of historical items
 * - No storage of final documents
 */

interface HistoricalSession {
  id: string;
  sessionId: string;
  caseLabel: string;
  interactionType: string;
  outcome: "completed" | "cancelled" | "abandoned";
  completedAt: Date;
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

function getOutcomeIcon(outcome: HistoricalSession["outcome"]) {
  switch (outcome) {
    case "completed":
      return CheckCircle2;
    case "cancelled":
      return XCircle;
    case "abandoned":
      return Clock;
    default:
      return History;
  }
}

function getOutcomeBadgeVariant(outcome: HistoricalSession["outcome"]) {
  switch (outcome) {
    case "completed":
      return "default" as const;
    case "cancelled":
      return "secondary" as const;
    case "abandoned":
      return "outline" as const;
    default:
      return "secondary" as const;
  }
}

function getOutcomeLabel(outcome: HistoricalSession["outcome"]) {
  switch (outcome) {
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    case "abandoned":
      return "Abandoned";
    default:
      return outcome;
  }
}

interface SessionHistoryPanelProps {
  className?: string;
}

export function SessionHistoryPanel({ className }: SessionHistoryPanelProps) {
  const navigate = useNavigate();
  const { notes, loading, error, refresh } = useRecentNotes(20);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Filter to only closed sessions (exported or cancelled)
  const historicalSessions: HistoricalSession[] = notes
    .filter((note) => 
      note.status === "exported" || 
      note.status === "cancelled"
    )
    .map((note) => ({
      id: note.id,
      sessionId: note.sessionId,
      caseLabel: note.title,
      interactionType: note.interactionType || "Documentation",
      outcome: note.status === "exported" 
        ? "completed" 
        : "cancelled",
      completedAt: note.updatedAt,
    }));

  // Apply search filter
  const filteredSessions = searchQuery.trim()
    ? historicalSessions.filter((session) =>
        session.caseLabel.toLowerCase().includes(searchQuery.toLowerCase()) ||
        session.interactionType.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : historicalSessions;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refresh();
    setIsRefreshing(false);
  };

  const handleSessionClick = (session: HistoricalSession) => {
    // Navigate to read-only session view (future enhancement)
    navigate(`/session?sessionId=${session.sessionId}&readonly=true`);
  };

  return (
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
          Completed and closed sessions
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
              {searchQuery.trim() ? "No sessions found" : "No session history"}
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              {searchQuery.trim() 
                ? "Try adjusting your search" 
                : "Completed sessions will appear here"}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {filteredSessions.map((session) => {
              const OutcomeIcon = getOutcomeIcon(session.outcome);
              return (
                <button
                  key={session.id}
                  onClick={() => handleSessionClick(session)}
                  className="w-full text-left p-3 rounded-lg hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
                      session.outcome === "completed" && "bg-primary/10 text-primary",
                      session.outcome === "cancelled" && "bg-muted text-muted-foreground",
                      session.outcome === "abandoned" && "bg-warning/10 text-warning"
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
                          {session.interactionType}
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
  );
}
