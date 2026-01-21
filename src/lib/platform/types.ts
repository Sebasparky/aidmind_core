/**
 * The Platform - Human Services Coordination Layer Types
 * 
 * Frontend-only prototype types for cases, referrals, CBOs, documents, and events.
 * All data is mocked - no real backend integration.
 */

// ============================================================
// ENUMS & TYPES
// ============================================================

export type CaseStatus = "open" | "pending" | "closed";

export type ReferralState = 
  | "drafted"
  | "sent"
  | "acknowledged"
  | "client_contacted"
  | "service_in_progress"
  | "completed"
  | "declined"
  | "stalled";

export type DocumentStatus = "requested" | "received" | "overdue";

export type EventSource = "system" | "caseworker" | "cbo" | "supervisor";

export type EventSeverity = "info" | "warn" | "error";

export type PlatformEventType =
  | "referral.created"
  | "referral.sent"
  | "referral.acknowledged"
  | "referral.status_updated"
  | "referral.completed"
  | "referral.declined"
  | "referral.stalled"
  | "document.requested"
  | "document.received"
  | "document.overdue"
  | "case.opened"
  | "case.status_changed"
  | "case.closed"
  | "cbo.acknowledgment"
  | "cbo.status_update"
  | "supervisor.annotation";

export type CoordinationEventType =
  | "coordination.referral_stalled"
  | "coordination.sla_breached"
  | "coordination.external_ack_delayed"
  | "coordination.repeated_handoff_failure";

// ============================================================
// ENTITY INTERFACES
// ============================================================

export interface PlatformCase {
  id: string;
  caseId: string; // Human-readable ID (e.g., "CASE-2024-0142")
  program: string;
  status: CaseStatus;
  activeReferrals: number;
  stalledItems: number;
  lastEventAt: string;
  createdAt: string;
}

export interface Referral {
  id: string;
  referralId: string; // Human-readable (e.g., "REF-2024-0089")
  caseId: string;
  cboId: string;
  cboName: string;
  state: ReferralState;
  serviceType: string;
  slaDeadline: string;
  slaStatus: "on_track" | "at_risk" | "breached";
  slaRemaining: string; // e.g., "72h remaining" or "Breach +2d"
  lastUpdatedAt: string;
  createdAt: string;
  stateHistory: { state: ReferralState; timestamp: string }[];
}

export interface CBO {
  id: string;
  name: string;
  serviceCategories: string[];
  avgAcknowledgeTime: string;
  last30dReferrals: number;
  contactEmail: string;
  contactPhone: string;
  address: string;
}

export interface PlatformDocument {
  id: string;
  documentId: string; // Human-readable (e.g., "DOC-2024-0201")
  caseId: string;
  type: string;
  requestedAt: string;
  dueDate: string;
  status: DocumentStatus;
  retention: "ephemeral" | "program_configured";
  receivedAt?: string;
}

export interface PlatformEvent {
  id: string;
  eventType: PlatformEventType;
  caseId: string;
  referralId?: string;
  documentId?: string;
  source: EventSource;
  severity: EventSeverity;
  description: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface CoordinationSignal {
  id: string;
  eventType: CoordinationEventType;
  caseId: string;
  referralId?: string;
  cboName?: string;
  program: string;
  severity: EventSeverity;
  title: string;
  description: string;
  timestamp: string;
  metadata: {
    daysStalled?: number;
    slaDuration?: string;
    ackDelayHours?: number;
    failureCount?: number;
    supportingCounts?: Record<string, number>;
  };
}

// ============================================================
// FILTER INTERFACES
// ============================================================

export interface PlatformEventFilters {
  eventTypes?: PlatformEventType[];
  sources?: EventSource[];
  severities?: EventSeverity[];
  timeRange?: { start: string; end: string };
  caseId?: string;
  program?: string;
}

export interface CaseFilters {
  status?: CaseStatus;
  program?: string;
  hasStalled?: boolean;
}

export interface ReferralFilters {
  states?: ReferralState[];
  slaStatus?: ("on_track" | "at_risk" | "breached")[];
  cboId?: string;
}
