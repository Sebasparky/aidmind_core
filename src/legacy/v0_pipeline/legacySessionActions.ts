/**
 * Legacy V0 Session Actions
 * 
 * QUARANTINED: These action implementations are preserved for reference only.
 * V1 code should NOT import from this file.
 * 
 * These actions were part of the v0 transcription/redaction/generative pipeline.
 */

import type { LegacySessionState } from "./legacySessionTypes";

/**
 * V0 startTranscription action
 * 
 * Original behavior: AUDIO_UPLOADED → TRANSCRIBING → TRANSCRIBED
 * Called Supabase edge function "transcribe-audio"
 */
export const v0StartTranscriptionDescription = `
  // V0 PIVOT: START_TRANSCRIPTION
  // Original: AUDIO_UPLOADED → TRANSCRIBING → TRANSCRIBED
  const startTranscription = useCallback(async () => {
    if (state !== "AUDIO_UPLOADED") return;
    setState("TRANSCRIBING");
    
    // Called: supabase.functions.invoke("transcribe-audio", {...})
    // On success: setState("TRANSCRIBED")
    // On failure: setState("ERROR")
  }, [state]);
`;

/**
 * V0 startRedaction action
 * 
 * Original behavior: TRANSCRIBED/TEXT_PROVIDED → REDACTING → INPUT_READY or VERIFICATION_REVIEW
 * Called Supabase edge function "redact-transcript"
 */
export const v0StartRedactionDescription = `
  // V1 PIVOT: START_REDACTION
  // Original: TRANSCRIBED/TEXT_PROVIDED → REDACTING → INPUT_READY or VERIFICATION_REVIEW
  const startRedaction = useCallback(async () => {
    if (state !== "TRANSCRIBED" && state !== "TEXT_PROVIDED") return;
    setState("REDACTING");
    
    // Called: supabase.functions.invoke("redact-transcript", {...})
    // On success with verification passed: setState("INPUT_READY")
    // On verification failure: setState("VERIFICATION_REVIEW")
    // On error: setState("ERROR")
  }, [state]);
`;

/**
 * V0 generateDraft action
 * 
 * Original behavior: INPUT_READY → RETRIEVING_CONTEXT → GENERATING → VALIDATING_OUTPUT → DRAFT_READY
 * Used LLM gateway for generative note generation
 */
export const v0GenerateDraftDescription = `
  // V1 PIVOT: GENERATE_DRAFT
  // Original: INPUT_READY → RETRIEVING_CONTEXT → GENERATING → VALIDATING_OUTPUT → DRAFT_READY
  const generateDraft = useCallback(async () => {
    if (state !== "INPUT_READY") return;
    setState("RETRIEVING_CONTEXT");
    // ...retrieve templates and policies...
    setState("GENERATING");
    // Called: LLM gateway for generative note gen
    setState("VALIDATING_OUTPUT");
    // ...validate output...
    setState("DRAFT_READY");
  }, [state]);
`;

/**
 * V0 reverifyText action
 * 
 * Original behavior: VERIFICATION_REVIEW → re-run redaction on edited text
 */
export const v0ReverifyTextDescription = `
  // V1 PIVOT: REVERIFY_TEXT
  // From VERIFICATION_REVIEW state, re-run redaction pipeline on user-edited text
  const reverifyText = useCallback(async (editedText: string) => {
    // Re-invoke redact-transcript with edited text
    // On success: setState("INPUT_READY")
    // On failure: stay in VERIFICATION_REVIEW
  }, []);
`;

// Type guard for v0-only states
export function isV0OnlyState(state: string): state is LegacySessionState {
  const v0OnlyStates = [
    "AUDIO_UPLOADED",
    "TRANSCRIBING", 
    "TRANSCRIBED",
    "REDACTING",
    "VERIFICATION_REVIEW",
    "INPUT_READY",
    "RETRIEVING_CONTEXT",
    "GENERATING",
    "VALIDATING_OUTPUT",
  ];
  return v0OnlyStates.includes(state);
}
