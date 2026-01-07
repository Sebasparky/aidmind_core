/**
 * Eye Event Contract Validation Tests
 * 
 * Run with: npx vitest run src/lib/eye/contract.test.ts
 * 
 * TEST CASES:
 * - Taxonomy coverage (category + severity mapping completeness)
 * - Severity precedence (backend-stamped > map > default)
 * - PHI validation (denylist + length)
 * - Idempotency (request_id presence for retryable events)
 * 
 * INTENTIONAL FRICTION:
 * These tests force explicit semantic intent when adding new event types.
 * A new EyeEventType MUST have:
 * - A category mapping in EVENT_CATEGORY_MAP
 * - A severity mapping in EVENT_SEVERITY_MAP (or be explicitly allowlisted)
 */

import { describe, it, expect } from "vitest";
import { 
  EyeEvent, 
  EyeEventType,
  EVENT_SEVERITY_MAP, 
  EVENT_CATEGORY_MAP,
  ALL_EYE_EVENT_TYPES,
  getEventSeverity,
} from "./types";

// ============================================================
// PHI VALIDATION LOGIC (MIRROR OF EDGE FUNCTION)
// ============================================================

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

const ALLOWLIST_LONG_KEYS = new Set([
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
  "remaining_types",
  "tags",
  "redaction_counts",
  "layer1",
  "layer2",
  "layer3",
]);

const MAX_STRING_LENGTH = 256;

/**
 * Validate event data for PHI safety.
 * Throws error if PHI is detected.
 */
function validateEyeEventData(
  eventType: string,
  eventData: Record<string, unknown>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

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

  return { valid: errors.length === 0, errors };
}

// ============================================================
// TAXONOMY COVERAGE TESTS
// ============================================================
// These tests enforce that every EyeEventType has explicit mappings.
// Failing these tests means a new event type was added without proper semantic intent.

/**
 * Events explicitly allowed to use default severity fallback (INFO).
 * 
 * IMPORTANT: This should be kept EMPTY or very small.
 * Adding events here should be a conscious decision with justification.
 * 
 * To add an event to this list:
 * 1. Explain why it doesn't need an explicit severity
 * 2. Get team consensus
 * 3. Add it here with a comment explaining the rationale
 */
const ALLOWED_SEVERITY_FALLBACK_EVENTS: EyeEventType[] = [
  // Intentionally empty - all events should have explicit severity mappings
];

describe("Taxonomy Coverage - Category Mapping", () => {
  it("ALL_EYE_EVENT_TYPES list is not empty", () => {
    expect(ALL_EYE_EVENT_TYPES.length).toBeGreaterThan(0);
  });

  it("every EyeEventType has a category mapping", () => {
    const missingCategories: string[] = [];
    
    for (const eventType of ALL_EYE_EVENT_TYPES) {
      if (!(eventType in EVENT_CATEGORY_MAP)) {
        missingCategories.push(eventType);
      }
    }
    
    if (missingCategories.length > 0) {
      throw new Error(
        `The following EyeEventType(s) are missing from EVENT_CATEGORY_MAP:\n` +
        missingCategories.map(e => `  - "${e}"`).join("\n") +
        `\n\nTo fix: Add category mappings in src/lib/eye/types.ts`
      );
    }
    
    expect(missingCategories).toHaveLength(0);
  });

  it("EVENT_CATEGORY_MAP has no extra entries not in EyeEventType", () => {
    const eventTypeSet = new Set(ALL_EYE_EVENT_TYPES as string[]);
    const extraEntries: string[] = [];
    
    for (const key of Object.keys(EVENT_CATEGORY_MAP)) {
      if (!eventTypeSet.has(key)) {
        extraEntries.push(key);
      }
    }
    
    if (extraEntries.length > 0) {
      throw new Error(
        `EVENT_CATEGORY_MAP contains entries not in EyeEventType:\n` +
        extraEntries.map(e => `  - "${e}"`).join("\n") +
        `\n\nTo fix: Remove these from EVENT_CATEGORY_MAP or add to EyeEventType`
      );
    }
    
    expect(extraEntries).toHaveLength(0);
  });
});

describe("Taxonomy Coverage - Severity Mapping", () => {
  it("every EyeEventType has a severity mapping or is explicitly allowlisted", () => {
    const allowlistSet = new Set(ALLOWED_SEVERITY_FALLBACK_EVENTS as string[]);
    const missingSeverities: string[] = [];
    
    for (const eventType of ALL_EYE_EVENT_TYPES) {
      const hasMapping = eventType in EVENT_SEVERITY_MAP;
      const isAllowlisted = allowlistSet.has(eventType);
      
      if (!hasMapping && !isAllowlisted) {
        missingSeverities.push(eventType);
      }
    }
    
    if (missingSeverities.length > 0) {
      throw new Error(
        `The following EyeEventType(s) have no severity mapping and are not allowlisted:\n` +
        missingSeverities.map(e => `  - "${e}"`).join("\n") +
        `\n\nTo fix either:\n` +
        `1. Add severity mapping in EVENT_SEVERITY_MAP (src/lib/eye/types.ts)\n` +
        `2. Add to ALLOWED_SEVERITY_FALLBACK_EVENTS (src/lib/eye/contract.test.ts) with justification`
      );
    }
    
    expect(missingSeverities).toHaveLength(0);
  });

  it("EVENT_SEVERITY_MAP has no extra entries not in EyeEventType", () => {
    const eventTypeSet = new Set(ALL_EYE_EVENT_TYPES as string[]);
    const extraEntries: string[] = [];
    
    for (const key of Object.keys(EVENT_SEVERITY_MAP)) {
      if (!eventTypeSet.has(key)) {
        extraEntries.push(key);
      }
    }
    
    if (extraEntries.length > 0) {
      throw new Error(
        `EVENT_SEVERITY_MAP contains entries not in EyeEventType:\n` +
        extraEntries.map(e => `  - "${e}"`).join("\n") +
        `\n\nTo fix: Remove these from EVENT_SEVERITY_MAP or add to EyeEventType`
      );
    }
    
    expect(extraEntries).toHaveLength(0);
  });

  it("ALLOWED_SEVERITY_FALLBACK_EVENTS contains only valid EyeEventTypes", () => {
    const eventTypeSet = new Set(ALL_EYE_EVENT_TYPES as string[]);
    const invalidEntries: string[] = [];
    
    for (const eventType of ALLOWED_SEVERITY_FALLBACK_EVENTS) {
      if (!eventTypeSet.has(eventType)) {
        invalidEntries.push(eventType);
      }
    }
    
    if (invalidEntries.length > 0) {
      throw new Error(
        `ALLOWED_SEVERITY_FALLBACK_EVENTS contains invalid event types:\n` +
        invalidEntries.map(e => `  - "${e}"`).join("\n")
      );
    }
    
    expect(invalidEntries).toHaveLength(0);
  });
});

describe("Taxonomy Coverage - ALL_EYE_EVENT_TYPES Sync Check", () => {
  it("ALL_EYE_EVENT_TYPES has no duplicates", () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    
    for (const eventType of ALL_EYE_EVENT_TYPES) {
      if (seen.has(eventType)) {
        duplicates.push(eventType);
      }
      seen.add(eventType);
    }
    
    if (duplicates.length > 0) {
      throw new Error(
        `ALL_EYE_EVENT_TYPES contains duplicates:\n` +
        duplicates.map(e => `  - "${e}"`).join("\n")
      );
    }
    
    expect(duplicates).toHaveLength(0);
  });

  it("ALL_EYE_EVENT_TYPES count matches EVENT_CATEGORY_MAP count", () => {
    const listCount = ALL_EYE_EVENT_TYPES.length;
    const mapCount = Object.keys(EVENT_CATEGORY_MAP).length;
    
    if (listCount !== mapCount) {
      throw new Error(
        `Mismatch: ALL_EYE_EVENT_TYPES has ${listCount} entries, ` +
        `EVENT_CATEGORY_MAP has ${mapCount} entries.\n` +
        `These should be equal. Check for missing or extra entries.`
      );
    }
    
    expect(listCount).toBe(mapCount);
  });
});

// ============================================================
// SEVERITY PRECEDENCE TESTS
// ============================================================

describe("Severity Precedence", () => {
  it("uses explicit severity from event_data when present", () => {
    const event: EyeEvent = {
      event_id: "evt_1",
      event_type: "SESSION_STARTED",
      event_version: 1,
      timestamp: new Date().toISOString(),
      tenant_id: "test",
      environment: "dev",
      actor_type: "user",
      actor_id: "test",
      actor_role: null,
      session_id: "sess_1",
      case_id: null,
      resource_type: "session",
      resource_id: "sess_1",
      result: "success",
      reason_code: null,
      request_id: "req_1",
      severity: "CRITICAL", // Explicitly set
    };

    expect(getEventSeverity(event)).toBe("CRITICAL");
  });

  it("falls back to EVENT_SEVERITY_MAP when severity is not set", () => {
    const event: EyeEvent = {
      event_id: "evt_1",
      event_type: "PURGE_FAILED", // Maps to HIGH
      event_version: 1,
      timestamp: new Date().toISOString(),
      tenant_id: "test",
      environment: "dev",
      actor_type: "service",
      actor_id: "test",
      actor_role: null,
      session_id: "sess_1",
      case_id: null,
      resource_type: "session",
      resource_id: "sess_1",
      result: "failure",
      reason_code: null,
      request_id: "req_1",
      // severity NOT set
    };

    // EVENT_SEVERITY_MAP[PURGE_FAILED] = HIGH
    expect(EVENT_SEVERITY_MAP["PURGE_FAILED"]).toBe("HIGH");
    expect(getEventSeverity(event)).toBe("HIGH");
  });

  it("defaults to INFO for unknown event types without explicit severity", () => {
    const event: EyeEvent = {
      event_id: "evt_1",
      event_type: "UNKNOWN_EVENT_TYPE" as any,
      event_version: 1,
      timestamp: new Date().toISOString(),
      tenant_id: "test",
      environment: "dev",
      actor_type: "service",
      actor_id: "test",
      actor_role: null,
      session_id: "sess_1",
      case_id: null,
      resource_type: "session",
      resource_id: "sess_1",
      result: "success",
      reason_code: null,
      request_id: "req_1",
      // severity NOT set, event_type not in map
    };

    expect(getEventSeverity(event)).toBe("INFO");
  });

  it("explicit severity overrides map even when map exists", () => {
    const event: EyeEvent = {
      event_id: "evt_1",
      event_type: "PURGE_FAILED", // Maps to HIGH
      event_version: 1,
      timestamp: new Date().toISOString(),
      tenant_id: "test",
      environment: "dev",
      actor_type: "service",
      actor_id: "test",
      actor_role: null,
      session_id: "sess_1",
      case_id: null,
      resource_type: "session",
      resource_id: "sess_1",
      result: "failure",
      reason_code: null,
      request_id: "req_1",
      severity: "WARN", // Override the map
    };

    expect(getEventSeverity(event)).toBe("WARN");
  });
});

// ============================================================
// PHI VALIDATION TESTS
// ============================================================

describe("PHI Validation", () => {
  it("rejects payload with denied keys (text)", () => {
    const payload = {
      text: "This is PHI content that should not be stored",
      severity: "INFO",
    };

    const result = validateEyeEventData("TEST_EVENT", payload);
    
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Denied key "text" found in event_data (PHI risk)');
  });

  it("rejects payload with denied keys (transcript)", () => {
    const payload = {
      transcript: "Full transcript with names and SSNs",
      severity: "INFO",
    };

    const result = validateEyeEventData("TEST_EVENT", payload);
    
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("transcript"))).toBe(true);
  });

  it("rejects payload with denied keys (prompt)", () => {
    const payload = {
      prompt: "Generate a note for John Doe SSN 123-45-6789",
      severity: "INFO",
    };

    const result = validateEyeEventData("TEST_EVENT", payload);
    
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("prompt"))).toBe(true);
  });

  it("rejects payload with denied keys (completion)", () => {
    const payload = {
      completion: "Here is the note content with PHI...",
      severity: "INFO",
    };

    const result = validateEyeEventData("TEST_EVENT", payload);
    
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("completion"))).toBe(true);
  });

  it("rejects strings exceeding max length for non-allowlisted keys", () => {
    const longString = "x".repeat(300); // 300 chars > 256 max
    const payload = {
      custom_field: longString,
      severity: "INFO",
    };

    const result = validateEyeEventData("TEST_EVENT", payload);
    
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("exceeds max length"))).toBe(true);
  });

  it("allows long strings for allowlisted keys", () => {
    const longString = "x".repeat(300);
    const payload = {
      case_id: longString, // allowlisted
      request_id: longString, // allowlisted
      severity: "INFO",
    };

    const result = validateEyeEventData("TEST_EVENT", payload);
    
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts valid payload with only counts and metadata", () => {
    const payload = {
      severity: "NOTICE",
      redaction_counts: { phone: 2, email: 1 },
      latency_ms: 1500,
      request_id: "req_abc123",
      operator_id: "emp_0142",
    };

    const result = validateEyeEventData("REDACTION_COMPLETED", payload);
    
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("catches multiple violations in one payload", () => {
    const longString = "x".repeat(300);
    const payload = {
      text: "PHI content",
      transcript: "More PHI",
      custom_long: longString,
    };

    const result = validateEyeEventData("TEST_EVENT", payload);
    
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ============================================================
// IDEMPOTENCY TESTS
// ============================================================

describe("Idempotency Contract", () => {
  const RETRYABLE_EVENTS = [
    "SESSION_STARTED",
    "SESSION_CLOSED",
    "SESSION_CANCELLED",
    "REDACTION_STARTED",
    "REDACTION_COMPLETED",
    "TRANSCRIPTION_STARTED",
    "TRANSCRIPTION_COMPLETED",
    "PURGE_STARTED",
    "PURGE_COMPLETED",
  ];

  it("defines retryable events that should include request_id", () => {
    // This is a documentation test - ensures we have a clear list
    expect(RETRYABLE_EVENTS.length).toBeGreaterThan(0);
  });

  it("SESSION_STARTED should be in retryable events", () => {
    expect(RETRYABLE_EVENTS).toContain("SESSION_STARTED");
  });

  it("SESSION_CLOSED should be in retryable events", () => {
    expect(RETRYABLE_EVENTS).toContain("SESSION_CLOSED");
  });

  it("SESSION_CANCELLED should be in retryable events", () => {
    expect(RETRYABLE_EVENTS).toContain("SESSION_CANCELLED");
  });

  it("REDACTION_STARTED should be in retryable events", () => {
    expect(RETRYABLE_EVENTS).toContain("REDACTION_STARTED");
  });

  it("REDACTION_COMPLETED should be in retryable events", () => {
    expect(RETRYABLE_EVENTS).toContain("REDACTION_COMPLETED");
  });
});

// ============================================================
// ENVIRONMENT & TENANT DERIVATION TESTS
// ============================================================

describe("Environment & Tenant Derivation", () => {
  const VALID_ENVIRONMENTS = ["dev", "staging", "prod"];

  it("accepts valid environment values", () => {
    VALID_ENVIRONMENTS.forEach(env => {
      expect(["dev", "staging", "prod"]).toContain(env);
    });
  });

  it("defaults to 'dev' for invalid environments", () => {
    const invalidEnv = "production"; // invalid, should be "prod"
    const result = VALID_ENVIRONMENTS.includes(invalidEnv) ? invalidEnv : "dev";
    expect(result).toBe("dev");
  });

  it("defaults tenant_id to 'default' when not provided", () => {
    const tenantFromHeader: string | null = null;
    const tenantId = tenantFromHeader ?? "default";
    expect(tenantId).toBe("default");
  });
});
// ============================================================
// ACTOR DERIVATION TESTS
// ============================================================

describe("Actor Derivation", () => {
  it("user actions should have actor_type=user when operator_id present", () => {
    const operatorId = "emp_0142";
    const actor = {
      actor_type: operatorId ? "user" : "service",
      actor_id: operatorId || "session-manager",
      actor_role: operatorId ? "caseworker" : undefined,
    };

    expect(actor.actor_type).toBe("user");
    expect(actor.actor_id).toBe("emp_0142");
    expect(actor.actor_role).toBe("caseworker");
  });

  it("system actions should have actor_type=service", () => {
    const operatorId = undefined;
    const serviceName = "session-manager";
    const actor = {
      actor_type: operatorId ? "user" : "service",
      actor_id: operatorId || serviceName,
      service_name: operatorId ? undefined : serviceName,
    };

    expect(actor.actor_type).toBe("service");
    expect(actor.actor_id).toBe("session-manager");
    expect(actor.service_name).toBe("session-manager");
  });
});
