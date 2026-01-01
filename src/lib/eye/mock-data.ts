/**
 * Mock Eye Events for Supervisor UI Development
 * 
 * IMPORTANT: This is placeholder data only. No PHI.
 * These events simulate what would come from the real Eye event store.
 */

import {
  EyeEvent,
  EyeEventType,
  EventSeverity,
  EventCategory,
  EVENT_CATEGORY_MAP,
  EVENT_SEVERITY_MAP,
  ActorRole,
  EventResult,
  ResourceType,
} from "./types";

// Helper to generate UUID
function uuid(): string {
  return crypto.randomUUID();
}

// Helper to generate timestamp within last N hours
function recentTimestamp(hoursAgo: number): string {
  const date = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  return date.toISOString();
}

// Helper to generate request ID
function requestId(): string {
  return `req_${uuid().slice(0, 8)}`;
}

// Mock session IDs (opaque, non-PHI)
const MOCK_SESSION_IDS = [
  "sess_a1b2c3d4",
  "sess_e5f6g7h8",
  "sess_i9j0k1l2",
  "sess_m3n4o5p6",
  "sess_q7r8s9t0",
];

// Mock case IDs (opaque, non-PHI)
const MOCK_CASE_IDS = [
  "case_001",
  "case_002",
  "case_003",
  "case_004",
  "case_005",
];

// Mock actor IDs
const MOCK_ACTORS = [
  { id: "user_001", role: "caseworker" as ActorRole },
  { id: "user_002", role: "caseworker" as ActorRole },
  { id: "user_003", role: "supervisor" as ActorRole },
  { id: "service_transcription", role: null },
  { id: "service_redaction", role: null },
  { id: "system_scheduler", role: null },
];

// Create a complete mock event
function createMockEvent(
  eventType: EyeEventType,
  hoursAgo: number,
  overrides: Partial<EyeEvent> = {}
): EyeEvent {
  const actor = MOCK_ACTORS[Math.floor(Math.random() * MOCK_ACTORS.length)];
  const sessionId = MOCK_SESSION_IDS[Math.floor(Math.random() * MOCK_SESSION_IDS.length)];
  const caseId = MOCK_CASE_IDS[Math.floor(Math.random() * MOCK_CASE_IDS.length)];
  
  const isService = actor.id.startsWith("service_") || actor.id.startsWith("system_");
  
  return {
    event_id: uuid(),
    event_type: eventType,
    event_version: 1,
    timestamp: recentTimestamp(hoursAgo),
    tenant_id: "tenant_aidmind_demo",
    environment: "dev",
    actor_type: isService ? (actor.id.startsWith("system_") ? "system" : "service") : "user",
    actor_id: actor.id,
    actor_role: actor.role,
    session_id: sessionId,
    case_id: caseId,
    resource_type: "session" as ResourceType,
    resource_id: sessionId,
    result: "success" as EventResult,
    reason_code: null,
    request_id: requestId(),
    severity: EVENT_SEVERITY_MAP[eventType],
    tags: [],
    ...overrides,
  };
}

// Generate realistic event sequences for sessions
export function generateMockEyeEvents(): EyeEvent[] {
  const events: EyeEvent[] = [];
  
  // Session 1: Complete successful flow (2 hours ago)
  const session1 = "sess_complete_001";
  const case1 = "case_housing_001";
  
  events.push(createMockEvent("SESSION_STARTED", 2.5, {
    session_id: session1,
    case_id: case1,
    actor_id: "user_001",
    actor_type: "user",
    actor_role: "caseworker",
    resource_type: "session",
  }));
  
  events.push(createMockEvent("AUDIO_UPLOADED", 2.4, {
    session_id: session1,
    case_id: case1,
    actor_id: "user_001",
    actor_type: "user",
    actor_role: "caseworker",
    resource_type: "audio",
    resource_id: "audio_001",
    bytes_in: 2457600,
    tags: ["PHI_TOUCHING", "EPHEMERAL"],
  }));
  
  events.push(createMockEvent("OBJECT_TTL_SET", 2.4, {
    session_id: session1,
    case_id: case1,
    actor_id: "service_storage",
    actor_type: "service",
    actor_role: null,
    resource_type: "audio",
    resource_id: "audio_001",
    ttl_seconds: 3600,
    tags: ["EPHEMERAL"],
  }));
  
  events.push(createMockEvent("TRANSCRIPTION_JOB_QUEUED", 2.35, {
    session_id: session1,
    case_id: case1,
    actor_id: "service_transcription",
    actor_type: "service",
    actor_role: null,
    resource_type: "job",
    resource_id: "job_trans_001",
  }));
  
  events.push(createMockEvent("TRANSCRIPTION_STARTED", 2.3, {
    session_id: session1,
    case_id: case1,
    actor_id: "service_transcription",
    actor_type: "service",
    actor_role: null,
    resource_type: "job",
    resource_id: "job_trans_001",
    tags: ["PHI_TOUCHING"],
  }));
  
  events.push(createMockEvent("TRANSCRIPTION_COMPLETED", 2.1, {
    session_id: session1,
    case_id: case1,
    actor_id: "service_transcription",
    actor_type: "service",
    actor_role: null,
    resource_type: "transcript",
    resource_id: "transcript_001",
    latency_ms: 12500,
    tags: ["PHI_TOUCHING", "EPHEMERAL"],
  }));
  
  events.push(createMockEvent("REDACTION_STARTED", 2.05, {
    session_id: session1,
    case_id: case1,
    actor_id: "service_redaction",
    actor_type: "service",
    actor_role: null,
    resource_type: "transcript",
    resource_id: "transcript_001",
    tags: ["PHI_TOUCHING"],
  }));
  
  events.push(createMockEvent("REDACTION_LAYER_COMPLETED", 2.0, {
    session_id: session1,
    case_id: case1,
    actor_id: "service_redaction",
    actor_type: "service",
    actor_role: null,
    resource_type: "transcript",
    resource_id: "transcript_001",
    redaction_counts: { case_id: 2, agency: 1 },
    service_name: "layer_0_preprocessing",
  }));
  
  events.push(createMockEvent("REDACTION_LAYER_COMPLETED", 1.95, {
    session_id: session1,
    case_id: case1,
    actor_id: "service_redaction",
    actor_type: "service",
    actor_role: null,
    resource_type: "transcript",
    resource_id: "transcript_001",
    redaction_counts: { phone: 1, email: 1, ssn: 0, dob: 1, address: 2 },
    service_name: "layer_1_regex",
  }));
  
  events.push(createMockEvent("REDACTION_LAYER_COMPLETED", 1.9, {
    session_id: session1,
    case_id: case1,
    actor_id: "service_redaction",
    actor_type: "service",
    actor_role: null,
    resource_type: "transcript",
    resource_id: "transcript_001",
    redaction_counts: { PERSON: 3, LOCATION: 2, ORGANIZATION: 1, DATE: 4 },
    service_name: "layer_2_ner",
  }));
  
  events.push(createMockEvent("VERIFICATION_PASSED", 1.85, {
    session_id: session1,
    case_id: case1,
    actor_id: "service_redaction",
    actor_type: "service",
    actor_role: null,
    resource_type: "minimized_transcript",
    resource_id: "minimized_001",
  }));
  
  events.push(createMockEvent("REDACTION_COMPLETED", 1.8, {
    session_id: session1,
    case_id: case1,
    actor_id: "service_redaction",
    actor_type: "service",
    actor_role: null,
    resource_type: "minimized_transcript",
    resource_id: "minimized_001",
    redaction_counts: { total: 17 },
    redaction_strategy: "tokenize",
    minimization_level: "strict",
    latency_ms: 18000,
  }));
  
  events.push(createMockEvent("SESSION_FINISH_CLICKED", 1.5, {
    session_id: session1,
    case_id: case1,
    actor_id: "user_001",
    actor_type: "user",
    actor_role: "caseworker",
    resource_type: "session",
    resource_id: session1,
  }));
  
  events.push(createMockEvent("PURGE_STARTED", 1.4, {
    session_id: session1,
    case_id: case1,
    actor_id: "system_scheduler",
    actor_type: "system",
    actor_role: null,
    resource_type: "session",
    resource_id: session1,
    tags: ["DELETION_PROOF"],
  }));
  
  events.push(createMockEvent("AUDIO_DELETED", 1.35, {
    session_id: session1,
    case_id: case1,
    actor_id: "system_scheduler",
    actor_type: "system",
    actor_role: null,
    resource_type: "audio",
    resource_id: "audio_001",
    tags: ["DELETION_PROOF", "EPHEMERAL"],
  }));
  
  events.push(createMockEvent("TRANSCRIPT_DELETED", 1.3, {
    session_id: session1,
    case_id: case1,
    actor_id: "system_scheduler",
    actor_type: "system",
    actor_role: null,
    resource_type: "transcript",
    resource_id: "transcript_001",
    tags: ["DELETION_PROOF", "EPHEMERAL"],
  }));
  
  events.push(createMockEvent("MINIMIZED_TRANSCRIPT_DELETED", 1.25, {
    session_id: session1,
    case_id: case1,
    actor_id: "system_scheduler",
    actor_type: "system",
    actor_role: null,
    resource_type: "minimized_transcript",
    resource_id: "minimized_001",
    tags: ["DELETION_PROOF", "EPHEMERAL"],
  }));
  
  events.push(createMockEvent("EPHEMERAL_SCAN_RESULT", 1.2, {
    session_id: session1,
    case_id: case1,
    actor_id: "system_scheduler",
    actor_type: "system",
    actor_role: null,
    resource_type: "session",
    resource_id: session1,
    remaining_count: 0,
    remaining_types: [],
    tags: ["DELETION_PROOF"],
  }));
  
  events.push(createMockEvent("PURGE_COMPLETED", 1.15, {
    session_id: session1,
    case_id: case1,
    actor_id: "system_scheduler",
    actor_type: "system",
    actor_role: null,
    resource_type: "session",
    resource_id: session1,
    tags: ["DELETION_PROOF"],
  }));
  
  events.push(createMockEvent("SESSION_CLOSED", 1.1, {
    session_id: session1,
    case_id: case1,
    actor_id: "system_scheduler",
    actor_type: "system",
    actor_role: null,
    resource_type: "session",
    resource_id: session1,
  }));

  // Session 2: Failed transcription (1 hour ago)
  const session2 = "sess_failed_001";
  const case2 = "case_benefits_002";
  
  events.push(createMockEvent("SESSION_STARTED", 1.0, {
    session_id: session2,
    case_id: case2,
    actor_id: "user_002",
    actor_type: "user",
    actor_role: "caseworker",
  }));
  
  events.push(createMockEvent("AUDIO_UPLOADED", 0.95, {
    session_id: session2,
    case_id: case2,
    actor_id: "user_002",
    actor_type: "user",
    actor_role: "caseworker",
    resource_type: "audio",
    resource_id: "audio_002",
    bytes_in: 5120000,
    tags: ["PHI_TOUCHING", "EPHEMERAL"],
  }));
  
  events.push(createMockEvent("TRANSCRIPTION_JOB_QUEUED", 0.9, {
    session_id: session2,
    case_id: case2,
    actor_id: "service_transcription",
    actor_type: "service",
    actor_role: null,
    resource_type: "job",
    resource_id: "job_trans_002",
  }));
  
  events.push(createMockEvent("TRANSCRIPTION_STARTED", 0.85, {
    session_id: session2,
    case_id: case2,
    actor_id: "service_transcription",
    actor_type: "service",
    actor_role: null,
    resource_type: "job",
    resource_id: "job_trans_002",
    tags: ["PHI_TOUCHING"],
  }));
  
  events.push(createMockEvent("TRANSCRIPTION_FAILED", 0.8, {
    session_id: session2,
    case_id: case2,
    actor_id: "service_transcription",
    actor_type: "service",
    actor_role: null,
    resource_type: "job",
    resource_id: "job_trans_002",
    result: "failure",
    reason_code: "PROVIDER_ERROR",
    severity: "WARN",
  }));
  
  events.push(createMockEvent("SESSION_CANCELLED", 0.75, {
    session_id: session2,
    case_id: case2,
    actor_id: "user_002",
    actor_type: "user",
    actor_role: "caseworker",
  }));
  
  events.push(createMockEvent("PURGE_STARTED", 0.7, {
    session_id: session2,
    case_id: case2,
    actor_id: "system_scheduler",
    actor_type: "system",
    actor_role: null,
    tags: ["DELETION_PROOF"],
  }));
  
  events.push(createMockEvent("AUDIO_DELETED", 0.65, {
    session_id: session2,
    case_id: case2,
    actor_id: "system_scheduler",
    actor_type: "system",
    actor_role: null,
    resource_type: "audio",
    resource_id: "audio_002",
    tags: ["DELETION_PROOF", "EPHEMERAL"],
  }));
  
  events.push(createMockEvent("EPHEMERAL_SCAN_RESULT", 0.6, {
    session_id: session2,
    case_id: case2,
    actor_id: "system_scheduler",
    actor_type: "system",
    actor_role: null,
    remaining_count: 0,
    remaining_types: [],
    tags: ["DELETION_PROOF"],
  }));
  
  events.push(createMockEvent("PURGE_COMPLETED", 0.55, {
    session_id: session2,
    case_id: case2,
    actor_id: "system_scheduler",
    actor_type: "system",
    actor_role: null,
    tags: ["DELETION_PROOF"],
  }));

  // Session 3: In-progress session (30 mins ago)
  const session3 = "sess_active_001";
  const case3 = "case_childcare_003";
  
  events.push(createMockEvent("SESSION_STARTED", 0.5, {
    session_id: session3,
    case_id: case3,
    actor_id: "user_001",
    actor_type: "user",
    actor_role: "caseworker",
  }));
  
  events.push(createMockEvent("AUDIO_UPLOADED", 0.45, {
    session_id: session3,
    case_id: case3,
    actor_id: "user_001",
    actor_type: "user",
    actor_role: "caseworker",
    resource_type: "audio",
    resource_id: "audio_003",
    bytes_in: 1843200,
    tags: ["PHI_TOUCHING", "EPHEMERAL"],
  }));
  
  events.push(createMockEvent("OBJECT_TTL_SET", 0.45, {
    session_id: session3,
    case_id: case3,
    actor_id: "service_storage",
    actor_type: "service",
    actor_role: null,
    resource_type: "audio",
    resource_id: "audio_003",
    ttl_seconds: 3600,
    tags: ["EPHEMERAL"],
  }));
  
  events.push(createMockEvent("TRANSCRIPTION_JOB_QUEUED", 0.4, {
    session_id: session3,
    case_id: case3,
    actor_id: "service_transcription",
    actor_type: "service",
    actor_role: null,
    resource_type: "job",
    resource_id: "job_trans_003",
  }));
  
  events.push(createMockEvent("TRANSCRIPTION_STARTED", 0.35, {
    session_id: session3,
    case_id: case3,
    actor_id: "service_transcription",
    actor_type: "service",
    actor_role: null,
    resource_type: "job",
    resource_id: "job_trans_003",
    tags: ["PHI_TOUCHING"],
  }));
  
  events.push(createMockEvent("TRANSCRIPTION_COMPLETED", 0.25, {
    session_id: session3,
    case_id: case3,
    actor_id: "service_transcription",
    actor_type: "service",
    actor_role: null,
    resource_type: "transcript",
    resource_id: "transcript_003",
    latency_ms: 6000,
    tags: ["PHI_TOUCHING", "EPHEMERAL"],
  }));
  
  events.push(createMockEvent("REDACTION_STARTED", 0.2, {
    session_id: session3,
    case_id: case3,
    actor_id: "service_redaction",
    actor_type: "service",
    actor_role: null,
    resource_type: "transcript",
    resource_id: "transcript_003",
    tags: ["PHI_TOUCHING"],
  }));
  
  events.push(createMockEvent("REDACTION_COMPLETED", 0.15, {
    session_id: session3,
    case_id: case3,
    actor_id: "service_redaction",
    actor_type: "service",
    actor_role: null,
    resource_type: "minimized_transcript",
    resource_id: "minimized_003",
    redaction_counts: { total: 8 },
    redaction_strategy: "tokenize",
    minimization_level: "strict",
    latency_ms: 3000,
  }));

  // Session 4: Redaction failure (15 mins ago)
  const session4 = "sess_redfail_001";
  const case4 = "case_snap_004";
  
  events.push(createMockEvent("SESSION_STARTED", 0.3, {
    session_id: session4,
    case_id: case4,
    actor_id: "user_002",
    actor_type: "user",
    actor_role: "caseworker",
  }));
  
  events.push(createMockEvent("AUDIO_UPLOADED", 0.28, {
    session_id: session4,
    case_id: case4,
    actor_id: "user_002",
    actor_type: "user",
    actor_role: "caseworker",
    resource_type: "audio",
    resource_id: "audio_004",
    bytes_in: 4096000,
    tags: ["PHI_TOUCHING", "EPHEMERAL"],
  }));
  
  events.push(createMockEvent("TRANSCRIPTION_COMPLETED", 0.22, {
    session_id: session4,
    case_id: case4,
    actor_id: "service_transcription",
    actor_type: "service",
    actor_role: null,
    resource_type: "transcript",
    resource_id: "transcript_004",
    latency_ms: 9500,
    tags: ["PHI_TOUCHING", "EPHEMERAL"],
  }));
  
  events.push(createMockEvent("REDACTION_STARTED", 0.2, {
    session_id: session4,
    case_id: case4,
    actor_id: "service_redaction",
    actor_type: "service",
    actor_role: null,
    resource_type: "transcript",
    resource_id: "transcript_004",
    tags: ["PHI_TOUCHING"],
  }));
  
  events.push(createMockEvent("REDACTION_FAILED", 0.18, {
    session_id: session4,
    case_id: case4,
    actor_id: "service_redaction",
    actor_type: "service",
    actor_role: null,
    resource_type: "transcript",
    resource_id: "transcript_004",
    result: "failure",
    reason_code: "TIMEOUT",
    severity: "WARN",
  }));

  // Add some TTL expiry events (mocked - these would come from background jobs)
  events.push(createMockEvent("OBJECT_TTL_EXPIRED", 3.0, {
    session_id: "sess_old_001",
    case_id: "case_old_001",
    actor_id: "system_scheduler",
    actor_type: "system",
    actor_role: null,
    resource_type: "audio",
    resource_id: "audio_old_001",
    tags: ["EPHEMERAL", "DELETION_PROOF"],
  }));

  // Sort by timestamp (newest first)
  return events.sort((a, b) => 
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

// Get category for an event
export function getEventCategory(event: EyeEvent): EventCategory {
  return EVENT_CATEGORY_MAP[event.event_type];
}

// Get severity for an event (from event or default mapping)
export function getEventSeverity(event: EyeEvent): EventSeverity {
  return event.severity || EVENT_SEVERITY_MAP[event.event_type];
}

// Filter events by various criteria
export interface EventFilters {
  categories?: EventCategory[];
  severities?: EventSeverity[];
  sessionId?: string;
  caseId?: string;
  startTime?: Date;
  endTime?: Date;
  result?: EventResult;
}

export function filterEvents(events: EyeEvent[], filters: EventFilters): EyeEvent[] {
  return events.filter((event) => {
    if (filters.categories?.length && !filters.categories.includes(getEventCategory(event))) {
      return false;
    }
    if (filters.severities?.length && !filters.severities.includes(getEventSeverity(event))) {
      return false;
    }
    if (filters.sessionId && event.session_id !== filters.sessionId) {
      return false;
    }
    if (filters.caseId && event.case_id !== filters.caseId) {
      return false;
    }
    if (filters.startTime && new Date(event.timestamp) < filters.startTime) {
      return false;
    }
    if (filters.endTime && new Date(event.timestamp) > filters.endTime) {
      return false;
    }
    if (filters.result && event.result !== filters.result) {
      return false;
    }
    return true;
  });
}

// Get purge proof events (sessions with successful purge)
export function getPurgeProofEvents(events: EyeEvent[]): EyeEvent[] {
  const purgeCompleted = events.filter(
    (e) => e.event_type === "PURGE_COMPLETED" && e.result === "success"
  );
  const scanResults = events.filter(
    (e) => e.event_type === "EPHEMERAL_SCAN_RESULT" && e.remaining_count === 0
  );
  
  // Return unique sessions that have both purge completed and scan result with 0 remaining
  const purgedSessionIds = new Set(purgeCompleted.map((e) => e.session_id));
  const cleanSessionIds = new Set(scanResults.map((e) => e.session_id));
  
  const provenSessionIds = [...purgedSessionIds].filter((id) => cleanSessionIds.has(id));
  
  return events.filter(
    (e) => 
      provenSessionIds.includes(e.session_id) && 
      (e.event_type === "PURGE_COMPLETED" || e.event_type === "EPHEMERAL_SCAN_RESULT")
  );
}

// Get error/warning events
export function getErrorEvents(events: EyeEvent[]): EyeEvent[] {
  const errorTypes: EyeEventType[] = [
    "TRANSCRIPTION_FAILED",
    "REDACTION_FAILED",
    "PURGE_FAILED",
    "AUDIO_UPLOAD_FAILED",
  ];
  
  return events.filter((e) => errorTypes.includes(e.event_type) || e.result === "failure");
}
