/**
 * Purge Reason Codes Unit Tests
 * 
 * Validates that purge event payloads contain the correct reason_code fields
 * for cancel/close/abandon paths, ensuring audit trail never relies on inference.
 */
import { describe, it, expect } from "vitest";
import type { ReasonCode } from "./types";

// ============================================================
// CANONICAL PURGE REASON CODES
// ============================================================

const VALID_PURGE_REASON_CODES: ReasonCode[] = [
  "USER_CANCELLED",      // User explicitly cancelled session
  "USER_COMPLETED",      // User explicitly completed/closed session  
  "INACTIVITY_TIMEOUT",  // System-observed inactivity (abandonment)
  "TTL_EXPIRED",         // System TTL expiration (future use)
  "USER_REQUESTED",      // Manual purge request
];

const FAILURE_DETAIL_CODES: ReasonCode[] = [
  "PARTIAL_DELETION",    // Some but not all artifacts deleted
];

// ============================================================
// PAYLOAD BUILDER HELPERS (mirrors edge function logic)
// ============================================================

interface PurgeEventPayload {
  severity: string;
  reason_code: ReasonCode;
  actor_type?: "user" | "system";
  operator_id?: string;
  request_id?: string;
  failure_reason_code?: ReasonCode;
  remaining_count?: number;
  remaining_types?: string[];
}

function buildPurgeStartedPayload(
  reasonCode: ReasonCode,
  actorType: "user" | "system",
  operatorId?: string,
  requestId?: string
): PurgeEventPayload {
  return {
    severity: "NOTICE",
    reason_code: reasonCode,
    actor_type: actorType,
    operator_id: operatorId,
    request_id: requestId,
  };
}

function buildPurgeCompletedPayload(
  reasonCode: ReasonCode,
  actorType: "user" | "system",
  operatorId?: string,
  requestId?: string
): PurgeEventPayload {
  return {
    severity: "NOTICE",
    reason_code: reasonCode,
    actor_type: actorType,
    operator_id: operatorId,
    request_id: requestId,
  };
}

function buildPurgeFailedPayload(
  reasonCode: ReasonCode,
  actorType: "user" | "system",
  operatorId?: string,
  requestId?: string
): PurgeEventPayload {
  return {
    severity: "HIGH",
    reason_code: reasonCode,
    failure_reason_code: "PARTIAL_DELETION",
    actor_type: actorType,
    operator_id: operatorId,
    request_id: requestId,
  };
}

function buildEphemeralScanResultPayload(
  reasonCode: ReasonCode,
  remainingCount: number,
  remainingTypes: string[],
  requestId?: string
): PurgeEventPayload {
  return {
    severity: "NOTICE",
    reason_code: reasonCode,
    remaining_count: remainingCount,
    remaining_types: remainingTypes,
    request_id: requestId,
  };
}

// ============================================================
// TESTS
// ============================================================

describe("Purge Reason Codes", () => {
  describe("Valid Reason Codes", () => {
    it("USER_CANCELLED is a valid purge reason code", () => {
      expect(VALID_PURGE_REASON_CODES).toContain("USER_CANCELLED");
    });

    it("USER_COMPLETED is a valid purge reason code", () => {
      expect(VALID_PURGE_REASON_CODES).toContain("USER_COMPLETED");
    });

    it("INACTIVITY_TIMEOUT is a valid purge reason code", () => {
      expect(VALID_PURGE_REASON_CODES).toContain("INACTIVITY_TIMEOUT");
    });

    it("PARTIAL_DELETION is a valid failure detail code", () => {
      expect(FAILURE_DETAIL_CODES).toContain("PARTIAL_DELETION");
    });
  });

  describe("Cancel Path Payload Building", () => {
    it("PURGE_STARTED contains reason_code: USER_CANCELLED", () => {
      const payload = buildPurgeStartedPayload("USER_CANCELLED", "user", "emp_0142", "req_123");
      
      expect(payload.reason_code).toBe("USER_CANCELLED");
      expect(payload.actor_type).toBe("user");
      expect(payload.operator_id).toBe("emp_0142");
      expect(payload.request_id).toBe("req_123");
    });

    it("PURGE_COMPLETED contains reason_code: USER_CANCELLED", () => {
      const payload = buildPurgeCompletedPayload("USER_CANCELLED", "user", "emp_0142", "req_123");
      
      expect(payload.reason_code).toBe("USER_CANCELLED");
      expect(payload.actor_type).toBe("user");
    });

    it("PURGE_FAILED contains both reason_code and failure_reason_code", () => {
      const payload = buildPurgeFailedPayload("USER_CANCELLED", "user", "emp_0142", "req_123");
      
      expect(payload.reason_code).toBe("USER_CANCELLED");
      expect(payload.failure_reason_code).toBe("PARTIAL_DELETION");
      expect(payload.severity).toBe("HIGH");
    });

    it("EPHEMERAL_SCAN_RESULT contains reason_code: USER_CANCELLED", () => {
      const payload = buildEphemeralScanResultPayload("USER_CANCELLED", 0, [], "req_123");
      
      expect(payload.reason_code).toBe("USER_CANCELLED");
      expect(payload.remaining_count).toBe(0);
      expect(payload.remaining_types).toEqual([]);
    });
  });

  describe("Close Path Payload Building", () => {
    it("PURGE_STARTED contains reason_code: USER_COMPLETED", () => {
      const payload = buildPurgeStartedPayload("USER_COMPLETED", "user", "emp_0142", "req_456");
      
      expect(payload.reason_code).toBe("USER_COMPLETED");
      expect(payload.actor_type).toBe("user");
    });

    it("PURGE_COMPLETED contains reason_code: USER_COMPLETED", () => {
      const payload = buildPurgeCompletedPayload("USER_COMPLETED", "user", "emp_0142", "req_456");
      
      expect(payload.reason_code).toBe("USER_COMPLETED");
    });

    it("PURGE_FAILED for close path preserves USER_COMPLETED as root reason", () => {
      const payload = buildPurgeFailedPayload("USER_COMPLETED", "user", "emp_0142", "req_456");
      
      // Root reason_code is the "why" (user completed session)
      expect(payload.reason_code).toBe("USER_COMPLETED");
      // failure_reason_code is the "what happened" (partial deletion)
      expect(payload.failure_reason_code).toBe("PARTIAL_DELETION");
    });
  });

  describe("Abandonment Path Payload Building", () => {
    it("PURGE_STARTED contains reason_code: INACTIVITY_TIMEOUT", () => {
      const payload = buildPurgeStartedPayload("INACTIVITY_TIMEOUT", "system", undefined, "abandon_123");
      
      expect(payload.reason_code).toBe("INACTIVITY_TIMEOUT");
      expect(payload.actor_type).toBe("system");
      expect(payload.operator_id).toBeUndefined();
    });

    it("PURGE_COMPLETED for abandonment uses system actor", () => {
      const payload = buildPurgeCompletedPayload("INACTIVITY_TIMEOUT", "system", undefined, "abandon_123");
      
      expect(payload.reason_code).toBe("INACTIVITY_TIMEOUT");
      expect(payload.actor_type).toBe("system");
    });

    it("EPHEMERAL_SCAN_RESULT for abandonment contains INACTIVITY_TIMEOUT", () => {
      const payload = buildEphemeralScanResultPayload("INACTIVITY_TIMEOUT", 0, [], "abandon_123");
      
      expect(payload.reason_code).toBe("INACTIVITY_TIMEOUT");
      expect(payload.remaining_count).toBe(0);
    });

    it("PURGE_FAILED for abandonment preserves INACTIVITY_TIMEOUT as root reason", () => {
      const payload = buildPurgeFailedPayload("INACTIVITY_TIMEOUT", "system", undefined, "abandon_123");
      
      expect(payload.reason_code).toBe("INACTIVITY_TIMEOUT");
      expect(payload.failure_reason_code).toBe("PARTIAL_DELETION");
    });
  });

  describe("Audit Trail Completeness", () => {
    it("reason_code is always present in purge events", () => {
      const scenarios = [
        buildPurgeStartedPayload("USER_CANCELLED", "user"),
        buildPurgeCompletedPayload("USER_COMPLETED", "user"),
        buildPurgeFailedPayload("INACTIVITY_TIMEOUT", "system"),
        buildEphemeralScanResultPayload("USER_CANCELLED", 0, []),
      ];

      for (const payload of scenarios) {
        expect(payload.reason_code).toBeDefined();
        expect(VALID_PURGE_REASON_CODES).toContain(payload.reason_code);
      }
    });

    it("failure_reason_code only appears in PURGE_FAILED payloads", () => {
      const successPayload = buildPurgeCompletedPayload("USER_CANCELLED", "user");
      const failurePayload = buildPurgeFailedPayload("USER_CANCELLED", "user");

      expect(successPayload.failure_reason_code).toBeUndefined();
      expect(failurePayload.failure_reason_code).toBe("PARTIAL_DELETION");
    });

    it("EPHEMERAL_SCAN_RESULT always has remaining_count and remaining_types", () => {
      const payload = buildEphemeralScanResultPayload("USER_COMPLETED", 0, []);

      expect(payload.remaining_count).toBeDefined();
      expect(payload.remaining_types).toBeDefined();
      expect(Array.isArray(payload.remaining_types)).toBe(true);
    });
  });

  describe("Actor Type Semantics", () => {
    it("user-initiated paths use actor_type: user", () => {
      const cancelPayload = buildPurgeStartedPayload("USER_CANCELLED", "user", "emp_0142");
      const closePayload = buildPurgeStartedPayload("USER_COMPLETED", "user", "emp_0142");

      expect(cancelPayload.actor_type).toBe("user");
      expect(closePayload.actor_type).toBe("user");
    });

    it("system-initiated paths use actor_type: system", () => {
      const abandonPayload = buildPurgeStartedPayload("INACTIVITY_TIMEOUT", "system");

      expect(abandonPayload.actor_type).toBe("system");
      expect(abandonPayload.operator_id).toBeUndefined();
    });
  });
});
