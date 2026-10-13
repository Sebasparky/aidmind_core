/**
 * The Platform - Mock Data
 * 
 * Static JSON-like mock data for frontend prototype.
 * No real backend - all data is local and read-only.
 */

import {
  PlatformCase,
  Referral,
  CBO,
  PlatformDocument,
  PlatformEvent,
  CoordinationSignal,
} from "./types";

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function uuid(): string {
  return crypto.randomUUID();
}

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function hoursAgo(hours: number): string {
  const date = new Date();
  date.setHours(date.getHours() - hours);
  return date.toISOString();
}

function daysFromNow(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

// ============================================================
// PROGRAMS
// ============================================================

export const PROGRAMS = [
  "SNAP",
  "TANF",
  "Medicaid",
  "Housing Assistance",
  "Child Care",
  "Energy Assistance",
];

// ============================================================
// MOCK CBOs
// ============================================================

export const MOCK_CBOS: CBO[] = [
  {
    id: "cbo-001",
    name: "Community Food Bank",
    serviceCategories: ["Food Assistance", "Emergency Aid"],
    avgAcknowledgeTime: "4.2 hours",
    last30dReferrals: 47,
    contactEmail: "referrals@communityfoodbank.example.org",
    contactPhone: "(555) 123-4567",
    address: "123 Main St, Springfield, IL 62701",
  },
  {
    id: "cbo-002",
    name: "Family Housing Services",
    serviceCategories: ["Housing", "Emergency Shelter"],
    avgAcknowledgeTime: "8.1 hours",
    last30dReferrals: 23,
    contactEmail: "intake@familyhousing.example.org",
    contactPhone: "(555) 234-5678",
    address: "456 Oak Ave, Springfield, IL 62702",
  },
  {
    id: "cbo-003",
    name: "Children First Daycare Network",
    serviceCategories: ["Child Care", "Early Education"],
    avgAcknowledgeTime: "12.5 hours",
    last30dReferrals: 31,
    contactEmail: "enrollment@childrenfirst.example.org",
    contactPhone: "(555) 345-6789",
    address: "789 Elm Blvd, Springfield, IL 62703",
  },
  {
    id: "cbo-004",
    name: "Workforce Development Center",
    serviceCategories: ["Job Training", "Employment Services"],
    avgAcknowledgeTime: "6.3 hours",
    last30dReferrals: 56,
    contactEmail: "services@workforcedev.example.org",
    contactPhone: "(555) 456-7890",
    address: "321 Pine Rd, Springfield, IL 62704",
  },
  {
    id: "cbo-005",
    name: "Senior Care Alliance",
    serviceCategories: ["Elder Care", "Transportation", "Meals"],
    avgAcknowledgeTime: "18.7 hours",
    last30dReferrals: 14,
    contactEmail: "outreach@seniorcare.example.org",
    contactPhone: "(555) 567-8901",
    address: "654 Maple Dr, Springfield, IL 62705",
  },
];

// ============================================================
// MOCK CASES
// ============================================================

export const MOCK_CASES: PlatformCase[] = [
  {
    id: uuid(),
    caseId: "CASE-2024-0142",
    program: "SNAP",
    status: "open",
    activeReferrals: 2,
    stalledItems: 1,
    lastEventAt: hoursAgo(2),
    createdAt: daysAgo(14),
  },
  {
    id: uuid(),
    caseId: "CASE-2024-0143",
    program: "TANF",
    status: "open",
    activeReferrals: 3,
    stalledItems: 0,
    lastEventAt: hoursAgo(6),
    createdAt: daysAgo(21),
  },
  {
    id: uuid(),
    caseId: "CASE-2024-0144",
    program: "Housing Assistance",
    status: "pending",
    activeReferrals: 1,
    stalledItems: 1,
    lastEventAt: daysAgo(3),
    createdAt: daysAgo(45),
  },
  {
    id: uuid(),
    caseId: "CASE-2024-0145",
    program: "Medicaid",
    status: "open",
    activeReferrals: 0,
    stalledItems: 0,
    lastEventAt: hoursAgo(12),
    createdAt: daysAgo(7),
  },
  {
    id: uuid(),
    caseId: "CASE-2024-0146",
    program: "Child Care",
    status: "closed",
    activeReferrals: 0,
    stalledItems: 0,
    lastEventAt: daysAgo(5),
    createdAt: daysAgo(60),
  },
  {
    id: uuid(),
    caseId: "CASE-2024-0147",
    program: "SNAP",
    status: "open",
    activeReferrals: 1,
    stalledItems: 2,
    lastEventAt: daysAgo(4),
    createdAt: daysAgo(30),
  },
  {
    id: uuid(),
    caseId: "CASE-2024-0148",
    program: "Energy Assistance",
    status: "pending",
    activeReferrals: 2,
    stalledItems: 0,
    lastEventAt: hoursAgo(18),
    createdAt: daysAgo(10),
  },
];

// ============================================================
// MOCK REFERRALS
// ============================================================

export const MOCK_REFERRALS: Referral[] = [
  {
    id: uuid(),
    referralId: "REF-2024-0089",
    caseId: "CASE-2024-0142",
    cboId: "cbo-001",
    cboName: "Community Food Bank",
    state: "service_in_progress",
    serviceType: "Food Assistance",
    slaDeadline: daysFromNow(2),
    slaStatus: "on_track",
    slaRemaining: "48h remaining",
    lastUpdatedAt: hoursAgo(4),
    createdAt: daysAgo(5),
    stateHistory: [
      { state: "drafted", timestamp: daysAgo(5) },
      { state: "sent", timestamp: daysAgo(5) },
      { state: "acknowledged", timestamp: daysAgo(4) },
      { state: "client_contacted", timestamp: daysAgo(3) },
      { state: "service_in_progress", timestamp: hoursAgo(4) },
    ],
  },
  {
    id: uuid(),
    referralId: "REF-2024-0090",
    caseId: "CASE-2024-0142",
    cboId: "cbo-002",
    cboName: "Family Housing Services",
    state: "stalled",
    serviceType: "Emergency Shelter",
    slaDeadline: daysAgo(2),
    slaStatus: "breached",
    slaRemaining: "Breach +2d",
    lastUpdatedAt: daysAgo(5),
    createdAt: daysAgo(10),
    stateHistory: [
      { state: "drafted", timestamp: daysAgo(10) },
      { state: "sent", timestamp: daysAgo(10) },
      { state: "acknowledged", timestamp: daysAgo(8) },
      { state: "stalled", timestamp: daysAgo(5) },
    ],
  },
  {
    id: uuid(),
    referralId: "REF-2024-0091",
    caseId: "CASE-2024-0143",
    cboId: "cbo-003",
    cboName: "Children First Daycare Network",
    state: "acknowledged",
    serviceType: "Child Care Placement",
    slaDeadline: daysFromNow(5),
    slaStatus: "on_track",
    slaRemaining: "5d remaining",
    lastUpdatedAt: hoursAgo(12),
    createdAt: daysAgo(3),
    stateHistory: [
      { state: "drafted", timestamp: daysAgo(3) },
      { state: "sent", timestamp: daysAgo(3) },
      { state: "acknowledged", timestamp: hoursAgo(12) },
    ],
  },
  {
    id: uuid(),
    referralId: "REF-2024-0092",
    caseId: "CASE-2024-0143",
    cboId: "cbo-004",
    cboName: "Workforce Development Center",
    state: "client_contacted",
    serviceType: "Job Training",
    slaDeadline: daysFromNow(1),
    slaStatus: "at_risk",
    slaRemaining: "24h remaining",
    lastUpdatedAt: hoursAgo(6),
    createdAt: daysAgo(7),
    stateHistory: [
      { state: "drafted", timestamp: daysAgo(7) },
      { state: "sent", timestamp: daysAgo(7) },
      { state: "acknowledged", timestamp: daysAgo(6) },
      { state: "client_contacted", timestamp: hoursAgo(6) },
    ],
  },
  {
    id: uuid(),
    referralId: "REF-2024-0093",
    caseId: "CASE-2024-0144",
    cboId: "cbo-002",
    cboName: "Family Housing Services",
    state: "sent",
    serviceType: "Housing Search",
    slaDeadline: daysAgo(1),
    slaStatus: "breached",
    slaRemaining: "Breach +1d",
    lastUpdatedAt: daysAgo(4),
    createdAt: daysAgo(8),
    stateHistory: [
      { state: "drafted", timestamp: daysAgo(8) },
      { state: "sent", timestamp: daysAgo(4) },
    ],
  },
  {
    id: uuid(),
    referralId: "REF-2024-0094",
    caseId: "CASE-2024-0147",
    cboId: "cbo-001",
    cboName: "Community Food Bank",
    state: "completed",
    serviceType: "Emergency Food",
    slaDeadline: daysAgo(3),
    slaStatus: "on_track",
    slaRemaining: "Completed",
    lastUpdatedAt: daysAgo(4),
    createdAt: daysAgo(12),
    stateHistory: [
      { state: "drafted", timestamp: daysAgo(12) },
      { state: "sent", timestamp: daysAgo(12) },
      { state: "acknowledged", timestamp: daysAgo(11) },
      { state: "client_contacted", timestamp: daysAgo(8) },
      { state: "service_in_progress", timestamp: daysAgo(6) },
      { state: "completed", timestamp: daysAgo(4) },
    ],
  },
];

// ============================================================
// MOCK DOCUMENTS
// ============================================================

export const MOCK_DOCUMENTS: PlatformDocument[] = [
  {
    id: uuid(),
    documentId: "DOC-2024-0201",
    caseId: "CASE-2024-0142",
    type: "Income Verification",
    requestedAt: daysAgo(7),
    dueDate: daysAgo(1),
    status: "overdue",
    retention: "ephemeral",
  },
  {
    id: uuid(),
    documentId: "DOC-2024-0202",
    caseId: "CASE-2024-0142",
    type: "ID Document",
    requestedAt: daysAgo(5),
    dueDate: daysFromNow(2),
    status: "requested",
    retention: "ephemeral",
  },
  {
    id: uuid(),
    documentId: "DOC-2024-0203",
    caseId: "CASE-2024-0143",
    type: "Employment Letter",
    requestedAt: daysAgo(10),
    dueDate: daysAgo(3),
    status: "received",
    retention: "program_configured",
    receivedAt: daysAgo(4),
  },
  {
    id: uuid(),
    documentId: "DOC-2024-0204",
    caseId: "CASE-2024-0144",
    type: "Lease Agreement",
    requestedAt: daysAgo(14),
    dueDate: daysAgo(7),
    status: "overdue",
    retention: "ephemeral",
  },
  {
    id: uuid(),
    documentId: "DOC-2024-0205",
    caseId: "CASE-2024-0147",
    type: "Bank Statement",
    requestedAt: daysAgo(3),
    dueDate: daysFromNow(4),
    status: "requested",
    retention: "ephemeral",
  },
];

// ============================================================
// MOCK PLATFORM EVENTS (for Case Timeline)
// ============================================================

export const MOCK_PLATFORM_EVENTS: PlatformEvent[] = [
  {
    id: uuid(),
    eventType: "referral.status_updated",
    caseId: "CASE-2024-0142",
    referralId: "REF-2024-0089",
    source: "cbo",
    severity: "info",
    description: "Service marked as in progress by Community Food Bank",
    timestamp: hoursAgo(4),
  },
  {
    id: uuid(),
    eventType: "document.overdue",
    caseId: "CASE-2024-0142",
    documentId: "DOC-2024-0201",
    source: "system",
    severity: "warn",
    description: "Income Verification document is now overdue",
    timestamp: daysAgo(1),
  },
  {
    id: uuid(),
    eventType: "referral.stalled",
    caseId: "CASE-2024-0142",
    referralId: "REF-2024-0090",
    source: "system",
    severity: "error",
    description: "Referral to Family Housing Services has stalled (5 days inactive)",
    timestamp: daysAgo(5),
  },
  {
    id: uuid(),
    eventType: "referral.acknowledged",
    caseId: "CASE-2024-0142",
    referralId: "REF-2024-0090",
    source: "cbo",
    severity: "info",
    description: "Family Housing Services acknowledged referral",
    timestamp: daysAgo(8),
  },
  {
    id: uuid(),
    eventType: "referral.sent",
    caseId: "CASE-2024-0142",
    referralId: "REF-2024-0090",
    source: "caseworker",
    severity: "info",
    description: "Referral sent to Family Housing Services",
    timestamp: daysAgo(10),
  },
  {
    id: uuid(),
    eventType: "case.opened",
    caseId: "CASE-2024-0142",
    source: "caseworker",
    severity: "info",
    description: "Case opened under SNAP program",
    timestamp: daysAgo(14),
  },
  {
    id: uuid(),
    eventType: "referral.acknowledged",
    caseId: "CASE-2024-0143",
    referralId: "REF-2024-0091",
    source: "cbo",
    severity: "info",
    description: "Children First Daycare Network acknowledged referral",
    timestamp: hoursAgo(12),
  },
  {
    id: uuid(),
    eventType: "supervisor.annotation",
    caseId: "CASE-2024-0144",
    source: "supervisor",
    severity: "info",
    description: "Flagged for priority review due to housing urgency",
    timestamp: daysAgo(2),
    metadata: { annotationType: "priority_flag" },
  },
];

// ============================================================
// MOCK COORDINATION SIGNALS (for Supervisor Integration)
// ============================================================

export const MOCK_COORDINATION_SIGNALS: CoordinationSignal[] = [
  {
    id: uuid(),
    eventType: "coordination.referral_stalled",
    caseId: "CASE-2024-0142",
    referralId: "REF-2024-0090",
    cboName: "Family Housing Services",
    program: "SNAP",
    severity: "error",
    title: "Referral stalled: No activity for 5 days",
    description: "Housing referral has had no status updates for 5 days. CBO last acknowledged on day 2.",
    timestamp: hoursAgo(2),
    metadata: {
      daysStalled: 5,
      supportingCounts: { referralsSentThisMonth: 23, avgResponseTime: 8.1 },
    },
  },
  {
    id: uuid(),
    eventType: "coordination.sla_breached",
    caseId: "CASE-2024-0144",
    referralId: "REF-2024-0093",
    cboName: "Family Housing Services",
    program: "Housing Assistance",
    severity: "error",
    title: "SLA breached: Housing referral 1 day overdue",
    description: "Referral exceeded 7-day SLA. Still in 'sent' state — no acknowledgment received.",
    timestamp: hoursAgo(8),
    metadata: {
      slaDuration: "7 days",
      daysStalled: 4,
      supportingCounts: { breachesThisWeek: 3 },
    },
  },
  {
    id: uuid(),
    eventType: "coordination.external_ack_delayed",
    caseId: "CASE-2024-0147",
    referralId: "REF-2024-0094",
    cboName: "Senior Care Alliance",
    program: "SNAP",
    severity: "warn",
    title: "Acknowledgment delayed: 42 hours without response",
    description: "Senior Care Alliance has not acknowledged referral. Typical response time is 18.7 hours.",
    timestamp: hoursAgo(18),
    metadata: {
      ackDelayHours: 42,
      supportingCounts: { avgAckTime: 18.7 },
    },
  },
  {
    id: uuid(),
    eventType: "coordination.repeated_handoff_failure",
    caseId: "CASE-2024-0143",
    program: "TANF",
    severity: "warn",
    title: "Repeated handoff failures detected",
    description: "3 referrals to Workforce Development Center have stalled in the past 30 days.",
    timestamp: daysAgo(1),
    metadata: {
      failureCount: 3,
      supportingCounts: { totalReferrals: 56, failureRate: 0.05 },
    },
  },
];

// ============================================================
// COORDINATION HEALTH STATS (for Overview)
// ============================================================

export const COORDINATION_STATS = {
  stalledReferrals: 4,
  slaBreaches: 2,
  referralsThroughput: {
    sent: 47,
    acknowledged: 38,
    completed: 29,
  },
  documentFlow: {
    requested: 12,
    received: 8,
    overdue: 4,
  },
  cboResponsiveness: {
    avgAcknowledgeTime: "9.6 hours",
    lateAcknowledges: 6,
  },
};

// ============================================================
// FILTER HELPERS
// ============================================================

export function filterCases(cases: PlatformCase[], filters: {
  status?: string;
  program?: string;
  hasStalled?: boolean;
}): PlatformCase[] {
  return cases.filter((c) => {
    if (filters.status && c.status !== filters.status) return false;
    if (filters.program && c.program !== filters.program) return false;
    if (filters.hasStalled && c.stalledItems === 0) return false;
    return true;
  });
}

export function filterReferrals(referrals: Referral[], filters: {
  states?: string[];
  slaStatus?: string[];
  cboId?: string;
}): Referral[] {
  return referrals.filter((r) => {
    if (filters.states?.length && !filters.states.includes(r.state)) return false;
    if (filters.slaStatus?.length && !filters.slaStatus.includes(r.slaStatus)) return false;
    if (filters.cboId && r.cboId !== filters.cboId) return false;
    return true;
  });
}

export function getEventsForCase(caseId: string): PlatformEvent[] {
  return MOCK_PLATFORM_EVENTS
    .filter((e) => e.caseId === caseId)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export function getReferralsForCase(caseId: string): Referral[] {
  return MOCK_REFERRALS.filter((r) => r.caseId === caseId);
}

export function getDocumentsForCase(caseId: string): PlatformDocument[] {
  return MOCK_DOCUMENTS.filter((d) => d.caseId === caseId);
}
