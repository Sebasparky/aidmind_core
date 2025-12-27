import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

// Supported transcription models
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

export interface LayerStatus {
  status: string; // Allow any status string to support new Layer 2 statuses
  counts?: Partial<RedactionCounts>;
  method?: string;
  skipped_reason?: string;
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
  autoRedact?: boolean; // Automatically trigger redaction after transcription
}

export function useTranscription(options: UseTranscriptionOptions = {}) {
  const { model = "gpt-4o-mini-transcribe", autoRedact = true } = options;

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

  // Upload audio file to storage
  const uploadAudio = useCallback(async (sessionId: string, file: File): Promise<string | null> => {
    setState((prev) => ({ ...prev, isUploading: true, error: null }));

    try {
      // Generate unique object key
      const fileExt = file.name.split(".").pop() || "webm";
      const objectKey = `${sessionId}/${crypto.randomUUID()}.${fileExt}`;

      console.log(`[Transcription] Uploading audio: ${objectKey}`);

      const { error: uploadError } = await supabase.storage
        .from("audio-uploads")
        .upload(objectKey, file, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadError) {
        console.error("Audio upload failed:", uploadError);
        throw new Error(`Upload failed: ${uploadError.message}`);
      }

      setState((prev) => ({ ...prev, isUploading: false, audioObjectKey: objectKey }));
      console.log(`[Transcription] Audio uploaded successfully: ${objectKey}`);
      return objectKey;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Upload failed";
      setState((prev) => ({ ...prev, isUploading: false, error: errorMessage }));
      return null;
    }
  }, []);

  // Start transcription
  const transcribe = useCallback(
    async (sessionId: string, audioObjectKey: string): Promise<string | null> => {
      setState((prev) => ({ ...prev, isTranscribing: true, error: null }));

      try {
        console.log(`[Transcription] Starting transcription with model: ${model}`);

        const { data, error } = await supabase.functions.invoke("transcribe-audio", {
          body: {
            session_id: sessionId,
            audio_object_key: audioObjectKey,
            model,
          },
        });

        if (error) {
          throw new Error(error.message);
        }

        if (!data.success) {
          throw new Error(data.error || "Transcription failed");
        }

        const transcript = data.transcript;
        setState((prev) => ({ ...prev, isTranscribing: false, transcript }));
        console.log(`[Transcription] Transcription complete, length: ${transcript.length}`);

        // Auto-trigger redaction if enabled
        if (autoRedact) {
          await redact(sessionId, transcript);
        }

        return transcript;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Transcription failed";
        setState((prev) => ({ ...prev, isTranscribing: false, error: errorMessage }));
        return null;
      }
    },
    [model, autoRedact]
  );

  // Start 3-layer redaction/minimization pipeline
  const redact = useCallback(async (sessionId: string, transcript?: string): Promise<{
    minimizedTranscript: string | null;
    verificationPassed: boolean;
    failedCategories: string[];
    redactionStatus: RedactionStatus | null;
    minimizedTextSource: "ner" | "regex" | null;
  }> => {
    setState((prev) => ({ ...prev, isRedacting: true, error: null, verificationResult: null }));

    try {
      console.log(`[Transcription] Starting 3-layer redaction pipeline for session: ${sessionId}`);

      const { data, error } = await supabase.functions.invoke("redact-transcript", {
        body: {
          session_id: sessionId,
          transcript,
        },
      });

      if (error) {
        throw new Error(error.message);
      }

      if (!data.success) {
        throw new Error(data.error || "Redaction failed");
      }

      const minimizedTranscript = data.minimized_text;
      const redactionCounts = data.redaction_counts as RedactionCounts;
      const verificationResult = data.verification_result as VerificationResult;
      const redactionStatus = data.redaction as RedactionStatus | undefined;
      const minimizedTextSource = data.minimized_text_source as "ner" | "regex" | undefined;

      setState((prev) => ({ 
        ...prev, 
        isRedacting: false, 
        minimizedTranscript,
        redactionCounts,
        redactionStatus: redactionStatus || null,
        minimizedTextSource: minimizedTextSource || null,
        verificationResult,
      }));

      console.log(`[Transcription] Redaction complete. Verification: ${verificationResult.status}`);
      console.log(`[Transcription] Redaction counts:`, redactionCounts);
      console.log(`[Transcription] Minimized text source: ${minimizedTextSource}`);

      if (verificationResult.status === "FAIL") {
        console.warn(`[Transcription] Verification FAILED. Categories: ${verificationResult.categories?.join(", ")}`);
      }

      return {
        minimizedTranscript,
        verificationPassed: verificationResult.status === "PASS",
        failedCategories: verificationResult.categories || [],
        redactionStatus: redactionStatus || null,
        minimizedTextSource: minimizedTextSource || null,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Redaction failed";
      setState((prev) => ({ ...prev, isRedacting: false, error: errorMessage }));
      return { minimizedTranscript: null, verificationPassed: false, failedCategories: [], redactionStatus: null, minimizedTextSource: null };
    }
  }, []);

  // Re-verify text with Layer 3 LLM verification only (no regex/NER re-run)
  const reverify = useCallback(async (sessionId: string, editedText: string): Promise<{
    verificationPassed: boolean;
    failedCategories: string[];
  }> => {
    setState((prev) => ({ ...prev, isRedacting: true, error: null }));

    try {
      console.log(`[Transcription] Starting Layer 3 verification only for session: ${sessionId}`);

      const { data, error } = await supabase.functions.invoke("redact-transcript", {
        body: {
          session_id: sessionId,
          transcript: editedText,
          verification_only: true, // Signal to skip Layers 1 & 2
        },
      });

      if (error) {
        throw new Error(error.message);
      }

      if (!data.success) {
        throw new Error(data.error || "Verification failed");
      }

      const verificationResult = data.verification_result as VerificationResult;

      setState((prev) => ({ 
        ...prev, 
        isRedacting: false, 
        minimizedTranscript: editedText,
        verificationResult,
      }));

      console.log(`[Transcription] Re-verification complete. Status: ${verificationResult.status}`);

      return {
        verificationPassed: verificationResult.status === "PASS",
        failedCategories: verificationResult.categories || [],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Verification failed";
      setState((prev) => ({ ...prev, isRedacting: false, error: errorMessage }));
      return { verificationPassed: false, failedCategories: [] };
    }
  }, []);

  // Full pipeline: upload → transcribe → redact
  const processAudio = useCallback(
    async (sessionId: string, file: File): Promise<{ 
      transcript: string; 
      minimizedTranscript: string;
      verificationPassed: boolean;
      redactionCounts: RedactionCounts;
    } | null> => {
      // Step 1: Upload
      const objectKey = await uploadAudio(sessionId, file);
      if (!objectKey) return null;

      // Step 2: Transcribe (redaction will auto-trigger if autoRedact is true)
      const transcript = await transcribe(sessionId, objectKey);
      if (!transcript) return null;

      // Wait for state to settle if autoRedact is true
      if (autoRedact) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      return {
        transcript,
        minimizedTranscript: state.minimizedTranscript || "",
        verificationPassed: state.verificationResult?.status === "PASS",
        redactionCounts: state.redactionCounts || {} as RedactionCounts,
      };
    },
    [uploadAudio, transcribe, autoRedact, state.minimizedTranscript, state.verificationResult, state.redactionCounts]
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

  // Check if verification failed
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
