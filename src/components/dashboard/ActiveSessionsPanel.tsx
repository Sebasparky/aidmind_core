import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Sparkles, Shield, Clock, RefreshCw, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StartNoteModal } from "./StartNoteModal";
import { useRecentNotes } from "@/hooks/useRecentNotes";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
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

/**
 * Active Sessions: Access points to Generate Guidance and Run Reviewer tools.
 * 
 * V1 CONSTRAINTS:
 * - Sessions are containers, NOT workflows
 * - No stage pills (drafting, editing, exporting)
 * - No lifecycle language
 * - Two explicit actions: Generate Guidance, Run Reviewer
 * - "Tools Used: X of 2" (display-only, NOT a workflow state)
 * - Sessions move to History when BOTH tools used AND user closes session
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

function getToolsUsedLabel(guidanceUsed: boolean, reviewerUsed: boolean): string {
  const count = (guidanceUsed ? 1 : 0) + (reviewerUsed ? 1 : 0);
  return `Tools Used: ${count} of 2`;
}

function getToolsUsedColor(guidanceUsed: boolean, reviewerUsed: boolean): string {
  const count = (guidanceUsed ? 1 : 0) + (reviewerUsed ? 1 : 0);
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
  const [startSessionOpen, setStartSessionOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [closingSessionId, setClosingSessionId] = useState<string | null>(null);
  const [sessionToClose, setSessionToClose] = useState<ActiveSession | null>(null);
  const [highlightedSessionId, setHighlightedSessionId] = useState<string | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Listen for highlight-session events from ObligationPanel
  useEffect(() => {
    const handler = (e: Event) => {
      const sessionId = (e as CustomEvent).detail?.sessionId;
      if (!sessionId) return;

      setHighlightedSessionId(sessionId);

      // Scroll to the card
      const card = cardRefs.current.get(sessionId);
      if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }

      // Remove highlight after 1.5s
      setTimeout(() => setHighlightedSessionId(null), 1500);
    };

    window.addEventListener("highlight-session", handler);
    return () => window.removeEventListener("highlight-session", handler);
  }, []);

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
      createdAt: note.updatedAt,
      // Placeholder: will be replaced with real tracking
      guidanceUsed: false,
      reviewerUsed: false,
    }));

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
    // Navigate to standalone Guidance tool page
    navigate(`/guidance/${session.sessionId}`);
  };

  const handleRunReviewer = (session: ActiveSession) => {
    // Navigate to standalone Reviewer tool page
    navigate(`/reviewer/${session.sessionId}`);
  };

  const handleCloseSessionClick = (session: ActiveSession) => {
    setSessionToClose(session);
  };

  const handleConfirmCloseSession = async () => {
    if (!sessionToClose) return;
    
    setClosingSessionId(sessionToClose.sessionId);
    
    try {
      const { error } = await supabase
        .from("sessions")
        .update({ 
          state: "CLOSING",
          closed_at: new Date().toISOString(),
        })
        .eq("session_id", sessionToClose.sessionId);

      if (error) throw error;

      toast({
        title: "Session closed",
        description: "Session moved to history.",
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
      {/* Close Session Confirmation Dialog */}
      <AlertDialog open={!!sessionToClose} onOpenChange={(open) => !open && setSessionToClose(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close this session?</AlertDialogTitle>
            <AlertDialogDescription>
              This will move the session to history. You won't be able to use the tools on this session anymore.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep open</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmCloseSession}>
              Close session
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
            {filteredActiveSessions.map((session) => (
              <div
                key={session.id}
                ref={(el) => {
                  if (el) cardRefs.current.set(session.sessionId, el);
                  else cardRefs.current.delete(session.sessionId);
                }}
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
                    {/* Tools used indicator - display only, NOT workflow */}
                    <Badge 
                      variant="secondary"
                      className={cn(
                        "text-xs shrink-0",
                        getToolsUsedColor(session.guidanceUsed, session.reviewerUsed)
                      )}
                    >
                      {getToolsUsedLabel(session.guidanceUsed, session.reviewerUsed)}
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

                {/* Two explicit tool actions - independent, non-sequential */}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant={session.guidanceUsed ? "secondary" : "outline"}
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={() => handleGenerateGuidance(session)}
                    data-tour="guidance-button"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Guidance
                    {session.guidanceUsed && <Check className="h-3 w-3 ml-0.5" />}
                  </Button>
                  <Button
                    variant={session.reviewerUsed ? "secondary" : "outline"}
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={() => handleRunReviewer(session)}
                    data-tour="reviewer-button"
                  >
                    <Shield className="h-3.5 w-3.5" />
                    Reviewer
                    {session.reviewerUsed && <Check className="h-3 w-3 ml-0.5" />}
                  </Button>
                  
                  {/* Close session action */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-xs text-muted-foreground hover:text-foreground ml-auto"
                    onClick={() => handleCloseSessionClick(session)}
                    disabled={closingSessionId === session.sessionId}
                    data-tour="close-session"
                  >
                    <X className="h-3.5 w-3.5" />
                    Close
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Start Session Modal - creates card, NEVER navigates */}
      <StartNoteModal 
        open={startSessionOpen} 
        onOpenChange={setStartSessionOpen}
        onSessionCreated={handleRefresh}
      />
    </div>
  );
}
