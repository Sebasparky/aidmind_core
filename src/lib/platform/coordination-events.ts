/**
 * Mock Coordination Events for Supervisor Integration
 * 
 * These are coordination signals from The Platform that appear
 * in the existing Supervisor Event Feed. Frontend-only prototype.
 */

import { EyeEvent } from "@/lib/eye/types";

function uuid(): string {
  return crypto.randomUUID();
}

function hoursAgo(hours: number): string {
  const date = new Date();
  date.setHours(date.getHours() - hours);
  return date.toISOString();
}

/**
 * Generate mock coordination events for the Supervisor UI.
 * These simulate signals from The Platform's coordination layer.
 */
export function generateMockCoordinationEvents(): EyeEvent[] {
  return [
    {
      event_id: uuid(),
      event_type: "COORDINATION_REFERRAL_STALLED",
      event_version: 1,
      timestamp: hoursAgo(2),
      tenant_id: "agency_01",
      environment: "prod",
      actor_type: "system",
      actor_id: "platform-coordinator",
      actor_role: null,
      session_id: null,
      case_id: "CASE-2024-0142",
      resource_type: "session",
      resource_id: "REF-2024-0090",
      result: "failure",
      reason_code: null,
      request_id: `req_${uuid().slice(0, 8)}`,
      severity: "HIGH",
      tags: [],
      // Coordination-specific metadata
      service_name: "platform-coordination",
    },
    {
      event_id: uuid(),
      event_type: "COORDINATION_SLA_BREACHED",
      event_version: 1,
      timestamp: hoursAgo(8),
      tenant_id: "agency_01",
      environment: "prod",
      actor_type: "system",
      actor_id: "platform-sla-monitor",
      actor_role: null,
      session_id: null,
      case_id: "CASE-2024-0144",
      resource_type: "session",
      resource_id: "REF-2024-0093",
      result: "failure",
      reason_code: null,
      request_id: `req_${uuid().slice(0, 8)}`,
      severity: "HIGH",
      tags: [],
      service_name: "platform-coordination",
    },
    {
      event_id: uuid(),
      event_type: "COORDINATION_EXTERNAL_ACK_DELAYED",
      event_version: 1,
      timestamp: hoursAgo(18),
      tenant_id: "agency_01",
      environment: "prod",
      actor_type: "system",
      actor_id: "platform-cbo-monitor",
      actor_role: null,
      session_id: null,
      case_id: "CASE-2024-0147",
      resource_type: "session",
      resource_id: "REF-2024-0094",
      result: "partial",
      reason_code: null,
      request_id: `req_${uuid().slice(0, 8)}`,
      severity: "WARN",
      tags: [],
      service_name: "platform-coordination",
    },
    {
      event_id: uuid(),
      event_type: "COORDINATION_REPEATED_HANDOFF_FAILURE",
      event_version: 1,
      timestamp: hoursAgo(24),
      tenant_id: "agency_01",
      environment: "prod",
      actor_type: "system",
      actor_id: "platform-pattern-detector",
      actor_role: null,
      session_id: null,
      case_id: "CASE-2024-0143",
      resource_type: "session",
      resource_id: "cbo-004",
      result: "failure",
      reason_code: null,
      request_id: `req_${uuid().slice(0, 8)}`,
      severity: "WARN",
      tags: [],
      service_name: "platform-coordination",
    },
  ];
}

/**
 * Check if an event is a coordination event from The Platform
 */
export function isCoordinationEvent(event: EyeEvent): boolean {
  return event.event_type.startsWith("COORDINATION_");
}

/**
 * Get coordination-specific context for an event (for detail drawer)
 */
export function getCoordinationContext(event: EyeEvent): {
  caseId: string | null;
  referralId: string | null;
  cboName: string | null;
  program: string | null;
  platformLink: string | null;
} {
  if (!isCoordinationEvent(event)) {
    return { caseId: null, referralId: null, cboName: null, program: null, platformLink: null };
  }

  // Mock context based on resource_id
  const caseId = event.case_id;
  const referralId = event.resource_id?.startsWith("REF-") ? event.resource_id : null;
  
  // Mock CBO name based on event type
  let cboName: string | null = null;
  if (event.event_type === "COORDINATION_REFERRAL_STALLED" || 
      event.event_type === "COORDINATION_SLA_BREACHED") {
    cboName = "Family Housing Services";
  } else if (event.event_type === "COORDINATION_EXTERNAL_ACK_DELAYED") {
    cboName = "Senior Care Alliance";
  } else if (event.event_type === "COORDINATION_REPEATED_HANDOFF_FAILURE") {
    cboName = "Workforce Development Center";
  }

  // Generate platform link
  const platformLink = caseId ? `/platform/cases?caseId=${caseId}` : "/platform";

  return {
    caseId,
    referralId,
    cboName,
    program: "SNAP", // Mock program
    platformLink,
  };
}
