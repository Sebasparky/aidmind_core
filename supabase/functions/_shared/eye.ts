/**
 * Shared Eye Event Module
 * 
 * DESIGN GOALS:
 * 1. No PHI in The Eye. Ever.
 * 2. Events are append-only (immutable)
 * 3. Every event has: who / what / when / where / why
 * 4. Canonical stamping of required fields
 * 5. PHI safety via denylist + length validation
 */

// ============================================================
// TYPE DEFINITIONS
// ============================================================

export type Environment = "dev" | "staging" | "prod";
export type ActorType = "user" | "service" | "system";
export type EventResult = "success" | "failure" | "partial";
export type EventSeverity = "INFO" | "NOTICE" | "WARN" | "HIGH" | "CRITICAL";

export interface ActorInfo {
  actor_type: ActorType;
  actor_id: string;
  actor_role?: string;
  operator_id?: string;
  service_name?: string;
}

export interface EyeEventInput {
  session_id: string | null;
  event_type: string;
  request_id?: string;
  result?: EventResult;
  severity?: EventSeverity;
  resource_type?: string;
  resource_id?: string;
  reason_code?: string;
  // Additional payload fields (will be validated)
  [key: string]: unknown;
}

export interface EyeEventData {
  event_version: number;
  tenant_id: string;
  environment: Environment;
  actor_type: ActorType;
  actor_id: string;
  actor_role?: string;
  operator_id?: string;
  service_name?: string;
  resource_type: string;
  resource_id: string;
  result: EventResult;
  severity: EventSeverity;
  reason_code?: string;
  request_id?: string;
  [key: string]: unknown;
}

export interface LogEyeEventParams {
  session_id: string | null;
  event_type: string;
  request?: Request;
  serviceName: string;
  payload?: Record<string, unknown>;
}

// ============================================================
// PHI SAFETY: DENYLIST + LENGTH VALIDATION
// ============================================================

/**
 * Keys that are NEVER allowed in event_data (PHI risk)
 */
const PHI_DENYLIST_KEYS = new Set([
  "text",
  "transcript",
  "prompt",
  "completion",
  "audio_url",
  "raw_text",
  "minimized_text",
  "draft_text",
  "note_content",
  "message",
  "content",
  "body",
  "response_text",
  "input_text",
  "output_text",
]);

/**
 * Keys explicitly allowed to exceed the length threshold
 */
const ALLOWLIST_LONG_KEYS = new Set([
  // Identifiers
  "case_id",
  "operator_id",
  "bundle_id",
  "request_id",
  "reason_code",
  "service_name",
  "session_id",
  "resource_id",
  "actor_id",
  "tenant_id",
  "event_type",
  // Arrays (will be JSON stringified for length check but allowed)
  "remaining_types",
  "tags",
  // Nested objects (allowed)
  "redaction_counts",
  "layer1",
  "layer2",
  "layer3",
]);

/**
 * Maximum string length for non-allowlisted fields
 */
const MAX_STRING_LENGTH = 256;

/**
 * Validate event data for PHI safety.
 * Throws error if PHI is detected.
 */
export function validateEyeEventData(
  eventType: string,
  eventData: Record<string, unknown>
): void {
  const errors: string[] = [];

  // Check for denied keys (shallow check for MVP)
  for (const key of Object.keys(eventData)) {
    const lowerKey = key.toLowerCase();
    
    // Check denylist
    if (PHI_DENYLIST_KEYS.has(lowerKey)) {
      errors.push(`Denied key "${key}" found in event_data (PHI risk)`);
    }
    
    // Check string length
    const value = eventData[key];
    if (typeof value === "string" && !ALLOWLIST_LONG_KEYS.has(key)) {
      if (value.length > MAX_STRING_LENGTH) {
        errors.push(
          `Field "${key}" exceeds max length (${value.length} > ${MAX_STRING_LENGTH})`
        );
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `PHI validation failed for ${eventType}: ${errors.join("; ")}`
    );
  }
}

// ============================================================
// ENVIRONMENT & TENANT DERIVATION
// ============================================================

const VALID_ENVIRONMENTS: Environment[] = ["dev", "staging", "prod"];

/**
 * Derive environment from env var.
 * Returns "dev" if missing or invalid.
 */
export function deriveEnvironment(): Environment {
  const env = Deno.env.get("ENVIRONMENT") ?? "dev";
  if (VALID_ENVIRONMENTS.includes(env as Environment)) {
    return env as Environment;
  }
  return "dev";
}

/**
 * Derive tenant_id from request headers.
 * For now: prefer x-tenant-id header, else "default".
 * Later: derive from JWT claims.
 */
export function deriveTenantId(req?: Request): string {
  if (req) {
    const tenantHeader = req.headers.get("x-tenant-id");
    if (tenantHeader && tenantHeader.trim()) {
      return tenantHeader.trim();
    }
  }
  return "default";
}

// ============================================================
// ACTOR DERIVATION
// ============================================================

/**
 * Derive actor identity from request and optional defaults.
 */
export function deriveActor(
  serviceName: string,
  operatorId?: string,
  isUserAction?: boolean
): ActorInfo {
  // User-initiated actions (e.g., session create, cancel)
  if (isUserAction && operatorId) {
    return {
      actor_type: "user",
      actor_id: operatorId,
      actor_role: "caseworker",
      operator_id: operatorId,
    };
  }

  // Service/system actions (e.g., purge, background jobs)
  return {
    actor_type: "service",
    actor_id: serviceName,
    service_name: serviceName,
  };
}

// ============================================================
// SEVERITY MAPPING (MIRROR FROM TYPES.TS)
// ============================================================

/**
 * Default severity by event type.
 * This is a subset; backend takes precedence.
 */
const EVENT_SEVERITY_MAP: Record<string, EventSeverity> = {
  // Session lifecycle
  SESSION_STARTED: "INFO",
  SESSION_HEARTBEAT: "INFO",
  SESSION_FINISH_CLICKED: "NOTICE",
  SESSION_CLOSED: "NOTICE",
  SESSION_CANCELLED: "NOTICE",
  WIP_BUNDLE_EXPORTED: "NOTICE",
  
  // Ingest
  AUDIO_UPLOADED: "INFO",
  AUDIO_UPLOAD_FAILED: "WARN",
  
  // Transcription
  TRANSCRIPTION_JOB_QUEUED: "INFO",
  TRANSCRIPTION_STARTED: "INFO",
  TRANSCRIPTION_COMPLETED: "NOTICE",
  TRANSCRIPTION_FAILED: "WARN",
  
  // Redaction
  REDACTION_STARTED: "INFO",
  REDACTION_COMPLETED: "NOTICE",
  REDACTION_FAILED: "WARN",
  VERIFICATION_PASSED: "INFO",
  VERIFICATION_FAILED: "WARN",
  
  // Purge
  PURGE_STARTED: "NOTICE",
  PURGE_COMPLETED: "NOTICE",
  PURGE_FAILED: "HIGH",
  AUDIO_DELETED: "NOTICE",
  TRANSCRIPT_DELETED: "NOTICE",
  MINIMIZED_TRANSCRIPT_DELETED: "NOTICE",
  EPHEMERAL_SCAN_RESULT: "NOTICE",
};

/**
 * Get default severity for an event type.
 */
function getDefaultSeverity(eventType: string): EventSeverity {
  return EVENT_SEVERITY_MAP[eventType] ?? "INFO";
}

// ============================================================
// BUILD EVENT DATA (CANONICAL STAMPING)
// ============================================================

export interface BuildEventDataInput {
  event_type: string;
  session_id: string | null;
  serviceName: string;
  request?: Request;
  payload?: Record<string, unknown>;
}

/**
 * Build canonical event_data with required fields always stamped.
 * Validates PHI safety before returning.
 */
export function buildEyeEventData(input: BuildEventDataInput): EyeEventData {
  const { event_type, session_id, serviceName, request, payload = {} } = input;

  // Derive environment, tenant, and actor
  const environment = deriveEnvironment();
  const tenant_id = deriveTenantId(request);
  
  // Determine if this is a user action (has operator_id)
  const operatorId = payload.operator_id as string | undefined;
  const isUserAction = 
    event_type === "SESSION_STARTED" ||
    event_type === "SESSION_CANCELLED" ||
    event_type === "SESSION_FINISH_CLICKED" ||
    !!operatorId;
  
  const actor = deriveActor(serviceName, operatorId, isUserAction);

  // Build canonical event_data
  const eventData: EyeEventData = {
    // Required stamped fields
    event_version: 1,
    tenant_id,
    environment,
    ...actor,
    resource_type: (payload.resource_type as string) ?? "session",
    resource_id: (payload.resource_id as string) ?? session_id ?? crypto.randomUUID(),
    result: (payload.result as EventResult) ?? "success",
    severity: (payload.severity as EventSeverity) ?? getDefaultSeverity(event_type),
    // Optional fields from payload
    ...payload,
  };

  // Ensure request_id is present if provided
  if (payload.request_id) {
    eventData.request_id = payload.request_id as string;
  }

  // Ensure reason_code is present if provided
  if (payload.reason_code) {
    eventData.reason_code = payload.reason_code as string;
  }

  // Validate PHI safety (throws if invalid)
  validateEyeEventData(event_type, eventData);

  return eventData;
}

// ============================================================
// IDEMPOTENCY CHECK
// ============================================================

/**
 * Check if an event with the same session_id, event_type, and request_id already exists.
 * Returns true if duplicate detected.
 */
export async function checkIdempotency(
  supabase: any,
  sessionId: string | null,
  eventType: string,
  requestId: string | undefined
): Promise<boolean> {
  if (!requestId) return false; // No idempotency without request_id

  const { data, error } = await supabase
    .from("eye_events")
    .select("id")
    .eq("session_id", sessionId)
    .eq("event_type", eventType)
    .eq("event_data->>request_id", requestId)
    .limit(1);

  if (error) {
    console.log(`[Idempotency] Check failed: ${error.message}`);
    return false;
  }

  if (data && data.length > 0) {
    console.log(
      `[Idempotency] Duplicate detected: ${eventType} with request_id ${requestId}`
    );
    return true;
  }

  return false;
}

// ============================================================
// LOG EYE EVENT (MAIN ENTRY POINT)
// ============================================================

/**
 * Log an Eye event with full contract enforcement.
 * 
 * - Derives tenant/env/actor
 * - Stamps required fields with buildEyeEventData
 * - Validates PHI safety
 * - Checks idempotency
 * - Inserts into eye_events
 */
export async function logEyeEvent(
  supabase: any,
  params: LogEyeEventParams
): Promise<void> {
  const { session_id, event_type, request, serviceName, payload = {} } = params;

  try {
    // Check idempotency first
    const requestId = payload.request_id as string | undefined;
    if (requestId) {
      const isDuplicate = await checkIdempotency(
        supabase,
        session_id,
        event_type,
        requestId
      );
      if (isDuplicate) {
        console.log(`[Eye Event] SKIPPED duplicate: ${event_type}`);
        return;
      }
    }

    // Build canonical event data (validates PHI)
    const eventData = buildEyeEventData({
      event_type,
      session_id,
      serviceName,
      request,
      payload,
    });

    // Insert event
    const { error } = await supabase.from("eye_events").insert({
      session_id,
      event_type,
      event_data: eventData,
    });

    if (error) {
      console.error(`[Eye Event] Insert failed for ${event_type}:`, error);
      return;
    }

    console.log(`[Eye Event] ${event_type}`, JSON.stringify(eventData));
  } catch (error) {
    // PHI validation errors are thrown - log them
    console.error(`[Eye Event] Failed to log ${event_type}:`, error);
  }
}

// ============================================================
// CORS HEADERS (SHARED)
// ============================================================

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};
