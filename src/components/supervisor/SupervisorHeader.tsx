/**
 * Supervisor Header Component
 */

import { Link } from "react-router-dom";
import { MockUser, ROLE_DISPLAY_NAMES, ROLE_COLORS } from "@/lib/rbac/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { 
  Eye, 
  ChevronLeft, 
  Shield,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { UserSwitcher } from "./UserSwitcher";

interface SupervisorHeaderProps {
  user: MockUser | null;
}

export function SupervisorHeader({ user }: SupervisorHeaderProps) {
  return (
    <header className="h-14 border-b border-border bg-card px-4 flex items-center justify-between flex-shrink-0">
      <div className="flex items-center gap-4">
        {/* Back to Dashboard */}
        <Link to="/dashboard">
          <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground">
            <ChevronLeft className="h-4 w-4" />
            Dashboard
          </Button>
        </Link>

        <Separator orientation="vertical" className="h-6" />

        {/* Eye Logo & Title */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[hsl(var(--status-info)/0.12)] flex items-center justify-center">
            <Eye className="h-5 w-5 text-[hsl(var(--status-info))]" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-foreground">The Eye</h1>
            <p className="text-xs text-muted-foreground">Audit & Trust Surface</p>
          </div>
        </div>

        {/* Environment Badge */}
        <Badge variant="outline" className="text-xs font-normal">
          DEV
        </Badge>
      </div>

      <div className="flex items-center gap-4">
        {/* No PHI Indicator */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Shield className="h-4 w-4 text-[hsl(var(--status-success))]" />
          <span>No PHI Zone</span>
        </div>

        <Separator orientation="vertical" className="h-6" />

        {/* User Info & Switcher */}
        <UserSwitcher currentUser={user} />
      </div>
    </header>
  );
}
