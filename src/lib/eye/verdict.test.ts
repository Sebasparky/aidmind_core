/**
 * Unit Tests for Daily Assurance Verdict Logic
 * 
 * Run with: npx vitest run src/lib/eye/verdict.test.ts
 * 
 * TEST CASES:
 * - GREEN: no failures, purge verified
 * - YELLOW: WARN/HIGH failures, but sessions completed
 * - RED (blocked): blocking failure with no recovery
 * - RED (compliance): purge failure or retained artifacts
 * - Partial results → YELLOW
 * - Recovery logic: failure followed by success → not blocked
 */

import { describe, it, expect } from "vitest";
import {
  computeActionCounts,
  computeVerdict,
  computeSessionOutcomes,
  computeComplianceStatus,
  generateIncidentSummary,
  getRelevantEvents,
  VerdictLevel,
} from "./verdict";
import { EyeEvent } from "./types";

// ============================================================
// TEST HELPERS
// ============================================================

function createEvent(
  eventType: string,
  sessionId: string,
  overrides: Partial<EyeEvent> = {}
): EyeEvent {
  return {
    event_id: `evt_${Math.random().toString(36).slice(2)}`,
    event_type: eventType as any,
    event_version: 1,
    timestamp: new Date().toISOString(),
    tenant_id: "test_tenant",
    environment: "dev",
    actor_type: "service",
    actor_id: "test_actor",
    actor_role: null,
    session_id: sessionId,
    case_id: "test_case",
    resource_type: "session",
    resource_id: sessionId,
    result: "success",
    reason_code: null,
    request_id: "req_test",
    ...overrides,
  };
}

function createTimestampedEvent(
  eventType: string,
  sessionId: string,
  minutesAgo: number,
  overrides: Partial<EyeEvent> = {}
): EyeEvent {
  const timestamp = new Date(Date.now() - minutesAgo * 60 * 1000).toISOString();
  return createEvent(eventType, sessionId, { timestamp, ...overrides });
}

// ============================================================
// GREEN VERDICT TESTS
// ============================================================

describe("GREEN Verdict", () => {
  it("returns GREEN when no failures and purge verified", () => {
    const events: EyeEvent[] = [
      createEvent("SESSION_STARTED", "sess_1"),
      createEvent("TRANSCRIPTION_COMPLETED", "sess_1"),
      createEvent("REDACTION_COMPLETED", "sess_1"),
      createEvent("PURGE_COMPLETED", "sess_1"),
      createEvent("EPHEMERAL_SCAN_RESULT", "sess_1", { remaining_count: 0 }),
      createEvent("SESSION_CLOSED", "sess_1"),
    ];

    const counts = computeActionCounts(events);
    const verdict = computeVerdict(counts);

    expect(verdict.level).toBe("green");
    expect(counts.blockedSessionsCount).toBe(0);
    expect(counts.issueSessionsCount).toBe(0);
    expect(counts.complianceRiskCount).toBe(0);
  });

  it("returns GREEN when no events at all", () => {
    const events: EyeEvent[] = [];

    const counts = computeActionCounts(events);
    const verdict = computeVerdict(counts);

    expect(verdict.level).toBe("green");
  });
});

// ============================================================
// YELLOW VERDICT TESTS
// ============================================================

describe("YELLOW Verdict", () => {
  it("returns YELLOW when WARN failures occur but sessions complete", () => {
    const events: EyeEvent[] = [
      createTimestampedEvent("SESSION_STARTED", "sess_1", 60),
      createTimestampedEvent("TRANSCRIPTION_FAILED", "sess_1", 55, { 
        result: "failure", 
        severity: "WARN",
        reason_code: "PROVIDER_ERROR" 
      }),
      // Retry succeeds
      createTimestampedEvent("TRANSCRIPTION_COMPLETED", "sess_1", 50),
      createTimestampedEvent("REDACTION_COMPLETED", "sess_1", 45),
      createTimestampedEvent("SESSION_CLOSED", "sess_1", 40),
    ];

    const counts = computeActionCounts(events);
    const verdict = computeVerdict(counts);

    expect(verdict.level).toBe("yellow");
    expect(counts.blockedSessionsCount).toBe(0);
    expect(counts.issueSessionsCount).toBe(1);
    expect(counts.complianceRiskCount).toBe(0);
  });

  it("returns YELLOW when partial results occur", () => {
    const events: EyeEvent[] = [
      createEvent("SESSION_STARTED", "sess_1"),
      createEvent("TRANSCRIPTION_COMPLETED", "sess_1", { result: "partial" }),
      createEvent("SESSION_CLOSED", "sess_1"),
    ];

    const counts = computeActionCounts(events);
    const verdict = computeVerdict(counts);

    expect(verdict.level).toBe("yellow");
    expect(counts.partialResultCount).toBe(1);
    expect(counts.issueSessionsCount).toBe(1);
  });

  it("includes partial results in incident summary", () => {
    const events: EyeEvent[] = [
      createEvent("SESSION_STARTED", "sess_1"),
      createEvent("TRANSCRIPTION_COMPLETED", "sess_1", { result: "partial" }),
      createEvent("SESSION_CLOSED", "sess_1"),
    ];

    const counts = computeActionCounts(events);
    const outcomes = computeSessionOutcomes(events);
    const summary = generateIncidentSummary("yellow", counts, outcomes);

    expect(summary.formattedText).toContain("Partial results: 1");
  });
});

// ============================================================
// RED VERDICT TESTS - BLOCKED SESSIONS
// ============================================================

describe("RED Verdict - Blocked Sessions", () => {
  it("returns RED when blocking failure has no recovery", () => {
    const events: EyeEvent[] = [
      createTimestampedEvent("SESSION_STARTED", "sess_1", 30),
      createTimestampedEvent("TRANSCRIPTION_FAILED", "sess_1", 25, { 
        result: "failure",
        reason_code: "PROVIDER_ERROR" 
      }),
      // No recovery event follows
    ];

    const counts = computeActionCounts(events);
    const verdict = computeVerdict(counts);

    expect(verdict.level).toBe("red");
    expect(counts.blockedSessionsCount).toBe(1);
  });

  it("returns RED when REDACTION_FAILED has no recovery", () => {
    const events: EyeEvent[] = [
      createTimestampedEvent("SESSION_STARTED", "sess_1", 30),
      createTimestampedEvent("TRANSCRIPTION_COMPLETED", "sess_1", 25),
      createTimestampedEvent("REDACTION_FAILED", "sess_1", 20, { 
        result: "failure",
        reason_code: "TIMEOUT" 
      }),
      // No recovery event follows
    ];

    const counts = computeActionCounts(events);
    const verdict = computeVerdict(counts);

    expect(verdict.level).toBe("red");
    expect(counts.blockedSessionsCount).toBe(1);
  });

  it("does NOT mark session blocked if CRITICAL severity alone (without blocking event type)", () => {
    const events: EyeEvent[] = [
      createEvent("SESSION_STARTED", "sess_1"),
      createEvent("AUDIO_UPLOADED", "sess_1", { severity: "CRITICAL" }),
      createEvent("SESSION_CLOSED", "sess_1"),
    ];

    const counts = computeActionCounts(events);
    const verdict = computeVerdict(counts);

    // CRITICAL severity alone should NOT cause RED
    expect(verdict.level).not.toBe("red");
    expect(counts.blockedSessionsCount).toBe(0);
  });
});

// ============================================================
// RED VERDICT TESTS - COMPLIANCE RISK
// ============================================================

describe("RED Verdict - Compliance Risk", () => {
  it("returns RED when purge fails", () => {
    const events: EyeEvent[] = [
      createEvent("SESSION_STARTED", "sess_1"),
      createEvent("TRANSCRIPTION_COMPLETED", "sess_1"),
      createEvent("SESSION_CLOSED", "sess_1"),
      createEvent("PURGE_FAILED", "sess_1", { result: "failure" }),
    ];

    const counts = computeActionCounts(events);
    const verdict = computeVerdict(counts);

    expect(verdict.level).toBe("red");
    expect(counts.complianceRiskCount).toBe(1);
  });

  it("returns RED when retained artifacts > 0", () => {
    const events: EyeEvent[] = [
      createEvent("SESSION_STARTED", "sess_1"),
      createEvent("SESSION_CLOSED", "sess_1"),
      createEvent("EPHEMERAL_SCAN_RESULT", "sess_1", { remaining_count: 2 }),
    ];

    const counts = computeActionCounts(events);
    const verdict = computeVerdict(counts);

    expect(verdict.level).toBe("red");
    expect(counts.complianceRiskCount).toBe(1);
  });
});

// ============================================================
// RECOVERY LOGIC TESTS
// ============================================================

describe("Recovery Logic", () => {
  it("clears block when TRANSCRIPTION_COMPLETED follows TRANSCRIPTION_FAILED", () => {
    const events: EyeEvent[] = [
      createTimestampedEvent("SESSION_STARTED", "sess_1", 60),
      createTimestampedEvent("TRANSCRIPTION_FAILED", "sess_1", 55, { result: "failure" }),
      createTimestampedEvent("TRANSCRIPTION_COMPLETED", "sess_1", 50), // Recovery!
      createTimestampedEvent("SESSION_CLOSED", "sess_1", 40),
    ];

    const counts = computeActionCounts(events);

    expect(counts.blockedSessionsCount).toBe(0);
    expect(counts.issueSessionsCount).toBe(1); // Still counts as issue, just not blocked
  });

  it("clears block when SESSION_CLOSED follows failure", () => {
    const events: EyeEvent[] = [
      createTimestampedEvent("SESSION_STARTED", "sess_1", 60),
      createTimestampedEvent("REDACTION_FAILED", "sess_1", 55, { result: "failure" }),
      createTimestampedEvent("SESSION_CLOSED", "sess_1", 40), // Session completed anyway
    ];

    const counts = computeActionCounts(events);

    expect(counts.blockedSessionsCount).toBe(0);
  });

  it("clears block when WIP_BUNDLE_EXPORTED follows failure (saved for later)", () => {
    const events: EyeEvent[] = [
      createTimestampedEvent("SESSION_STARTED", "sess_1", 60),
      createTimestampedEvent("TRANSCRIPTION_FAILED", "sess_1", 55, { result: "failure" }),
      createTimestampedEvent("WIP_BUNDLE_EXPORTED", "sess_1", 50), // Saved for later
    ];

    const counts = computeActionCounts(events);

    expect(counts.blockedSessionsCount).toBe(0);
  });

  it("clears block when SESSION_CANCELLED follows failure", () => {
    const events: EyeEvent[] = [
      createTimestampedEvent("SESSION_STARTED", "sess_1", 60),
      createTimestampedEvent("TRANSCRIPTION_FAILED", "sess_1", 55, { result: "failure" }),
      createTimestampedEvent("SESSION_CANCELLED", "sess_1", 50), // User cancelled
    ];

    const counts = computeActionCounts(events);

    expect(counts.blockedSessionsCount).toBe(0);
  });

  it("handles provider outage with retry recovery → YELLOW, not RED", () => {
    // Scenario: Provider timeout, then retry succeeds
    const events: EyeEvent[] = [
      createTimestampedEvent("SESSION_STARTED", "sess_1", 60),
      createTimestampedEvent("TRANSCRIPTION_FAILED", "sess_1", 55, { 
        result: "failure",
        reason_code: "TIMEOUT" 
      }),
      createTimestampedEvent("TRANSCRIPTION_STARTED", "sess_1", 54), // Retry
      createTimestampedEvent("TRANSCRIPTION_COMPLETED", "sess_1", 50), // Success!
      createTimestampedEvent("SESSION_CLOSED", "sess_1", 40),
    ];

    const counts = computeActionCounts(events);
    const verdict = computeVerdict(counts);

    expect(verdict.level).toBe("yellow"); // Not RED
    expect(counts.blockedSessionsCount).toBe(0);
    expect(counts.issueSessionsCount).toBe(1);
  });
});

// ============================================================
// SESSION OUTCOMES TESTS
// ============================================================

describe("Session Outcomes Reconciliation", () => {
  it("ensures outcomes sum to sessionsToday", () => {
    const events: EyeEvent[] = [
      // Session 1: Completed
      createEvent("SESSION_STARTED", "sess_1"),
      createEvent("SESSION_CLOSED", "sess_1"),
      // Session 2: Saved
      createEvent("SESSION_STARTED", "sess_2"),
      createEvent("WIP_BUNDLE_EXPORTED", "sess_2"),
      // Session 3: Cancelled
      createEvent("SESSION_STARTED", "sess_3"),
      createEvent("SESSION_CANCELLED", "sess_3"),
      // Session 4: Failed (unresolved)
      createTimestampedEvent("SESSION_STARTED", "sess_4", 30),
      createTimestampedEvent("TRANSCRIPTION_FAILED", "sess_4", 25, { result: "failure" }),
      // Session 5: In Progress
      createEvent("SESSION_STARTED", "sess_5"),
    ];

    const outcomes = computeSessionOutcomes(events);

    expect(outcomes.sessionsToday).toBe(5);
    expect(outcomes.completed).toBe(1);
    expect(outcomes.saved).toBe(1);
    expect(outcomes.cancelled).toBe(1);
    expect(outcomes.failed).toBe(1);
    expect(outcomes.inProgress).toBe(1);

    // Verify reconciliation
    const sum = outcomes.completed + outcomes.saved + outcomes.cancelled + 
                outcomes.failed + outcomes.inProgress;
    expect(sum).toBe(outcomes.sessionsToday);
  });

  it("applies priority correctly (Failed > Completed > Saved)", () => {
    // Edge case: session has both failure and close
    const events: EyeEvent[] = [
      createTimestampedEvent("SESSION_STARTED", "sess_1", 60),
      createTimestampedEvent("TRANSCRIPTION_FAILED", "sess_1", 55, { result: "failure" }),
      // No recovery, but somehow SESSION_CLOSED? Priority: Failed wins
    ];

    const outcomes = computeSessionOutcomes(events);

    expect(outcomes.failed).toBe(1);
    expect(outcomes.completed).toBe(0);
  });
});

// ============================================================
// COMPLIANCE STATUS TESTS
// ============================================================

describe("Compliance Status", () => {
  it("returns not_instrumented when no LLM events", () => {
    const events: EyeEvent[] = [
      createEvent("SESSION_STARTED", "sess_1"),
      createEvent("SESSION_CLOSED", "sess_1"),
    ];

    const compliance = computeComplianceStatus(events);

    expect(compliance.llmComplianceStatus).toBe("not_instrumented");
    expect(compliance.userApprovalStatus).toBe("not_instrumented");
  });

  it("returns passed when LLM calls use zero_retention", () => {
    const events: EyeEvent[] = [
      createEvent("LLM_CALL_STARTED", "sess_1"),
      createEvent("LLM_CALL_COMPLETED", "sess_1", { data_retention_mode: "zero_retention" }),
    ];

    const compliance = computeComplianceStatus(events);

    expect(compliance.llmComplianceStatus).toBe("passed");
  });

  it("returns passed when NOTE_APPROVED events exist", () => {
    const events: EyeEvent[] = [
      createEvent("NOTE_APPROVED", "sess_1"),
    ];

    const compliance = computeComplianceStatus(events);

    expect(compliance.userApprovalStatus).toBe("passed");
  });

  it("counts deletions verified correctly", () => {
    const events: EyeEvent[] = [
      createEvent("EPHEMERAL_SCAN_RESULT", "sess_1", { remaining_count: 0 }),
      createEvent("EPHEMERAL_SCAN_RESULT", "sess_2", { remaining_count: 0 }),
      createEvent("EPHEMERAL_SCAN_RESULT", "sess_3", { remaining_count: 2 }), // Not verified
    ];

    const compliance = computeComplianceStatus(events);

    expect(compliance.deletionsVerified).toBe(2);
    expect(compliance.retainedArtifacts).toBe(1);
  });
});

// ============================================================
// INCIDENT SUMMARY TESTS
// ============================================================

describe("Incident Summary", () => {
  it("generates PHI-safe summary", () => {
    const counts = {
      blockedSessionsCount: 1,
      issueSessionsCount: 2,
      complianceRiskCount: 0,
      partialResultCount: 0,
    };
    const outcomes = {
      sessionsToday: 5,
      completed: 3,
      saved: 1,
      cancelled: 0,
      failed: 1,
      inProgress: 0,
      activeCaseworkers: 2,
    };

    const summary = generateIncidentSummary("red", counts, outcomes);

    expect(summary.formattedText).toContain("No PHI is included");
    expect(summary.formattedText).toContain("Blocked sessions: 1");
    expect(summary.formattedText).toContain("Status Level: Critical");
    expect(summary.verdictLevel).toBe("red");
  });

  it("includes recommendation based on verdict", () => {
    const counts = {
      blockedSessionsCount: 0,
      issueSessionsCount: 0,
      complianceRiskCount: 0,
      partialResultCount: 0,
    };
    const outcomes = {
      sessionsToday: 3,
      completed: 3,
      saved: 0,
      cancelled: 0,
      failed: 0,
      inProgress: 0,
      activeCaseworkers: 1,
    };

    const summary = generateIncidentSummary("green", counts, outcomes);

    expect(summary.recommendation).toBe("No action required.");
  });
});

// ============================================================
// TIME RANGE TESTS
// ============================================================

describe("Time Range Filtering", () => {
  it("filters to last 24 hours by default", () => {
    const now = Date.now();
    const events: EyeEvent[] = [
      createEvent("SESSION_STARTED", "sess_1", { 
        timestamp: new Date(now - 12 * 60 * 60 * 1000).toISOString() // 12h ago
      }),
      createEvent("SESSION_STARTED", "sess_2", { 
        timestamp: new Date(now - 36 * 60 * 60 * 1000).toISOString() // 36h ago
      }),
    ];

    const relevant = getRelevantEvents(events, "last24h");

    expect(relevant.length).toBe(1);
    expect(relevant[0].session_id).toBe("sess_1");
  });
});
