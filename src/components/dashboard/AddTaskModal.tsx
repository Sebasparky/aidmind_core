import { useState, useEffect, useRef } from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format, parse } from "date-fns";
import { cn } from "@/lib/utils";
import { useDashboard, availableCases, Task } from "@/contexts/DashboardContext";

interface AddTaskModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editTask?: Task | null;
}

export function AddTaskModal({ open, onOpenChange, editTask }: AddTaskModalProps) {
  const { addTask, updateTask } = useDashboard();
  const [title, setTitle] = useState("");
  const [caseId, setCaseId] = useState<string>("");
  const [dueDate, setDueDate] = useState<Date | undefined>();
  const [priority, setPriority] = useState<"NORMAL" | "HIGH">("NORMAL");
  const [titleError, setTitleError] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const isEditMode = !!editTask;

  // Reset or populate form when modal opens
  useEffect(() => {
    if (open) {
      if (editTask) {
        setTitle(editTask.title);
        setCaseId(editTask.caseId || "");
        setDueDate(parseDueDateString(editTask.dueDate));
        setPriority(editTask.priority);
      } else {
        setTitle("");
        setCaseId("");
        setDueDate(undefined);
        setPriority("NORMAL");
      }
      setTitleError(false);
      setTimeout(() => titleInputRef.current?.focus(), 100);
    }
  }, [open, editTask]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!title.trim()) {
      setTitleError(true);
      titleInputRef.current?.focus();
      return;
    }

    const selectedCase = availableCases.find((c) => c.id === caseId);
    const taskData = {
      title: title.trim(),
      caseId: caseId || undefined,
      caseLabel: selectedCase?.label,
      clientLabel: selectedCase?.client,
      dueDate: dueDate ? formatDueDate(dueDate) : undefined,
      priority,
    };

    if (isEditMode && editTask) {
      updateTask(editTask.id, taskData);
    } else {
      addTask(taskData);
    }

    onOpenChange(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-foreground">
            {isEditMode ? "Edit Task" : "Add New Task"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 pt-2">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="task-title" className="text-sm font-medium text-foreground">
              Task Title <span className="text-destructive">*</span>
            </Label>
            <Input
              ref={titleInputRef}
              id="task-title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (titleError) setTitleError(false);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Enter task title..."
              className={cn(
                "bg-background border-border",
                titleError && "border-destructive focus-visible:ring-destructive"
              )}
              aria-invalid={titleError}
              aria-describedby={titleError ? "title-error" : undefined}
            />
            {titleError && (
              <p id="title-error" className="text-xs text-destructive">
                Title is required
              </p>
            )}
          </div>

          {/* Case */}
          <div className="space-y-2">
            <Label htmlFor="task-case" className="text-sm font-medium text-foreground">
              Case
            </Label>
            <Select value={caseId} onValueChange={setCaseId}>
              <SelectTrigger id="task-case" className="bg-background border-border">
                <SelectValue placeholder="Select a case (optional)" />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                <SelectItem value="none">No case</SelectItem>
                {availableCases.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label} — {c.client}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Due Date */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground">Due Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal bg-background border-border",
                    !dueDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dueDate ? format(dueDate, "PPP") : "Select date (optional)"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 bg-popover border-border" align="start">
                <Calendar
                  mode="single"
                  selected={dueDate}
                  onSelect={setDueDate}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Priority */}
          <div className="space-y-2">
            <Label htmlFor="task-priority" className="text-sm font-medium text-foreground">
              Priority
            </Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as "NORMAL" | "HIGH")}>
              <SelectTrigger id="task-priority" className="bg-background border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                <SelectItem value="NORMAL">Normal</SelectItem>
                <SelectItem value="HIGH">High</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit">{isEditMode ? "Save Changes" : "Create Task"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function formatDueDate(date: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  const targetDate = new Date(date);
  targetDate.setHours(0, 0, 0, 0);
  
  if (targetDate.getTime() === today.getTime()) {
    return "Today";
  }
  if (targetDate.getTime() === tomorrow.getTime()) {
    return "Tomorrow";
  }
  return format(date, "MMM d");
}

function parseDueDateString(dueDate?: string): Date | undefined {
  if (!dueDate) return undefined;
  
  const lower = dueDate.toLowerCase();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  if (lower.includes("today")) {
    return today;
  }
  if (lower.includes("tomorrow")) {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow;
  }
  
  // Try to parse "Apr 28" format
  try {
    const cleanDate = dueDate.split("·")[0].trim();
    const parsed = parse(cleanDate, "MMM d", new Date());
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  } catch {
    // Fall through
  }
  
  return undefined;
}