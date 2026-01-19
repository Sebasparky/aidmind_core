import { GuardedLink } from "@/components/navigation/GuardedLink";
import {
  Calendar,
  Phone,
  Users,
  AlertCircle,
  ChevronRight,
  Settings,
  FileText,
  ChevronDown,
  Clock,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { V1_SHOW_PLACEHOLDER_SCHEDULE } from "@/config/features";

const scheduleItems = [
  {
    id: 1,
    type: "call" as const,
    icon: Phone,
    title: "Housing assistance intake retake",
    time: "4:30 – 5:00 pm",
  },
  {
    id: 2,
    type: "meeting" as const,
    icon: Users,
    title: "Shelter coordinator check-in",
    time: "2:00 – 2:30 pm",
  },
  {
    id: 3,
    type: "deadline" as const,
    icon: AlertCircle,
    title: "Submit consent form",
    time: "Due Today",
  },
  {
    id: 4,
    type: "document" as const,
    icon: FileText,
    title: "Review case documentation",
    time: "3:00 – 3:30 pm",
  },
  {
    id: 5,
    type: "call" as const,
    icon: Phone,
    title: "Follow-up with client B.R.",
    time: "5:30 – 6:00 pm",
  },
];

const typeColors = {
  call: "text-schedule-call bg-[hsl(var(--schedule-call)/0.12)]",
  meeting: "text-schedule-meeting bg-[hsl(var(--schedule-meeting)/0.12)]",
  deadline: "text-schedule-deadline bg-[hsl(var(--schedule-deadline)/0.12)]",
  document: "text-schedule-document bg-[hsl(var(--schedule-document)/0.12)]",
};

export function Sidebar() {
  return (
    <aside className="w-[280px] bg-sidebar flex flex-col h-full self-stretch flex-shrink-0">
      {/* Today Schedule Block - Primary Content */}
      <div className="p-4 flex-1 flex flex-col min-h-0">
        <div className="bg-card rounded-xl border border-border flex flex-col flex-1 min-h-0 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-4 pb-3 flex-shrink-0">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-[hsl(var(--status-success)/0.08)] flex items-center justify-center">
                <Calendar className="h-4 w-4 text-status-success" />
              </div>
              <span className="text-base">Today's Schedule</span>
            </h3>
            {V1_SHOW_PLACEHOLDER_SCHEDULE && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground/70">
                <Clock className="h-3.5 w-3.5" />
                <span>{scheduleItems.length} items</span>
              </div>
            )}
          </div>

          <Separator className="mx-4 bg-border/80" />

          {/* Schedule Items - Scrollable or Empty State */}
          <div className="flex-1 overflow-y-auto p-4 space-y-1">
            {V1_SHOW_PLACEHOLDER_SCHEDULE ? (
              // Placeholder schedule items
              scheduleItems.map((item, index) => {
                const Icon = item.icon;
                return (
                  <div key={item.id}>
                    <div className="flex gap-3 py-4 px-2 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer">
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
                            : item.type === "deadline"
                            ? "Deadline"
                            : "Document Review"}
                        </p>
                        <p className="text-sm text-muted-foreground/80 truncate mt-0.5">
                          {item.title}
                        </p>
                        <p className="text-xs font-medium text-foreground/60 mt-1.5">
                          {item.time}
                        </p>
                      </div>
                    </div>
                    {index < scheduleItems.length - 1 && (
                      <Separator className="my-2 bg-border/50" />
                    )}
                  </div>
                );
              })
            ) : (
              // Empty state when placeholder is disabled
              <div className="flex flex-col items-center justify-center h-full text-center py-8">
                <div className="w-10 h-10 rounded-lg bg-muted/50 flex items-center justify-center mb-3">
                  <Info className="h-5 w-5 text-muted-foreground/50" />
                </div>
                <p className="text-sm text-muted-foreground">
                  Platform signals will appear here when connected.
                </p>
              </div>
            )}
          </div>

          {/* View Full Calendar Link - Quieter */}
          <div className="p-4 pt-0 flex-shrink-0">
            <GuardedLink
              to="/calendar"
              className="flex items-center justify-between w-full px-4 py-2.5 bg-muted/30 hover:bg-muted/50 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <span>View Full Calendar</span>
              <ChevronRight className="h-4 w-4" />
            </GuardedLink>
          </div>
        </div>
      </div>

      {/* Bottom: Date + User - Pinned */}
      <div className="p-4 pt-0 mt-auto flex-shrink-0">
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

