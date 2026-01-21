/**
 * The Eye Event Taxonomy
 * 
 * Design Goals:
 * 1. No PHI in The Eye. Ever.
 * 2. Events are append-only (immutable); corrections happen via new events.
 * 3. Every event supports: who / what / when / where / why (as metadata).
 * 4. Events are scoped: tenant → user → case → session → artifact.
 * 
 * ============================================================================
 * ⚠️  V1 PIVOT NOTE
 * ============================================================================
 * AidMind v1 does NOT use transcription, redaction, or automated note generation.
 * 
 * Events related to these features are LEGACY (v0 pipeline) and are disabled
 * in v1. They are preserved in this taxonomy for:
 *   • Historical audit data continuity
 *   • Forward compatibility if features are re-enabled
 *   • Reference documentation for the v0 architecture
 * 
 * Legacy event categories:
 *   • TRANSCRIPTION_* — Audio-to-text pipeline (v0 only)
 *   • REDACTION_* — PHI minimization pipeline (v0 only)  
 *   • VERIFICATION_* — Human review of redacted text (v0 only)
 *   • AUDIO_* — Audio upload/storage (v0 only)
 * 
 * These events will NOT fire in v1 sessions. Their absence is expected
 * and is NOT an error.
 * ============================================================================
 */

// ============================================================
// ENUMS & TYPES
// ============================================================

export type Environment = "dev" | "staging" | "prod";

export type ActorType = "user" | "service" | "system";

export type ActorRole = "caseworker" | "supervisor" | "auditor" | "support";

export type ResourceType =
  | "audio"
  | "transcript"
  | "minimized_transcript"
  | "draft"
  | "note"
  | "kb_doc"
  | "export"
  | "credential"
  | "policy"
  | "template"
  | "job"
  | "cache_key"
  | "vector_entry"
  | "session";

export type EventResult = "success" | "failure" | "partial";

export type EventSeverity = "INFO" | "NOTICE" | "WARN" | "HIGH" | "CRITICAL";

// Reason codes for various event types
export type ReasonCode =
  | "USER_REQUESTED"
  | "USER_CANCELLED"      // User explicitly cancelled session
  | "USER_COMPLETED"      // User explicitly completed/closed session
  | "TTL_EXPIRED"         // System TTL expiration
  | "RBAC_DENY"
  | "PROVIDER_ERROR"
  | "VALIDATION_FAILED"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "QUOTA_EXCEEDED"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "INTERNAL_ERROR"
  | "RETRY_EXHAUSTED"
  | "CANCELLED"
  | "INACTIVITY_TIMEOUT"  // Observational: no activity signals for configured safety window
  | "PARTIAL_DELETION";   // Failure detail: some but not all artifacts deleted

// Event categories for filtering
export type EventCategory =
  | "AUTH"
  | "SESSION"
  | "INGEST"
  | "TRANSCRIPTION"
  | "REDACTION"
  | "GENERATION"
  | "VALIDATION"
  | "DRAFT"
  | "EXPORT"
  | "PURGE"
  | "CONFIG"
  | "ANOMALY"
  | "GOVERNANCE"
  | "COORDINATION";

// Event source for filtering (used by Platform coordination signals)
export type EventSource = "system" | "policy" | "legacy" | "coordination";

// Tags for event classification
export type EventTag =
  | "PHI_TOUCHING"
  | "EPHEMERAL"
  | "BREAK_GLASS"
  | "DELETION_PROOF"
  | "AUDIT_CRITICAL"
  | "COMPLIANCE";

// ============================================================
// EVENT TYPE ENUMS (from taxonomy)
// ============================================================

export type EyeEventType =
  // A) Identity & Access (AuthN/AuthZ)
  | "AUTH_LOGIN_SUCCESS"
  | "AUTH_LOGIN_FAILED"
  | "AUTH_LOGOUT"
  | "TOKEN_ISSUED"
  | "TOKEN_REVOKED"
  | "RBAC_ALLOW"
  | "RBAC_DENY"
  | "BREAK_GLASS_REQUESTED"
  | "BREAK_GLASS_GRANTED"
  | "BREAK_GLASS_EXPIRED"
  | "BREAK_GLASS_DENIED"

  // B) Case & Session Lifecycle
  | "CASE_ACCESSED"
  | "CASE_LISTED"
  | "SESSION_STARTED"
  | "SESSION_HEARTBEAT"
  | "SESSION_FINISH_CLICKED"
  | "SESSION_CLOSED"
  | "SESSION_CANCELLED"
  /**
   * SESSION_ABANDONED: Observational, non-blaming terminal event.
   * 
   * Emitted when no activity signals are received for the configured safety window.
   * This is NOT user intent — it is a system-observed timeout.
   * 
   * Design rationale:
   * - Timeout is data-risk driven, not UX-driven
   * - Purging happens immediately upon detection
   * - No PHI is retained without liveness signals
   * - User intent is NEVER claimed or inferred
   * 
   * Always includes: confidence: "system_observed", reason_code: "INACTIVITY_TIMEOUT"
   * Never includes: actor_type: "user"
   */
  | "SESSION_ABANDONED"

  // Save for Later / Resume Draft
  | "WIP_BUNDLE_EXPORTED"
  | "EPHEMERAL_INPUTS_PURGED"
  | "WIP_BUNDLE_IMPORTED"
  | "SESSION_LINKED"
  | "RESUME_REQUIRES_NEW_INPUT"

  // -------------------------------------------------------------------------
  // LEGACY (v0 PIPELINE) EVENTS — C through E
  // Disabled in v1. Retained for audit/history compatibility.
  // -------------------------------------------------------------------------

  // C) Ingest: Uploads & Object Storage (Legacy – v0 pipeline)
  | "AUDIO_UPLOAD_URL_ISSUED"      // Legacy – v0 pipeline
  | "AUDIO_UPLOADED"               // Legacy – v0 pipeline
  | "AUDIO_UPLOAD_FAILED"          // Legacy – v0 pipeline
  | "OBJECT_TTL_SET"
  | "OBJECT_TTL_EXPIRED"
  | "OBJECT_ENCRYPTION_VERIFIED"

  // D) Transcription Pipeline (Legacy – v0 pipeline)
  | "TRANSCRIPTION_JOB_QUEUED"     // Legacy – v0 pipeline
  | "TRANSCRIPTION_STARTED"        // Legacy – v0 pipeline
  | "TRANSCRIPTION_COMPLETED"      // Legacy – v0 pipeline
  | "TRANSCRIPTION_FAILED"         // Legacy – v0 pipeline
  /**
   * TRANSCRIPTION_PROVIDER_USED: Observability event for audit visibility.
   * (Legacy – v0 pipeline)
   * 
   * Emitted once per transcription job to record which AI provider processed data.
   * This is NOT a generative AI event and does NOT require supervisor approval.
   * 
   * Metadata (PHI-safe only):
   * - provider: "openai"
   * - model: "whisper-1" | "gpt-4o-transcribe" | etc.
   * - data_retention_mode: "zero_retention"
   * - request_id
   * 
   * Never includes: audio, transcript text, filenames, object keys
   */
  | "TRANSCRIPTION_PROVIDER_USED"  // Legacy – v0 pipeline

  // E) Redaction & Minimization (Legacy – v0 pipeline)
  | "REDACTION_STARTED"            // Legacy – v0 pipeline
  | "REDACTION_COMPLETED"          // Legacy – v0 pipeline
  | "REDACTION_FAILED"             // Legacy – v0 pipeline
  | "REDACTION_LAYER_COMPLETED"    // Legacy – v0 pipeline
  | "VERIFICATION_PASSED"          // Legacy – v0 pipeline
  | "VERIFICATION_FAILED"          // Legacy – v0 pipeline

  // -------------------------------------------------------------------------
  // END LEGACY (v0 PIPELINE) EVENTS
  // -------------------------------------------------------------------------

  // F) Knowledge Base Retrieval (Future - scaffolded)
  | "KB_QUERY_STARTED"
  | "KB_QUERY_COMPLETED"
  | "KB_QUERY_FAILED"
  | "TEMPLATE_SELECTED"
  | "POLICY_PACK_ATTACHED"

  // G) LLM / RAG Generation (Future - scaffolded)
  | "LLM_CALL_STARTED"
  | "LLM_CALL_COMPLETED"
  | "LLM_CALL_FAILED"

  // H) Output Validation (Future - scaffolded)
  | "OUTPUT_SCHEMA_VALIDATION_PASSED"
  | "OUTPUT_SCHEMA_VALIDATION_FAILED"
  | "OUTPUT_PHI_LEAK_CHECK_PASSED"
  | "OUTPUT_PHI_LEAK_CHECK_FAILED"
  | "OUTPUT_UNKNOWN_FIELDS_COUNTED"

  // I) Drafting, Editing, Approval (Future - scaffolded)
  | "DRAFT_CREATED"
  | "DRAFT_VIEWED"
  | "DRAFT_EDITED"
  | "DRAFT_VERSION_SAVED"
  | "NOTE_APPROVED"
  | "NOTE_APPROVAL_REVOKED"
  | "TIMELINE_DERIVED"
  | "TIMELINES_CONFIRMED"

  // J) Export & System-of-Record (Future - scaffolded)
  | "EXPORT_STARTED"
  | "EXPORT_COMPLETED"
  | "EXPORT_FAILED"
  | "SYSTEM_OF_RECORD_CONFIRMED"

  // K) Deletion, Purge, Verification
  | "PURGE_STARTED"
  | "PURGE_COMPLETED"
  | "PURGE_FAILED"
  | "AUDIO_DELETED"
  | "TRANSCRIPT_DELETED"
  | "MINIMIZED_TRANSCRIPT_DELETED"
  | "DRAFT_DELETED"
  | "EXPORT_ARTIFACT_DELETED"
  | "EPHEMERAL_SCAN_STARTED"
  | "EPHEMERAL_SCAN_COMPLETED"
  | "EPHEMERAL_SCAN_RESULT"
  | "EPHEMERAL_REMEDIATION_STARTED"
  | "EPHEMERAL_REMEDIATION_COMPLETED"

  // L) Config & Security Posture (Future - scaffolded)
  | "CONFIG_CHANGED"
  | "RETENTION_POLICY_UPDATED"
  | "KEY_ROTATION_COMPLETED"
  | "ENCRYPTION_POLICY_ENFORCED"

  // M) Anomalies & Alerts (Future - scaffolded)
  | "ANOMALY_ACCESS_TIME"
  | "ANOMALY_ACCESS_VOLUME"
  | "ANOMALY_FAILED_LOGINS_SPIKE"
  | "ANOMALY_BREAK_GLASS_USAGE"
  | "ANOMALY_EXPORT_SPIKE"
  | "ALERT_RAISED"
  | "ALERT_ACKNOWLEDGED"
  | "ALERT_RESOLVED"

  // N) Governance & Authorization (Generative AI Only)
  /**
   * These governance events apply ONLY to generative AI (chat/completions).
   * They do NOT apply to transcription (Whisper) or redaction (Presidio),
   * which are non-generative processing steps.
   */
  | "AI_USAGE_APPROVAL_REQUESTED"
  | "AI_USAGE_APPROVED_BY_SUPERVISOR"
  | "AI_USAGE_APPROVAL_REVOKED"
  | "AI_USAGE_BLOCKED_NO_APPROVAL"

  // O) Auditor Access
  | "AUDITOR_ACCESS_GRANTED"
  | "AUDITOR_ACCESS_EXPIRED"
  | "AUDITOR_ACCESS_REVOKED"

  // P) Compliance Export
  | "COMPLIANCE_EXPORT_GENERATED"
  | "COMPLIANCE_EXPORT_DOWNLOADED"

  // Q) Coordination Events (from The Platform)
  | "COORDINATION_REFERRAL_STALLED"
  | "COORDINATION_SLA_BREACHED"
  | "COORDINATION_EXTERNAL_ACK_DELAYED"
  | "COORDINATION_REPEATED_HANDOFF_FAILURE";

/**
 * Exhaustive list of all EyeEventType values.
 * 
 * IMPORTANT: This list MUST be kept in sync with the EyeEventType union above.
 * Contract tests will fail if a new event type is added to the union but not to this list.
 * 
 * To add a new event type:
 * 1. Add it to the EyeEventType union above
 * 2. Add it to ALL_EYE_EVENT_TYPES below
 * 3. Add it to EVENT_CATEGORY_MAP
 * 4. Add it to EVENT_SEVERITY_MAP (or add to ALLOWED_SEVERITY_FALLBACK_EVENTS in contract tests)
 * 5. Run tests: npx vitest run src/lib/eye/contract.test.ts
 */
export const ALL_EYE_EVENT_TYPES: EyeEventType[] = [
  // A) Identity & Access
  "AUTH_LOGIN_SUCCESS",
  "AUTH_LOGIN_FAILED",
  "AUTH_LOGOUT",
  "TOKEN_ISSUED",
  "TOKEN_REVOKED",
  "RBAC_ALLOW",
  "RBAC_DENY",
  "BREAK_GLASS_REQUESTED",
  "BREAK_GLASS_GRANTED",
  "BREAK_GLASS_EXPIRED",
  "BREAK_GLASS_DENIED",

  // B) Case & Session Lifecycle
  "CASE_ACCESSED",
  "CASE_LISTED",
  "SESSION_STARTED",
  "SESSION_HEARTBEAT",
  "SESSION_FINISH_CLICKED",
  "SESSION_CLOSED",
  "SESSION_CANCELLED",
  "SESSION_ABANDONED",

  // Save for Later / Resume Draft
  "WIP_BUNDLE_EXPORTED",
  "EPHEMERAL_INPUTS_PURGED",
  "WIP_BUNDLE_IMPORTED",
  "SESSION_LINKED",
  "RESUME_REQUIRES_NEW_INPUT",

  // -------------------------------------------------------------------------
  // LEGACY (v0 PIPELINE) EVENTS — C through E
  // -------------------------------------------------------------------------

  // C) Ingest (Legacy – v0 pipeline: AUDIO_* events)
  "AUDIO_UPLOAD_URL_ISSUED",
  "AUDIO_UPLOADED",
  "AUDIO_UPLOAD_FAILED",
  "OBJECT_TTL_SET",
  "OBJECT_TTL_EXPIRED",
  "OBJECT_ENCRYPTION_VERIFIED",

  // D) Transcription (Legacy – v0 pipeline)
  "TRANSCRIPTION_JOB_QUEUED",
  "TRANSCRIPTION_STARTED",
  "TRANSCRIPTION_COMPLETED",
  "TRANSCRIPTION_FAILED",
  "TRANSCRIPTION_PROVIDER_USED",

  // E) Redaction (Legacy – v0 pipeline)
  "REDACTION_STARTED",
  "REDACTION_COMPLETED",
  "REDACTION_FAILED",
  "REDACTION_LAYER_COMPLETED",
  "VERIFICATION_PASSED",
  "VERIFICATION_FAILED",

  // -------------------------------------------------------------------------
  // END LEGACY (v0 PIPELINE) EVENTS
  // -------------------------------------------------------------------------

  // F) Knowledge Base
  "KB_QUERY_STARTED",
  "KB_QUERY_COMPLETED",
  "KB_QUERY_FAILED",
  "TEMPLATE_SELECTED",
  "POLICY_PACK_ATTACHED",

  // G) LLM / RAG
  "LLM_CALL_STARTED",
  "LLM_CALL_COMPLETED",
  "LLM_CALL_FAILED",

  // H) Output Validation
  "OUTPUT_SCHEMA_VALIDATION_PASSED",
  "OUTPUT_SCHEMA_VALIDATION_FAILED",
  "OUTPUT_PHI_LEAK_CHECK_PASSED",
  "OUTPUT_PHI_LEAK_CHECK_FAILED",
  "OUTPUT_UNKNOWN_FIELDS_COUNTED",

  // I) Drafting, Editing, Approval
  "DRAFT_CREATED",
  "DRAFT_VIEWED",
  "DRAFT_EDITED",
  "DRAFT_VERSION_SAVED",
  "NOTE_APPROVED",
  "NOTE_APPROVAL_REVOKED",
  "TIMELINE_DERIVED",
  "TIMELINES_CONFIRMED",

  // J) Export
  "EXPORT_STARTED",
  "EXPORT_COMPLETED",
  "EXPORT_FAILED",
  "SYSTEM_OF_RECORD_CONFIRMED",

  // K) Deletion, Purge
  "PURGE_STARTED",
  "PURGE_COMPLETED",
  "PURGE_FAILED",
  "AUDIO_DELETED",
  "TRANSCRIPT_DELETED",
  "MINIMIZED_TRANSCRIPT_DELETED",
  "DRAFT_DELETED",
  "EXPORT_ARTIFACT_DELETED",
  "EPHEMERAL_SCAN_STARTED",
  "EPHEMERAL_SCAN_COMPLETED",
  "EPHEMERAL_SCAN_RESULT",
  "EPHEMERAL_REMEDIATION_STARTED",
  "EPHEMERAL_REMEDIATION_COMPLETED",

  // L) Config & Security
  "CONFIG_CHANGED",
  "RETENTION_POLICY_UPDATED",
  "KEY_ROTATION_COMPLETED",
  "ENCRYPTION_POLICY_ENFORCED",

  // M) Anomalies & Alerts
  "ANOMALY_ACCESS_TIME",
  "ANOMALY_ACCESS_VOLUME",
  "ANOMALY_FAILED_LOGINS_SPIKE",
  "ANOMALY_BREAK_GLASS_USAGE",
  "ANOMALY_EXPORT_SPIKE",
  "ALERT_RAISED",
  "ALERT_ACKNOWLEDGED",
  "ALERT_RESOLVED",

  // N) Governance & Authorization
  "AI_USAGE_APPROVAL_REQUESTED",
  "AI_USAGE_APPROVED_BY_SUPERVISOR",
  "AI_USAGE_APPROVAL_REVOKED",
  "AI_USAGE_BLOCKED_NO_APPROVAL",

  // O) Auditor Access
  "AUDITOR_ACCESS_GRANTED",
  "AUDITOR_ACCESS_EXPIRED",
  "AUDITOR_ACCESS_REVOKED",

  // P) Compliance Export
  "COMPLIANCE_EXPORT_GENERATED",
  "COMPLIANCE_EXPORT_DOWNLOADED",

  // Q) Coordination Events (from The Platform)
  "COORDINATION_REFERRAL_STALLED",
  "COORDINATION_SLA_BREACHED",
  "COORDINATION_EXTERNAL_ACK_DELAYED",
  "COORDINATION_REPEATED_HANDOFF_FAILURE",
];

// ============================================================
// GLOBAL EVENT SCHEMA
// ============================================================

// Required fields for every event
export interface EyeEventBase {
  event_id: string;              // UUID
  event_type: EyeEventType;
  event_version: number;         // Schema version (currently 1)
  timestamp: string;             // UTC ISO 8601
  tenant_id: string;             // org/agency identifier
  environment: Environment;
  actor_type: ActorType;
  actor_id: string;              // user UUID or service identity
  actor_role: ActorRole | null;  // null if actor_type != 'user'
  session_id: string | null;     // nullable for non-session events
  case_id: string | null;        // nullable
  resource_type: ResourceType;
  resource_id: string;           // opaque ID, never a filename with PHI
  result: EventResult;
  reason_code: ReasonCode | null;
  request_id: string;            // trace ID across services
}

// Optional/useful fields
export interface EyeEventOptional {
  ip_hash?: string;
  device_fingerprint_hash?: string;
  geo_region?: string;           // coarse: state/region
  service_name?: string;         // emitter
  latency_ms?: number;
  bytes_in?: number;
  bytes_out?: number;
  tags?: EventTag[];
  severity?: EventSeverity;

  // Operator/identity fields (non-PHI)
  operator_id?: string;          // e.g., emp_0142
  
  // Save for Later / Resume fields
  bundle_id?: string;            // opaque WIP bundle ID
  previous_bundle_id?: string;   // for SESSION_LINKED
  linked_session_id?: string;    // for SESSION_LINKED
  
  // Category-specific optional fields
  ttl_seconds?: number;
  storage_bucket_id?: string;
  encryption_mode?: string;
  
  // Redaction-specific
  redaction_counts?: Record<string, number>;
  redaction_strategy?: "mask" | "tokenize" | "drop";
  minimization_level?: "strict" | "standard" | "off";
  
  // LLM-specific (future)
  model_provider?: string;
  model_name?: string;
  input_tokens_est?: number;
  output_tokens_est?: number;
  temperature?: number;
  prompt_template_id?: string;
  data_retention_mode?: "zero_retention" | "standard" | "self_hosted";
  
  // Purge-specific
  remaining_count?: number;
  remaining_types?: string[];
  
  // Export-specific
  destination_type?: string;
  destination_id?: string;
  export_artifact_ttl_set?: number;
}

// Complete Eye Event
export interface EyeEvent extends EyeEventBase, EyeEventOptional {}

// ============================================================
// EVENT CATEGORY MAPPING
// ============================================================

export const EVENT_CATEGORY_MAP: Record<EyeEventType, EventCategory> = {
  // Auth
  AUTH_LOGIN_SUCCESS: "AUTH",
  AUTH_LOGIN_FAILED: "AUTH",
  AUTH_LOGOUT: "AUTH",
  TOKEN_ISSUED: "AUTH",
  TOKEN_REVOKED: "AUTH",
  RBAC_ALLOW: "AUTH",
  RBAC_DENY: "AUTH",
  BREAK_GLASS_REQUESTED: "AUTH",
  BREAK_GLASS_GRANTED: "AUTH",
  BREAK_GLASS_EXPIRED: "AUTH",
  BREAK_GLASS_DENIED: "AUTH",

  // Session
  CASE_ACCESSED: "SESSION",
  CASE_LISTED: "SESSION",
  SESSION_STARTED: "SESSION",
  SESSION_HEARTBEAT: "SESSION",
  SESSION_FINISH_CLICKED: "SESSION",
  SESSION_CLOSED: "SESSION",
  SESSION_CANCELLED: "SESSION",
  SESSION_ABANDONED: "SESSION",
  
  // Save for Later / Resume
  WIP_BUNDLE_EXPORTED: "SESSION",
  EPHEMERAL_INPUTS_PURGED: "SESSION",
  WIP_BUNDLE_IMPORTED: "SESSION",
  SESSION_LINKED: "SESSION",
  RESUME_REQUIRES_NEW_INPUT: "SESSION",

  // Ingest
  AUDIO_UPLOAD_URL_ISSUED: "INGEST",
  AUDIO_UPLOADED: "INGEST",
  AUDIO_UPLOAD_FAILED: "INGEST",
  OBJECT_TTL_SET: "INGEST",
  OBJECT_TTL_EXPIRED: "INGEST",
  OBJECT_ENCRYPTION_VERIFIED: "INGEST",

  // Transcription
  TRANSCRIPTION_JOB_QUEUED: "TRANSCRIPTION",
  TRANSCRIPTION_STARTED: "TRANSCRIPTION",
  TRANSCRIPTION_COMPLETED: "TRANSCRIPTION",
  TRANSCRIPTION_FAILED: "TRANSCRIPTION",
  TRANSCRIPTION_PROVIDER_USED: "TRANSCRIPTION",

  // Redaction
  REDACTION_STARTED: "REDACTION",
  REDACTION_COMPLETED: "REDACTION",
  REDACTION_FAILED: "REDACTION",
  REDACTION_LAYER_COMPLETED: "REDACTION",
  VERIFICATION_PASSED: "REDACTION",
  VERIFICATION_FAILED: "REDACTION",

  // Generation (Future)
  KB_QUERY_STARTED: "GENERATION",
  KB_QUERY_COMPLETED: "GENERATION",
  KB_QUERY_FAILED: "GENERATION",
  TEMPLATE_SELECTED: "GENERATION",
  POLICY_PACK_ATTACHED: "GENERATION",
  LLM_CALL_STARTED: "GENERATION",
  LLM_CALL_COMPLETED: "GENERATION",
  LLM_CALL_FAILED: "GENERATION",

  // Validation (Future)
  OUTPUT_SCHEMA_VALIDATION_PASSED: "VALIDATION",
  OUTPUT_SCHEMA_VALIDATION_FAILED: "VALIDATION",
  OUTPUT_PHI_LEAK_CHECK_PASSED: "VALIDATION",
  OUTPUT_PHI_LEAK_CHECK_FAILED: "VALIDATION",
  OUTPUT_UNKNOWN_FIELDS_COUNTED: "VALIDATION",

  // Draft (Future)
  DRAFT_CREATED: "DRAFT",
  DRAFT_VIEWED: "DRAFT",
  DRAFT_EDITED: "DRAFT",
  DRAFT_VERSION_SAVED: "DRAFT",
  NOTE_APPROVED: "DRAFT",
  NOTE_APPROVAL_REVOKED: "DRAFT",
  TIMELINE_DERIVED: "DRAFT",
  TIMELINES_CONFIRMED: "DRAFT",

  // Export (Future)
  EXPORT_STARTED: "EXPORT",
  EXPORT_COMPLETED: "EXPORT",
  EXPORT_FAILED: "EXPORT",
  SYSTEM_OF_RECORD_CONFIRMED: "EXPORT",

  // Purge
  PURGE_STARTED: "PURGE",
  PURGE_COMPLETED: "PURGE",
  PURGE_FAILED: "PURGE",
  AUDIO_DELETED: "PURGE",
  TRANSCRIPT_DELETED: "PURGE",
  MINIMIZED_TRANSCRIPT_DELETED: "PURGE",
  DRAFT_DELETED: "PURGE",
  EXPORT_ARTIFACT_DELETED: "PURGE",
  EPHEMERAL_SCAN_STARTED: "PURGE",
  EPHEMERAL_SCAN_COMPLETED: "PURGE",
  EPHEMERAL_SCAN_RESULT: "PURGE",
  EPHEMERAL_REMEDIATION_STARTED: "PURGE",
  EPHEMERAL_REMEDIATION_COMPLETED: "PURGE",

  // Config (Future)
  CONFIG_CHANGED: "CONFIG",
  RETENTION_POLICY_UPDATED: "CONFIG",
  KEY_ROTATION_COMPLETED: "CONFIG",
  ENCRYPTION_POLICY_ENFORCED: "CONFIG",

  // Anomaly (Future)
  ANOMALY_ACCESS_TIME: "ANOMALY",
  ANOMALY_ACCESS_VOLUME: "ANOMALY",
  ANOMALY_FAILED_LOGINS_SPIKE: "ANOMALY",
  ANOMALY_BREAK_GLASS_USAGE: "ANOMALY",
  ANOMALY_EXPORT_SPIKE: "ANOMALY",
  ALERT_RAISED: "ANOMALY",
  ALERT_ACKNOWLEDGED: "ANOMALY",
  ALERT_RESOLVED: "ANOMALY",

  // Governance & Authorization
  AI_USAGE_APPROVAL_REQUESTED: "GOVERNANCE",
  AI_USAGE_APPROVED_BY_SUPERVISOR: "GOVERNANCE",
  AI_USAGE_APPROVAL_REVOKED: "GOVERNANCE",
  AI_USAGE_BLOCKED_NO_APPROVAL: "GOVERNANCE",

  // Auditor Access
  AUDITOR_ACCESS_GRANTED: "GOVERNANCE",
  AUDITOR_ACCESS_EXPIRED: "GOVERNANCE",
  AUDITOR_ACCESS_REVOKED: "GOVERNANCE",

  // Compliance Export
  COMPLIANCE_EXPORT_GENERATED: "EXPORT",
  COMPLIANCE_EXPORT_DOWNLOADED: "EXPORT",

  // Coordination (The Platform)
  COORDINATION_REFERRAL_STALLED: "COORDINATION",
  COORDINATION_SLA_BREACHED: "COORDINATION",
  COORDINATION_EXTERNAL_ACK_DELAYED: "COORDINATION",
  COORDINATION_REPEATED_HANDOFF_FAILURE: "COORDINATION",
};

// ============================================================
// DEFAULT SEVERITY MAPPING
// ============================================================

export const EVENT_SEVERITY_MAP: Record<EyeEventType, EventSeverity> = {
  // Auth - mostly INFO, failures are WARN/HIGH
  AUTH_LOGIN_SUCCESS: "INFO",
  AUTH_LOGIN_FAILED: "WARN",
  AUTH_LOGOUT: "INFO",
  TOKEN_ISSUED: "INFO",
  TOKEN_REVOKED: "INFO",
  RBAC_ALLOW: "INFO",
  RBAC_DENY: "HIGH",
  BREAK_GLASS_REQUESTED: "HIGH",
  BREAK_GLASS_GRANTED: "CRITICAL",
  BREAK_GLASS_EXPIRED: "NOTICE",
  BREAK_GLASS_DENIED: "HIGH",

  // Session
  CASE_ACCESSED: "INFO",
  CASE_LISTED: "INFO",
  SESSION_STARTED: "INFO",
  SESSION_HEARTBEAT: "INFO",
  SESSION_FINISH_CLICKED: "NOTICE",
  SESSION_CLOSED: "NOTICE",
  SESSION_CANCELLED: "NOTICE",
  // SESSION_ABANDONED: NOTICE (informational safety outcome, not a failure)
  // This is observational — no user intent is claimed
  SESSION_ABANDONED: "NOTICE",
  
  // Save for Later / Resume
  WIP_BUNDLE_EXPORTED: "NOTICE",
  EPHEMERAL_INPUTS_PURGED: "NOTICE",
  WIP_BUNDLE_IMPORTED: "NOTICE",
  SESSION_LINKED: "INFO",
  RESUME_REQUIRES_NEW_INPUT: "INFO",

  // Ingest
  AUDIO_UPLOAD_URL_ISSUED: "INFO",
  AUDIO_UPLOADED: "INFO",
  AUDIO_UPLOAD_FAILED: "WARN",
  OBJECT_TTL_SET: "INFO",
  OBJECT_TTL_EXPIRED: "NOTICE",
  OBJECT_ENCRYPTION_VERIFIED: "INFO",

  // Transcription
  TRANSCRIPTION_JOB_QUEUED: "INFO",
  TRANSCRIPTION_STARTED: "INFO",
  TRANSCRIPTION_COMPLETED: "NOTICE",
  TRANSCRIPTION_FAILED: "WARN",
  TRANSCRIPTION_PROVIDER_USED: "INFO",

  // Redaction
  REDACTION_STARTED: "INFO",
  REDACTION_COMPLETED: "NOTICE",
  REDACTION_FAILED: "WARN",
  REDACTION_LAYER_COMPLETED: "INFO",
  VERIFICATION_PASSED: "INFO",
  VERIFICATION_FAILED: "WARN",

  // Generation (Future)
  KB_QUERY_STARTED: "INFO",
  KB_QUERY_COMPLETED: "INFO",
  KB_QUERY_FAILED: "WARN",
  TEMPLATE_SELECTED: "INFO",
  POLICY_PACK_ATTACHED: "INFO",
  // LLM events: Compliance-focused instrumentation
  // STARTED: INFO (informational, no action needed)
  // COMPLETED: NOTICE (compliance-relevant, confirms data_retention_mode)
  // FAILED: WARN (degradation, counts as compliance failure per policy)
  LLM_CALL_STARTED: "INFO",
  LLM_CALL_COMPLETED: "NOTICE",
  LLM_CALL_FAILED: "WARN",

  // Validation (Future)
  OUTPUT_SCHEMA_VALIDATION_PASSED: "INFO",
  OUTPUT_SCHEMA_VALIDATION_FAILED: "WARN",
  OUTPUT_PHI_LEAK_CHECK_PASSED: "INFO",
  OUTPUT_PHI_LEAK_CHECK_FAILED: "HIGH",
  OUTPUT_UNKNOWN_FIELDS_COUNTED: "INFO",

  // Draft (Future)
  DRAFT_CREATED: "INFO",
  DRAFT_VIEWED: "INFO",
  DRAFT_EDITED: "INFO",
  DRAFT_VERSION_SAVED: "INFO",
  NOTE_APPROVED: "NOTICE",
  NOTE_APPROVAL_REVOKED: "NOTICE",
  TIMELINE_DERIVED: "INFO",
  TIMELINES_CONFIRMED: "INFO",

  // Export (Future)
  EXPORT_STARTED: "NOTICE",
  EXPORT_COMPLETED: "NOTICE",
  EXPORT_FAILED: "WARN",
  SYSTEM_OF_RECORD_CONFIRMED: "NOTICE",

  // Purge
  PURGE_STARTED: "NOTICE",
  PURGE_COMPLETED: "NOTICE",
  PURGE_FAILED: "HIGH",
  AUDIO_DELETED: "NOTICE",
  TRANSCRIPT_DELETED: "NOTICE",
  MINIMIZED_TRANSCRIPT_DELETED: "NOTICE",
  DRAFT_DELETED: "NOTICE",
  EXPORT_ARTIFACT_DELETED: "NOTICE",
  EPHEMERAL_SCAN_STARTED: "INFO",
  EPHEMERAL_SCAN_COMPLETED: "INFO",
  EPHEMERAL_SCAN_RESULT: "NOTICE",
  EPHEMERAL_REMEDIATION_STARTED: "NOTICE",
  EPHEMERAL_REMEDIATION_COMPLETED: "NOTICE",

  // Config (Future)
  CONFIG_CHANGED: "NOTICE",
  RETENTION_POLICY_UPDATED: "NOTICE",
  KEY_ROTATION_COMPLETED: "NOTICE",
  ENCRYPTION_POLICY_ENFORCED: "INFO",

  // Anomaly (Future)
  ANOMALY_ACCESS_TIME: "WARN",
  ANOMALY_ACCESS_VOLUME: "WARN",
  ANOMALY_FAILED_LOGINS_SPIKE: "HIGH",
  ANOMALY_BREAK_GLASS_USAGE: "CRITICAL",
  ANOMALY_EXPORT_SPIKE: "WARN",
  ALERT_RAISED: "HIGH",
  ALERT_ACKNOWLEDGED: "INFO",
  ALERT_RESOLVED: "INFO",

  // Governance & Authorization
  AI_USAGE_APPROVAL_REQUESTED: "INFO",
  AI_USAGE_APPROVED_BY_SUPERVISOR: "NOTICE",
  AI_USAGE_APPROVAL_REVOKED: "HIGH",
  AI_USAGE_BLOCKED_NO_APPROVAL: "HIGH",

  // Auditor Access
  AUDITOR_ACCESS_GRANTED: "NOTICE",
  AUDITOR_ACCESS_EXPIRED: "NOTICE",
  AUDITOR_ACCESS_REVOKED: "NOTICE",

  // Compliance Export
  COMPLIANCE_EXPORT_GENERATED: "NOTICE",
  COMPLIANCE_EXPORT_DOWNLOADED: "INFO",

  // Coordination (The Platform)
  COORDINATION_REFERRAL_STALLED: "HIGH",
  COORDINATION_SLA_BREACHED: "HIGH",
  COORDINATION_EXTERNAL_ACK_DELAYED: "WARN",
  COORDINATION_REPEATED_HANDOFF_FAILURE: "WARN",
};

// ============================================================
// IMPLEMENTED VS FUTURE EVENTS
// ============================================================

// Events that are currently implemented and emitting
export const IMPLEMENTED_EVENTS: EyeEventType[] = [
  // Session lifecycle
  "SESSION_STARTED",
  "SESSION_HEARTBEAT",
  "SESSION_FINISH_CLICKED",
  "SESSION_CLOSED",
  "SESSION_CANCELLED",
  "SESSION_ABANDONED",  // Observational safety event
  
  // Save for Later / Resume
  "WIP_BUNDLE_EXPORTED",
  "EPHEMERAL_INPUTS_PURGED",
  "WIP_BUNDLE_IMPORTED",
  "SESSION_LINKED",

  // Ingest & storage (AUDIO_* are Legacy – v0 pipeline)
  "AUDIO_UPLOADED",               // Legacy – v0 pipeline
  "OBJECT_TTL_SET",
  "OBJECT_TTL_EXPIRED",           // mocked

  // Transcription (Legacy – v0 pipeline — NOT emitting in v1)
  "TRANSCRIPTION_JOB_QUEUED",
  "TRANSCRIPTION_STARTED",
  "TRANSCRIPTION_COMPLETED",
  "TRANSCRIPTION_FAILED",
  "TRANSCRIPTION_PROVIDER_USED",

  // Redaction (Legacy – v0 pipeline — NOT emitting in v1)
  "REDACTION_STARTED",
  "REDACTION_COMPLETED",
  "REDACTION_FAILED",
  "REDACTION_LAYER_COMPLETED",
  "VERIFICATION_PASSED",
  "VERIFICATION_FAILED",

  // Purge & ephemerality
  "PURGE_STARTED",
  "AUDIO_DELETED",
  "TRANSCRIPT_DELETED",
  "MINIMIZED_TRANSCRIPT_DELETED",
  "EPHEMERAL_SCAN_RESULT",
  "PURGE_COMPLETED",
  "PURGE_FAILED",
  
  // LLM (compliance-focused instrumentation)
  "LLM_CALL_STARTED",
  "LLM_CALL_COMPLETED",
  "LLM_CALL_FAILED",
  
  // Export
  "EXPORT_STARTED",
  "EXPORT_COMPLETED",
  "EXPORT_FAILED",

  // Governance & Authorization
  "AI_USAGE_APPROVAL_REQUESTED",
  "AI_USAGE_APPROVED_BY_SUPERVISOR",
  "AI_USAGE_APPROVAL_REVOKED",
  "AI_USAGE_BLOCKED_NO_APPROVAL",

  // Auditor Access
  "AUDITOR_ACCESS_GRANTED",
  "AUDITOR_ACCESS_EXPIRED",
  "AUDITOR_ACCESS_REVOKED",

  // Compliance Export
  "COMPLIANCE_EXPORT_GENERATED",
  "COMPLIANCE_EXPORT_DOWNLOADED",
];

// Events that are scaffolded but not yet emitting
export const FUTURE_EVENTS: EyeEventType[] = [
  // KB retrieval
  "KB_QUERY_STARTED",
  "KB_QUERY_COMPLETED",
  "KB_QUERY_FAILED",
  "TEMPLATE_SELECTED",
  "POLICY_PACK_ATTACHED",

  // Validation
  "OUTPUT_SCHEMA_VALIDATION_PASSED",
  "OUTPUT_SCHEMA_VALIDATION_FAILED",
  "OUTPUT_PHI_LEAK_CHECK_PASSED",
  "OUTPUT_PHI_LEAK_CHECK_FAILED",

  // Draft
  "DRAFT_CREATED",
  "NOTE_APPROVED",
  "TIMELINE_DERIVED",
  "TIMELINES_CONFIRMED",
];

// Check if an event type is currently implemented
export function isEventImplemented(eventType: EyeEventType): boolean {
  return IMPLEMENTED_EVENTS.includes(eventType);
}

// ============================================================
// HELPER FUNCTIONS (replacing mock-data dependencies)
// ============================================================

/**
 * Get the severity for an Eye event.
 * Uses explicit event.severity if available, otherwise falls back to type-based mapping.
 */
export function getEventSeverity(event: EyeEvent): EventSeverity {
  if (event.severity) return event.severity;
  return EVENT_SEVERITY_MAP[event.event_type] ?? "INFO";
}

/**
 * Get the category for an Eye event based on event type.
 */
export function getEventCategory(event: EyeEvent): EventCategory {
  return EVENT_CATEGORY_MAP[event.event_type] ?? "SESSION";
}
