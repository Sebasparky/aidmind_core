/**
 * QUARANTINED: v0 Pipeline Edge Function
 * 
 * This is the original transcribe-audio edge function from v0.
 * It has been moved to _future/ as part of the v1 pivot.
 * 
 * NOTE: This file is preserved for reference only. Import paths reference
 * the active _shared folder since _future functions are not deployed.
 * 
 * The active stub in supabase/functions/transcribe-audio/ returns 410 Gone.
 * 
 * To restore this function:
 * 1. Copy this file to supabase/functions/transcribe-audio/index.ts
 * 2. Update supabase/config.toml to enable the function
 * 3. Set V1_ENABLE_TRANSCRIPTION = true in src/config/features.ts
 */

// ==========================================================================
// QUARANTINE NOTICE: This file is NOT deployed. It is preserved for future use.
// The actual transcribe-audio function returns 410 Gone.
// ==========================================================================

/*
Original imports (for reference):

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders, enforceTransportSecurity } from "../_shared/security-headers.ts";
import { ValidationErrors, isValidUUID, isValidStorageObjectKey, isValidTranscriptionModel } from "../_shared/input-validation.ts";

Original implementation handles:
- Audio file download from Supabase storage
- OpenAI Whisper/GPT-4o transcription API calls
- Storing raw_transcript as ephemeral artifact
- Eye event logging (TRANSCRIPTION_STARTED, TRANSCRIPTION_COMPLETED)
- Transcription job tracking in transcription_jobs table

See git history for the complete original implementation.
*/

export const QUARANTINE_NOTICE = "This function is quarantined for v1 pivot. See supabase/functions/transcribe-audio/index.ts for the active stub.";
