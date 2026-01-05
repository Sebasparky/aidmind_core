import { useState, useCallback, useRef } from "react";
import { useTranscription, TranscriptionModel, TRANSCRIPTION_MODELS } from "./useTranscription";
import { useSessionApi } from "./useSessionApi";

// Re-export for convenience
export { TRANSCRIPTION_MODELS };
export type { TranscriptionModel };

// Session states following the AidMind State Machine
export type SessionState =
  | "NEW"
  | "READY_FOR_INPUT"
  | "AUDIO_UPLOADED"
  | "TEXT_PROVIDED"
  | "TRANSCRIBING"
  | "TRANSCRIBED"
  | "REDACTING"
  | "VERIFICATION_REVIEW" // New state for verification failure UX
  | "INPUT_READY"
  | "RETRIEVING_CONTEXT"
  | "GENERATING"
  | "VALIDATING_OUTPUT"
  | "DRAFT_READY"
  | "EDITING"
  | "APPROVED"
  | "EXPORTING"
  | "CLOSING"
  | "PURGED"
  | "ERROR";

export type TimelineEventStatus = "PENDING" | "CONFIRMED" | "DENIED";

export interface SessionData {
  sessionId: string;
  caseId: string;
  caseLabel: string;
  clientLabel: string;
  interactionType: string;
  timestamp: Date;
  audioFile?: File;
  textNotes?: string;
  transcript?: string;
  minimizedTranscript?: string;
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
  // Verification review fields
  verificationFailedCategories?: string[];
  isReverifying?: boolean;
  redactionStatus?: {
    layer1?: { status: string; counts?: Record<string, number> };
    layer2?: { status: string; counts?: Record<string, number>; method?: string; skipped_reason?: string };
    layer3?: { status: string; categories?: string[] };
  };
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

// Resume bundle structure (for Save for Later)
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
  template_ids: string[]; // Dummy placeholder
  policy_pack_ids: string[]; // Dummy placeholder
  unknown_fields: string[]; // Placeholder for unfilled fields
}

// Mock data - policy-derived timeline events
const MOCK_TRANSCRIPT = `Client A. J. discussed housing instability and upcoming follow-up needs. They mentioned receiving an eviction notice last week and are concerned about finding affordable housing options. Client expressed interest in emergency shelter placement if needed. They also mentioned needing help with utility assistance programs. A follow-up appointment was scheduled to review available resources.`;

const MOCK_MINIMIZED_TRANSCRIPT = `Client discussed housing concerns including recent eviction notice. Interested in emergency shelter options and utility assistance. Follow-up scheduled for resource review.`;

const MOCK_GENERATED_DRAFT = `## Case Note Summary

**Date:** ${new Date().toLocaleDateString()}
**Interaction Type:** Phone Call
**Client:** A. J.

### Presenting Concerns
- Housing instability due to recent eviction notice
- Need for emergency housing options
- Utility assistance requirements

### Discussion Summary
Client reported receiving an eviction notice within the past week. They expressed significant concern regarding their ability to secure affordable housing alternatives. Emergency shelter placement was discussed as a potential interim solution.

### Action Items
1. Research available emergency shelter options in client's area
2. Connect client with utility assistance programs
3. Schedule follow-up appointment to review housing resources

### Follow-Up Required
- **Next Appointment:** Within 7 days
- **Priority:** High
- **Notes:** Ensure client has emergency contact information for housing crisis line

### Compliance Notes
- Client consent obtained for documentation
- PHI minimized per agency policy
- Session notes reviewed for accuracy`;

// Mock policy-derived timeline events (merged from previous timelines and follow-ups)
const MOCK_TIMELINES: TimelineItem[] = [
  {
    id: "1",
    title: "Schedule housing resource review appointment",
    date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString(),
    priority: "HIGH",
    status: "PENDING",
  },
  {
    id: "2",
    title: "Send utility assistance program information",
    date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toLocaleDateString(),
    priority: "MEDIUM",
    status: "PENDING",
  },
  {
    id: "3",
    title: "Document eviction notice receipt",
    date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toLocaleDateString(),
    priority: "HIGH",
    status: "PENDING",
  },
  {
    id: "4",
    title: "Update case file with consultation notes",
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
  resumeBundle?: ResumeBundle;
  transcriptionModel?: TranscriptionModel;
  useRealTranscription?: boolean; // Toggle for real vs mock transcription
}

export function useSessionMachine({
  caseId,
  caseLabel,
  clientLabel,
  interactionType,
  resumeBundle,
  transcriptionModel = "gpt-4o-mini-transcribe",
  useRealTranscription = true,
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
  
  // Real transcription hooks
  const transcription = useTranscription({ 
    model: transcriptionModel, 
    autoRedact: true 
  });
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
    transcription.reset();
  }, [transcription]);

  // START_SESSION: NEW → READY_FOR_INPUT (or DRAFT_READY if resuming)
  const startSession = useCallback(async () => {
    if (state !== "NEW") return;
    
    const requestId = generateRequestId();
    
    // ALWAYS create session in database - backend is source of truth for session ID
    try {
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
      console.log("[AidMind] Session created with ID:", session.session_id);
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

  // UPLOAD_AUDIO: READY_FOR_INPUT → AUDIO_UPLOADED
  const uploadAudio = useCallback(
    async (file: File) => {
      if (state !== "READY_FOR_INPUT") return;
      setData((prev) => ({ 
        ...prev, 
        audioFile: file,
        hasNewInputForRegeneration: true, // New input provided
      }));
      await simulateAsync(500);
      setState("AUDIO_UPLOADED");
    },
    [state, simulateAsync]
  );

  // PASTE_TEXT_NOTES: READY_FOR_INPUT → TEXT_PROVIDED
  const pasteTextNotes = useCallback(
    async (text: string) => {
      if (state !== "READY_FOR_INPUT") return;
      setData((prev) => ({ 
        ...prev, 
        textNotes: text,
        hasNewInputForRegeneration: true, // New input provided
      }));
      await simulateAsync(300);
      setState("TEXT_PROVIDED");
    },
    [state, simulateAsync]
  );

  // START_TRANSCRIPTION: AUDIO_UPLOADED → TRANSCRIBING → TRANSCRIBED
  const startTranscription = useCallback(async () => {
    if (state !== "AUDIO_UPLOADED") return;
    setState("TRANSCRIBING");
    
    if (useRealTranscription && data.audioFile) {
      try {
        // Upload audio to storage
        const objectKey = await transcription.uploadAudio(data.sessionId, data.audioFile);
        if (!objectKey) {
          throw new Error("Failed to upload audio");
        }
        
        // Transcribe using OpenAI API
        const transcript = await transcription.transcribe(data.sessionId, objectKey);
        if (!transcript) {
          throw new Error("Transcription failed");
        }
        
        setData((prev) => ({ ...prev, transcript }));
        setState("TRANSCRIBED");
        
        console.log("[AidMind Event] TRANSCRIPTION_COMPLETED");
      } catch (error) {
        console.error("Transcription error:", error);
        setData((prev) => ({
          ...prev,
          errorMessage: error instanceof Error ? error.message : "Transcription failed",
          previousStateBeforeError: "TRANSCRIBING",
        }));
        setState("ERROR");
      }
    } else {
      // Fallback to mock for development
      await simulateAsync(2000);
      setData((prev) => ({ ...prev, transcript: MOCK_TRANSCRIPT }));
      setState("TRANSCRIBED");
    }
  }, [state, data.audioFile, data.sessionId, useRealTranscription, transcription, simulateAsync]);

  // START_REDACTION: TRANSCRIBED/TEXT_PROVIDED → REDACTING → INPUT_READY or VERIFICATION_REVIEW
  const startRedaction = useCallback(async () => {
    if (state !== "TRANSCRIBED" && state !== "TEXT_PROVIDED") return;
    setState("REDACTING");
    
    if (useRealTranscription && (data.transcript || data.textNotes)) {
      try {
        // Use the 3-layer redact function
        const result = await transcription.redact(data.sessionId, data.transcript || data.textNotes);
        
        if (!result.minimizedTranscript) {
          throw new Error("Redaction failed");
        }
        
        // Check verification result
        if (!result.verificationPassed) {
          // Verification failed - enter VERIFICATION_REVIEW state
          setData((prev) => ({
            ...prev,
            minimizedTranscript: result.minimizedTranscript || "",
            verificationFailedCategories: result.failedCategories,
            redactionStatus: result.redactionStatus ? {
              layer1: result.redactionStatus.layer1,
              layer2: result.redactionStatus.layer2,
              layer3: result.redactionStatus.layer3,
            } : undefined,
          }));
          setState("VERIFICATION_REVIEW");
          console.log("[AidMind Event] REDACTION_REVIEW_ENTERED");
          return;
        }
        
        setData((prev) => ({
          ...prev,
          minimizedTranscript: result.minimizedTranscript || "",
          verificationFailedCategories: undefined,
          redactionStatus: result.redactionStatus ? {
            layer1: result.redactionStatus.layer1,
            layer2: result.redactionStatus.layer2,
            layer3: result.redactionStatus.layer3,
          } : undefined,
        }));
        setState("INPUT_READY");
        
        console.log("[AidMind Event] REDACTION_COMPLETED");
      } catch (error) {
        console.error("Redaction error:", error);
        setData((prev) => ({
          ...prev,
          errorMessage: error instanceof Error ? error.message : "Redaction failed",
          previousStateBeforeError: "REDACTING",
        }));
        setState("ERROR");
      }
    } else {
      // Fallback to mock for development
      await simulateAsync(1500);
      setData((prev) => ({
        ...prev,
        minimizedTranscript: MOCK_MINIMIZED_TRANSCRIPT,
      }));
      setState("INPUT_READY");
    }
  }, [state, data.sessionId, data.transcript, data.textNotes, useRealTranscription, transcription, simulateAsync]);

  // REVERIFY_TEXT: VERIFICATION_REVIEW → INPUT_READY (if pass) or stay (if fail)
  const reverifyText = useCallback(async (editedText: string) => {
    if (state !== "VERIFICATION_REVIEW") return;
    
    setData((prev) => ({ ...prev, isReverifying: true }));
    console.log("[AidMind Event] REDACTION_VERIFICATION_RETRY");
    
    try {
      const result = await transcription.reverify(data.sessionId, editedText);
      
      if (result.verificationPassed) {
        // Verification passed - proceed to INPUT_READY
        setData((prev) => ({
          ...prev,
          minimizedTranscript: editedText,
          verificationFailedCategories: undefined,
          isReverifying: false,
        }));
        setState("INPUT_READY");
        console.log("[AidMind Event] REDACTION_VERIFICATION_PASSED");
        console.log("[AidMind Event] REDACTION_REVIEW_EXITED");
      } else {
        // Still failing - stay in review with updated categories
        setData((prev) => ({
          ...prev,
          minimizedTranscript: editedText,
          verificationFailedCategories: result.failedCategories,
          isReverifying: false,
        }));
        console.log("[AidMind Event] REDACTION_VERIFICATION_FAILED", result.failedCategories);
      }
    } catch (error) {
      console.error("Reverification error:", error);
      setData((prev) => ({ ...prev, isReverifying: false }));
    }
  }, [state, data.sessionId, transcription]);

  // DISCARD_AND_START_OVER: VERIFICATION_REVIEW → CLOSING → navigate to start
  const discardAndStartOver = useCallback(() => {
    if (state !== "VERIFICATION_REVIEW") return;
    console.log("[AidMind Event] SESSION_CANCELLED");
    console.log("[AidMind Event] PURGE_STARTED");
    console.log("[AidMind Event] REDACTION_REVIEW_EXITED");
    setState("CLOSING");
  }, [state]);

  // GENERATE_DRAFT: INPUT_READY → RETRIEVING_CONTEXT → GENERATING → VALIDATING_OUTPUT → DRAFT_READY
  const generateDraft = useCallback(async () => {
    if (state !== "INPUT_READY") return;
    
    setState("RETRIEVING_CONTEXT");
    await simulateAsync(1200); // Simulate context retrieval
    
    setState("GENERATING");
    setData((prev) => ({ ...prev, llmRequestCount: prev.llmRequestCount + 1 }));
    await simulateAsync(2500); // Simulate LLM generation
    
    setState("VALIDATING_OUTPUT");
    await simulateAsync(800); // Simulate validation
    
    setData((prev) => ({
      ...prev,
      generatedDraft: MOCK_GENERATED_DRAFT,
      timelines: MOCK_TIMELINES,
    }));
    setState("DRAFT_READY");
  }, [state, simulateAsync]);

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

  // REGENERATE_REQUEST: DRAFT_READY → RETRIEVING_CONTEXT (loop back)
  // For resumed sessions, only allowed if new input was provided
  const regenerateDraft = useCallback(async () => {
    if (state !== "DRAFT_READY") return;
    if (data.llmRequestCount >= 3) {
      setData((prev) => ({
        ...prev,
        errorMessage: "Maximum regeneration attempts reached (3)",
      }));
      return;
    }
    
    // For resumed sessions without new input, regeneration is not allowed
    if (data.isResumedSession && !data.hasNewInputForRegeneration) {
      return; // Should not reach here if UI is correct
    }
    
    setState("RETRIEVING_CONTEXT");
    await simulateAsync(1200);
    
    setState("GENERATING");
    setData((prev) => ({ ...prev, llmRequestCount: prev.llmRequestCount + 1 }));
    await simulateAsync(2500);
    
    setState("VALIDATING_OUTPUT");
    await simulateAsync(800);
    
    setState("DRAFT_READY");
  }, [state, data.llmRequestCount, data.isResumedSession, data.hasNewInputForRegeneration, simulateAsync]);

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
      template_ids: ["template_housing_v1", "template_general_v1"], // Dummy
      policy_pack_ids: ["policy_state_abc_2024", "policy_agency_default"], // Dummy
      unknown_fields: ["supervisor_signature", "follow_up_outcome"], // Dummy placeholder
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
      audioFile: undefined,
      textNotes: undefined,
      transcript: undefined,
      minimizedTranscript: undefined,
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
      audioFile: undefined,
      textNotes: undefined,
      transcript: undefined,
      minimizedTranscript: undefined,
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
      startSession,
      uploadAudio,
      pasteTextNotes,
      startTranscription,
      startRedaction,
      reverifyText,
      discardAndStartOver,
      generateDraft,
      startEditing,
      saveEdit,
      regenerateDraft,
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
