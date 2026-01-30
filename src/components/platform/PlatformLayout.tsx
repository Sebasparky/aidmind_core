/**
 * Platform Layout - Shared layout for all /platform routes
 * 
 * Features a left sidebar navigation and main content area.
 * Matches AidMind design system (clean, minimal, gov-tech feel).
 */

import { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  LayoutDashboard,
  Briefcase,
  ArrowLeftRight,
  Building2,
  FileText,
  ScrollText,
  Info,
  Eye,
  ClipboardList,
} from "lucide-react";

interface PlatformLayoutProps {
  children: ReactNode;
}

const NAV_ITEMS = [
  { path: "/platform", label: "Overview", icon: LayoutDashboard, end: true },
  { path: "/platform/cases", label: "Cases", icon: Briefcase },
  { path: "/platform/referrals", label: "Referrals", icon: ArrowLeftRight },
  { path: "/platform/providers", label: "Providers (CBOs)", icon: Building2 },
  { path: "/platform/documents", label: "Documents", icon: FileText },
  { path: "/platform/events", label: "Events & Audit", icon: ScrollText },
  { path: "/platform/progress", label: "Progress", icon: ClipboardList, internal: true },
];

interface NavItem {
  path: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
  internal?: boolean;
}

export function PlatformLayout({ children }: PlatformLayoutProps) {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-canvas flex">
      {/* Sidebar */}
      <aside className="w-64 bg-sidebar-background border-r border-sidebar-border flex flex-col">
        {/* Logo / Header */}
        <div className="p-4 border-b border-sidebar-border">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-sidebar-primary flex items-center justify-center">
              <ArrowLeftRight className="h-4 w-4 text-sidebar-primary-foreground" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-sidebar-foreground">The Platform</h1>
              <p className="text-xs text-sidebar-muted">Coordination Layer</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50",
                  item.internal && "border-t border-sidebar-border mt-3 pt-3"
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
              {item.internal && (
                <Badge variant="outline" className="ml-auto text-[10px] px-1.5 py-0 bg-muted text-muted-foreground">
                  Internal
                </Badge>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Footer / Quick Links */}
        <div className="p-4 border-t border-sidebar-border space-y-3">
          <NavLink
            to="/supervisor"
            className="flex items-center gap-2 text-xs text-sidebar-muted hover:text-sidebar-foreground transition-colors"
          >
            <Eye className="h-3 w-3" />
            Go to The Eye (Supervisor)
          </NavLink>
          
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-2 text-xs text-sidebar-muted cursor-help">
                <Info className="h-3 w-3" />
                <span>No PHI Zone</span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-xs">
              <p className="text-xs">
                This interface displays coordination signals and metadata only. 
                No Protected Health Information (PHI) or client content is shown.
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <header className="h-14 border-b border-border bg-card flex items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-foreground">
              {NAV_ITEMS.find(
                (item) =>
                  item.end
                    ? location.pathname === item.path
                    : location.pathname.startsWith(item.path) && item.path !== "/platform"
              )?.label || "Overview"}
            </h2>
            <Badge variant="outline" className="text-xs bg-muted text-muted-foreground">
              Read-only prototype
            </Badge>
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="secondary" className="text-xs cursor-help">
                <Info className="h-3 w-3 mr-1" />
                Signals, not productivity
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <p className="text-xs">
                These are coordination signals for operational awareness. 
                They do not measure or represent worker productivity.
              </p>
            </TooltipContent>
          </Tooltip>
        </header>

        {/* Page Content */}
        <div className="flex-1 overflow-auto p-6">
          {children}
        </div>
      </main>
    </div>
  );
}
