import { Link } from "react-router-dom";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

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
        <div className="bg-card rounded-xl shadow-card flex flex-col flex-1 min-h-0 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-4 pb-3 flex-shrink-0">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-status-success/10 flex items-center justify-center">
                <Calendar className="h-4 w-4 text-status-success" />
              </div>
              <span className="text-base">Today's Schedule</span>
            </h3>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              <span>{scheduleItems.length} items</span>
            </div>
          </div>

          <Separator className="mx-4 bg-border" />

          {/* Schedule Items - Scrollable */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {scheduleItems.map((item, index) => {
              const Icon = item.icon;
              return (
                <div key={item.id}>
                  <div className="flex gap-3 py-3.5 px-2 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer">
                    <div
                      className={cn(
                        "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0",
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
                      <p className="text-sm text-muted-foreground truncate mt-0.5">
                        {item.title}
                      </p>
                      <p className="text-xs font-medium text-foreground/70 mt-1.5">
                        {item.time}
                      </p>
                    </div>
                  </div>
                  {index < scheduleItems.length - 1 && (
                    <Separator className="my-1.5 bg-border/40" />
                  )}
                </div>
              );
            })}
          </div>

          {/* View Full Calendar Link */}
          <div className="p-4 pt-0 flex-shrink-0">
            <Link
              to="/calendar"
              className="flex items-center justify-between w-full px-4 py-3 bg-muted/50 hover:bg-muted rounded-lg text-sm text-primary hover:text-primary/80 transition-colors font-medium"
            >
              <span>View Full Calendar</span>
              <ChevronRight className="h-4 w-4" />
            </Link>
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

