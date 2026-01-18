import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSessionMachine, SessionState, TimelineItem, ResumeBundle } from "@/hooks/useSessionMachine";
import { useSessionNavigationGuard } from "@/hooks/useSessionNavigationGuard";
import { useSessionHeartbeat } from "@/hooks/useSessionHeartbeat";
import { useNavigationGuard } from "@/contexts/NavigationGuardContext";
import { useDashboard } from "@/contexts/DashboardContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  Loader2, 
  CheckCircle2, 
  ArrowRight,
  Edit3,
  RefreshCw,
  Download,
  Trash2,
  AlertTriangle,
  Check,
  X,
  Save,
  AlertCircle
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { LeaveSessionDialog } from "@/components/session/LeaveSessionDialog";

const DENY_REASONS = [
  { value: "not_applicable", label: "Not applicable" },
  { value: "outdated_policy", label: "Outdated policy" },
  { value: "already_completed", label: "Already completed" },
  { value: "other", label: "Other" },
];

export default function Session() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { addTask, deleteTask } = useDashboard();
  
  const caseId = searchParams.get("caseId") || crypto.randomUUID().slice(0, 8);
  const clientLabel = searchParams.get("clientLabel") || "";
  const interactionType = searchParams.get("interactionType") || "phone_call";
  const noteTitleParam = searchParams.get("noteTitle");
  const caseLabelParam = searchParams.get("caseLabel");
  const resumeBundleParam = searchParams.get("resumeBundle");

  // Parse resume bundle if provided
  const [resumeBundle] = useState<ResumeBundle | undefined>(() => {
    if (resumeBundleParam) {
      try {
        return JSON.parse(decodeURIComponent(resumeBundleParam));
      } catch {
        return undefined;
      }
    }
    return undefined;
  });

  // Derive the actual note title/case label to use
  // Priority: noteTitle param > caseLabel param > resume bundle > "Untitled note"
  const effectiveCaseLabel = noteTitleParam?.trim() 
    || caseLabelParam?.trim() 
    || resumeBundle?.case_reference.caseLabel 
    || "Untitled note";
  
  const { state, data, actions } = useSessionMachine({
    caseId: resumeBundle?.case_reference.caseId || caseId,
    caseLabel: effectiveCaseLabel,
    clientLabel: resumeBundle?.case_reference.clientLabel || clientLabel,
    interactionType: resumeBundle?.case_reference.interactionType || interactionType,
    resumeBundle,
  });

  const [editedDraft, setEditedDraft] = useState("");
  const [textInput, setTextInput] = useState("");
  
  // Exit dialog - only for explicit cancel button
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [isNavigationCancelling, setIsNavigationCancelling] = useState(false);
  
  // Deny dialog state
  const [denyDialogOpen, setDenyDialogOpen] = useState(false);
  const [denyingTimelineId, setDenyingTimelineId] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState("");

  // New input dialog for resumed sessions (for regeneration)
  const [showNewInputDialog, setShowNewInputDialog] = useState(false);
  const [newInputText, setNewInputText] = useState("");

  // Track created task IDs for undo
  const createdTasksRef = useRef<Map<string, string>>(new Map());

  // Intended navigation target when the user tries to leave mid-session
  const leaveTargetRef = useRef<string | null>(null);

  // Prevent duplicate session creation from re-renders (NEW can persist during async createSession)
  const hasAutoStartedRef = useRef(false);
  const hasAttemptedStartRef = useRef(false);
  const startSessionRef = useRef(actions.startSession);
  const [, bumpAttemptedStart] = useState(0);

  useEffect(() => {
    startSessionRef.current = actions.startSession;
  }, [actions.startSession]);

  // Auto-start session on mount (exactly once per mount)
  useEffect(() => {
    if (state === "NEW" && !hasAutoStartedRef.current) {
      hasAutoStartedRef.current = true;
      hasAttemptedStartRef.current = true;
      bumpAttemptedStart((v) => v + 1); // rerender so guards/unload can see attempted start immediately
      startSessionRef.current();
    }
  }, [state]);

  // V1 pivot: transcription/redaction disabled - no auto progression
  // Original v0 code auto-triggered:
  //   - startTranscription() when state === "AUDIO_UPLOADED"
  //   - startRedaction() when state === "TRANSCRIBED" or "TEXT_PROVIDED"
  // 
  // These features are quarantined. See:
  //   - src/config/features.ts for feature gates
  //   - src/legacy/v0_pipeline/ for quarantined frontend code
  //   - supabase/functions/_future/ for quarantined edge functions
  //
  // useEffect(() => {
  //   if (state === "AUDIO_UPLOADED") {
  //     actions.startTranscription();
  //   } else if (state === "TRANSCRIBED") {
  //     actions.startRedaction();
  //   } else if (state === "TEXT_PROVIDED") {
  //     actions.startRedaction();
  //   }
  // }, [state, actions]);

  // Helper to map interaction type to note format
  // Navigate to dashboard when purged with appropriate message (color-coded)
  useEffect(() => {
    if (state === "PURGED") {
      if (data.exportCompleted) {
        // Green / Success styling
        toast({
          title: "✅ Export complete",
          description: "Session finalized and closed successfully.",
          className: "border-green-500 bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-100 dark:border-green-700",
        });
      } else if (data.savedForLater) {
        // Message already shown by handleSaveForLater (blue styling)
      } else {
        // Red / Destructive styling (cancelled)
        toast({
          title: "❌ Session cancelled",
          description: "Draft discarded and temporary data purged.",
          className: "border-destructive bg-destructive/10 text-destructive dark:bg-destructive/20",
        });
      }

      // Notes are now automatically updated via realtime subscription in useRecentNotes
      navigate(leaveTargetRef.current || "/dashboard");
    }
  }, [state, navigate, data.exportCompleted, data.savedForLater]);

  // Auto-complete purge when closing
  useEffect(() => {
    if (state === "CLOSING") {
      actions.completePurge();
    }
  }, [state, actions]);

  // Initialize edited draft
  useEffect(() => {
    if (data.generatedDraft) {
      setEditedDraft(data.generatedDraft);
    }
  }, [data.generatedDraft]);

  // Determine if session is "dirty" (active and not terminal)
  // startSession() keeps state at NEW while async createSession runs, so NEW is terminal only
  // until a start attempt has happened.
  const isTerminalState = state === "PURGED" || (state === "NEW" && !hasAttemptedStartRef.current);
  const canSaveForLater = state === "DRAFT_READY";
  const isDirtySession =
    !isTerminalState && (hasAttemptedStartRef.current || data.sessionId !== "");

  // Session heartbeat: emit liveness signals every 30s
  // Heartbeats are used to detect abandonment (no activity = auto-purge)
  useSessionHeartbeat({
    sessionId: data.sessionId || null,
    isActive: !isTerminalState && !!data.sessionId,
  });

  // Get the global navigation guard context
  const { setGuard, clearGuard } = useNavigationGuard();

  // Navigation guard for leaving mid-session
  const {
    showLeaveDialog,
    handleStay,
    handleCancelAndLeave,
    pendingPath,
    guardedNavigate,
  } = useSessionNavigationGuard({
    isDirtySession,
    onCancel: async () => {
      setIsNavigationCancelling(true);
      try {
        await actions.cancelSession();
      } finally {
        setIsNavigationCancelling(false);
      }
    },
    // Save is handled by Session.tsx (bundle download + purge)
    onSave: undefined,
    saveEnabled: false,
  });

  useEffect(() => {
    if (pendingPath) {
      leaveTargetRef.current = pendingPath;
    }
  }, [pendingPath]);

  const handleStayAndClear = useCallback(() => {
    leaveTargetRef.current = null;
    handleStay();
  }, [handleStay]);

  const guardedNavigateWithTarget = useCallback(
    (path: string) => {
      leaveTargetRef.current = path;
      guardedNavigate(path);
    },
    [guardedNavigate]
  );

  // Register/unregister the navigation guard globally
  useEffect(() => {
    setGuard({
      active: isDirtySession,
      guardedNavigate: guardedNavigateWithTarget,
    });

    return () => {
      clearGuard();
    };
  }, [isDirtySession, guardedNavigateWithTarget, setGuard, clearGuard]);

  // V1: No audio upload - removed handleFileUpload
  // Audio transcription is quarantined in src/legacy/v0_pipeline/

  const handleTextSubmit = useCallback(() => {
    if (textInput.trim()) {
      actions.pasteTextNotes(textInput);
    }
  }, [textInput, actions]);

  const handleSaveEdit = useCallback(() => {
    actions.saveEdit(editedDraft);
    toast({
      title: "Draft saved",
      description: "Your changes have been saved.",
    });
  }, [actions, editedDraft]);

  const handleExport = useCallback(() => {
    actions.exportDraft();
  }, [actions]);


  const handleCancelClick = useCallback(() => {
    setShowCancelDialog(true);
  }, []);

  // Note: handleConfirmLeave is now handled by navigation guard

  const handleConfirmCancel = useCallback(() => {
    setShowCancelDialog(false);
    actions.cancelSession();
  }, [actions]);

  // Save for Later handler
  const handleSaveForLater = useCallback(() => {
    const bundle = actions.saveForLater();
    if (bundle) {
      // Create downloadable JSON file
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `aidmind_draft_bundle_v1_${bundle.resume_bundle_id.slice(0, 8)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Blue / Informational styling
      toast({
        title: "💾 Draft saved for later",
        description: "Download complete. Session closed and temporary data purged.",
        className: "border-blue-500 bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-100 dark:border-blue-700",
      });

      // Trigger closing after download
      actions.triggerClosingAfterSave();
    }
  }, [actions]);

  // Timeline Confirm/Deny handlers
  const handleConfirmTimeline = useCallback((timeline: TimelineItem) => {
    // Check if this timeline already created a task (from resume bundle)
    if (timeline.createdTaskId) {
      toast({
        title: "Task already exists",
        description: "This event was already confirmed in a previous session.",
      });
      return;
    }

    // Create task in dashboard and store its ID
    const taskId = addTask({
      title: timeline.title,
      clientLabel: data.clientLabel,
      caseId: data.caseId,
      caseLabel: data.caseLabel,
      dueDate: timeline.date,
      priority: timeline.priority === "HIGH" ? "HIGH" : "NORMAL",
    });
    
    actions.confirmTimeline(timeline.id, taskId);
    createdTasksRef.current.set(timeline.id, taskId);

    const { dismiss } = toast({
      title: "Task added to My Tasks",
      action: (
        <button
          onClick={() => {
            // Undo: reset timeline and delete task
            actions.resetTimeline(timeline.id);
            const createdTaskId = createdTasksRef.current.get(timeline.id);
            if (createdTaskId) {
              deleteTask(createdTaskId);
              createdTasksRef.current.delete(timeline.id);
            }
            dismiss();
          }}
          className="text-sm font-medium text-primary hover:text-primary/80 transition-colors px-3 py-1 rounded-md bg-primary/10 hover:bg-primary/20"
        >
          Undo
        </button>
      ),
      duration: 5000,
    });
  }, [actions, addTask, deleteTask, data.clientLabel, data.caseId, data.caseLabel]);

  const handleDenyClick = useCallback((timelineId: string) => {
    setDenyingTimelineId(timelineId);
    setDenyReason("");
    setDenyDialogOpen(true);
  }, []);

  const handleConfirmDeny = useCallback(() => {
    if (denyingTimelineId) {
      const reason = DENY_REASONS.find(r => r.value === denyReason)?.label || denyReason;
      actions.denyTimeline(denyingTimelineId, reason);
    }
    setDenyDialogOpen(false);
    setDenyingTimelineId(null);
    setDenyReason("");
  }, [denyingTimelineId, denyReason, actions]);

  // Handle new input for regeneration (resumed sessions)
  const handleRequestRegeneration = useCallback(() => {
    if (data.isResumedSession && !data.hasNewInputForRegeneration) {
      setShowNewInputDialog(true);
    } else {
      actions.regenerateDraft();
    }
  }, [data.isResumedSession, data.hasNewInputForRegeneration, actions]);

  const handleSubmitNewInput = useCallback(() => {
    if (newInputText.trim()) {
      actions.addNewInputForRegeneration(newInputText);
      setShowNewInputDialog(false);
      setNewInputText("");
      // Now trigger regeneration
      actions.regenerateDraft();
    }
  }, [newInputText, actions]);

  const getInteractionTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      phone_call: "Phone Call",
      visit: "Visit",
      meeting: "Meeting",
      other: "Other",
    };
    return labels[type] || type;
  };

  // V1 Progress mapping (simplified - no transcription/redaction/generation states)
  const getProgressValue = (currentState: SessionState): number => {
    const progressMap: Record<SessionState, number> = {
      NEW: 0,
      READY_FOR_INPUT: 10,
      TEXT_PROVIDED: 30,
      DRAFT_READY: 70,
      EDITING: 80,
      APPROVED: 90,
      EXPORTING: 95,
      CLOSING: 98,
      PURGED: 100,
      ERROR: 0,
    };
    return progressMap[currentState] || 0;
  };

  // V1 State labels (simplified - no transcription/redaction/generation states)
  const getStateLabel = (currentState: SessionState): string => {
    const labels: Record<SessionState, string> = {
      NEW: "Initializing session...",
      READY_FOR_INPUT: "Ready for input",
      TEXT_PROVIDED: "Processing input...",
      DRAFT_READY: data.isResumedSession ? "Resumed draft ready for review" : "Draft ready for review",
      EDITING: "Editing draft",
      APPROVED: "Draft approved",
      EXPORTING: "Exporting to system of record...",
      CLOSING: "Cleaning up session data...",
      PURGED: "Session completed",
      ERROR: "Error occurred",
    };
    return labels[currentState] || currentState;
  };

  const getPriorityBadgeVariant = (priority: string) => {
    switch (priority) {
      case "HIGH":
        return "destructive";
      case "MEDIUM":
        return "default";
      default:
        return "secondary";
    }
  };

  const getStatusIndicator = (status: string) => {
    switch (status) {
      case "CONFIRMED":
        return <Badge variant="outline" className="text-green-600 border-green-600 bg-green-50">Confirmed</Badge>;
      case "DENIED":
        return <Badge variant="outline" className="text-muted-foreground border-muted bg-muted/30">Denied</Badge>;
      default:
        return null;
    }
  };

  const canRegenerate = data.llmRequestCount < 3 && 
    (!data.isResumedSession || data.hasNewInputForRegeneration);

  return (
    <div className="min-h-screen bg-background">
      {/* Leave Session Dialog - using new component with navigation guard */}
      <LeaveSessionDialog
        open={showLeaveDialog}
        onStay={handleStayAndClear}
        onCancel={handleCancelAndLeave}
        onSave={canSaveForLater ? handleSaveForLater : undefined}
        saveEnabled={canSaveForLater}
        isLoading={isNavigationCancelling}
      />

      {/* Cancel Session Dialog */}
      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this session?</AlertDialogTitle>
            <AlertDialogDescription>
              This will discard this session and purge temporary data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep working</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmCancel}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Cancel session
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Deny Reason Dialog */}
      <AlertDialog open={denyDialogOpen} onOpenChange={setDenyDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deny timeline event</AlertDialogTitle>
            <AlertDialogDescription>
              Optionally select a reason for denying this event.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <Select value={denyReason} onValueChange={setDenyReason}>
              <SelectTrigger>
                <SelectValue placeholder="Select a reason (optional)" />
              </SelectTrigger>
              <SelectContent>
                {DENY_REASONS.map((reason) => (
                  <SelectItem key={reason.value} value={reason.value}>
                    {reason.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDeny}>
              Deny event
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* New Input Dialog for Regeneration (Resumed Sessions) */}
      <AlertDialog open={showNewInputDialog} onOpenChange={setShowNewInputDialog}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              Regeneration requires new input
            </AlertDialogTitle>
            <AlertDialogDescription>
              Since this is a resumed session, the original audio and transcript have been purged. 
              To regenerate the draft, please provide new notes or context.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <Textarea
              placeholder="Enter additional notes or context..."
              value={newInputText}
              onChange={(e) => setNewInputText(e.target.value)}
              className="min-h-[120px]"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleSubmitNewInput}
              disabled={!newInputText.trim()}
            >
              Regenerate with new input
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold text-foreground">
                  {data.isResumedSession ? "Resumed Note Session" : "New Note Session"}
                </h1>
                {data.isResumedSession && (
                  <Badge variant="outline" className="text-amber-600 border-amber-400 bg-amber-50">
                    Resumed
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {data.clientLabel} • {data.caseLabel} • {getInteractionTypeLabel(data.interactionType)}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {state === "READY_FOR_INPUT" && (
                <Button 
                  variant="outline" 
                  onClick={handleCancelClick}
                  className="text-destructive border-destructive/50 hover:bg-destructive/10 hover:border-destructive"
                >
                  Cancel Session
                </Button>
              )}
              <Badge variant="outline" className="text-xs">
                Session: {data.sessionId.slice(0, 8)}...
              </Badge>
            </div>
          </div>
          
          {/* Progress bar */}
          <div className="mt-4">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-muted-foreground">{getStateLabel(state)}</span>
              <span className="text-muted-foreground">{getProgressValue(state)}%</span>
            </div>
            <Progress value={getProgressValue(state)} className="h-2" />
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="container mx-auto px-6 py-8 max-w-4xl">
        
        {/* V1: READY_FOR_INPUT - Text input only (no audio upload) */}
        {state === "READY_FOR_INPUT" && (
          <Card>
            <CardHeader className="text-center">
              <CardTitle className="text-2xl">Start a New Note</CardTitle>
              <CardDescription>
                Enter your case notes to begin documentation
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <Textarea
                placeholder="Enter your case notes here..."
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                className="min-h-[200px]"
              />
              <div className="flex gap-3">
                <Button variant="outline" onClick={handleCancelClick}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleTextSubmit}
                  disabled={!textInput.trim()}
                  className="flex-1"
                >
                  Continue
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* V1: TEXT_PROVIDED - Show processing indicator and auto-proceed */}
        {state === "TEXT_PROVIDED" && (
          <Card>
            <CardContent className="py-12 text-center">
              <Loader2 className="h-12 w-12 mx-auto text-primary animate-spin mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                Processing your input...
              </h3>
              <p className="text-sm text-muted-foreground">
                Preparing your draft note
              </p>
              <div className="mt-6">
                <Button onClick={() => actions.proceedToDraft()}>
                  Continue to Draft
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* V0 states removed: AUDIO_UPLOADED, TRANSCRIBING, TRANSCRIBED, REDACTING, 
            VERIFICATION_REVIEW, INPUT_READY, RETRIEVING_CONTEXT, GENERATING, VALIDATING_OUTPUT
            See src/legacy/v0_pipeline/ for quarantined code */}

        {/* DRAFT_READY: Review and edit */}
        {(state === "DRAFT_READY" || state === "EDITING") && (
          <div className="space-y-6">
            {/* Resumed session notice */}
            {data.isResumedSession && state === "DRAFT_READY" && (
              <Card className="border-amber-200 bg-amber-50/50">
                <CardContent className="py-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-amber-800">
                        This is a resumed session
                      </p>
                      <p className="text-sm text-amber-700 mt-1">
                        Original audio and transcript were securely purged. Regeneration requires new input.
                        {data.previousResumeBundleId && (
                          <span className="block mt-1 text-xs text-amber-600">
                            Previous bundle ID: {data.previousResumeBundleId.slice(0, 8)}...
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Generated Draft</CardTitle>
                    <CardDescription>
                      Review and edit your case note before approval
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    {state === "DRAFT_READY" && (
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={actions.startEditing}
                      >
                        <Edit3 className="h-4 w-4 mr-1" />
                        Edit
                      </Button>
                    )}
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={handleRequestRegeneration}
                      disabled={data.llmRequestCount >= 3}
                      title={
                        data.isResumedSession && !data.hasNewInputForRegeneration
                          ? "Regeneration requires new input"
                          : undefined
                      }
                    >
                      <RefreshCw className="h-4 w-4 mr-1" />
                      {canRegenerate 
                        ? `Regenerate (${3 - data.llmRequestCount} left)`
                        : data.isResumedSession && !data.hasNewInputForRegeneration
                        ? "New input required"
                        : "Regenerate (0 left)"
                      }
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {state === "EDITING" ? (
                  <div className="space-y-4">
                    <Textarea
                      value={editedDraft}
                      onChange={(e) => setEditedDraft(e.target.value)}
                      className="min-h-[400px] font-mono text-sm"
                    />
                    <div className="flex gap-2 justify-end">
                      <Button 
                        variant="outline" 
                        onClick={() => {
                          setEditedDraft(data.generatedDraft || "");
                          actions.saveEdit(data.generatedDraft || "");
                        }}
                      >
                        Cancel
                      </Button>
                      <Button onClick={handleSaveEdit}>
                        Save Changes
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="prose prose-sm max-w-none dark:prose-invert bg-accent/30 rounded-lg p-6">
                    <pre className="whitespace-pre-wrap font-sans text-foreground">
                      {data.generatedDraft}
                    </pre>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Timeline Events (merged with follow-ups, policy-derived) */}
            {data.timelines && data.timelines.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Timeline Events</CardTitle>
                  <CardDescription>
                    Confirm or deny policy-derived timeline events. Confirmed events will be added to My Tasks.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {data.timelines.map((timeline) => (
                      <div 
                        key={timeline.id}
                        className={`flex items-center gap-4 p-4 rounded-lg border ${
                          timeline.status === "CONFIRMED" 
                            ? "bg-green-50/50 border-green-200" 
                            : timeline.status === "DENIED"
                            ? "bg-muted/30 border-muted"
                            : "bg-accent/50 border-transparent"
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="text-sm font-medium text-foreground truncate">
                              {timeline.title}
                            </p>
                            <Badge variant={getPriorityBadgeVariant(timeline.priority)} className="text-xs shrink-0">
                              {timeline.priority}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2">
                            <p className="text-xs text-muted-foreground">
                              {timeline.date}
                            </p>
                            {getStatusIndicator(timeline.status)}
                            {timeline.status === "DENIED" && timeline.denyReason && (
                              <span className="text-xs text-muted-foreground">
                                — {timeline.denyReason}
                              </span>
                            )}
                          </div>
                        </div>
                        
                        {timeline.status === "PENDING" && (
                          <div className="flex gap-2 shrink-0">
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => handleConfirmTimeline(timeline)}
                              className="gap-1"
                            >
                              <Check className="h-3.5 w-3.5" />
                              Confirm
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDenyClick(timeline.id)}
                              className="gap-1"
                            >
                              <X className="h-3.5 w-3.5" />
                              Deny
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Action buttons */}
            {state === "DRAFT_READY" && (
              <div className="flex gap-3 justify-between">
                <Button variant="outline" onClick={handleCancelClick}>
                  Cancel Session
                </Button>
                <div className="flex gap-3">
                  <Button 
                    variant="secondary" 
                    onClick={handleSaveForLater}
                    className="border border-border hover:bg-blue-100 hover:border-blue-300 hover:text-blue-700 dark:hover:bg-blue-950 dark:hover:border-blue-700 dark:hover:text-blue-300 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:bg-blue-200 dark:active:bg-blue-900 transition-all duration-150 cursor-pointer"
                  >
                    <Save className="h-4 w-4 mr-2" />
                    Save for Later
                  </Button>
                  <Button onClick={actions.approveDraft}>
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Approve Draft
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* APPROVED: Export options */}
        {state === "APPROVED" && (
          <Card>
            <CardHeader className="text-center">
              <CheckCircle2 className="h-16 w-16 mx-auto text-green-500 mb-4" />
              <CardTitle className="text-2xl">Draft Approved</CardTitle>
              <CardDescription>
                Your case note has been approved and is ready for export.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-3 justify-center">
                <Button variant="outline" onClick={actions.skipExport}>
                  Skip Export
                </Button>
                <Button onClick={handleExport}>
                  <Download className="h-4 w-4 mr-2" />
                  Export to System of Record
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* EXPORTING */}
        {state === "EXPORTING" && (
          <Card>
            <CardContent className="py-12 text-center">
              <Loader2 className="h-12 w-12 mx-auto text-primary animate-spin mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                Exporting...
              </h3>
              <p className="text-sm text-muted-foreground">
                Sending your approved note to the system of record.
              </p>
            </CardContent>
          </Card>
        )}

        {/* CLOSING */}
        {state === "CLOSING" && (
          <Card>
            <CardContent className="py-12 text-center">
              <Trash2 className="h-12 w-12 mx-auto text-muted-foreground animate-pulse mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                Cleaning up session data...
              </h3>
              <p className="text-sm text-muted-foreground">
                Securely purging all temporary session artifacts.
              </p>
            </CardContent>
          </Card>
        )}

        {/* ERROR */}
        {state === "ERROR" && (
          <Card>
            <CardContent className="py-12 text-center">
              <AlertTriangle className="h-12 w-12 mx-auto text-destructive mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                An error occurred
              </h3>
              <p className="text-sm text-muted-foreground mb-6">
                {data.errorMessage || "Something went wrong. Please try again."}
              </p>
              <div className="flex gap-3 justify-center">
                <Button variant="outline" onClick={handleCancelClick}>
                  Cancel Session
                </Button>
                <Button onClick={actions.retryFromError}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Retry
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
