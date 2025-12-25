import { useState } from "react";
import { ChevronDown, MoreHorizontal, Clock, Check, Pencil, CheckCircle2, ArrowUpCircle, ArrowDownCircle, Trash2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Task } from "@/contexts/DashboardContext";
import { formatDistanceToNow } from "date-fns";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface TaskItemProps {
  task: Task;
  onComplete: (taskId: string) => void;
  onEdit: (task: Task) => void;
  onDelete: (taskId: string) => void;
  onRestore: (taskId: string) => void;
  onChangePriority: (taskId: string, priority: "NORMAL" | "HIGH") => void;
  isCompleted?: boolean;
}

export function TaskItem({ 
  task, 
  onComplete, 
  onEdit, 
  onDelete, 
  onRestore, 
  onChangePriority,
  isCompleted = false 
}: TaskItemProps) {
  const [isAnimating, setIsAnimating] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const isHighPriority = task.priority === "HIGH";
  const isDueToday = task.dueDate?.toLowerCase().includes("today");
  const isOverdue = task.dueDate?.toLowerCase().includes("overdue");

  const handleCheckboxChange = (checked: boolean) => {
    if (checked && !isCompleted) {
      // Completing a task
      setIsAnimating(true);
      setTimeout(() => {
        onComplete(task.id);
      }, 200);
    } else if (!checked && isCompleted) {
      // Restoring a task (unchecking in completed view)
      onRestore(task.id);
    }
  };

  const handleDelete = () => {
    setShowDeleteDialog(false);
    onDelete(task.id);
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
    <>
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

          {/* 3-dot menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="Task options"
              >
                <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 bg-popover border-border">
              {isCompleted ? (
                <>
                  <DropdownMenuItem onClick={() => onRestore(task.id)}>
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Restore to Active
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem 
                    onClick={() => setShowDeleteDialog(true)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </>
              ) : (
                <>
                  <DropdownMenuItem onClick={() => onEdit(task)}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit task
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onComplete(task.id)}>
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    Mark as completed
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <ArrowUpCircle className="mr-2 h-4 w-4" />
                      Change priority
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="bg-popover border-border">
                      <DropdownMenuItem 
                        onClick={() => onChangePriority(task.id, "HIGH")}
                        disabled={task.priority === "HIGH"}
                      >
                        <ArrowUpCircle className="mr-2 h-4 w-4 text-destructive" />
                        Set to High
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => onChangePriority(task.id, "NORMAL")}
                        disabled={task.priority === "NORMAL"}
                      >
                        <ArrowDownCircle className="mr-2 h-4 w-4" />
                        Set to Normal
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem 
                    onClick={() => setShowDeleteDialog(true)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete task?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the task. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}