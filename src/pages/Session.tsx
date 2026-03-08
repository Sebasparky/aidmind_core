import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSessionMachine, SessionState, ResumeBundle } from "@/hooks/useSessionMachine";
import { useSessionNavigationGuard } from "@/hooks/useSessionNavigationGuard";
import { useSessionHeartbeat } from "@/hooks/useSessionHeartbeat";
import { useNavigationGuard } from "@/contexts/NavigationGuardContext";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/hooks/useTenant";
import { useDashboard } from "@/contexts/DashboardContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
  Loader2, 
  CheckCircle2, 
  Download,
  Trash2,
  Save,
  AlertCircle
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { LeaveSessionDialog } from "@/components/session/LeaveSessionDialog";
import { SetupSection } from "@/components/session/SetupSection";
import { GuidanceSection } from "@/components/session/GuidanceSection";
import { WorkAreaSection } from "@/components/session/WorkAreaSection";
import { ReviewerSection } from "@/components/session/ReviewerSection";
import { SessionErrorCard } from "@/components/session/SessionErrorCard";

interface TemplateFields {
  summary: string;
  presentingConcern: string;
  actionsTaken: string;
  plan: string;
}

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
  const effectiveCaseLabel = noteTitleParam?.trim() 
    || caseLabelParam?.trim() 
    || resumeBundle?.case_reference.caseLabel 
    || "Untitled session";
  
  const { state, data, actions } = useSessionMachine({
    caseId: resumeBundle?.case_reference.caseId || caseId,
    caseLabel: effectiveCaseLabel,
    clientLabel: resumeBundle?.case_reference.clientLabel || clientLabel,
    interactionType: resumeBundle?.case_reference.interactionType || interactionType,
    resumeBundle,
  });

  // V1 UI State - local only (no backend yet)
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [policyPackUploaded, setPolicyPackUploaded] = useState(false);
  const [templateFields, setTemplateFields] = useState<TemplateFields>({
    summary: "",
    presentingConcern: "",
    actionsTaken: "",
    plan: "",
  });
  const [scratchpadNotes, setScratchpadNotes] = useState("");
  
  // Exit dialog - only for explicit cancel button
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [isNavigationCancelling, setIsNavigationCancelling] = useState(false);

  // Track created task IDs for undo
  const createdTasksRef = useRef<Map<string, string>>(new Map());

  // Intended navigation target when the user tries to leave mid-session
  const leaveTargetRef = useRef<string | null>(null);

  // Prevent duplicate session creation from re-renders
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
      bumpAttemptedStart((v) => v + 1);
      startSessionRef.current();
    }
  }, [state]);

  // Navigate to dashboard when purged with appropriate message
  useEffect(() => {
    if (state === "PURGED") {
      if (data.exportCompleted) {
        toast({
          title: "✅ Export complete",
          description: "Session finalized and closed successfully.",
          className: "border-green-500 bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-100 dark:border-green-700",
        });
      } else if (data.savedForLater) {
        // Message already shown by handleSaveForLater
      } else {
        toast({
          title: "❌ Session cancelled",
          description: "Documentation discarded and temporary data purged.",
          className: "border-destructive bg-destructive/10 text-destructive dark:bg-destructive/20",
        });
      }

      navigate(leaveTargetRef.current || "/dashboard");
    }
  }, [state, navigate, data.exportCompleted, data.savedForLater]);

  // Auto-complete purge when closing
  useEffect(() => {
    if (state === "CLOSING") {
      actions.completePurge();
    }
  }, [state, actions]);

  // Determine if session is "dirty"
  const isTerminalState = state === "PURGED" || (state === "NEW" && !hasAttemptedStartRef.current);
  const canSaveForLater = state === "DRAFT_READY";
  const isDirtySession =
    !isTerminalState && (hasAttemptedStartRef.current || data.sessionId !== "");

  // Session heartbeat
  useSessionHeartbeat({
    sessionId: data.sessionId || null,
    isActive: !isTerminalState && !!data.sessionId,
  });

  // Navigation guard context
  const { setGuard, clearGuard } = useNavigationGuard();

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

  useEffect(() => {
    setGuard({
      active: isDirtySession,
      guardedNavigate: guardedNavigateWithTarget,
    });

    return () => {
      clearGuard();
    };
  }, [isDirtySession, guardedNavigateWithTarget, setGuard, clearGuard]);

  const handleExport = useCallback(() => {
    actions.exportDraft();
  }, [actions]);

  const handleCancelClick = useCallback(() => {
    setShowCancelDialog(true);
  }, []);

  const handleConfirmCancel = useCallback(() => {
    setShowCancelDialog(false);
    actions.cancelSession();
  }, [actions]);

  const handleSaveForLater = useCallback(() => {
    const bundle = actions.saveForLater();
    if (bundle) {
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `aidmind_session_bundle_v1_${bundle.resume_bundle_id.slice(0, 8)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "💾 Session saved for later",
        description: "Download complete. Session closed and temporary data purged.",
        className: "border-blue-500 bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-100 dark:border-blue-700",
      });

      actions.triggerClosingAfterSave();
    }
  }, [actions]);

  const handlePolicyPackUpload = useCallback(() => {
    // Placeholder: just toggle state
    setPolicyPackUploaded(true);
    toast({
      title: "Policy pack uploaded",
      description: "Policy pack ready for guidance generation.",
    });
  }, []);

  const handleTemplateFieldChange = useCallback((field: keyof TemplateFields, value: string) => {
    setTemplateFields((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleJumpToSection = useCallback((sectionRef: string) => {
    const element = document.getElementById(sectionRef);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      element.focus();
    }
  }, []);

  const getInteractionTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      phone_call: "Phone call",
      visit: "Visit",
      meeting: "Meeting",
      other: "Other",
    };
    return labels[type] || type;
  };

  // V1 Progress mapping
  const getProgressValue = (currentState: SessionState): number => {
    const progressMap: Record<SessionState, number> = {
      NEW: 0,
      READY_FOR_INPUT: 20,
      TEXT_PROVIDED: 40,
      DRAFT_READY: 60,
      EDITING: 70,
      APPROVED: 85,
      EXPORTING: 95,
      CLOSING: 98,
      PURGED: 100,
      ERROR: 0,
    };
    return progressMap[currentState] || 0;
  };

  // V1 State labels
  const getStateLabel = (currentState: SessionState): string => {
    const labels: Record<SessionState, string> = {
      NEW: "Initializing session...",
      READY_FOR_INPUT: "Ready for documentation",
      TEXT_PROVIDED: "Preparing workspace...",
      DRAFT_READY: data.isResumedSession ? "Resumed session ready" : "Documentation in progress",
      EDITING: "Editing documentation",
      APPROVED: "Documentation approved",
      EXPORTING: "Exporting to system of record...",
      CLOSING: "Cleaning up session data...",
      PURGED: "Session completed",
      ERROR: "Error occurred",
    };
    return labels[currentState] || currentState;
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Leave Session Dialog */}
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

      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold text-foreground">
                  {data.isResumedSession ? "Resumed Documentation Session" : "Documentation Session"}
                </h1>
                {data.isResumedSession && (
                  <Badge variant="outline" className="text-amber-600 border-amber-400 bg-amber-50">
                    Resumed
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {data.caseLabel} • {getInteractionTypeLabel(data.interactionType)}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {(state === "READY_FOR_INPUT" || state === "TEXT_PROVIDED" || state === "DRAFT_READY") && (
                <Button 
                  variant="outline" 
                  onClick={handleCancelClick}
                  className="text-destructive border-destructive/50 hover:bg-destructive/10 hover:border-destructive"
                >
                  Cancel Session
                </Button>
              )}
              <Button variant="outline" size="sm" disabled title="Save for later (coming soon)">
                <Save className="h-4 w-4 mr-2" />
                Save for later
              </Button>
              <Badge variant="outline" className="text-xs">
                Session: {data.sessionId.slice(0, 8) || "..."}
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
        
        {/* NEW: Loading state */}
        {state === "NEW" && (
          <Card>
            <CardContent className="py-12 text-center">
              <Loader2 className="h-12 w-12 mx-auto text-primary animate-spin mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                Initializing session...
              </h3>
              <p className="text-sm text-muted-foreground">
                Setting up your documentation workspace
              </p>
            </CardContent>
          </Card>
        )}

        {/* V1: READY_FOR_INPUT - Show the new three-section layout */}
        {(state === "READY_FOR_INPUT" || state === "TEXT_PROVIDED" || state === "DRAFT_READY" || state === "EDITING") && (
          <div className="space-y-6">
            {/* Resumed session notice */}
            {data.isResumedSession && (
              <Card className="border-amber-200 bg-amber-50/50">
                <CardContent className="py-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-amber-800">
                        This is a resumed session
                      </p>
                      <p className="text-sm text-amber-700 mt-1">
                        Previous session artifacts were purged. You can continue editing safely.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* A) Setup Section */}
            <SetupSection
              selectedTemplate={selectedTemplate}
              onTemplateChange={setSelectedTemplate}
              policyPackUploaded={policyPackUploaded}
              onPolicyPackUpload={handlePolicyPackUpload}
            />

            {/* B) Guidance Section */}
            <GuidanceSection isTemplateSelected={selectedTemplate !== ""} sessionId={data.sessionId} />

            {/* C) Work Area Section */}
            <WorkAreaSection
              templateFields={templateFields}
              onTemplateFieldChange={handleTemplateFieldChange}
              scratchpadNotes={scratchpadNotes}
              onScratchpadChange={setScratchpadNotes}
            />

            {/* D) Reviewer Section */}
            <ReviewerSection onJumpToSection={handleJumpToSection} />

            {/* Action buttons */}
            <div className="flex gap-3 justify-between pt-4 border-t">
              <Button variant="outline" onClick={handleCancelClick}>
                Cancel Session
              </Button>
              <div className="flex gap-3">
                <Button 
                  variant="secondary" 
                  onClick={handleSaveForLater}
                  className="border border-border hover:bg-blue-100 hover:border-blue-300 hover:text-blue-700 dark:hover:bg-blue-950 dark:hover:border-blue-700 dark:hover:text-blue-300"
                >
                  <Save className="h-4 w-4 mr-2" />
                  Save for Later
                </Button>
                <Button onClick={actions.approveDraft}>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Approve Documentation
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* APPROVED: Export options */}
        {state === "APPROVED" && (
          <Card>
            <CardHeader className="text-center">
              <CheckCircle2 className="h-16 w-16 mx-auto text-green-500 mb-4" />
              <CardTitle className="text-2xl">Documentation Approved</CardTitle>
              <CardDescription>
                Your documentation has been approved and is ready for export.
              </CardDescription>
              <Badge variant="outline" className="mx-auto mt-2 text-amber-600 border-amber-400">
                Export is simulated in v1 — no system of record connected
              </Badge>
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
                Sending your approved documentation to the system of record.
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
          <SessionErrorCard
            errorMessage={data.errorMessage}
            onRetry={actions.retryFromError}
            onCancel={handleCancelClick}
          />
        )}
      </main>
    </div>
  );
}
