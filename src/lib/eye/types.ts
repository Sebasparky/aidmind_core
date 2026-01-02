/**
 * The Eye Event Taxonomy v0
 * 
 * Design Goals:
 * 1. No PHI in The Eye. Ever.
 * 2. Events are append-only (immutable); corrections happen via new events.
 * 3. Every event supports: who / what / when / where / why (as metadata).
 * 4. Events are scoped: tenant → user → case → session → artifact.
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
  | "TTL_EXPIRED"
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
  | "CANCELLED";

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
  | "ANOMALY";

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

  // Save for Later / Resume Draft
  | "WIP_BUNDLE_EXPORTED"
  | "EPHEMERAL_INPUTS_PURGED"
  | "WIP_BUNDLE_IMPORTED"
  | "SESSION_LINKED"
  | "RESUME_REQUIRES_NEW_INPUT"

  // C) Ingest: Uploads & Object Storage
  | "AUDIO_UPLOAD_URL_ISSUED"
  | "AUDIO_UPLOADED"
  | "AUDIO_UPLOAD_FAILED"
  | "OBJECT_TTL_SET"
  | "OBJECT_TTL_EXPIRED"
  | "OBJECT_ENCRYPTION_VERIFIED"

  // D) Transcription Pipeline
  | "TRANSCRIPTION_JOB_QUEUED"
  | "TRANSCRIPTION_STARTED"
  | "TRANSCRIPTION_COMPLETED"
  | "TRANSCRIPTION_FAILED"

  // E) Redaction & Minimization
  | "REDACTION_STARTED"
  | "REDACTION_COMPLETED"
  | "REDACTION_FAILED"
  | "REDACTION_LAYER_COMPLETED"
  | "VERIFICATION_PASSED"
  | "VERIFICATION_FAILED"

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
  | "ALERT_RESOLVED";

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
  LLM_CALL_STARTED: "INFO",
  LLM_CALL_COMPLETED: "INFO",
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
};

// ============================================================
// IMPLEMENTED VS FUTURE EVENTS
// ============================================================

// Events that are currently implemented and emitting
export const IMPLEMENTED_EVENTS: EyeEventType[] = [
  // Session lifecycle
  "SESSION_STARTED",
  "SESSION_FINISH_CLICKED",
  "SESSION_CLOSED",
  "SESSION_CANCELLED",
  
  // Save for Later / Resume
  "WIP_BUNDLE_EXPORTED",
  "EPHEMERAL_INPUTS_PURGED",
  "WIP_BUNDLE_IMPORTED",
  "SESSION_LINKED",

  // Ingest & storage
  "AUDIO_UPLOADED",
  "OBJECT_TTL_SET",
  "OBJECT_TTL_EXPIRED", // mocked

  // Transcription
  "TRANSCRIPTION_JOB_QUEUED",
  "TRANSCRIPTION_STARTED",
  "TRANSCRIPTION_COMPLETED",
  "TRANSCRIPTION_FAILED",

  // Redaction
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
];

// Events that are scaffolded but not yet emitting
export const FUTURE_EVENTS: EyeEventType[] = [
  // KB retrieval
  "KB_QUERY_STARTED",
  "KB_QUERY_COMPLETED",
  "KB_QUERY_FAILED",
  "TEMPLATE_SELECTED",
  "POLICY_PACK_ATTACHED",

  // LLM
  "LLM_CALL_STARTED",
  "LLM_CALL_COMPLETED",
  "LLM_CALL_FAILED",

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

  // Export
  "EXPORT_STARTED",
  "EXPORT_COMPLETED",
];

// Check if an event type is currently implemented
export function isEventImplemented(eventType: EyeEventType): boolean {
  return IMPLEMENTED_EVENTS.includes(eventType);
}
