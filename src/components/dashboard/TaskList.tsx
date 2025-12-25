import { useState, useMemo } from "react";
import { Plus, ChevronDown, Circle, Check, ListTodo, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TaskItem } from "./TaskItem";
import { AddTaskModal } from "./AddTaskModal";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useDashboard, Task } from "@/contexts/DashboardContext";
import { cn } from "@/lib/utils";

type SortMode = "dueDate" | "priority" | "created";
type PriorityFilter = "all" | "high" | "normal";
type ViewFilter = "active" | "completed";

const priorityOrder = { HIGH: 0, NORMAL: 1 };

// Parse due date for sorting
function parseDueDate(dueDate?: string): Date {
  if (!dueDate) return new Date("9999-12-31");
  
  const lower = dueDate.toLowerCase();
  const now = new Date();
  
  if (lower.includes("today")) {
    return now;
  }
  if (lower.includes("tomorrow")) {
    return new Date(now.getTime() + 24 * 60 * 60 * 1000);
  }
  if (lower.includes("overdue")) {
    return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }
  // Try to parse "Apr 28" style dates
  const parsed = new Date(dueDate + ", 2024");
  return isNaN(parsed.getTime()) ? new Date("9999-12-31") : parsed;
}

export function TaskList() {
  const { 
    searchQuery, 
    activeTasks, 
    completedTasks, 
    completeTask,
    updateTask,
    deleteTask,
    restoreTask,
  } = useDashboard();
  const [highPriorityOpen, setHighPriorityOpen] = useState(true);
  const [upcomingOpen, setUpcomingOpen] = useState(true);
  const [sortMode, setSortMode] = useState<SortMode>("dueDate");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [viewFilter, setViewFilter] = useState<ViewFilter>("active");
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  // Filter and sort active tasks
  const filteredActiveTasks = useMemo(() => {
    let tasks = [...activeTasks];
    
    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      tasks = tasks.filter(
        (task) =>
          task.title.toLowerCase().includes(query) ||
          (task.clientLabel?.toLowerCase().includes(query)) ||
          (task.caseLabel?.toLowerCase().includes(query))
      );
    }
    
    // Apply priority filter
    if (priorityFilter !== "all") {
      const filterPriority = priorityFilter.toUpperCase() as "HIGH" | "NORMAL";
      tasks = tasks.filter((task) => task.priority === filterPriority);
    }
    
    // Apply sorting
    tasks.sort((a, b) => {
      switch (sortMode) {
        case "priority":
          return priorityOrder[a.priority] - priorityOrder[b.priority];
        case "created":
          return b.createdAt.getTime() - a.createdAt.getTime();
        case "dueDate":
        default:
          return parseDueDate(a.dueDate).getTime() - parseDueDate(b.dueDate).getTime();
      }
    });
    
    return tasks;
  }, [activeTasks, searchQuery, priorityFilter, sortMode]);

  // Filter completed tasks
  const filteredCompletedTasks = useMemo(() => {
    let tasks = [...completedTasks];
    
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      tasks = tasks.filter(
        (task) =>
          task.title.toLowerCase().includes(query) ||
          (task.clientLabel?.toLowerCase().includes(query)) ||
          (task.caseLabel?.toLowerCase().includes(query))
      );
    }
    
    return tasks;
  }, [completedTasks, searchQuery]);

  // Group active tasks
  const highPriorityTasks = filteredActiveTasks.filter((t) => t.priority === "HIGH");
  const upcomingTasks = filteredActiveTasks.filter((t) => t.priority === "NORMAL");

  const sortLabels: Record<SortMode, string> = {
    dueDate: "Due Date",
    priority: "Priority",
    created: "Created",
  };

  const filterLabels: Record<PriorityFilter, string> = {
    all: "All Tasks",
    high: "High Priority",
    normal: "Normal Priority",
  };

  const displayedTasks = viewFilter === "active" ? filteredActiveTasks : filteredCompletedTasks;
  const showNoResults = searchQuery.trim() && displayedTasks.length === 0;

  const handleEdit = (task: Task) => {
    setEditingTask(task);
    setAddTaskOpen(true);
  };

  const handleModalClose = (open: boolean) => {
    setAddTaskOpen(open);
    if (!open) {
      setEditingTask(null);
    }
  };

  const handleChangePriority = (taskId: string, priority: "NORMAL" | "HIGH") => {
    updateTask(taskId, { priority });
  };

  return (
    <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden bg-card rounded-xl border border-border p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-foreground">My Tasks</h1>
          <Badge
            variant="secondary"
            className="text-xs font-normal px-2 py-0.5 text-muted-foreground"
          >
            {viewFilter === "active" ? activeTasks.length : completedTasks.length}
          </Badge>
        </div>

        <Button className="gap-2" onClick={() => setAddTaskOpen(true)}>
          <Plus className="h-4 w-4" />
          Add Task
        </Button>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between mb-4 gap-3">
        {/* View Filter - Active/Completed */}
        <div className="flex items-center gap-1 p-1 bg-secondary/50 rounded-lg">
          <button
            onClick={() => setViewFilter("active")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
              viewFilter === "active"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
            aria-pressed={viewFilter === "active"}
          >
            <ListTodo className="h-4 w-4" />
            Active
          </button>
          <button
            onClick={() => setViewFilter("completed")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
              viewFilter === "completed"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
            aria-pressed={viewFilter === "completed"}
          >
            <CheckCircle2 className="h-4 w-4" />
            Completed
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* Priority Filter (only show for active view) */}
          {viewFilter === "active" && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-2 text-sm">
                  {priorityFilter === "high" && (
                    <Circle className="h-2 w-2 fill-status-danger text-status-danger" />
                  )}
                  {priorityFilter === "normal" && (
                    <Circle className="h-2 w-2 fill-status-info text-status-info" />
                  )}
                  {filterLabels[priorityFilter]}
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-popover">
                {(Object.keys(filterLabels) as PriorityFilter[]).map((filter) => (
                  <DropdownMenuItem
                    key={filter}
                    onClick={() => setPriorityFilter(filter)}
                    className="flex items-center justify-between gap-2"
                  >
                    <span>{filterLabels[filter]}</span>
                    {priorityFilter === filter && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Sort Dropdown (only show for active view) */}
          {viewFilter === "active" && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-2 text-sm">
                  Sort: {sortLabels[sortMode]}
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-popover">
                {(Object.keys(sortLabels) as SortMode[]).map((mode) => (
                  <DropdownMenuItem
                    key={mode}
                    onClick={() => setSortMode(mode)}
                    className="flex items-center justify-between gap-2"
                  >
                    <span>{sortLabels[mode]}</span>
                    {sortMode === mode && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Task Groups */}
      <div className="overflow-y-auto flex-1 min-h-0 -mx-5 px-5">
        {showNoResults ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm text-muted-foreground">No results found</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Try adjusting your search or filters
            </p>
          </div>
        ) : viewFilter === "active" ? (
          <>
            {/* High Priority Section */}
            {highPriorityTasks.length > 0 && (
              <Collapsible open={highPriorityOpen} onOpenChange={setHighPriorityOpen}>
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center gap-2 px-4 py-3 bg-secondary/50 hover:bg-secondary transition-colors text-left">
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 text-muted-foreground transition-transform",
                        !highPriorityOpen && "-rotate-90"
                      )}
                    />
                    <span className="text-sm font-medium text-foreground">
                      High Priority
                    </span>
                    <span className="text-xs text-muted-foreground">
                      ({highPriorityTasks.length})
                    </span>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="divide-y divide-border/60">
                    {highPriorityTasks.map((task) => (
                      <TaskItem
                        key={task.id}
                        task={task}
                        onComplete={completeTask}
                        onEdit={handleEdit}
                        onDelete={deleteTask}
                        onRestore={restoreTask}
                        onChangePriority={handleChangePriority}
                      />
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Upcoming Section */}
            {upcomingTasks.length > 0 && (
              <Collapsible open={upcomingOpen} onOpenChange={setUpcomingOpen}>
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center gap-2 px-4 py-3 bg-secondary/50 hover:bg-secondary transition-colors text-left border-t-2 border-border mt-2">
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 text-muted-foreground transition-transform",
                        !upcomingOpen && "-rotate-90"
                      )}
                    />
                    <span className="text-sm font-medium text-foreground">
                      Upcoming
                    </span>
                    <span className="text-xs text-muted-foreground">
                      ({upcomingTasks.length})
                    </span>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="divide-y divide-border/60">
                    {upcomingTasks.map((task) => (
                      <TaskItem
                        key={task.id}
                        task={task}
                        onComplete={completeTask}
                        onEdit={handleEdit}
                        onDelete={deleteTask}
                        onRestore={restoreTask}
                        onChangePriority={handleChangePriority}
                      />
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Empty state for active tasks */}
            {filteredActiveTasks.length === 0 && !searchQuery.trim() && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <ListTodo className="h-12 w-12 text-muted-foreground/30 mb-4" />
                <p className="text-sm text-muted-foreground">No active tasks</p>
                <p className="text-xs text-muted-foreground/70 mt-1">
                  Click "Add Task" to create a new task
                </p>
              </div>
            )}
          </>
        ) : (
          /* Completed tasks view */
          <div className="divide-y divide-border/60">
            {filteredCompletedTasks.length > 0 ? (
              filteredCompletedTasks.map((task) => (
                <TaskItem
                  key={task.id}
                  task={task}
                  onComplete={completeTask}
                  onEdit={handleEdit}
                  onDelete={deleteTask}
                  onRestore={restoreTask}
                  onChangePriority={handleChangePriority}
                  isCompleted
                />
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <CheckCircle2 className="h-12 w-12 text-muted-foreground/30 mb-4" />
                <p className="text-sm text-muted-foreground">No completed tasks yet</p>
                <p className="text-xs text-muted-foreground/70 mt-1">
                  Completed tasks will appear here
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add/Edit Task Modal */}
      <AddTaskModal 
        open={addTaskOpen} 
        onOpenChange={handleModalClose} 
        editTask={editingTask}
      />
    </div>
  );
}
