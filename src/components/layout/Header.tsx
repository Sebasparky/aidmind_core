import { Search, Bell, ChevronDown, X, Check, Activity, BookOpen } from "lucide-react";
import { AidMindBrand } from "@/components/brand/AidMindBrand";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useNavigate } from "react-router-dom";
import { useNavigationGuard } from "@/contexts/NavigationGuardContext";
import { useDashboard } from "@/contexts/DashboardContext";
import { useAuth } from "@/contexts/AuthContext";
import { useTourReplay } from "@/components/tour/useTourReplay";
import { useRecentEyeEvents } from "@/hooks/useRecentEyeEvents";
import { useUnreadActivity } from "@/hooks/useUnreadActivity";
import { useTenant } from "@/hooks/useTenant";
import { Map } from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { useDebounce } from "@/hooks/use-debounce";

/** Format event type for display */
function humanizeEventType(eventType: string): string {
  return eventType
    .replace(/_/g, " ")
    .replace(/\./g, " ")
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 1000 / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  return `${diffDays}d ago`;
}

export function Header() {
  const navigate = useNavigate();
  const { guardActive, guardedNavigate } = useNavigationGuard();
  const { searchQuery, setSearchQuery, clearSearch } = useDashboard();
  const { profile, role, signOut } = useAuth();
  const { replayTour } = useTourReplay("caseworker");
  const { tenant } = useTenant();
  const { events } = useRecentEyeEvents(10);
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const debouncedSearch = useDebounce(localSearch, 200);

  // Derive latest activity timestamp from events
  const latestActivityAt = useMemo(() => {
    if (events.length === 0) return null;
    return events[0].createdAt; // events are ordered desc by createdAt
  }, [events]);

  const { hasUnread, markSeen } = useUnreadActivity({
    tenantId: tenant?.tenantId ?? null,
    latestActivityAt,
  });

  useEffect(() => {
    setSearchQuery(debouncedSearch);
  }, [debouncedSearch, setSearchQuery]);

  const initials = profile?.display_name
    ? profile.display_name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)
    : "?";

  const roleLabel = role ? role.charAt(0).toUpperCase() + role.slice(1) : "";

  const handleLogoClick = () => {
    if (guardActive) {
      guardedNavigate("/dashboard");
    } else {
      clearSearch();
      setLocalSearch("");
      navigate("/dashboard");
    }
  };

  const handleClearSearch = () => {
    setLocalSearch("");
    clearSearch();
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };

  const handleActivityOpen = (open: boolean) => {
    if (open) {
      markSeen();
    }
  };

  return (
    <header className="h-16 border-b border-border bg-card px-6 flex items-center justify-between">
      {/* Left: Logo */}
      <AidMindBrand size="md" showWordmark={false} onClick={handleLogoClick} />

      {/* Center: Retrieve + Search */}
      <div className="flex items-center flex-1 max-w-2xl mx-8 gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="flex-shrink-0 gap-2 text-muted-foreground hover:text-foreground font-medium"
          onClick={() => {
            if (guardActive) {
              guardedNavigate("/retrieve");
            } else {
              navigate("/retrieve");
            }
          }}
          aria-label="Open Retrieve"
        >
          <BookOpen className="h-4 w-4" />
          <span className="hidden sm:inline">Retrieve</span>
        </Button>
        <div className="h-5 w-px bg-border flex-shrink-0" />
        <div className="flex-1" data-tour="dashboard-search">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search sessions, tools..."
            className="pl-10 pr-10 h-10 bg-secondary border-border [&::-webkit-search-cancel-button]:hidden"
            aria-label="Search sessions and tools"
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
          />
          {localSearch && (
            <button
              onClick={handleClearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Right: Activity + User */}
      <div className="flex items-center gap-4">
        {/* Recent Activity Dropdown */}
        <DropdownMenu onOpenChange={handleActivityOpen}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative" aria-label="Recent activity">
              <Activity className="h-5 w-5 text-muted-foreground" />
              {hasUnread && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-primary rounded-full animate-pulse" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80 bg-popover">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <span className="text-sm font-medium text-foreground">Recent Activity</span>
              {events.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    markSeen();
                  }}
                >
                  <Check className="h-3 w-3 mr-1" />
                  Mark all read
                </Button>
              )}
            </div>
            <div className="max-h-[300px] overflow-y-auto">
              {events.length === 0 ? (
                <div className="px-3 py-6 text-center">
                  <p className="text-sm text-muted-foreground">No recent activity</p>
                </div>
              ) : (
                events.map((event) => (
                  <DropdownMenuItem key={event.id} className="flex items-start gap-3 px-3 py-3 cursor-default">
                    <div className="flex-shrink-0 mt-0.5">
                      <Activity className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm leading-snug text-foreground">
                        {humanizeEventType(event.eventType)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatRelativeTime(event.createdAt)}
                      </p>
                    </div>
                  </DropdownMenuItem>
                ))
              )}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2 px-2" aria-label="User menu">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary text-primary-foreground text-sm font-medium">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48 bg-popover">
            <div className="px-2 py-1.5">
              <p className="text-sm text-foreground font-medium">{profile?.display_name}</p>
              {roleLabel && (
                <p className="text-xs text-muted-foreground">{roleLabel}</p>
              )}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={replayTour} className="gap-2">
              <Map className="h-3.5 w-3.5" />
              Replay tour
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut}>Sign out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
