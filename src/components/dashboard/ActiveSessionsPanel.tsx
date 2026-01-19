import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Sparkles, CheckSquare, Clock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StartNoteModal } from "./StartNoteModal";
import { useRecentNotes } from "@/hooks/useRecentNotes";
import { cn } from "@/lib/utils";

/**
 * Active Sessions: Access points to Generate Guidance and Run Reviewer tools.
 * 
 * IMPORTANT: Sessions are containers, NOT workflows.
 * - No stage pills (drafting, editing, exporting)
 * - No lifecycle language
 * - Two explicit actions: Generate Guidance, Run Reviewer
 * - Progress indicator: 0/2, 1/2, 2/2 (tools used)
 * 
 * "New Session" creates a card on the dashboard, NOT a navigation event.
 */

interface ActiveSession {
  id: string;
  sessionId: string;
  caseLabel: string;
  interactionType: string;
  lastAccessed: Date;
  createdAt: Date;
  guidanceUsed: boolean;
  reviewerUsed: boolean;
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 1000 / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  return `${diffDays}d ago`;
}

function getProgressLabel(guidanceUsed: boolean, reviewerUsed: boolean): string {
  const count = (guidanceUsed ? 1 : 0) + (reviewerUsed ? 1 : 0);
  return `${count} / 2`;
}

function getProgressColor(guidanceUsed: boolean, reviewerUsed: boolean): string {
  const count = (guidanceUsed ? 1 : 0) + (reviewerUsed ? 1 : 0);
  if (count === 0) return "bg-muted text-muted-foreground";
  if (count === 1) return "bg-primary/20 text-primary";
  return "bg-primary text-primary-foreground";
}

interface ActiveSessionsPanelProps {
  className?: string;
}

export function ActiveSessionsPanel({ className }: ActiveSessionsPanelProps) {
  const navigate = useNavigate();
  const { notes, loading, error, refresh } = useRecentNotes(20);
  const [startSessionOpen, setStartSessionOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Filter to only active sessions (not completed, not cancelled)
  // TODO: Replace with real tool usage tracking from database
  const activeSessions: ActiveSession[] = notes
    .filter((note) => note.status === "in_progress" || note.status === "saved")
    .map((note) => ({
      id: note.id,
      sessionId: note.sessionId,
      caseLabel: note.title,
      interactionType: note.interactionType || "Documentation",
      lastAccessed: note.updatedAt,
      createdAt: note.updatedAt, // Use updatedAt as fallback since createdAt may not exist
      // Placeholder: will be replaced with real tracking
      guidanceUsed: false,
      reviewerUsed: false,
    }));

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refresh();
    setIsRefreshing(false);
  };

  const handleGenerateGuidance = (session: ActiveSession) => {
    navigate(`/session?sessionId=${session.sessionId}&action=guidance`);
  };

  const handleRunReviewer = (session: ActiveSession) => {
    navigate(`/session?sessionId=${session.sessionId}&action=reviewer`);
  };

  return (
    <div className={cn("flex flex-col h-full overflow-hidden bg-card rounded-xl border border-border", className)}>
      {/* Header */}
      <div className="p-5 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-foreground">Active Sessions</h2>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleRefresh}
              disabled={isRefreshing}
              title="Refresh sessions"
            >
              <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
            </Button>
          </div>
          <Button onClick={() => setStartSessionOpen(true)} size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" />
            New Session
          </Button>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Access guidance and review tools
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="p-4 rounded-lg border border-border">
                <Skeleton className="h-4 w-3/4 mb-2" />
                <Skeleton className="h-3 w-1/2 mb-3" />
                <div className="flex gap-2">
                  <Skeleton className="h-8 w-32" />
                  <Skeleton className="h-8 w-28" />
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
        ) : activeSessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-4">
              <Clock className="h-6 w-6 text-muted-foreground/50" />
            </div>
            <p className="text-sm text-muted-foreground">
              No active sessions
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Start a new session to access guidance and review tools
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {activeSessions.map((session) => (
              <div
                key={session.id}
                className="p-4 rounded-lg border border-border bg-background hover:bg-accent/30 transition-colors"
              >
                {/* Session info */}
                <div className="mb-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">
                      {session.caseLabel}
                    </p>
                    {/* Progress indicator */}
                    <Badge 
                      variant="secondary"
                      className={cn(
                        "text-xs font-mono shrink-0",
                        getProgressColor(session.guidanceUsed, session.reviewerUsed)
                      )}
                    >
                      {getProgressLabel(session.guidanceUsed, session.reviewerUsed)}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline" className="text-xs">
                      {session.interactionType}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      Accessed {formatRelativeTime(session.lastAccessed)}
                    </span>
                  </div>
                </div>

                {/* Two explicit actions - NOT lifecycle stages */}
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={session.guidanceUsed ? "secondary" : "outline"}
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={() => handleGenerateGuidance(session)}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Generate Guidance
                  </Button>
                  <Button
                    variant={session.reviewerUsed ? "secondary" : "outline"}
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={() => handleRunReviewer(session)}
                  >
                    <CheckSquare className="h-3.5 w-3.5" />
                    Run Reviewer
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Start Session Modal - creates card, doesn't navigate to session page */}
      <StartNoteModal open={startSessionOpen} onOpenChange={setStartSessionOpen} />
    </div>
  );
}
