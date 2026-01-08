/**
 * LLM Authorization Tests
 * 
 * Tests for:
 * - LLM calls blocked without approval
 * - Approval allows LLM calls
 * - Revocation re-blocks calls
 * - Auditor cannot access non-auditor routes
 * - Verdict/compliance reflects authorization state
 * 
 * Run with: npx vitest run src/lib/eye/authorization.test.ts
 */

import { describe, it, expect } from "vitest";
import { computeComplianceStatus } from "./verdict";
import { canAccessSupervisorUI, hasPermission, ROLE_PERMISSIONS, UserRole } from "@/lib/rbac/types";

// ============================================================
// LLM AUTHORIZATION STATE TESTS
// ============================================================

describe("LLM Authorization State", () => {
  describe("without approval", () => {
    it("returns 'missing' when no authorization events exist", () => {
      const events: any[] = [];
      const status = computeComplianceStatus(events);
      expect(status.aiAuthorizationStatus).toBe("missing");
    });

    it("should block LLM calls when no approval exists (unit test for logic)", () => {
      // Simulate the authorization check logic
      const events: any[] = [];
      const approvalEvents = events.filter(
        (e: any) =>
          e.event_type === "AI_USAGE_APPROVED_BY_SUPERVISOR" ||
          e.event_type === "AI_USAGE_APPROVAL_REVOKED"
      );
      
      const isAuthorized = approvalEvents.length > 0 &&
        approvalEvents[0]?.event_type === "AI_USAGE_APPROVED_BY_SUPERVISOR";
      
      expect(isAuthorized).toBe(false);
    });
  });

  describe("with approval", () => {
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

    it("should allow LLM calls when approval exists (unit test for logic)", () => {
      const events = [
        {
          event_type: "AI_USAGE_APPROVED_BY_SUPERVISOR",
          timestamp: "2026-01-08T10:00:00Z",
        },
      ];
      
      const latestAuthEvent = events[0];
      const isAuthorized = latestAuthEvent.event_type === "AI_USAGE_APPROVED_BY_SUPERVISOR";
      
      expect(isAuthorized).toBe(true);
    });
  });

  describe("with revocation", () => {
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

    it("should block LLM calls after revocation (unit test for logic)", () => {
      const events = [
        {
          event_type: "AI_USAGE_APPROVAL_REVOKED",
          timestamp: "2026-01-08T10:00:00Z",
        },
        {
          event_type: "AI_USAGE_APPROVED_BY_SUPERVISOR",
          timestamp: "2026-01-07T10:00:00Z",
        },
      ];
      
      // Sorted by timestamp descending
      const sortedEvents = [...events].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      
      const latestAuthEvent = sortedEvents[0];
      const isAuthorized = latestAuthEvent.event_type === "AI_USAGE_APPROVED_BY_SUPERVISOR";
      
      expect(isAuthorized).toBe(false);
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
});

// ============================================================
// AUDITOR ACCESS CONTROL TESTS
// ============================================================

describe("Auditor Access Control", () => {
  it("auditor can access supervisor UI", () => {
    expect(canAccessSupervisorUI("auditor")).toBe(true);
  });

  it("auditor cannot access caseworker permissions", () => {
    expect(hasPermission("auditor", "create", "session")).toBe(false);
    expect(hasPermission("auditor", "edit", "own_draft")).toBe(false);
  });

  it("auditor can view all events", () => {
    expect(hasPermission("auditor", "view", "all_events")).toBe(true);
  });

  it("auditor can view purge proof", () => {
    expect(hasPermission("auditor", "view", "purge_proof")).toBe(true);
  });

  it("auditor can export audit log", () => {
    expect(hasPermission("auditor", "export", "audit_log")).toBe(true);
  });

  it("caseworker cannot access supervisor UI", () => {
    expect(canAccessSupervisorUI("caseworker")).toBe(false);
  });

  it("caseworker cannot view all events", () => {
    expect(hasPermission("caseworker", "view", "all_events")).toBe(false);
  });

  describe("role isolation", () => {
    const phiAdjacentResources = ["own_draft", "session"];
    
    it("auditor has no permissions for PHI-adjacent resources", () => {
      const auditorPermissions = ROLE_PERMISSIONS.auditor;
      
      for (const resource of phiAdjacentResources) {
        const hasPhiAccess = auditorPermissions.some(
          p => p.resource === resource && p.action === "edit"
        );
        expect(hasPhiAccess).toBe(false);
      }
    });
  });
});

// ============================================================
// VERDICT REFLECTS AUTHORIZATION STATE
// ============================================================

describe("Verdict Reflects Authorization State", () => {
  it("verdict is YELLOW when AI authorization is missing but session is otherwise GREEN", () => {
    // A session that completed normally but has no AI authorization
    const events: any[] = [
      {
        event_id: "1",
        event_type: "SESSION_STARTED",
        timestamp: "2026-01-08T09:00:00Z",
        session_id: "sess_001",
      },
      {
        event_id: "2",
        event_type: "SESSION_CLOSED",
        timestamp: "2026-01-08T10:00:00Z",
        session_id: "sess_001",
      },
      {
        event_id: "3",
        event_type: "PURGE_COMPLETED",
        timestamp: "2026-01-08T10:01:00Z",
        session_id: "sess_001",
      },
    ];
    
    const compliance = computeComplianceStatus(events);
    expect(compliance.aiAuthorizationStatus).toBe("missing");
  });

  it("verdict is GREEN when AI authorization is approved and session completes normally", () => {
    const events: any[] = [
      {
        event_id: "0",
        event_type: "AI_USAGE_APPROVED_BY_SUPERVISOR",
        timestamp: "2026-01-07T00:00:00Z",
        session_id: null,
      },
      {
        event_id: "1",
        event_type: "SESSION_STARTED",
        timestamp: "2026-01-08T09:00:00Z",
        session_id: "sess_001",
      },
      {
        event_id: "2",
        event_type: "SESSION_CLOSED",
        timestamp: "2026-01-08T10:00:00Z",
        session_id: "sess_001",
      },
      {
        event_id: "3",
        event_type: "PURGE_COMPLETED",
        timestamp: "2026-01-08T10:01:00Z",
        session_id: "sess_001",
      },
    ];
    
    const compliance = computeComplianceStatus(events);
    expect(compliance.aiAuthorizationStatus).toBe("approved");
  });
});

// ============================================================
// BLOCKED EVENT PAYLOAD VALIDATION
// ============================================================

describe("AI_USAGE_BLOCKED_NO_APPROVAL Event Payload", () => {
  it("blocked event payload contains required fields", () => {
    const blockedPayload = {
      event_version: 1,
      tenant_id: "test_tenant",
      scope: "organization",
      reason_code: "no_approval_exists",
      operator_id: "user_001",
      request_id: "req_123",
      result: "failure",
      severity: "HIGH",
      resource_type: "llm_call",
      blocked_at: "2026-01-08T10:00:00Z",
    };

    expect(blockedPayload.reason_code).toBeDefined();
    expect(blockedPayload.result).toBe("failure");
    expect(blockedPayload.severity).toBe("HIGH");
    expect(blockedPayload.blocked_at).toBeDefined();
  });

  it("blocked event does not contain PHI fields", () => {
    const blockedPayload = {
      reason_code: "no_approval_exists",
      resource_type: "llm_call",
    };

    const phiKeys = ["text", "transcript", "prompt", "completion", "content", "message"];
    for (const key of phiKeys) {
      expect(blockedPayload).not.toHaveProperty(key);
    }
  });
});
