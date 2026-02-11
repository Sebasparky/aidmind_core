import { Search, Bell, ChevronDown, X, Check, FileText, Calendar, MessageSquare, RotateCcw } from "lucide-react";
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
import { useOnboardingState } from "@/components/onboarding/WelcomeModal";
import { resetContextualTooltips } from "@/components/onboarding/ContextualTooltips";
import { useTourReplay } from "@/components/tour/useTourReplay";
import { Map } from "lucide-react";
import { useState, useEffect } from "react";
import { useDebounce } from "@/hooks/use-debounce";

// Mock updates data
const mockUpdates = [
  { id: "1", icon: FileText, description: "Case notes approved for A. J.", timestamp: "2h ago", read: false },
  { id: "2", icon: Calendar, description: "Task due date changed: Follow up on housing", timestamp: "4h ago", read: false },
  { id: "3", icon: MessageSquare, description: "Supervisor comment on Medical support case", timestamp: "Yesterday", read: true },
  { id: "4", icon: FileText, description: "Document review completed for C. T.", timestamp: "2 days ago", read: true },
];

export function Header() {
  const navigate = useNavigate();
  const { guardActive, guardedNavigate } = useNavigationGuard();
  const { searchQuery, setSearchQuery, clearSearch } = useDashboard();
  const { profile, signOut } = useAuth();
  const { replay } = useOnboardingState();
  const { replayTour } = useTourReplay("caseworker");
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const debouncedSearch = useDebounce(localSearch, 200);
  const [updates, setUpdates] = useState(mockUpdates);

  const unreadCount = updates.filter((u) => !u.read).length;

  useEffect(() => {
    setSearchQuery(debouncedSearch);
  }, [debouncedSearch, setSearchQuery]);

  const initials = profile?.display_name
    ? profile.display_name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)
    : "?";

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

  const handleMarkAllRead = () => {
    setUpdates((prev) => prev.map((u) => ({ ...u, read: true })));
  };

  const handleReplayOnboarding = () => {
    resetContextualTooltips();
    replay();
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };

  return (
    <header className="h-16 border-b border-border bg-card px-6 flex items-center justify-between">
      {/* Left: Logo */}
      <button
        onClick={handleLogoClick}
        className="flex items-center gap-2 hover:opacity-80 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-lg"
        aria-label="Go to dashboard"
      >
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-primary-foreground" stroke="currentColor" strokeWidth="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>
        <span className="text-xl font-semibold text-foreground">AidMind</span>
      </button>

      {/* Center: Search */}
      <div className="flex-1 max-w-xl mx-8">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search cases, tasks, notes..."
            className="pl-10 pr-10 h-10 bg-secondary border-border"
            aria-label="Search cases, tasks, and notes"
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

      {/* Right: Notifications + User */}
      <div className="flex items-center gap-4">
        {/* Bell/Updates Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative" aria-label="Recent updates">
              <Bell className="h-5 w-5 text-muted-foreground" />
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-status-danger rounded-full" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80 bg-popover">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <span className="text-sm font-medium text-foreground">Recent Updates</span>
              {unreadCount > 0 && (
                <button onClick={handleMarkAllRead} className="text-xs text-primary hover:text-primary/80 transition-colors flex items-center gap-1">
                  <Check className="h-3 w-3" />Mark all as read
                </button>
              )}
            </div>
            <div className="max-h-[300px] overflow-y-auto">
              {updates.map((update) => {
                const Icon = update.icon;
                return (
                  <DropdownMenuItem key={update.id} className="flex items-start gap-3 px-3 py-3 cursor-pointer">
                    <div className="flex-shrink-0 mt-0.5">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm leading-snug ${update.read ? "text-muted-foreground" : "text-foreground"}`}>
                        {update.description}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">{update.timestamp}</p>
                    </div>
                    {!update.read && (
                      <div className="flex-shrink-0 mt-1.5">
                        <span className="w-2 h-2 bg-primary rounded-full block" />
                      </div>
                    )}
                  </DropdownMenuItem>
                );
              })}
            </div>
            <DropdownMenuSeparator />
            <div className="px-3 py-2">
              <button disabled className="text-xs text-muted-foreground/60 cursor-not-allowed">
                View all updates
              </button>
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
            <div className="px-2 py-1.5 text-sm text-muted-foreground">{profile?.display_name}</div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleReplayOnboarding} className="gap-2">
              <RotateCcw className="h-3.5 w-3.5" />
              Replay onboarding
            </DropdownMenuItem>
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
