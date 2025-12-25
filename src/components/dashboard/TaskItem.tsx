import { ChevronDown, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface Task {
  id: string;
  title: string;
  client: string;
  caseTag: string;
  dueDate: string;
  status: "high" | "overdue" | "info" | "normal";
}

interface TaskItemProps {
  task: Task;
}

const statusConfig = {
  high: {
    label: "High",
    className: "badge-danger font-medium",
  },
  overdue: {
    label: "Overdue",
    className: "bg-status-danger text-status-danger-foreground font-medium",
  },
  info: {
    label: "Info",
    className: "badge-info font-medium",
  },
  normal: {
    label: "",
    className: "",
  },
};

export function TaskItem({ task }: TaskItemProps) {
  const status = statusConfig[task.status];

  return (
    <div className="group flex items-start gap-4 p-4 hover:bg-secondary/50 rounded-lg transition-colors">
      <Checkbox
        id={`task-${task.id}`}
        className="mt-1 border-muted-foreground/40"
        aria-label={`Mark "${task.title}" as complete`}
      />

      <div className="flex-1 min-w-0">
        <label
          htmlFor={`task-${task.id}`}
          className="text-sm font-medium text-foreground cursor-pointer block"
        >
          {task.title}
        </label>

        <div className="flex items-center gap-1 mt-1">
          <span className="text-xs text-muted-foreground">
            Client: {task.client}
          </span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </div>

        <div className="mt-2">
          <Badge
            variant="outline"
            className="text-xs font-normal bg-background border-border"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-primary mr-1.5" />
            {task.caseTag}
          </Badge>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>{task.dueDate}</span>
          <ChevronDown className="h-3 w-3" />
        </div>

        {status.label && (
          <Badge
            className={cn(
              "text-xs px-2 py-0.5 border-0",
              status.className
            )}
          >
            {status.label}
          </Badge>
        )}

        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label="Task options"
        >
          <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
        </Button>
      </div>
    </div>
  );
}
