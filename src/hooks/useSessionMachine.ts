import { useState, useCallback, useRef } from "react";

// Session states following the AidMind State Machine
export type SessionState =
  | "NEW"
  | "READY_FOR_INPUT"
  | "AUDIO_UPLOADED"
  | "TEXT_PROVIDED"
  | "TRANSCRIBING"
  | "TRANSCRIBED"
  | "REDACTING"
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
  followUps?: FollowUpItem[];
  llmRequestCount: number;
  errorMessage?: string;
  previousStateBeforeError?: SessionState;
}

export interface TimelineItem {
  id: string;
  date: string;
  description: string;
  confirmed: boolean;
}

export interface FollowUpItem {
  id: string;
  title: string;
  dueDate: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
}

// Mock data
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

const MOCK_TIMELINES: TimelineItem[] = [
  {
    id: "1",
    date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toLocaleDateString(),
    description: "Eviction notice received",
    confirmed: false,
  },
  {
    id: "2",
    date: new Date().toLocaleDateString(),
    description: "Initial consultation completed",
    confirmed: false,
  },
];

const MOCK_FOLLOWUPS: FollowUpItem[] = [
  {
    id: "1",
    title: "Schedule housing resource review appointment",
    dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString(),
    priority: "HIGH",
  },
  {
    id: "2",
    title: "Send utility assistance program information",
    dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toLocaleDateString(),
    priority: "MEDIUM",
  },
];

interface UseSessionMachineProps {
  caseId: string;
  caseLabel: string;
  clientLabel: string;
  interactionType: string;
}

export function useSessionMachine({
  caseId,
  caseLabel,
  clientLabel,
  interactionType,
}: UseSessionMachineProps) {
  const [state, setState] = useState<SessionState>("NEW");
  const [data, setData] = useState<SessionData>({
    sessionId: crypto.randomUUID(),
    caseId,
    caseLabel,
    clientLabel,
    interactionType,
    timestamp: new Date(),
    llmRequestCount: 0,
  });

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

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

  // START_SESSION: NEW → READY_FOR_INPUT
  const startSession = useCallback(async () => {
    if (state !== "NEW") return;
    await simulateAsync(300);
    setState("READY_FOR_INPUT");
  }, [state, simulateAsync]);

  // UPLOAD_AUDIO: READY_FOR_INPUT → AUDIO_UPLOADED
  const uploadAudio = useCallback(
    async (file: File) => {
      if (state !== "READY_FOR_INPUT") return;
      setData((prev) => ({ ...prev, audioFile: file }));
      await simulateAsync(500);
      setState("AUDIO_UPLOADED");
    },
    [state, simulateAsync]
  );

  // PASTE_TEXT_NOTES: READY_FOR_INPUT → TEXT_PROVIDED
  const pasteTextNotes = useCallback(
    async (text: string) => {
      if (state !== "READY_FOR_INPUT") return;
      setData((prev) => ({ ...prev, textNotes: text }));
      await simulateAsync(300);
      setState("TEXT_PROVIDED");
    },
    [state, simulateAsync]
  );

  // START_TRANSCRIPTION: AUDIO_UPLOADED → TRANSCRIBING → TRANSCRIBED
  const startTranscription = useCallback(async () => {
    if (state !== "AUDIO_UPLOADED") return;
    setState("TRANSCRIBING");
    await simulateAsync(2000); // Simulate transcription
    setData((prev) => ({ ...prev, transcript: MOCK_TRANSCRIPT }));
    setState("TRANSCRIBED");
  }, [state, simulateAsync]);

  // START_REDACTION: TRANSCRIBED/TEXT_PROVIDED → REDACTING → INPUT_READY
  const startRedaction = useCallback(async () => {
    if (state !== "TRANSCRIBED" && state !== "TEXT_PROVIDED") return;
    setState("REDACTING");
    await simulateAsync(1500); // Simulate redaction
    setData((prev) => ({
      ...prev,
      minimizedTranscript: MOCK_MINIMIZED_TRANSCRIPT,
    }));
    setState("INPUT_READY");
  }, [state, simulateAsync]);

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
      followUps: MOCK_FOLLOWUPS,
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
  const regenerateDraft = useCallback(async () => {
    if (state !== "DRAFT_READY") return;
    if (data.llmRequestCount >= 3) {
      setData((prev) => ({
        ...prev,
        errorMessage: "Maximum regeneration attempts reached (3)",
      }));
      return;
    }
    
    setState("RETRIEVING_CONTEXT");
    await simulateAsync(1200);
    
    setState("GENERATING");
    setData((prev) => ({ ...prev, llmRequestCount: prev.llmRequestCount + 1 }));
    await simulateAsync(2500);
    
    setState("VALIDATING_OUTPUT");
    await simulateAsync(800);
    
    setState("DRAFT_READY");
  }, [state, data.llmRequestCount, simulateAsync]);

  // CONFIRM_TIMELINES_APPLICABILITY
  const confirmTimeline = useCallback(
    (timelineId: string) => {
      if (state !== "DRAFT_READY") return;
      setData((prev) => ({
        ...prev,
        timelines: prev.timelines?.map((t) =>
          t.id === timelineId ? { ...t, confirmed: !t.confirmed } : t
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
    setState("CLOSING");
  }, [state, simulateAsync]);

  // Skip export and go directly to closing
  const skipExport = useCallback(() => {
    if (state !== "APPROVED") return;
    setState("CLOSING");
  }, [state]);

  // CANCEL_SESSION: Any state → CLOSING
  const cancelSession = useCallback(() => {
    setState("CLOSING");
  }, []);

  // Complete purge: CLOSING → PURGED
  const completePurge = useCallback(async () => {
    if (state !== "CLOSING") return;
    await simulateAsync(1000); // Simulate purge
    cleanup();
    setData((prev) => ({
      ...prev,
      audioFile: undefined,
      textNotes: undefined,
      transcript: undefined,
      minimizedTranscript: undefined,
      generatedDraft: undefined,
      timelines: undefined,
      followUps: undefined,
    }));
    setState("PURGED");
  }, [state, simulateAsync, cleanup]);

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

  return {
    state,
    data,
    actions: {
      startSession,
      uploadAudio,
      pasteTextNotes,
      startTranscription,
      startRedaction,
      generateDraft,
      startEditing,
      saveEdit,
      regenerateDraft,
      confirmTimeline,
      approveDraft,
      exportDraft,
      skipExport,
      cancelSession,
      completePurge,
      handleError,
      retryFromError,
      cleanup,
    },
  };
}
