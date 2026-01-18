/**
 * Legacy V0 Session Types
 * 
 * QUARANTINED: These types are preserved for reference only.
 * V1 code should NOT import from this file.
 * 
 * These states were part of the v0 transcription/redaction pipeline.
 */

// V0 Session states - includes transcription/redaction pipeline states
export type LegacySessionState =
  | "NEW"
  | "READY_FOR_INPUT"
  | "AUDIO_UPLOADED"        // V0: after audio file upload
  | "TEXT_PROVIDED"
  | "TRANSCRIBING"          // V0: during transcription
  | "TRANSCRIBED"           // V0: after transcription complete
  | "REDACTING"             // V0: during redaction
  | "VERIFICATION_REVIEW"   // V0: when verification fails
  | "INPUT_READY"           // V0: after redaction complete
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

// V0-only states (for reference)
export const V0_ONLY_STATES = [
  "AUDIO_UPLOADED",
  "TRANSCRIBING",
  "TRANSCRIBED",
  "REDACTING",
  "VERIFICATION_REVIEW",
  "INPUT_READY",
  "RETRIEVING_CONTEXT",
  "GENERATING",
  "VALIDATING_OUTPUT",
] as const;

// V0 Session data - includes transcript fields
export interface LegacySessionData {
  sessionId: string;
  caseId: string;
  caseLabel: string;
  clientLabel: string;
  interactionType: string;
  timestamp: Date;
  audioFile?: File;
  textNotes?: string;
  transcript?: string;                // V0: raw transcript from transcription
  minimizedTranscript?: string;       // V0: redacted/minimized transcript
  generatedDraft?: string;
  timelines?: LegacyTimelineItem[];
  llmRequestCount: number;
  errorMessage?: string;
  previousStateBeforeError?: LegacySessionState;
  exportCompleted?: boolean;
  savedForLater?: boolean;
  isResumedSession?: boolean;
  previousResumeBundleId?: string;
  hasNewInputForRegeneration?: boolean;
  // V0: Verification review fields
  verificationFailedCategories?: string[];
  isReverifying?: boolean;
  redactionStatus?: {
    layer1?: { status: string; counts?: Record<string, number> };
    layer2?: { status: string; counts?: Record<string, number>; method?: string; skipped_reason?: string };
    layer3?: { status: string; categories?: string[] };
  };
}

export interface LegacyTimelineItem {
  id: string;
  title: string;
  date: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
  status: "PENDING" | "CONFIRMED" | "DENIED";
  denyReason?: string;
  createdTaskId?: string;
}
