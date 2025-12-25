import { useState } from "react";
import { ChevronDown, MoreHorizontal, Clock, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Task } from "@/contexts/DashboardContext";
import { formatDistanceToNow } from "date-fns";

interface TaskItemProps {
  task: Task;
  onComplete: (taskId: string) => void;
  isCompleted?: boolean;
}

export function TaskItem({ task, onComplete, isCompleted = false }: TaskItemProps) {
  const [isAnimating, setIsAnimating] = useState(false);

  const isHighPriority = task.priority === "HIGH";
  const isDueToday = task.dueDate?.toLowerCase().includes("today");
  const isOverdue = task.dueDate?.toLowerCase().includes("overdue");

  const handleCheckboxChange = (checked: boolean) => {
    if (checked && !isCompleted) {
      setIsAnimating(true);
      // Brief animation before removal
      setTimeout(() => {
        onComplete(task.id);
      }, 200);
    }
  };

  const getStatusBadge = () => {
    if (isOverdue) {
      return { label: "Overdue", badgeClass: "badge-critical" };
    }
    if (isHighPriority) {
      return { label: "High", badgeClass: "badge-danger" };
    }
    return null;
  };

  const statusBadge = getStatusBadge();

  return (
    <div
      className={cn(
        "group flex items-start gap-4 py-6 px-4 hover:bg-secondary/30 transition-all relative",
        isHighPriority && !isCompleted && "priority-accent-high",
        isAnimating && "opacity-0 translate-x-2 line-through",
        isCompleted && "opacity-60"
      )}
      style={{
        transition: isAnimating ? "all 200ms ease-out" : "background-color 150ms ease",
      }}
    >
      <Checkbox
        id={`task-${task.id}`}
        checked={isCompleted}
        onCheckedChange={handleCheckboxChange}
        className={cn(
          "mt-0.5 border-muted-foreground/25",
          isCompleted && "bg-muted border-muted-foreground/40"
        )}
        aria-label={`Mark "${task.title}" as ${isCompleted ? "incomplete" : "complete"}`}
      />

      <div className="flex-1 min-w-0">
        <label
          htmlFor={`task-${task.id}`}
          className={cn(
            "text-sm font-medium cursor-pointer block leading-snug",
            isCompleted ? "text-muted-foreground line-through" : "text-foreground"
          )}
        >
          {task.title}
        </label>

        {task.clientLabel && (
          <div className="flex items-center gap-1 mt-1.5">
            <span className="text-xs text-muted-foreground/70">
              Client: {task.clientLabel}
            </span>
            {!isCompleted && <ChevronDown className="h-3 w-3 text-muted-foreground/50" />}
          </div>
        )}

        {task.caseLabel && (
          <div className="mt-2.5">
            <Badge
              variant="outline"
              className="text-xs font-normal bg-background/50 border-border/60 text-muted-foreground"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-primary/60 mr-1.5" />
              {task.caseLabel}
            </Badge>
          </div>
        )}

        {/* Completed timestamp */}
        {isCompleted && task.completedAt && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground/70">
            <Check className="h-3 w-3" />
            <span>Completed {formatDistanceToNow(task.completedAt, { addSuffix: true })}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 flex-shrink-0">
        {/* Due date with urgency styling (only for active tasks) */}
        {!isCompleted && task.dueDate && (
          <div
            className={cn(
              "flex items-center gap-1.5 text-xs",
              isDueToday || isOverdue ? "text-due-today font-medium" : "text-due-soon"
            )}
          >
            {(isDueToday || isOverdue) && <Clock className="h-3 w-3" />}
            <span>{task.dueDate}</span>
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </div>
        )}

        {/* Status badge (only for active tasks) */}
        {!isCompleted && statusBadge && (
          <Badge
            className={cn("text-xs px-2 py-0.5 border-0", statusBadge.badgeClass)}
          >
            {statusBadge.label}
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
