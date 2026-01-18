/**
 * Transcription Hook - V1 Stub
 * 
 * In v1, transcription and redaction features are DISABLED.
 * This stub provides the same interface but returns disabled errors
 * instead of invoking edge functions.
 * 
 * Original implementation: src/legacy/v0_pipeline/useTranscription.ts
 */

import { useState, useCallback } from "react";
import { 
  V1_ENABLE_TRANSCRIPTION, 
  V1_ENABLE_REDACTION, 
  V1_DISABLED_ERROR 
} from "@/config/features";

// Re-export types for compatibility
export const TRANSCRIPTION_MODELS = {
  "gpt-4o-mini-transcribe": "GPT-4o Mini Transcribe (Default)",
  "gpt-4o-transcribe": "GPT-4o Transcribe",
  "whisper-1": "Whisper",
} as const;

export type TranscriptionModel = keyof typeof TRANSCRIPTION_MODELS;

export interface RedactionCounts {
  phone: number;
  email: number;
  ssn: number;
  dob: number;
  address: number;
  case_id: number;
  generic_id: number;
  person: number;
  location: number;
  organization: number;
  date: number;
}

export type Layer2StatusType = 
  | "COMPLETED" 
  | "FAILED_UNREACHABLE" 
  | "FAILED_TIMEOUT" 
  | "FAILED_ERROR" 
  | "SKIPPED_CONFIG_MISSING" 
  | "SKIPPED";

export interface Layer2Error {
  reason: "missing_env_var" | "misconfigured_env" | "invalid_url_for_edge" | "unreachable" | "timeout" | "http_error" | "service_unhealthy" | "unknown";
  detail: string;
  url?: string;
  analyzer_url?: string;
  anonymizer_url?: string;
}

export interface LayerStatus {
  status: string;
  counts?: Partial<RedactionCounts>;
  method?: string;
  skipped_reason?: string;
  error?: Layer2Error;
}

export interface RedactionStatus {
  layer1: LayerStatus;
  layer2: LayerStatus;
  layer3: { status: "PASS" | "FAIL"; categories?: string[] };
}

export interface VerificationResult {
  status: "PASS" | "FAIL";
  categories?: string[];
}

interface TranscriptionState {
  isUploading: boolean;
  isTranscribing: boolean;
  isRedacting: boolean;
  transcript: string | null;
  minimizedTranscript: string | null;
  redactionCounts: RedactionCounts | null;
  redactionStatus: RedactionStatus | null;
  minimizedTextSource: "ner" | "regex" | null;
  verificationResult: VerificationResult | null;
  error: string | null;
  audioObjectKey: string | null;
}

interface UseTranscriptionOptions {
  model?: TranscriptionModel;
  autoRedact?: boolean;
}

const V1_TRANSCRIPTION_ERROR = "Transcription is disabled in v1";
const V1_REDACTION_ERROR = "Redaction is disabled in v1";

/**
 * V1 Stub - Transcription/Redaction features are disabled
 * 
 * All methods return disabled errors without invoking edge functions.
 */
export function useTranscription(options: UseTranscriptionOptions = {}) {
  const { model = "gpt-4o-mini-transcribe" } = options;

  const [state, setState] = useState<TranscriptionState>({
    isUploading: false,
    isTranscribing: false,
    isRedacting: false,
    transcript: null,
    minimizedTranscript: null,
    redactionCounts: null,
    redactionStatus: null,
    minimizedTextSource: null,
    verificationResult: null,
    error: null,
    audioObjectKey: null,
  });

  // V1 pivot: transcription disabled - return error without calling edge function
  const uploadAudio = useCallback(async (_sessionId: string, _file: File): Promise<string | null> => {
    if (!V1_ENABLE_TRANSCRIPTION) {
      console.warn("[V1 Pivot] uploadAudio called but transcription is disabled");
      setState((prev) => ({ ...prev, error: V1_TRANSCRIPTION_ERROR }));
      return null;
    }
    // This code is unreachable in v1
    return null;
  }, []);

  // V1 pivot: transcription disabled
  const transcribe = useCallback(
    async (_sessionId: string, _audioObjectKey: string): Promise<string | null> => {
      if (!V1_ENABLE_TRANSCRIPTION) {
        console.warn("[V1 Pivot] transcribe called but transcription is disabled");
        setState((prev) => ({ ...prev, error: V1_TRANSCRIPTION_ERROR }));
        return null;
      }
      return null;
    },
    []
  );

  // V1 pivot: redaction disabled
  const redact = useCallback(async (_sessionId: string, _transcript?: string): Promise<{
    minimizedTranscript: string | null;
    verificationPassed: boolean;
    failedCategories: string[];
    redactionStatus: RedactionStatus | null;
    minimizedTextSource: "ner" | "regex" | null;
  }> => {
    if (!V1_ENABLE_REDACTION) {
      console.warn("[V1 Pivot] redact called but redaction is disabled");
      setState((prev) => ({ ...prev, error: V1_REDACTION_ERROR }));
      return { 
        minimizedTranscript: null, 
        verificationPassed: false, 
        failedCategories: [], 
        redactionStatus: null, 
        minimizedTextSource: null 
      };
    }
    return { minimizedTranscript: null, verificationPassed: false, failedCategories: [], redactionStatus: null, minimizedTextSource: null };
  }, []);

  // V1 pivot: redaction disabled
  const reverify = useCallback(async (_sessionId: string, _editedText: string): Promise<{
    verificationPassed: boolean;
    failedCategories: string[];
  }> => {
    if (!V1_ENABLE_REDACTION) {
      console.warn("[V1 Pivot] reverify called but redaction is disabled");
      setState((prev) => ({ ...prev, error: V1_REDACTION_ERROR }));
      return { verificationPassed: false, failedCategories: [] };
    }
    return { verificationPassed: false, failedCategories: [] };
  }, []);

  // V1 pivot: full pipeline disabled
  const processAudio = useCallback(
    async (_sessionId: string, _file: File): Promise<{ 
      transcript: string; 
      minimizedTranscript: string;
      verificationPassed: boolean;
      redactionCounts: RedactionCounts;
    } | null> => {
      if (!V1_ENABLE_TRANSCRIPTION || !V1_ENABLE_REDACTION) {
        console.warn("[V1 Pivot] processAudio called but transcription/redaction is disabled");
        setState((prev) => ({ ...prev, error: V1_DISABLED_ERROR }));
        return null;
      }
      return null;
    },
    []
  );

  // Reset state
  const reset = useCallback(() => {
    setState({
      isUploading: false,
      isTranscribing: false,
      isRedacting: false,
      transcript: null,
      minimizedTranscript: null,
      redactionCounts: null,
      redactionStatus: null,
      minimizedTextSource: null,
      verificationResult: null,
      error: null,
      audioObjectKey: null,
    });
  }, []);

  const verificationFailed = state.verificationResult?.status === "FAIL";
  const failedCategories = state.verificationResult?.categories || [];

  return {
    ...state,
    isProcessing: state.isUploading || state.isTranscribing || state.isRedacting,
    verificationFailed,
    failedCategories,
    uploadAudio,
    transcribe,
    redact,
    reverify,
    processAudio,
    reset,
    currentModel: model,
  };
}
