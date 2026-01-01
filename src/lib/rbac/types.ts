/**
 * Mock RBAC System for Supervisor UI
 * 
 * This is a placeholder implementation for role-based access control.
 * In production, this would integrate with Supabase Auth and a proper
 * user_roles table as specified in the security guidelines.
 */

export type UserRole = "caseworker" | "supervisor" | "auditor" | "support";

export interface MockUser {
  id: string;
  email: string;
  name: string;
  initials: string;
  role: UserRole;
  tenant_id: string;
  // Supervisors have scope over specific cases
  case_scope?: string[]; // null means all cases in tenant
}

// Mock users for development
export const MOCK_USERS: Record<string, MockUser> = {
  caseworker_1: {
    id: "user_001",
    email: "j.smith@aidmind.demo",
    name: "J. Smith",
    initials: "JS",
    role: "caseworker",
    tenant_id: "tenant_aidmind_demo",
  },
  caseworker_2: {
    id: "user_002",
    email: "m.johnson@aidmind.demo",
    name: "M. Johnson",
    initials: "MJ",
    role: "caseworker",
    tenant_id: "tenant_aidmind_demo",
  },
  supervisor_1: {
    id: "user_003",
    email: "s.williams@aidmind.demo",
    name: "S. Williams",
    initials: "SW",
    role: "supervisor",
    tenant_id: "tenant_aidmind_demo",
    case_scope: undefined, // Can see all cases in tenant
  },
  auditor_1: {
    id: "user_004",
    email: "a.davis@aidmind.demo",
    name: "A. Davis",
    initials: "AD",
    role: "auditor",
    tenant_id: "tenant_aidmind_demo",
  },
  support_1: {
    id: "user_005",
    email: "t.support@aidmind.internal",
    name: "T. Support",
    initials: "TS",
    role: "support",
    tenant_id: "tenant_aidmind_internal",
  },
};

// Permission definitions
export interface Permission {
  action: string;
  resource: string;
}

// Role-based permissions
export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  caseworker: [
    { action: "view", resource: "own_session_events" },
    { action: "create", resource: "session" },
    { action: "edit", resource: "own_draft" },
  ],
  supervisor: [
    { action: "view", resource: "team_session_events" },
    { action: "view", resource: "event_feed" },
    { action: "view", resource: "purge_proof" },
    { action: "view", resource: "errors_warnings" },
    { action: "filter", resource: "events" },
    { action: "export", resource: "event_report" },
  ],
  auditor: [
    { action: "view", resource: "all_events" },
    { action: "view", resource: "event_feed" },
    { action: "view", resource: "purge_proof" },
    { action: "view", resource: "errors_warnings" },
    { action: "filter", resource: "events" },
    { action: "export", resource: "event_report" },
    { action: "export", resource: "audit_log" },
  ],
  support: [
    { action: "view", resource: "operational_telemetry" },
    // No case/session binding unless break-glass
  ],
};

// Check if a role has a specific permission
export function hasPermission(
  role: UserRole,
  action: string,
  resource: string
): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  return permissions.some(
    (p) => p.action === action && p.resource === resource
  );
}

// Check if a role can access the Supervisor UI
export function canAccessSupervisorUI(role: UserRole): boolean {
  return ["supervisor", "auditor"].includes(role);
}

// Check if a role can view a specific case's events
export function canViewCaseEvents(
  user: MockUser,
  caseId: string
): boolean {
  if (user.role === "auditor") return true;
  if (user.role === "supervisor") {
    if (!user.case_scope) return true; // No scope restriction = all cases
    return user.case_scope.includes(caseId);
  }
  return false;
}

// Role display names
export const ROLE_DISPLAY_NAMES: Record<UserRole, string> = {
  caseworker: "Caseworker",
  supervisor: "Supervisor",
  auditor: "Auditor",
  support: "Support Engineer",
};

// Role colors for UI
export const ROLE_COLORS: Record<UserRole, string> = {
  caseworker: "bg-[hsl(var(--status-info-muted))] text-[hsl(var(--status-info-muted-foreground))]",
  supervisor: "bg-[hsl(var(--status-success-muted))] text-[hsl(var(--status-success-muted-foreground))]",
  auditor: "bg-[hsl(var(--status-warning-muted))] text-[hsl(var(--status-warning-muted-foreground))]",
  support: "bg-[hsl(var(--status-neutral-muted))] text-[hsl(var(--status-neutral-muted-foreground))]",
};
