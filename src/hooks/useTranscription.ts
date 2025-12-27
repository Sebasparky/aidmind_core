import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

// Supported transcription models
export const TRANSCRIPTION_MODELS = {
  "gpt-4o-mini-transcribe": "GPT-4o Mini Transcribe (Default)",
  "gpt-4o-transcribe": "GPT-4o Transcribe",
  "whisper-1": "Whisper",
} as const;

export type TranscriptionModel = keyof typeof TRANSCRIPTION_MODELS;

interface TranscriptionState {
  isUploading: boolean;
  isTranscribing: boolean;
  isRedacting: boolean;
  transcript: string | null;
  minimizedTranscript: string | null;
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

  // Start redaction/minimization
  const redact = useCallback(async (sessionId: string, transcript?: string): Promise<string | null> => {
    setState((prev) => ({ ...prev, isRedacting: true, error: null }));

    try {
      console.log(`[Transcription] Starting redaction for session: ${sessionId}`);

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

      const minimizedTranscript = data.minimized_transcript;
      setState((prev) => ({ ...prev, isRedacting: false, minimizedTranscript }));
      console.log(`[Transcription] Redaction complete, length: ${minimizedTranscript.length}`);
      return minimizedTranscript;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Redaction failed";
      setState((prev) => ({ ...prev, isRedacting: false, error: errorMessage }));
      return null;
    }
  }, []);

  // Full pipeline: upload → transcribe → redact
  const processAudio = useCallback(
    async (sessionId: string, file: File): Promise<{ transcript: string; minimizedTranscript: string } | null> => {
      // Step 1: Upload
      const objectKey = await uploadAudio(sessionId, file);
      if (!objectKey) return null;

      // Step 2: Transcribe (redaction will auto-trigger if autoRedact is true)
      const transcript = await transcribe(sessionId, objectKey);
      if (!transcript) return null;

      // If autoRedact is false, we need to wait for the minimized transcript
      const minimizedTranscript = state.minimizedTranscript;
      if (!minimizedTranscript && autoRedact) {
        // Wait a bit for the state to update
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      return {
        transcript,
        minimizedTranscript: state.minimizedTranscript || "",
      };
    },
    [uploadAudio, transcribe, autoRedact, state.minimizedTranscript]
  );

  // Reset state
  const reset = useCallback(() => {
    setState({
      isUploading: false,
      isTranscribing: false,
      isRedacting: false,
      transcript: null,
      minimizedTranscript: null,
      error: null,
      audioObjectKey: null,
    });
  }, []);

  return {
    ...state,
    isProcessing: state.isUploading || state.isTranscribing || state.isRedacting,
    uploadAudio,
    transcribe,
    redact,
    processAudio,
    reset,
    currentModel: model,
  };
}
