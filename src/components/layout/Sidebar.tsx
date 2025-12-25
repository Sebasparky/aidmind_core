import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Calendar,
  CalendarDays,
  CalendarRange,
  Clock,
  Phone,
  Users,
  AlertCircle,
  ChevronRight,
  MoreHorizontal,
  Settings,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const navItems = [
  { id: "today", label: "Today", icon: Clock, active: true },
  { id: "tomorrow", label: "Tomorrow", icon: CalendarDays },
  { id: "week", label: "This Week", icon: CalendarRange },
  { id: "calendar", label: "Calendar", icon: Calendar, href: "/calendar" },
];

const scheduleItems = [
  {
    id: 1,
    type: "call" as const,
    icon: Phone,
    title: "Housing assistance intake retake",
    time: "4:30 - 5:00 pm",
  },
  {
    id: 2,
    type: "meeting" as const,
    icon: Users,
    title: "Shelter coordinator check-in",
    time: "2:00 - 2:30 pm",
  },
  {
    id: 3,
    type: "deadline" as const,
    icon: AlertCircle,
    title: "Submit consent form",
    subtitle: "Due Today",
  },
];

const typeColors = {
  call: "text-schedule-call bg-schedule-call/10",
  meeting: "text-schedule-meeting bg-schedule-meeting/10",
  deadline: "text-schedule-deadline bg-schedule-deadline/10",
};

export function Sidebar() {
  const location = useLocation();
  const [activeNav, setActiveNav] = useState("today");

  return (
    <aside className="w-[280px] bg-sidebar flex flex-col h-full">
      {/* Navigation */}
      <nav className="p-4 space-y-1" role="navigation" aria-label="Time filters">
        {navItems.map((item) => {
          const isActive = item.id === activeNav;
          const Icon = item.icon;

          const content = (
            <button
              onClick={() => setActiveNav(item.id)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                isActive
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </button>
          );

          if (item.href) {
            return (
              <Link key={item.id} to={item.href}>
                {content}
              </Link>
            );
          }

          return <div key={item.id}>{content}</div>;
        })}
      </nav>

      <div className="px-4">
        <Separator className="bg-sidebar-border" />
      </div>

      {/* Today Schedule Card */}
      <div className="p-4 flex-1">
        <div className="bg-card rounded-xl p-4 shadow-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <div className="w-6 h-6 rounded bg-status-success/10 flex items-center justify-center">
                <Calendar className="h-3.5 w-3.5 text-status-success" />
              </div>
              Today
            </h3>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              aria-label="Schedule options"
            >
              <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
            </Button>
          </div>

          <div className="space-y-3">
            {scheduleItems.map((item, index) => {
              const Icon = item.icon;
              return (
                <div key={item.id}>
                  <div className="flex gap-3">
                    <div
                      className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
                        typeColors[item.type]
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground capitalize">
                        {item.type === "call"
                          ? "Phone call"
                          : item.type === "meeting"
                          ? "Meeting"
                          : "Deadline"}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {item.title}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {item.time || item.subtitle}
                      </p>
                    </div>
                  </div>
                  {index < scheduleItems.length - 1 && (
                    <Separator className="my-3 bg-border" />
                  )}
                </div>
              );
            })}
          </div>

          <Link
            to="/calendar"
            className="flex items-center justify-between mt-4 pt-3 border-t border-border text-sm text-primary hover:text-primary/80 transition-colors font-medium"
          >
            <span>View Full Calendar</span>
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* Bottom: Date + User */}
      <div className="p-4 mt-auto">
        <p className="text-sm text-sidebar-muted mb-3">Tuesday, April 25</p>
        <div className="flex items-center justify-between bg-sidebar-accent rounded-lg px-3 py-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-sidebar-primary flex items-center justify-center text-xs font-medium text-sidebar-primary-foreground">
              JS
            </div>
            <span className="text-sm text-sidebar-accent-foreground font-medium">
              J. Smith
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-sidebar-muted" />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-sidebar-muted hover:text-sidebar-accent-foreground"
            aria-label="Settings"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </aside>
  );
}
