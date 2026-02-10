/**
 * Development-Only Role Toggle
 *
 * Allows switching between Caseworker / Supervisor / Auditor views
 * for layout inspection and design review.
 *
 * GATED: Only renders when import.meta.env.DEV is true.
 * NOT persisted. NOT backed by real auth. NOT available in production.
 */

import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { MOCK_USERS, ROLE_DISPLAY_NAMES, type UserRole } from "@/lib/rbac/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const ROLE_TARGETS: Record<string, { userId: string; route: string }> = {
  caseworker: { userId: MOCK_USERS.caseworker_1.id, route: "/dashboard" },
  supervisor: { userId: MOCK_USERS.supervisor_1.id, route: "/supervisor" },
  auditor: { userId: MOCK_USERS.auditor_1.id, route: "/auditor" },
};

const TOGGLE_ROLES: UserRole[] = ["caseworker", "supervisor", "auditor"];

export function DevRoleToggle() {
  // Hard gate — tree-shaken in production builds
  if (!import.meta.env.DEV) return null;

  const { currentUser, switchUser } = useAuth();
  const navigate = useNavigate();
  const activeRole = currentUser?.role ?? "caseworker";

  const handleSwitch = (role: UserRole) => {
    if (role === activeRole) return;
    const target = ROLE_TARGETS[role];
    if (target) {
      switchUser(target.userId);
      navigate(target.route);
    }
  };

  return (
    <div className="fixed bottom-4 left-4 z-50 flex flex-col gap-2">
      {/* Toggle card */}
      <div className="bg-card border border-border rounded-lg shadow-lg p-3 min-w-[220px]">
        {/* DEV MODE label */}
        <div className="flex items-center gap-2 mb-2">
          <Badge
            variant="outline"
            className="text-[10px] font-mono uppercase tracking-wider border-destructive text-destructive bg-destructive/5"
          >
            DEV MODE
          </Badge>
        </div>

        {/* Role buttons */}
        <div className="flex flex-col gap-1">
          {TOGGLE_ROLES.map((role) => (
            <button
              key={role}
              onClick={() => handleSwitch(role)}
              className={cn(
                "w-full text-left px-3 py-1.5 rounded text-sm transition-colors",
                role === activeRole
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {ROLE_DISPLAY_NAMES[role]}
            </button>
          ))}
        </div>

        {/* Disclaimer */}
        <p className="text-[10px] text-muted-foreground/60 mt-2 leading-tight">
          Role simulation for development only. Production access is enforced server-side.
        </p>
      </div>
    </div>
  );
}
