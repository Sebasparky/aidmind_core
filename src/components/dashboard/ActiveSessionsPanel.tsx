import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Sparkles, Shield, Clock, RefreshCw, Check, X, CheckCircle2, FileText, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { StartNoteModal } from "./StartNoteModal";
import { useRecentNotes, type RecentNote } from "@/hooks/useRecentNotes";
import { useEyeLogger } from "@/hooks/useEyeLogger";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useDashboard } from "@/contexts/DashboardContext";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ActiveSession {
  id: string;
  sessionId: string;
  caseLabel: string;
  interactionType: string;
  lastAccessed: Date;
  createdAt: Date;
  guidanceCompleted: boolean;
  caseNotesCompleted: boolean;
  reviewerCompleted: boolean;
  sessionCompleted: boolean;
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

function getToolsUsedColor(count: number): string {
  if (count === 0) return "bg-muted text-muted-foreground";
  if (count === 1) return "bg-primary/20 text-primary";
  return "bg-primary text-primary-foreground";
}

interface ActiveSessionsPanelProps {
  className?: string;
  searchQuery?: string;
}

export function ActiveSessionsPanel({ className, searchQuery = "" }: ActiveSessionsPanelProps) {
  const navigate = useNavigate();
  const { notes, loading, error, refresh } = useRecentNotes(20);
  const { registerActiveSessionIds, sessionHighlightTarget, clearSessionHighlight } = useDashboard();
  const { logEvent } = useEyeLogger();
  const [startSessionOpen, setStartSessionOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [closingSessionId, setClosingSessionId] = useState<string | null>(null);
  const [sessionToClose, setSessionToClose] = useState<ActiveSession | null>(null);
  const [closeAction, setCloseAction] = useState<"close_early" | "done">("close_early");
  const [highlightedSessionId, setHighlightedSessionId] = useState<string | null>(null);
  
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Build session list from real DB data only
  const activeSessions: ActiveSession[] = useMemo(() => {
    return notes
      .filter((note) => note.status === "in_progress" || note.status === "saved")
      .map((note) => ({
        id: note.id,
        sessionId: note.sessionId,
        caseLabel: note.title,
        interactionType: note.interactionType || "Documentation",
        lastAccessed: note.updatedAt,
        createdAt: note.updatedAt,
        guidanceCompleted: note.guidanceCompleted,
        caseNotesCompleted: note.caseNotesCompleted,
        reviewerCompleted: note.reviewerCompleted,
      }));
  }, [notes]);

  // Register session IDs into context for cross-panel lookup
  useEffect(() => {
    if (activeSessions.length > 0) {
      registerActiveSessionIds(activeSessions.map((s) => s.sessionId), "ActiveSessionsPanel");
    }
  }, [activeSessions, registerActiveSessionIds]);

  // React to highlight requests from context
  useEffect(() => {
    if (!sessionHighlightTarget || sessionHighlightTarget.location !== "active") return;

    const targetId = sessionHighlightTarget.sessionId;
    setHighlightedSessionId(targetId);

    requestAnimationFrame(() => {
      const card = cardRefs.current.get(targetId);
      if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });

    const timer = setTimeout(() => {
      setHighlightedSessionId(null);
      clearSessionHighlight();
    }, 1200);

    return () => clearTimeout(timer);
  }, [sessionHighlightTarget, clearSessionHighlight]);

  const filteredActiveSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return activeSessions;
    return activeSessions.filter((s) =>
      s.caseLabel.toLowerCase().includes(q) ||
      s.interactionType.toLowerCase().includes(q)
    );
  }, [activeSessions, searchQuery]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refresh();
    setIsRefreshing(false);
  };

  const handleGenerateGuidance = (session: ActiveSession) => {
    navigate(`/guidance/${session.sessionId}`);
  };

  const handleRunReviewer = (session: ActiveSession) => {
    navigate(`/reviewer/${session.sessionId}`);
  };

  const handleCloseSessionClick = (session: ActiveSession) => {
    setSessionToClose(session);
    setCloseAction("close_early");
  };

  const handleMarkDoneClick = (session: ActiveSession) => {
    setSessionToClose(session);
    setCloseAction("done");
  };

  const handleConfirmCloseSession = async () => {
    if (!sessionToClose) return;
    
    setClosingSessionId(sessionToClose.sessionId);
    const isDone = closeAction === "done";
    
    try {
      const { error } = await supabase
        .from("sessions")
        .update({ 
          state: "CLOSING",
          status: isDone ? "completed" : "closed_early",
          closed_at: new Date().toISOString(),
        })
        .eq("session_id", sessionToClose.sessionId);

      if (error) throw error;

      // Log eye event
      await logEvent({
        eventType: isDone ? "session.completed" : "session.closed_early",
        sessionId: sessionToClose.sessionId,
        result: "success",
      });

      toast({
        title: isDone ? "Session completed" : "Session closed early",
        description: isDone 
          ? "Session marked as done and moved to history."
          : "Session moved to history.",
      });

      await refresh();
    } catch (err) {
      console.error("Failed to close session:", err);
      toast({
        title: "Failed to close session",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setClosingSessionId(null);
      setSessionToClose(null);
    }
  };

  return (
    <div className={cn("flex flex-col h-full overflow-hidden bg-card rounded-xl border border-border", className)}>
      {/* Close/Done Session Confirmation Dialog */}
      <AlertDialog open={!!sessionToClose} onOpenChange={(open) => !open && setSessionToClose(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {closeAction === "done" ? "Mark session as done?" : "Close this session early?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {closeAction === "done"
                ? "This will mark the session as completed and move it to history."
                : "This will close the session without completing the full workflow and move it to history."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep open</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmCloseSession}>
              {closeAction === "done" ? "Mark as done" : "Close early"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
          <Button onClick={() => setStartSessionOpen(true)} size="sm" className="gap-1.5" data-tour="create-session">
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
        ) : filteredActiveSessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-4">
              <Clock className="h-6 w-6 text-muted-foreground/50" />
            </div>
            <p className="text-sm text-muted-foreground">
              {searchQuery.trim() ? "No matches in Active Sessions" : "No active sessions"}
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              {searchQuery.trim()
                ? "Try adjusting your search"
                : "Start a new session to access guidance and review tools"}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredActiveSessions.map((session) => {
              const toolCount = (session.guidanceCompleted ? 1 : 0) + (session.caseNotesCompleted ? 1 : 0) + (session.reviewerCompleted ? 1 : 0);
              const totalTools = 3;
              const allToolsUsed = toolCount >= totalTools;

              return (
                <div
                  key={session.id}
                  ref={(el) => {
                    if (el) cardRefs.current.set(session.sessionId, el);
                    else cardRefs.current.delete(session.sessionId);
                  }}
                  data-session-id={session.sessionId}
                  className={cn(
                    "p-4 rounded-lg border border-border bg-background hover:bg-accent/30 transition-all duration-300",
                    highlightedSessionId === session.sessionId && "ring-2 ring-primary/40 bg-primary/5"
                  )}
                >
                  {/* Session info */}
                  <div className="mb-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">
                        {session.caseLabel}
                      </p>
                      <Badge 
                        variant="secondary"
                        className={cn("text-xs shrink-0", getToolsUsedColor(toolCount))}
                      >
                        Tools: {toolCount}/{totalTools}
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

                  {/* Tool actions + session actions */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {session.guidanceCompleted ? (
                      <Button
                        variant="default"
                        size="sm"
                        className="gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white border-0"
                        onClick={() => handleGenerateGuidance(session)}
                        data-tour="guidance-button"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        View Guidance
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 text-xs"
                        onClick={() => handleGenerateGuidance(session)}
                        data-tour="guidance-button"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        Guidance
                      </Button>
                    )}
                    {session.caseNotesCompleted ? (
                      <Button
                        variant="default"
                        size="sm"
                        className="gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white border-0"
                        onClick={() => navigate(`/sessions/${session.sessionId}/case-notes`)}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        View Notes
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 text-xs"
                        onClick={() => navigate(`/sessions/${session.sessionId}/case-notes`)}
                      >
                        <FileText className="h-3.5 w-3.5" />
                        Case Notes
                      </Button>
                    )}
                    {session.reviewerCompleted ? (
                      <Button
                        variant="default"
                        size="sm"
                        className="gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white border-0"
                        onClick={() => handleRunReviewer(session)}
                        data-tour="reviewer-button"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        View Review
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 text-xs"
                        onClick={() => handleRunReviewer(session)}
                        data-tour="reviewer-button"
                      >
                        <Shield className="h-3.5 w-3.5" />
                        Reviewer
                      </Button>
                    )}
                    
                    <div className="ml-auto">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            {allToolsUsed ? (
                              <Button
                                variant="default"
                                size="sm"
                                className="gap-1.5 text-xs"
                                onClick={() => handleMarkDoneClick(session)}
                                disabled={closingSessionId === session.sessionId}
                                data-tour="close-session"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Done
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                onClick={() => handleCloseSessionClick(session)}
                                disabled={closingSessionId === session.sessionId}
                                data-tour="close-session"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            )}
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{allToolsUsed ? "Mark session as done" : "Close early"}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Start Session Modal */}
      <StartNoteModal 
        open={startSessionOpen} 
        onOpenChange={setStartSessionOpen}
        onSessionCreated={handleRefresh}
      />

    </div>
  );
}
