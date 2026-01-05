/**
 * Daily Assurance Verdict Logic
 * 
 * This module computes the supervisor-facing Daily Assurance verdict.
 * It is deterministic, explainable, testable, and recovery-aware.
 * 
 * DESIGN PRINCIPLES:
 * 1. No PHI in any output
 * 2. Pure functions only (no React, no side effects)
 * 3. Recovery-aware: sessions that fail then recover are NOT blocked
 * 4. Supervisor-safe: caseworkers are never blamed
 * 5. Auditable: explicit criteria for each verdict state
 * 
 * VERDICT DECISION TABLE:
 * ┌─────────────────────┬─────────────────────┬─────────────────────┬─────────┐
 * │ blockedSessionsCount│ issueSessionsCount  │ complianceRiskCount │ Verdict │
 * ├─────────────────────┼─────────────────────┼─────────────────────┼─────────┤
 * │ 0                   │ 0                   │ 0                   │ GREEN   │
 * │ 0                   │ > 0                 │ 0                   │ YELLOW  │
 * │ > 0                 │ any                 │ any                 │ RED     │
 * │ any                 │ any                 │ > 0                 │ RED     │
 * └─────────────────────┴─────────────────────┴─────────────────────┴─────────┘
 * 
 * SUPERVISOR-FACING GUARANTEES:
 * - Caseworkers are never blamed by this logic
 * - Supervisors are not expected to resolve system issues
 * - Escalation implies AidMind involvement, not supervisor action
 */

import { EyeEvent, EyeEventType, EventSeverity } from "./types";
import { getEventSeverity } from "./mock-data";

// ============================================================
// TYPE DEFINITIONS
// ============================================================

export type VerdictLevel = "green" | "yellow" | "red";

export type TimeRange = "last24h" | "today" | "last7d" | "last30d";

export interface ActionCounts {
  blockedSessionsCount: number;
  issueSessionsCount: number;
  complianceRiskCount: number;
  partialResultCount: number;
}

export interface SessionOutcomes {
  sessionsToday: number;
  completed: number;
  saved: number;
  cancelled: number;
  failed: number;
  inProgress: number;
  activeCaseworkers: number;
}

export interface ComplianceStatus {
  deletionsVerified: number;
  retainedArtifacts: number;
  /** 
   * Derived from actual LLM_CALL events. 
   * null = not instrumented (no LLM events found)
   */
  llmComplianceStatus: "passed" | "failed" | "not_instrumented";
  /**
   * Derived from actual NOTE_APPROVED events.
   * null = not instrumented (no approval events found)
   */
  userApprovalStatus: "passed" | "failed" | "not_instrumented";
}

export interface VerdictResult {
  level: VerdictLevel;
  title: string;
  subtitle: string;
  counts: ActionCounts;
}

export interface IncidentSummary {
  generatedAt: string;
  levelLabel: string;
  verdictLevel: VerdictLevel;
  counts: ActionCounts;
  outcomes: SessionOutcomes;
  recommendation: string;
  formattedText: string;
}

// ============================================================
// BLOCKING FAILURE DEFINITIONS
// ============================================================

/**
 * Event types that indicate a workflow-blocking failure.
 * A session with one of these events AND no subsequent recovery is considered "blocked".
 * 
 * DEFINITION: A blocked session is "a session that cannot proceed or complete without intervention."
 */
const BLOCKING_FAILURE_EVENTS: EyeEventType[] = [
  "TRANSCRIPTION_FAILED",
  "REDACTION_FAILED",
];

/**
 * Event types that indicate recovery from a blocking failure.
 * If any of these occur AFTER a blocking failure, the session is no longer blocked.
 */
const RECOVERY_EVENTS: EyeEventType[] = [
  "TRANSCRIPTION_COMPLETED",
  "REDACTION_COMPLETED",
  "SESSION_CLOSED",
  "WIP_BUNDLE_EXPORTED", // Saved for later = session can continue
  "SESSION_CANCELLED",   // Intentional end = not blocked
];

/**
 * Event types that indicate compliance risk.
 */
const COMPLIANCE_RISK_EVENTS: EyeEventType[] = [
  "PURGE_FAILED",
];

// ============================================================
// TIME RANGE FILTERING
// ============================================================

/**
 * Get the start timestamp for a given time range.
 * 
 * NOTE: "last24h" uses a rolling 24-hour window.
 * "today" uses calendar day (local time).
 */
export function getTimeRangeStart(range: TimeRange): Date {
  const now = new Date();
  
  switch (range) {
    case "last24h":
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case "today": {
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);
      return today;
    }
    case "last7d":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "last30d":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    default:
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }
}

/**
 * Filter events to the specified time range.
 */
export function getRelevantEvents(events: EyeEvent[], range: TimeRange = "last24h"): EyeEvent[] {
  const startTime = getTimeRangeStart(range);
  return events.filter(e => new Date(e.timestamp) >= startTime);
}

// ============================================================
// RECOVERY-AWARE BLOCKED SESSION DETECTION
// ============================================================

/**
 * Determine if a session is blocked (unresolved blocking failure).
 * 
 * ALGORITHM:
 * 1. Find all blocking failure events in the session
 * 2. For each blocking failure, check if a recovery event occurred AFTER it
 * 3. If ANY blocking failure has no subsequent recovery, the session is blocked
 * 
 * This prevents false positives where a session fails transcription but later completes.
 */
function isSessionBlocked(sessionEvents: EyeEvent[]): boolean {
  // Sort events by timestamp (oldest first)
  const sorted = [...sessionEvents].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  
  // Track the latest blocking failure timestamp
  let latestBlockingFailureTime: number | null = null;
  
  for (const event of sorted) {
    // Check if this is a blocking failure
    if (BLOCKING_FAILURE_EVENTS.includes(event.event_type)) {
      latestBlockingFailureTime = new Date(event.timestamp).getTime();
    }
    
    // Check if this is a recovery event (clears the block if it happened after the failure)
    if (RECOVERY_EVENTS.includes(event.event_type)) {
      if (latestBlockingFailureTime !== null) {
        const recoveryTime = new Date(event.timestamp).getTime();
        if (recoveryTime >= latestBlockingFailureTime) {
          latestBlockingFailureTime = null; // Block resolved
        }
      }
    }
  }
  
  // Session is blocked if there's an unresolved blocking failure
  return latestBlockingFailureTime !== null;
}

// ============================================================
// ACTION COUNTS COMPUTATION
// ============================================================

/**
 * Compute action counts for verdict determination.
 * 
 * COUNTS:
 * - blockedSessionsCount: Sessions with UNRESOLVED blocking failures
 * - issueSessionsCount: Sessions with errors/warnings but NOT blocked
 * - complianceRiskCount: Sessions with compliance violations
 * - partialResultCount: Sessions with partial results (first-class issue)
 */
export function computeActionCounts(events: EyeEvent[]): ActionCounts {
  const blockedSessionIds = new Set<string>();
  const issueSessionIds = new Set<string>();
  const complianceRiskSessionIds = new Set<string>();
  const partialResultSessionIds = new Set<string>();
  
  // Group events by session
  const eventsBySession = new Map<string, EyeEvent[]>();
  for (const event of events) {
    if (!event.session_id) continue;
    const existing = eventsBySession.get(event.session_id) || [];
    existing.push(event);
    eventsBySession.set(event.session_id, existing);
  }
  
  // Analyze each session
  for (const [sessionId, sessionEvents] of eventsBySession) {
    // Check for blocked sessions (recovery-aware)
    if (isSessionBlocked(sessionEvents)) {
      blockedSessionIds.add(sessionId);
      continue; // Blocked sessions don't also count as "issues"
    }
    
    // Check for compliance risks
    for (const event of sessionEvents) {
      if (COMPLIANCE_RISK_EVENTS.includes(event.event_type)) {
        complianceRiskSessionIds.add(sessionId);
      }
      
      // Check for retained artifacts (compliance risk)
      if (event.event_type === "EPHEMERAL_SCAN_RESULT" && (event.remaining_count ?? 0) > 0) {
        complianceRiskSessionIds.add(sessionId);
      }
      
      // Check for partial results (first-class issue)
      if (event.result === "partial") {
        partialResultSessionIds.add(sessionId);
      }
    }
    
    // Check for non-blocking issues (errors/warnings that recovered)
    for (const event of sessionEvents) {
      const severity = getEventSeverity(event);
      const hasIssue = 
        event.result === "failure" || 
        event.result === "partial" ||
        severity === "WARN" || 
        severity === "HIGH";
      
      if (hasIssue) {
        issueSessionIds.add(sessionId);
      }
    }
  }
  
  // Remove blocked from issue count (don't double count)
  blockedSessionIds.forEach(id => issueSessionIds.delete(id));
  
  // Partial results contribute to issue count
  partialResultSessionIds.forEach(id => issueSessionIds.add(id));
  
  return {
    blockedSessionsCount: blockedSessionIds.size,
    issueSessionsCount: issueSessionIds.size,
    complianceRiskCount: complianceRiskSessionIds.size,
    partialResultCount: partialResultSessionIds.size,
  };
}

// ============================================================
// VERDICT COMPUTATION
// ============================================================

/**
 * Compute the Daily Assurance verdict from action counts.
 * 
 * VERDICT DEFINITIONS:
 * 
 * GREEN (All good):
 * - No blocked sessions AND no compliance risks
 * - Sessions may have had errors, but they all recovered
 * 
 * YELLOW (Errors occurred, but no disruption):
 * - No blocked sessions
 * - Some sessions had warnings/errors
 * - No compliance risks
 * - "Errors occurred but sessions recovered or completed"
 * 
 * RED (Service disruption or compliance risk):
 * - blockedSessionsCount > 0: "A session cannot proceed without intervention"
 * - complianceRiskCount > 0: "Compliance requires attention"
 * 
 * SEVERITY HANDLING:
 * - severity === "CRITICAL" alone is NOT sufficient to mark a session blocked
 * - Severity is a multiplier, not a workflow state
 * - Only workflow-blocking event types determine blocked status
 */
export function computeVerdict(counts: ActionCounts): VerdictResult {
  const { blockedSessionsCount, issueSessionsCount, complianceRiskCount } = counts;
  
  // RED: Blocking or compliance risk
  if (blockedSessionsCount > 0 || complianceRiskCount > 0) {
    return {
      level: "red",
      title: "Service disruption detected — sessions may be delayed",
      subtitle: "Caseworkers may be blocked or compliance requires attention. Escalation recommended.",
      counts,
    };
  }
  
  // YELLOW: Errors occurred but not blocking and no compliance risk
  if (issueSessionsCount > 0) {
    return {
      level: "yellow",
      title: "Some system errors occurred — no caseworkers blocked",
      subtitle: "AidMind has been notified. No action needed from supervisors.",
      counts,
    };
  }
  
  // GREEN: All good
  return {
    level: "green",
    title: "All systems operating normally",
    subtitle: "No blocked sessions. Compliance checks passed.",
    counts,
  };
}

// ============================================================
// SESSION OUTCOMES COMPUTATION
// ============================================================

/**
 * Compute session outcomes with reconciliation.
 * 
 * OUTCOME PRIORITY (highest wins):
 * 1. Failed - session has unresolved blocking failure
 * 2. Completed - SESSION_CLOSED with no major failures
 * 3. Saved - WIP_BUNDLE_EXPORTED
 * 4. Cancelled - SESSION_CANCELLED
 * 5. In Progress - none of the above
 * 
 * GUARANTEE: completed + saved + cancelled + failed + inProgress === sessionsToday
 */
export function computeSessionOutcomes(events: EyeEvent[]): SessionOutcomes {
  // Group events by session
  const eventsBySession = new Map<string, EyeEvent[]>();
  for (const event of events) {
    if (!event.session_id) continue;
    const existing = eventsBySession.get(event.session_id) || [];
    existing.push(event);
    eventsBySession.set(event.session_id, existing);
  }
  
  // Determine outcome for each session
  type Outcome = "completed" | "saved" | "cancelled" | "failed" | "inProgress";
  const outcomes = new Map<string, Outcome>();
  
  for (const [sessionId, sessionEvents] of eventsBySession) {
    // Priority 1: Failed (unresolved blocking failure)
    if (isSessionBlocked(sessionEvents)) {
      outcomes.set(sessionId, "failed");
      continue;
    }
    
    // Priority 2: Completed (SESSION_CLOSED)
    const isClosed = sessionEvents.some(e => e.event_type === "SESSION_CLOSED");
    if (isClosed) {
      outcomes.set(sessionId, "completed");
      continue;
    }
    
    // Priority 3: Saved (WIP_BUNDLE_EXPORTED)
    const isSaved = sessionEvents.some(e => e.event_type === "WIP_BUNDLE_EXPORTED");
    if (isSaved) {
      outcomes.set(sessionId, "saved");
      continue;
    }
    
    // Priority 4: Cancelled
    const isCancelled = sessionEvents.some(e => e.event_type === "SESSION_CANCELLED");
    if (isCancelled) {
      outcomes.set(sessionId, "cancelled");
      continue;
    }
    
    // Priority 5: In Progress
    outcomes.set(sessionId, "inProgress");
  }
  
  // Count outcomes
  let completed = 0, saved = 0, cancelled = 0, failed = 0, inProgress = 0;
  for (const outcome of outcomes.values()) {
    switch (outcome) {
      case "completed": completed++; break;
      case "saved": saved++; break;
      case "cancelled": cancelled++; break;
      case "failed": failed++; break;
      case "inProgress": inProgress++; break;
    }
  }
  
  // Count unique operators (caseworkers)
  const activeCaseworkers = new Set(
    events.map(e => e.operator_id).filter(Boolean)
  ).size;
  
  return {
    sessionsToday: eventsBySession.size,
    completed,
    saved,
    cancelled,
    failed,
    inProgress,
    activeCaseworkers,
  };
}

// ============================================================
// COMPLIANCE STATUS COMPUTATION
// ============================================================

/**
 * Compute compliance status from events.
 * 
 * LLM Compliance:
 * - If no LLM_CALL events exist → "not_instrumented"
 * - If all LLM_CALL_COMPLETED events have data_retention_mode === "zero_retention" → "passed"
 * - Otherwise → "failed" or "not_instrumented"
 * 
 * User Approval:
 * - If no NOTE_APPROVED events exist → "not_instrumented"
 * - If at least one NOTE_APPROVED exists → "passed"
 * - Otherwise → "not_instrumented"
 */
export function computeComplianceStatus(events: EyeEvent[]): ComplianceStatus {
  const deletionsVerified = events.filter(
    e => e.event_type === "EPHEMERAL_SCAN_RESULT" && e.remaining_count === 0
  ).length;
  
  const retainedArtifacts = events.filter(
    e => e.event_type === "EPHEMERAL_SCAN_RESULT" && (e.remaining_count ?? 0) > 0
  ).length;
  
  // LLM Compliance: Check for LLM events
  const llmEvents = events.filter(
    e => e.event_type === "LLM_CALL_STARTED" || 
         e.event_type === "LLM_CALL_COMPLETED" ||
         e.event_type === "LLM_CALL_FAILED"
  );
  
  let llmComplianceStatus: ComplianceStatus["llmComplianceStatus"] = "not_instrumented";
  if (llmEvents.length > 0) {
    const completedLlmCalls = events.filter(e => e.event_type === "LLM_CALL_COMPLETED");
    const allZeroRetention = completedLlmCalls.every(
      e => e.data_retention_mode === "zero_retention"
    );
    llmComplianceStatus = allZeroRetention ? "passed" : "failed";
  }
  
  // User Approval: Check for NOTE_APPROVED events
  const approvalEvents = events.filter(
    e => e.event_type === "NOTE_APPROVED"
  );
  
  let userApprovalStatus: ComplianceStatus["userApprovalStatus"] = "not_instrumented";
  if (approvalEvents.length > 0) {
    userApprovalStatus = "passed";
  }
  
  return {
    deletionsVerified,
    retainedArtifacts,
    llmComplianceStatus,
    userApprovalStatus,
  };
}

// ============================================================
// INCIDENT SUMMARY GENERATION
// ============================================================

/**
 * Generate a PHI-safe incident summary.
 * 
 * CONTENTS (all PHI-safe):
 * - Date/time
 * - Verdict level
 * - Session counts (no session IDs by default)
 * - Impact summary (counts only)
 * - Recommendation
 */
export function generateIncidentSummary(
  verdictLevel: VerdictLevel,
  counts: ActionCounts,
  outcomes: SessionOutcomes
): IncidentSummary {
  const now = new Date().toISOString();
  const levelLabel = verdictLevel === "green" ? "Normal" : verdictLevel === "yellow" ? "Attention" : "Critical";
  
  let recommendation: string;
  if (verdictLevel === "green") {
    recommendation = "No action required.";
  } else if (verdictLevel === "yellow") {
    recommendation = "Monitor situation. Engineering has been automatically notified.";
  } else {
    recommendation = "Escalation recommended. Caseworkers may be blocked or compliance requires attention.";
  }
  
  const formattedText = `AidMind System Status Report
Generated: ${now}
Status Level: ${levelLabel}

Session Counts (Last 24h):
- Total sessions: ${outcomes.sessionsToday}
- Completed: ${outcomes.completed}
- Saved for later: ${outcomes.saved}
- Cancelled: ${outcomes.cancelled}
- Failed: ${outcomes.failed}
- In progress: ${outcomes.inProgress}

Impact Summary:
- Blocked sessions: ${counts.blockedSessionsCount}
- Sessions with issues: ${counts.issueSessionsCount}
- Compliance risks: ${counts.complianceRiskCount}
${counts.partialResultCount > 0 ? `- Partial results: ${counts.partialResultCount}\n` : ""}
Recommendation: ${recommendation}

---
No PHI is included in this report.`;

  return {
    generatedAt: now,
    levelLabel,
    verdictLevel,
    counts,
    outcomes,
    recommendation,
    formattedText,
  };
}

// ============================================================
// EDGE CASES & TODOS
// ============================================================

/**
 * EDGE CASES DOCUMENTED:
 * 
 * 1. Timeout during purge:
 *    - If PURGE_FAILED with reason_code === "TIMEOUT", this is a compliance risk
 *    - Counted in complianceRiskCount
 * 
 * 2. Provider errors during transcription:
 *    - TRANSCRIPTION_FAILED is a blocking failure
 *    - If session later has TRANSCRIPTION_COMPLETED, it's recovered
 *    - Provider outages that recover → YELLOW, not RED
 * 
 * 3. Partial results:
 *    - result === "partial" always contributes to issueSessionsCount
 *    - Never silently passes as GREEN
 *    - Auditors will see these in incident summaries
 * 
 * 4. CRITICAL severity:
 *    - Severity alone does NOT determine blocked status
 *    - Only workflow-blocking event types matter
 *    - CRITICAL severity is logged but doesn't auto-escalate to RED
 * 
 * TODOS:
 * - [ ] Add approval gate violation events (INPUT_APPROVED_FOR_GENERATION)
 * - [ ] Add OUTPUT_PHI_LEAK_CHECK_FAILED as compliance risk
 * - [ ] Add real-time updates (currently computed on render)
 * - [ ] Add time range selector UI
 */
