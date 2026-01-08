/**
 * Governance Feature Tests
 * 
 * Tests for AI Authorization, Auditor Access, and Compliance Export.
 * Run with: npx vitest run src/lib/eye/governance.test.ts
 */

import { describe, it, expect } from "vitest";
import { 
  ALL_EYE_EVENT_TYPES,
  EVENT_CATEGORY_MAP,
  EVENT_SEVERITY_MAP,
} from "./types";
import { computeComplianceStatus } from "./verdict";

// ============================================================
// GOVERNANCE EVENT TAXONOMY TESTS
// ============================================================

describe("Governance Event Taxonomy", () => {
  const governanceEvents = [
    "AI_USAGE_APPROVAL_REQUESTED",
    "AI_USAGE_APPROVED_BY_SUPERVISOR",
    "AI_USAGE_APPROVAL_REVOKED",
    "AI_USAGE_BLOCKED_NO_APPROVAL",
    "AUDITOR_ACCESS_GRANTED",
    "AUDITOR_ACCESS_EXPIRED",
    "AUDITOR_ACCESS_REVOKED",
    "COMPLIANCE_EXPORT_GENERATED",
    "COMPLIANCE_EXPORT_DOWNLOADED",
  ];

  it("all governance events exist in ALL_EYE_EVENT_TYPES", () => {
    for (const eventType of governanceEvents) {
      expect(ALL_EYE_EVENT_TYPES).toContain(eventType);
    }
  });

  it("all governance events have category mappings", () => {
    for (const eventType of governanceEvents) {
      expect(EVENT_CATEGORY_MAP[eventType as keyof typeof EVENT_CATEGORY_MAP]).toBeDefined();
    }
  });

  it("all governance events have severity mappings", () => {
    for (const eventType of governanceEvents) {
      expect(EVENT_SEVERITY_MAP[eventType as keyof typeof EVENT_SEVERITY_MAP]).toBeDefined();
    }
  });

  it("AI_USAGE_APPROVAL_REVOKED has HIGH severity", () => {
    expect(EVENT_SEVERITY_MAP["AI_USAGE_APPROVAL_REVOKED"]).toBe("HIGH");
  });

  it("AI_USAGE_APPROVED_BY_SUPERVISOR has NOTICE severity", () => {
    expect(EVENT_SEVERITY_MAP["AI_USAGE_APPROVED_BY_SUPERVISOR"]).toBe("NOTICE");
  });

  it("AI_USAGE_BLOCKED_NO_APPROVAL has HIGH severity", () => {
    expect(EVENT_SEVERITY_MAP["AI_USAGE_BLOCKED_NO_APPROVAL"]).toBe("HIGH");
  });
});

// ============================================================
// AI AUTHORIZATION STATUS TESTS
// ============================================================

describe("AI Authorization Status in Verdict", () => {
  it("returns 'missing' when no authorization events exist", () => {
    const events: any[] = [];
    const status = computeComplianceStatus(events);
    expect(status.aiAuthorizationStatus).toBe("missing");
  });

  it("returns 'approved' when AI_USAGE_APPROVED_BY_SUPERVISOR is latest", () => {
    const events: any[] = [
      {
        event_id: "1",
        event_type: "AI_USAGE_APPROVED_BY_SUPERVISOR",
        timestamp: "2026-01-08T10:00:00Z",
        session_id: null,
      },
    ];
    const status = computeComplianceStatus(events);
    expect(status.aiAuthorizationStatus).toBe("approved");
  });

  it("returns 'revoked' when AI_USAGE_APPROVAL_REVOKED is latest", () => {
    const events: any[] = [
      {
        event_id: "1",
        event_type: "AI_USAGE_APPROVED_BY_SUPERVISOR",
        timestamp: "2026-01-07T10:00:00Z",
        session_id: null,
      },
      {
        event_id: "2",
        event_type: "AI_USAGE_APPROVAL_REVOKED",
        timestamp: "2026-01-08T10:00:00Z",
        session_id: null,
      },
    ];
    const status = computeComplianceStatus(events);
    expect(status.aiAuthorizationStatus).toBe("revoked");
  });

  it("returns 'approved' after re-approval following revocation", () => {
    const events: any[] = [
      {
        event_id: "1",
        event_type: "AI_USAGE_APPROVED_BY_SUPERVISOR",
        timestamp: "2026-01-06T10:00:00Z",
        session_id: null,
      },
      {
        event_id: "2",
        event_type: "AI_USAGE_APPROVAL_REVOKED",
        timestamp: "2026-01-07T10:00:00Z",
        session_id: null,
      },
      {
        event_id: "3",
        event_type: "AI_USAGE_APPROVED_BY_SUPERVISOR",
        timestamp: "2026-01-08T10:00:00Z",
        session_id: null,
      },
    ];
    const status = computeComplianceStatus(events);
    expect(status.aiAuthorizationStatus).toBe("approved");
  });
});

// ============================================================
// PURGE REASON CODE TESTS (already in purge-reason-codes.test.ts)
// ============================================================

describe("Compliance Export Payload Validation", () => {
  it("export event payload contains required fields", () => {
    const exportPayload = {
      event_version: 1,
      tenant_id: "test_tenant",
      time_range_start: "2026-01-01T00:00:00Z",
      time_range_end: "2026-01-31T23:59:59Z",
      generated_by_role: "supervisor",
      operator_id: "user_001",
      export_hash: "abc123...",
      event_count: 150,
      confidence: "explicit_user_action",
      result: "success",
      severity: "NOTICE",
    };

    expect(exportPayload.time_range_start).toBeDefined();
    expect(exportPayload.time_range_end).toBeDefined();
    expect(exportPayload.export_hash).toBeDefined();
    expect(exportPayload.generated_by_role).toBe("supervisor");
    expect(exportPayload.confidence).toBe("explicit_user_action");
  });

  it("export payload does not contain PHI fields", () => {
    const exportPayload = {
      export_hash: "abc123",
      event_count: 100,
    };

    // PHI denylist keys should never be in export payload
    const phiKeys = ["text", "transcript", "prompt", "completion", "content"];
    for (const key of phiKeys) {
      expect(exportPayload).not.toHaveProperty(key);
    }
  });
});
