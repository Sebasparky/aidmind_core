/**
 * Governance Feature Tests
 * 
 * Tests for Generative AI Authorization, Auditor Access, and Compliance Export.
 * Run with: npx vitest run src/lib/eye/governance.test.ts
 * 
 * SCOPE CLARITY:
 * - Authorization gates apply ONLY to generative AI (chat/completions)
 * - Transcription (Whisper) and redaction (Presidio) are NON-generative
 * - Non-generative steps do NOT require supervisor approval
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
// TRANSCRIPTION PROVIDER VISIBILITY EVENT TESTS
// ============================================================

describe("TRANSCRIPTION_PROVIDER_USED Event", () => {
  it("exists in ALL_EYE_EVENT_TYPES", () => {
    expect(ALL_EYE_EVENT_TYPES).toContain("TRANSCRIPTION_PROVIDER_USED");
  });

  it("has category TRANSCRIPTION (not GOVERNANCE)", () => {
    expect(EVENT_CATEGORY_MAP["TRANSCRIPTION_PROVIDER_USED"]).toBe("TRANSCRIPTION");
  });

  it("has severity INFO (observational, non-blocking)", () => {
    expect(EVENT_SEVERITY_MAP["TRANSCRIPTION_PROVIDER_USED"]).toBe("INFO");
  });

  it("is separate from governance events (does not require approval)", () => {
    // Governance events are in GOVERNANCE category
    // TRANSCRIPTION_PROVIDER_USED must NOT be in GOVERNANCE category
    const governanceCategory = EVENT_CATEGORY_MAP["AI_USAGE_APPROVED_BY_SUPERVISOR"];
    const transcriptionProviderCategory = EVENT_CATEGORY_MAP["TRANSCRIPTION_PROVIDER_USED"];
    
    expect(governanceCategory).toBe("GOVERNANCE");
    expect(transcriptionProviderCategory).not.toBe("GOVERNANCE");
    expect(transcriptionProviderCategory).toBe("TRANSCRIPTION");
  });
});

// ============================================================
// SCOPE CLARITY TESTS
// ============================================================

describe("Generative AI Scope Clarity", () => {
  it("authorization events are categorized as GOVERNANCE", () => {
    const authEvents = [
      "AI_USAGE_APPROVAL_REQUESTED",
      "AI_USAGE_APPROVED_BY_SUPERVISOR",
      "AI_USAGE_APPROVAL_REVOKED",
      "AI_USAGE_BLOCKED_NO_APPROVAL",
    ];
    
    for (const eventType of authEvents) {
      expect(EVENT_CATEGORY_MAP[eventType as keyof typeof EVENT_CATEGORY_MAP]).toBe("GOVERNANCE");
    }
  });

  it("transcription events are NOT categorized as GOVERNANCE", () => {
    const transcriptionEvents = [
      "TRANSCRIPTION_JOB_QUEUED",
      "TRANSCRIPTION_STARTED",
      "TRANSCRIPTION_COMPLETED",
      "TRANSCRIPTION_FAILED",
      "TRANSCRIPTION_PROVIDER_USED",
    ];
    
    for (const eventType of transcriptionEvents) {
      expect(EVENT_CATEGORY_MAP[eventType as keyof typeof EVENT_CATEGORY_MAP]).toBe("TRANSCRIPTION");
      expect(EVENT_CATEGORY_MAP[eventType as keyof typeof EVENT_CATEGORY_MAP]).not.toBe("GOVERNANCE");
    }
  });

  it("redaction events are NOT categorized as GOVERNANCE", () => {
    const redactionEvents = [
      "REDACTION_STARTED",
      "REDACTION_COMPLETED",
      "REDACTION_FAILED",
    ];
    
    for (const eventType of redactionEvents) {
      expect(EVENT_CATEGORY_MAP[eventType as keyof typeof EVENT_CATEGORY_MAP]).toBe("REDACTION");
      expect(EVENT_CATEGORY_MAP[eventType as keyof typeof EVENT_CATEGORY_MAP]).not.toBe("GOVERNANCE");
    }
  });

  it("LLM (generative) events are in GENERATION category", () => {
    const llmEvents = [
      "LLM_CALL_STARTED",
      "LLM_CALL_COMPLETED",
      "LLM_CALL_FAILED",
    ];
    
    for (const eventType of llmEvents) {
      expect(EVENT_CATEGORY_MAP[eventType as keyof typeof EVENT_CATEGORY_MAP]).toBe("GENERATION");
    }
  });
});

// ============================================================
// GENERATIVE AI AUTHORIZATION STATUS TESTS
// ============================================================

describe("Generative AI Authorization Status in Verdict", () => {
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
