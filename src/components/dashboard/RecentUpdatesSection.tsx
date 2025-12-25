import { Clock, FileText, Calendar, MessageSquare, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, formatDistanceToNow } from "date-fns";

export interface RecentUpdate {
  id: string;
  type: "case_updated" | "task_due_changed" | "supervisor_comment" | "note_approved" | "task_completed";
  title: string;
  description: string;
  timestamp: Date;
  read?: boolean;
}

interface RecentUpdatesSectionProps {
  updates: RecentUpdate[];
  onUpdateClick?: (update: RecentUpdate) => void;
}

const updateIcons: Record<RecentUpdate["type"], React.ElementType> = {
  case_updated: FileText,
  task_due_changed: Calendar,
  supervisor_comment: MessageSquare,
  note_approved: CheckCircle2,
  task_completed: CheckCircle2,
};

const updateColors: Record<RecentUpdate["type"], string> = {
  case_updated: "text-status-info",
  task_due_changed: "text-status-warning",
  supervisor_comment: "text-primary",
  note_approved: "text-status-success",
  task_completed: "text-status-success",
};

export function RecentUpdatesSection({ updates, onUpdateClick }: RecentUpdatesSectionProps) {
  if (updates.length === 0) return null;

  // Only show max 5 recent updates
  const visibleUpdates = updates.slice(0, 5);

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <Clock className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-medium text-foreground">
          Recent Updates
        </h3>
      </div>
      
      <div className="space-y-1">
        {visibleUpdates.map((update) => {
          const Icon = updateIcons[update.type];
          const iconColor = updateColors[update.type];
          
          return (
            <button
              key={update.id}
              onClick={() => onUpdateClick?.(update)}
              className={cn(
                "w-full flex items-start gap-3 p-2.5 rounded-md text-left transition-colors",
                "hover:bg-secondary/50",
                !update.read && "bg-secondary/30"
              )}
            >
              <div className={cn("mt-0.5 flex-shrink-0", iconColor)}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className={cn(
                  "text-sm text-foreground truncate",
                  !update.read && "font-medium"
                )}>
                  {update.title}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {update.description}
                </p>
              </div>
              <span className="text-xs text-muted-foreground flex-shrink-0 mt-0.5">
                {formatDistanceToNow(update.timestamp, { addSuffix: false })}
              </span>
            </button>
          );
        })}
      </div>
      
      {updates.length > 5 && (
        <p className="text-xs text-muted-foreground text-center mt-3">
          +{updates.length - 5} more updates
        </p>
      )}
    </div>
  );
}
