import { useState, useMemo } from "react";
import { Plus, ChevronDown, Circle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TaskItem, Task } from "./TaskItem";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useDashboard } from "@/contexts/DashboardContext";

const allTasks: Task[] = [
  {
    id: "1",
    title: "Follow up on housing assistance intake",
    client: "A. J.",
    caseTag: "Housing assistance — intake",
    dueDate: "Today · 5:00 PM",
    status: "high",
    priority: "high",
    createdAt: new Date("2024-04-20"),
  },
  {
    id: "2",
    title: "Gather missing consent form",
    client: "B. R.",
    caseTag: "Medical support case",
    dueDate: "Tomorrow · 9:00 AM",
    status: "overdue",
    priority: "high",
    createdAt: new Date("2024-04-18"),
  },
  {
    id: "3",
    title: "Complete job placement review",
    client: "C. T.",
    caseTag: "Job placement review",
    dueDate: "Apr 28",
    status: "info",
    priority: "medium",
    createdAt: new Date("2024-04-22"),
  },
  {
    id: "4",
    title: "Check on veteran outreach request",
    client: "E. O.",
    caseTag: "Veteran outreach case",
    dueDate: "Apr 29",
    status: "normal",
    priority: "low",
    createdAt: new Date("2024-04-23"),
  },
];

type SortMode = "dueDate" | "priority" | "created";
type PriorityFilter = "all" | "high" | "medium" | "low";

const priorityOrder = { high: 0, medium: 1, low: 2 };

// Parse due date for sorting
function parseDueDate(dueDate: string): Date {
  const lower = dueDate.toLowerCase();
  const now = new Date();
  
  if (lower.includes("today")) {
    return now;
  }
  if (lower.includes("tomorrow")) {
    return new Date(now.getTime() + 24 * 60 * 60 * 1000);
  }
  // Try to parse "Apr 28" style dates
  const parsed = new Date(dueDate + ", 2024");
  return isNaN(parsed.getTime()) ? now : parsed;
}

export function TaskList() {
  const { searchQuery } = useDashboard();
  const [highPriorityOpen, setHighPriorityOpen] = useState(true);
  const [upcomingOpen, setUpcomingOpen] = useState(true);
  const [sortMode, setSortMode] = useState<SortMode>("dueDate");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");

  // Filter and sort tasks
  const filteredTasks = useMemo(() => {
    let tasks = [...allTasks];
    
    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      tasks = tasks.filter(
        (task) =>
          task.title.toLowerCase().includes(query) ||
          task.client.toLowerCase().includes(query) ||
          task.caseTag.toLowerCase().includes(query)
      );
    }
    
    // Apply priority filter
    if (priorityFilter !== "all") {
      tasks = tasks.filter((task) => task.priority === priorityFilter);
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
  }, [searchQuery, priorityFilter, sortMode]);

  // Group tasks
  const highPriorityTasks = filteredTasks.filter(
    (t) => t.status === "high" || t.status === "overdue"
  );
  const upcomingTasks = filteredTasks.filter(
    (t) => t.status !== "high" && t.status !== "overdue"
  );

  const sortLabels: Record<SortMode, string> = {
    dueDate: "Due Date",
    priority: "Priority",
    created: "Created",
  };

  const filterLabels: Record<PriorityFilter, string> = {
    all: "All Tasks",
    high: "High Priority",
    medium: "Medium Priority",
    low: "Low Priority",
  };

  const showNoResults = searchQuery.trim() && filteredTasks.length === 0;

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
            {filteredTasks.length}
          </Badge>
        </div>

        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Add Task
        </Button>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between mb-4">
        {/* Priority Filter */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="gap-2 text-sm">
              {priorityFilter === "high" && (
                <Circle className="h-2 w-2 fill-status-danger text-status-danger" />
              )}
              {priorityFilter === "medium" && (
                <Circle className="h-2 w-2 fill-status-warning text-status-warning" />
              )}
              {priorityFilter === "low" && (
                <Circle className="h-2 w-2 fill-status-info text-status-info" />
              )}
              {filterLabels[priorityFilter]}
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="bg-popover">
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

        {/* Sort Dropdown */}
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
        ) : (
          <>
            {/* High Priority Section */}
            {highPriorityTasks.length > 0 && (
              <Collapsible open={highPriorityOpen} onOpenChange={setHighPriorityOpen}>
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center gap-2 px-4 py-3 bg-secondary/50 hover:bg-secondary transition-colors text-left">
                    <ChevronDown
                      className={`h-4 w-4 text-muted-foreground transition-transform ${
                        highPriorityOpen ? "" : "-rotate-90"
                      }`}
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
                      <TaskItem key={task.id} task={task} />
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
                      className={`h-4 w-4 text-muted-foreground transition-transform ${
                        upcomingOpen ? "" : "-rotate-90"
                      }`}
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
                      <TaskItem key={task.id} task={task} />
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </>
        )}
      </div>
    </div>
  );
}
