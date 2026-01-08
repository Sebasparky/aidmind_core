/**
 * Governance Types for AI Usage Authorization
 * 
 * These types support the Supervisor Approval Gate feature.
 */

export type AIApprovalScope = "organization" | "workflow" | "session";

export type AIAuthorizationStatus = "approved" | "missing" | "revoked";

export interface AIUsageApproval {
  id: string;
  scope: AIApprovalScope;
  tenant_id: string;
  approved_by_role: "supervisor";
  approved_by_id: string;
  approval_policy_id: string;
  approved_at: string;
  revoked_at: string | null;
  expires_at: string | null;
}

export interface AuditorAccess {
  id: string;
  auditor_id: string;
  tenant_id: string;
  granted_by_role: "supervisor";
  granted_by_id: string;
  granted_at: string;
  expires_at: string;
  revoked_at: string | null;
}

export interface ComplianceExport {
  id: string;
  tenant_id: string;
  time_range_start: string;
  time_range_end: string;
  generated_by_role: "supervisor" | "auditor";
  generated_by_id: string;
  generated_at: string;
  export_hash: string;
}
