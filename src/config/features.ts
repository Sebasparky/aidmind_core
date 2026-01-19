/**
 * V1 Feature Gates
 * 
 * Single source of truth for features that are disabled in the v1 pivot.
 * These features are quarantined, not deleted - they can be re-enabled
 * in future versions by changing these flags.
 * 
 * @see src/legacy/v0_pipeline/ for quarantined code
 * @see supabase/functions/_future/ for quarantined edge functions
 */

// ============================================================================
// V1 PIVOT: The following features are DISABLED in v1
// ============================================================================

/**
 * Audio transcription via OpenAI Whisper/GPT-4o models.
 * When false: transcribe-audio edge function returns 410 Gone
 */
export const V1_ENABLE_TRANSCRIPTION = false;

/**
 * 3-layer redaction/minimization pipeline (regex, NER, LLM verification).
 * When false: redact-transcript edge function returns 410 Gone
 */
export const V1_ENABLE_REDACTION = false;

/**
 * Generative AI note generation using LLM.
 * When false: LLM-based draft generation is disabled, manual input only.
 */
export const V1_ENABLE_GENERATIVE_NOTE_GEN = false;

// ============================================================================
// V1 PLACEHOLDER UI FLAGS
// These control visibility of mock/placeholder UI elements
// ============================================================================

/**
 * Show placeholder task list with mock data.
 * When false: Shows empty state with "Platform signals will appear here when connected."
 */
export const V1_SHOW_PLACEHOLDER_TASKS = false;

/**
 * Show placeholder schedule sidebar with mock data.
 * When false: Shows empty state with "Platform signals will appear here when connected."
 */
export const V1_SHOW_PLACEHOLDER_SCHEDULE = false;

/**
 * Use the v1 dashboard redesign (Signals Hub layout).
 * When true: Shows Work Radar, Active Sessions, Session History panels.
 * When false: Shows legacy TaskList + NotesPanel layout.
 */
export const V1_DASHBOARD_REDESIGN = true;

// ============================================================================
// Helper
// ============================================================================

/**
 * Feature flags object for convenient destructuring
 */
export const FEATURES = {
  transcription: V1_ENABLE_TRANSCRIPTION,
  redaction: V1_ENABLE_REDACTION,
  generativeNoteGen: V1_ENABLE_GENERATIVE_NOTE_GEN,
  showPlaceholderTasks: V1_SHOW_PLACEHOLDER_TASKS,
  showPlaceholderSchedule: V1_SHOW_PLACEHOLDER_SCHEDULE,
  dashboardRedesign: V1_DASHBOARD_REDESIGN,
} as const;

/**
 * Check if we're in v1 mode (any v0 pipeline feature is disabled)
 */
export function isV1(): boolean {
  return !V1_ENABLE_TRANSCRIPTION || !V1_ENABLE_REDACTION || !V1_ENABLE_GENERATIVE_NOTE_GEN;
}

/**
 * Error message for disabled features
 */
export const V1_DISABLED_ERROR = "This feature is disabled in v1. See src/config/features.ts.";
