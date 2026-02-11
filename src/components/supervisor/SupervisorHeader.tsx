/**
 * Supervisor Header Component
 * 
 * Updated for real auth — no more mock user prop.
 */

import { GuardedLink } from "@/components/navigation/GuardedLink";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useTourReplay } from "@/components/tour/useTourReplay";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { 
  Eye, 
  ChevronLeft, 
  Shield,
  LogOut,
  ChevronDown,
  Map,
} from "lucide-react";
import { OrphanCleanupButton } from "./OrphanCleanupButton";
import { supabase } from "@/integrations/supabase/client";

export function SupervisorHeader() {
  const { profile } = useAuth();
  const { replayTour } = useTourReplay("supervisor");
  
  const initials = profile?.display_name
    ? profile.display_name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)
    : "?";

  return (
    <header className="h-14 border-b border-border bg-card px-4 flex items-center justify-between flex-shrink-0">
      <div className="flex items-center gap-4">
        <GuardedLink to="/dashboard">
          <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground">
            <ChevronLeft className="h-4 w-4" />
            Dashboard
          </Button>
        </GuardedLink>

        <Separator orientation="vertical" className="h-6" />

        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[hsl(var(--status-info)/0.12)] flex items-center justify-center">
            <Eye className="h-5 w-5 text-[hsl(var(--status-info))]" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-foreground">The Eye</h1>
            <p className="text-xs text-muted-foreground">Audit & Trust Surface</p>
          </div>
        </div>

        {import.meta.env.DEV && (
          <Badge variant="outline" className="text-xs font-normal">DEV</Badge>
        )}
      </div>

      <div className="flex items-center gap-4">
        <OrphanCleanupButton />
        
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Shield className="h-4 w-4 text-[hsl(var(--status-success))]" />
          <span>No PHI Zone</span>
        </div>

        <Separator orientation="vertical" className="h-6" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2 px-2" aria-label="User menu">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="bg-primary text-primary-foreground text-xs font-medium">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium text-foreground">{profile?.display_name}</span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={replayTour} className="gap-2">
              <Map className="h-3.5 w-3.5" />
              Replay tour
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={async () => {
                await supabase.auth.signOut();
                window.location.href = "/login";
              }}
              className="gap-2"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
