/**
 * Development-Only Role Toggle
 *
 * Allows switching between Caseworker / Supervisor / Auditor views
 * for layout inspection and design review.
 *
 * GATED: Only renders when import.meta.env.DEV is true.
 * NOT persisted. NOT backed by real auth. NOT available in production.
 *
 * Now uses devRoleOverride from AuthContext instead of mock user switching.
 */

import { useAuth, type AppRole } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const ROLE_DISPLAY: Record<AppRole, string> = {
  caseworker: "Caseworker",
  supervisor: "Supervisor",
  auditor: "Auditor",
};

const ROLE_ROUTES: Record<AppRole, string> = {
  caseworker: "/dashboard",
  supervisor: "/supervisor",
  auditor: "/auditor",
};

const TOGGLE_ROLES: AppRole[] = ["caseworker", "supervisor", "auditor"];

export function DevRoleToggle() {
  // Gate on VITE_DEV_MODE env var (false in production builds)
  if (import.meta.env.VITE_DEV_MODE !== 'true') return null;

  const { role, devRoleOverride, setDevRoleOverride, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  // Only show when authenticated
  if (!isAuthenticated) return null;

  const activeRole = devRoleOverride ?? role ?? "caseworker";

  const handleSwitch = (r: AppRole) => {
    if (r === activeRole) return;
    setDevRoleOverride(r);
    navigate(ROLE_ROUTES[r]);
  };

  const handleClear = () => {
    setDevRoleOverride(null);
    if (role) navigate(ROLE_ROUTES[role]);
  };

  return (
    <div className="fixed bottom-4 left-4 z-50 flex flex-col gap-2">
      <div className="bg-card border border-border rounded-lg shadow-lg p-3 min-w-[220px]">
        <div className="flex items-center gap-2 mb-2">
          <Badge
            variant="outline"
            className="text-[10px] font-mono uppercase tracking-wider border-destructive text-destructive bg-destructive/5"
          >
            DEV MODE
          </Badge>
          {devRoleOverride && (
            <button
              onClick={handleClear}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors ml-auto"
            >
              Reset
            </button>
          )}
        </div>

        <div className="flex flex-col gap-1">
          {TOGGLE_ROLES.map((r) => (
            <button
              key={r}
              onClick={() => handleSwitch(r)}
              className={cn(
                "w-full text-left px-3 py-1.5 rounded text-sm transition-colors",
                r === activeRole
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {ROLE_DISPLAY[r]}
            </button>
          ))}
        </div>

        <p className="text-[10px] text-muted-foreground/60 mt-2 leading-tight">
          Role simulation for development only. Production access is enforced server-side.
        </p>
      </div>
    </div>
  );
}
