/**
 * RouteGuard — Enforces auth, status, and role-based access.
 *
 * Rules:
 * - Not authenticated → /login
 * - Status !== active → /access-pending
 * - Role mismatch → redirect to role's home
 */

import { Navigate } from "react-router-dom";
import { useAuth, type AppRole } from "@/contexts/AuthContext";
import { AuthLoadingScreen } from "./AuthLoadingScreen";

const ROLE_HOME: Record<AppRole, string> = {
  caseworker: "/dashboard",
  supervisor: "/supervisor",
  auditor: "/auditor",
};

interface RouteGuardProps {
  /** Which roles are allowed on this route */
  allowedRoles: AppRole[];
  children: React.ReactNode;
}

export function RouteGuard({ allowedRoles, children }: RouteGuardProps) {
  const { isAuthenticated, loading, status, role } = useAuth();

  if (loading) {
    return <AuthLoadingScreen />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (status !== "active" || !role) {
    return <Navigate to="/access-pending" replace />;
  }

  if (!allowedRoles.includes(role)) {
    return <Navigate to={ROLE_HOME[role] ?? "/access-pending"} replace />;
  }

  return <>{children}</>;
}
