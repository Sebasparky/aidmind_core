/**
 * QUARANTINED: v0 Pipeline Edge Function
 * 
 * This is the original redact-transcript edge function from v0.
 * It has been moved to _future/ as part of the v1 pivot.
 * 
 * NOTE: This file is preserved for reference only. The original 2400+ line
 * implementation handled the 3-layer redaction pipeline:
 * - Layer 1: Regex-based PII detection
 * - Layer 2: Presidio NER-based entity recognition
 * - Layer 3: LLM verification of redaction completeness
 * 
 * The active stub in supabase/functions/redact-transcript/ returns 410 Gone.
 * 
 * To restore this function:
 * 1. Restore from git history to supabase/functions/redact-transcript/index.ts
 * 2. Update supabase/config.toml to enable the function
 * 3. Set V1_ENABLE_REDACTION = true in src/config/features.ts
 */

// ==========================================================================
// QUARANTINE NOTICE: This file is NOT deployed. It is preserved for future use.
// The actual redact-transcript function returns 410 Gone.
// ==========================================================================

/*
Original implementation features (for reference):

- 3-layer redaction pipeline:
  - Layer 1: Regex patterns for phone, email, SSN, DOB, addresses, IDs
  - Layer 2: Presidio NER via external service (PRESIDIO_ANALYZER_URL, PRESIDIO_ANONYMIZER_URL)
  - Layer 3: LLM verification to catch missed PII

- Creates minimized_transcript ephemeral artifact
- Deletes raw_transcript after successful redaction (with TRANSCRIPT_DELETED event)
- Health checking for Presidio services
- Graceful fallback when Presidio is unavailable

Eye events:
- REDACTION_STARTED
- REDACTION_LAYER1_COMPLETED
- REDACTION_LAYER2_COMPLETED / REDACTION_LAYER2_FAILED
- REDACTION_LAYER3_VERIFICATION_PASSED / REDACTION_LAYER3_VERIFICATION_FAILED
- REDACTION_COMPLETED
- TRANSCRIPT_DELETED

See git history for the complete ~2400 line original implementation.
*/

export const QUARANTINE_NOTICE = "This function is quarantined for v1 pivot. See supabase/functions/redact-transcript/index.ts for the active stub.";
