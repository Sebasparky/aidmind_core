import { useState, useCallback, useRef } from "react";
import { useSessionApi } from "./useSessionApi";

/**
 * V1 Session States
 * 
 * The v1 session flow is simplified - no transcription/redaction/generative pipeline.
 * V0 states (AUDIO_UPLOADED, TRANSCRIBING, TRANSCRIBED, REDACTING, VERIFICATION_REVIEW,
 * INPUT_READY, RETRIEVING_CONTEXT, GENERATING, VALIDATING_OUTPUT) are quarantined in:
 *   src/legacy/v0_pipeline/legacySessionTypes.ts
 */
export type SessionState =
  | "NEW"                 // Initial state
  | "READY_FOR_INPUT"     // Awaiting user input (text notes)
  | "TEXT_PROVIDED"       // User has provided text notes
  | "DRAFT_READY"         // Draft is ready for review (manual entry or resumed)
  | "EDITING"             // User is editing the draft
  | "APPROVED"            // Draft has been approved
  | "EXPORTING"           // Exporting to system of record
  | "CLOSING"             // Cleaning up session data
  | "PURGED"              // Session completed and cleaned up
  | "ERROR";              // Error state

// V1 states list for validation
export const V1_SESSION_STATES = [
  "NEW",
  "READY_FOR_INPUT", 
  "TEXT_PROVIDED",
  "DRAFT_READY",
  "EDITING",
  "APPROVED",
  "EXPORTING",
  "CLOSING",
  "PURGED",
  "ERROR",
] as const;

export type TimelineEventStatus = "PENDING" | "CONFIRMED" | "DENIED";

/**
 * V1 Session Data
 * 
 * Removed v0 fields: transcript, minimizedTranscript, audioFile,
 * verificationFailedCategories, isReverifying, redactionStatus
 * 
 * These are preserved in src/legacy/v0_pipeline/legacySessionTypes.ts
 */
export interface SessionData {
  sessionId: string;
  caseId: string;
  caseLabel: string;
  clientLabel: string;
  interactionType: string;
  timestamp: Date;
  textNotes?: string;
  generatedDraft?: string;
  timelines?: TimelineItem[];
  llmRequestCount: number;
  errorMessage?: string;
  previousStateBeforeError?: SessionState;
  exportCompleted?: boolean;
  savedForLater?: boolean;
  // Resume-related fields
  isResumedSession?: boolean;
  previousResumeBundleId?: string;
  hasNewInputForRegeneration?: boolean;
}

export interface TimelineItem {
  id: string;
  title: string;
  date: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
  status: TimelineEventStatus;
  denyReason?: string;
  createdTaskId?: string; // Track if this already created a task (for resume deduplication)
}

/**
 * Resume bundle structure (for Save for Later)
 * 
 * V1 placeholder notes:
 * - template_ids, policy_pack_ids, unknown_fields are placeholders until
 *   templates/policy packs are implemented in a future version.
 * - No audio/transcript/redaction references - v1 is text-only.
 */
export interface ResumeBundle {
  version: "1.0";
  resume_bundle_id: string;
  created_at: string;
  case_reference: {
    caseId: string;
    caseLabel: string;
    clientLabel: string;
    interactionType: string;
  };
  draft_content: string;
  timeline_events: TimelineItem[];
  // V1 placeholder until templates/policy packs are implemented
  placeholder_data: true;
  template_ids: string[];
  policy_pack_ids: string[];
  unknown_fields: string[];
}

// V1: Mock timeline events for demo (transcription/draft mocks removed)
// V0 mock data moved to src/legacy/v0_pipeline/

/**
 * Timeline suggestions (placeholder)
 * 
 * These are hardcoded placeholder suggestions until the policy engine
 * is implemented. In production, these would be derived from:
 * - Case context
 * - Agency policy packs
 * - Deadline templates
 */
const PLACEHOLDER_TIMELINE_SUGGESTIONS: TimelineItem[] = [
  {
    id: "1",
    title: "Schedule follow-up appointment",
    date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString(),
    priority: "HIGH",
    status: "PENDING",
  },
  {
    id: "2",
    title: "Send resource information to client",
    date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toLocaleDateString(),
    priority: "MEDIUM",
    status: "PENDING",
  },
  {
    id: "3",
    title: "Document case notes",
    date: new Date().toLocaleDateString(),
    priority: "LOW",
    status: "PENDING",
  },
];

interface UseSessionMachineProps {
  caseId: string;
  caseLabel: string;
  clientLabel: string;
  interactionType: string;
  tenantId: string;
  userId: string;
  resumeBundle?: ResumeBundle;
}

export function useSessionMachine({
  caseId,
  caseLabel,
  clientLabel,
  interactionType,
  tenantId,
  userId,
  resumeBundle,
}: UseSessionMachineProps) {
  const [state, setState] = useState<SessionState>("NEW");
  const [data, setData] = useState<SessionData>({
    sessionId: "", // Empty until backend returns real session ID
    caseId,
    caseLabel,
    clientLabel,
    interactionType,
    timestamp: new Date(),
    llmRequestCount: 0,
    exportCompleted: false,
    savedForLater: false,
    isResumedSession: !!resumeBundle,
    previousResumeBundleId: resumeBundle?.resume_bundle_id,
    hasNewInputForRegeneration: false,
  });

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Track request_id per action for idempotency
  const actionRequestIdRef = useRef<string>("");
  
  // Generate a new request_id for each action
  const generateRequestId = useCallback(() => {
    actionRequestIdRef.current = crypto.randomUUID();
    return actionRequestIdRef.current;
  }, []);
  
  const sessionApi = useSessionApi();

  // Helper to simulate async operations
  const simulateAsync = useCallback((ms: number): Promise<void> => {
    return new Promise((resolve) => {
      timeoutRef.current = setTimeout(resolve, ms);
    });
  }, []);

  // Cleanup timeouts
  const cleanup = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // START_SESSION: NEW → READY_FOR_INPUT (or DRAFT_READY if resuming)
  const startSession = useCallback(async () => {
    if (state !== "NEW") return;
    
    const requestId = generateRequestId();
    
    // ALWAYS create session in database - backend is source of truth for session ID
    try {
      console.log("[AidMind] Creating session with:", {
        case_id: caseId,
        case_label: caseLabel,
        client_label: clientLabel,
        interaction_type: interactionType,
      });
      
      const session = await sessionApi.createSession({
        case_id: caseId,
        case_label: caseLabel,
        client_label: clientLabel,
        interaction_type: interactionType,
        request_id: requestId,
      });
      
      if (!session) {
        throw new Error("Backend returned null session");
      }
      
      // Update local session ID to match database record
      setData((prev) => ({ ...prev, sessionId: session.session_id }));
      console.log("[AidMind] Session created:", {
        session_id: session.session_id,
        case_label: session.case_label,
      });
    } catch (error) {
      console.error("Failed to create session:", error);
      setData((prev) => ({
        ...prev,
        errorMessage: "Failed to create session. Please try again.",
        previousStateBeforeError: "NEW",
      }));
      setState("ERROR");
      return;
    }
    
    if (resumeBundle) {
      // Resume from bundle: restore state and go directly to DRAFT_READY
      setData((prev) => ({
        ...prev,
        generatedDraft: resumeBundle.draft_content,
        timelines: resumeBundle.timeline_events,
        isResumedSession: true,
        previousResumeBundleId: resumeBundle.resume_bundle_id,
      }));
      setState("DRAFT_READY");
      console.log("[AidMind] WIP_BUNDLE_IMPORTED");
    } else {
      setState("READY_FOR_INPUT");
    }
  }, [state, generateRequestId, resumeBundle, sessionApi, caseId, caseLabel, clientLabel, interactionType]);

  // V1: PASTE_TEXT_NOTES: READY_FOR_INPUT → TEXT_PROVIDED
  // In v1, this is the primary input method (no audio upload/transcription)
  const pasteTextNotes = useCallback(
    async (text: string) => {
      if (state !== "READY_FOR_INPUT") return;
      setData((prev) => ({ 
        ...prev, 
        textNotes: text,
        hasNewInputForRegeneration: true,
      }));
      await simulateAsync(300);
      setState("TEXT_PROVIDED");
    },
    [state, simulateAsync]
  );

  // V1: Skip to DRAFT_READY from TEXT_PROVIDED
  // In v1, user manually writes/edits the note - no generative pipeline
  const proceedToDraft = useCallback(async () => {
    if (state !== "TEXT_PROVIDED") return;
    // Use the text notes as the initial draft
    setData((prev) => ({
      ...prev,
      generatedDraft: prev.textNotes || "",
      timelines: PLACEHOLDER_TIMELINE_SUGGESTIONS, // Placeholder suggestions
    }));
    setState("DRAFT_READY");
  }, [state]);

  // EDIT: DRAFT_READY → EDITING
  const startEditing = useCallback(() => {
    if (state !== "DRAFT_READY") return;
    setState("EDITING");
  }, [state]);

  // SAVE_VERSION: EDITING → DRAFT_READY
  const saveEdit = useCallback(
    (updatedDraft: string) => {
      if (state !== "EDITING") return;
      setData((prev) => ({ ...prev, generatedDraft: updatedDraft }));
      setState("DRAFT_READY");
    },
    [state]
  );

  // V1: No regeneration - generative pipeline is disabled
  // User must manually edit the draft instead
  const regenerateDraft = useCallback(async () => {
    // V1: Regeneration disabled - just start editing instead
    console.warn("[V1] regenerateDraft called but generative pipeline is disabled");
    if (state === "DRAFT_READY") {
      // Just go to editing mode
      setState("EDITING");
    }
  }, [state]);

  // CONFIRM_TIMELINE: Set timeline status to CONFIRMED
  const confirmTimeline = useCallback(
    (timelineId: string, createdTaskId?: string) => {
      if (state !== "DRAFT_READY") return;
      setData((prev) => ({
        ...prev,
        timelines: prev.timelines?.map((t) =>
          t.id === timelineId 
            ? { ...t, status: "CONFIRMED" as TimelineEventStatus, createdTaskId } 
            : t
        ),
      }));
    },
    [state]
  );

  // DENY_TIMELINE: Set timeline status to DENIED with optional reason
  const denyTimeline = useCallback(
    (timelineId: string, reason?: string) => {
      if (state !== "DRAFT_READY") return;
      setData((prev) => ({
        ...prev,
        timelines: prev.timelines?.map((t) =>
          t.id === timelineId
            ? { ...t, status: "DENIED" as TimelineEventStatus, denyReason: reason }
            : t
        ),
      }));
    },
    [state]
  );

  // RESET_TIMELINE: Reset timeline status to PENDING (for undo)
  const resetTimeline = useCallback(
    (timelineId: string) => {
      if (state !== "DRAFT_READY") return;
      setData((prev) => ({
        ...prev,
        timelines: prev.timelines?.map((t) =>
          t.id === timelineId
            ? { ...t, status: "PENDING" as TimelineEventStatus, denyReason: undefined, createdTaskId: undefined }
            : t
        ),
      }));
    },
    [state]
  );

  // APPROVE: DRAFT_READY → APPROVED
  const approveDraft = useCallback(() => {
    if (state !== "DRAFT_READY") return;
    setState("APPROVED");
  }, [state]);

  // EXPORT: APPROVED → EXPORTING → CLOSING
  const exportDraft = useCallback(async () => {
    if (state !== "APPROVED") return;
    setState("EXPORTING");
    await simulateAsync(1500); // Simulate export
    setData((prev) => ({ ...prev, exportCompleted: true }));
    setState("CLOSING");
  }, [state, simulateAsync]);

  // Skip export and go directly to closing
  const skipExport = useCallback(() => {
    if (state !== "APPROVED") return;
    setState("CLOSING");
  }, [state]);

  // SAVE_FOR_LATER: DRAFT_READY → generate bundle → CLOSING
  const saveForLater = useCallback((): ResumeBundle | null => {
    if (state !== "DRAFT_READY") return null;
    
    // V1 placeholder: template_ids, policy_pack_ids, unknown_fields are
    // placeholders until templates/policy packs are implemented.
    const bundle: ResumeBundle = {
      version: "1.0",
      resume_bundle_id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      case_reference: {
        caseId: data.caseId,
        caseLabel: data.caseLabel,
        clientLabel: data.clientLabel,
        interactionType: data.interactionType,
      },
      draft_content: data.generatedDraft || "",
      timeline_events: data.timelines || [],
      placeholder_data: true,
      template_ids: [],
      policy_pack_ids: [],
      unknown_fields: [],
    };

    // Log events (internal only)
    console.log("[AidMind Event] WIP_BUNDLE_EXPORTED");
    console.log("[AidMind Event] EPHEMERAL_INPUTS_PURGED");
    console.log("[AidMind Event] SESSION_CLOSED");

    setData((prev) => ({ ...prev, savedForLater: true }));
    
    return bundle;
  }, [state, data]);

  // Trigger closing after save for later
  const triggerClosingAfterSave = useCallback(() => {
    setState("CLOSING");
  }, []);

  // CANCEL_SESSION: Any state → directly to PURGED (calls backend to emit terminal event)
  // Does NOT go through CLOSING to avoid triggering completePurge effect
  const cancelSession = useCallback(async () => {
    if (state === "PURGED") return;
    
    // Only call backend if we have a valid session ID
    if (data.sessionId) {
      try {
        await sessionApi.cancelSession(data.sessionId);
        console.log("[AidMind] Session cancelled:", data.sessionId);
      } catch (error) {
        console.error("Failed to cancel session in backend:", error);
        // Continue with local cleanup even if backend fails
      }
    }
    
    cleanup();
    setData((prev) => ({
      ...prev,
      textNotes: undefined,
      generatedDraft: undefined,
      timelines: undefined,
    }));
    setState("PURGED");
  }, [state, data.sessionId, sessionApi, cleanup]);

  // Complete purge: CLOSING → PURGED (calls backend to emit terminal event)
  const completePurge = useCallback(async () => {
    if (state !== "CLOSING") return;
    
    // Only call backend if we have a valid session ID and export was completed
    if (data.sessionId && data.exportCompleted) {
      try {
        await sessionApi.closeSession(data.sessionId);
        console.log("[AidMind] Session closed:", data.sessionId);
      } catch (error) {
        console.error("Failed to close session in backend:", error);
        // Continue with local cleanup even if backend fails
      }
    }
    
    cleanup();
    setData((prev) => ({
      ...prev,
      textNotes: undefined,
      generatedDraft: undefined,
      timelines: undefined,
    }));
    setState("PURGED");
  }, [state, data.sessionId, data.exportCompleted, sessionApi, cleanup]);

  // ERROR handling
  const handleError = useCallback(
    (message: string) => {
      setData((prev) => ({
        ...prev,
        errorMessage: message,
        previousStateBeforeError: state,
      }));
      setState("ERROR");
    },
    [state]
  );

  // RETRY from ERROR
  const retryFromError = useCallback(() => {
    if (state !== "ERROR") return;
    const previousState = data.previousStateBeforeError;
    setData((prev) => ({
      ...prev,
      errorMessage: undefined,
      previousStateBeforeError: undefined,
    }));
    if (previousState) {
      setState(previousState);
    } else {
      setState("READY_FOR_INPUT");
    }
  }, [state, data.previousStateBeforeError]);

  // Add new input for regeneration (for resumed sessions)
  const addNewInputForRegeneration = useCallback(
    async (text: string) => {
      if (state !== "DRAFT_READY") return;
      setData((prev) => ({ 
        ...prev, 
        textNotes: text,
        hasNewInputForRegeneration: true,
      }));
    },
    [state]
  );

  return {
    state,
    data,
    actions: {
      // V1 Session Actions (no transcription/redaction/generative pipeline)
      startSession,
      pasteTextNotes,
      proceedToDraft,
      startEditing,
      saveEdit,
      regenerateDraft, // V1: Just switches to editing mode
      confirmTimeline,
      denyTimeline,
      resetTimeline,
      approveDraft,
      exportDraft,
      skipExport,
      saveForLater,
      triggerClosingAfterSave,
      cancelSession,
      completePurge,
      handleError,
      retryFromError,
      cleanup,
      addNewInputForRegeneration,
    },
  };
}
