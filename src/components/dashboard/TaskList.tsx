import { useState } from "react";
import { Plus, ChevronDown, Circle } from "lucide-react";
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

const highPriorityTasks: Task[] = [
  {
    id: "1",
    title: "Follow up on housing assistance intake",
    client: "A. J.",
    caseTag: "Housing assistance — intake",
    dueDate: "Today · 5:00 PM",
    status: "high",
  },
  {
    id: "2",
    title: "Gather missing consent form",
    client: "B. R.",
    caseTag: "Medical support case",
    dueDate: "Tomorrow · 9:00 AM",
    status: "overdue",
  },
];

const upcomingTasks: Task[] = [
  {
    id: "3",
    title: "Complete job placement review",
    client: "C. T.",
    caseTag: "Job placement review",
    dueDate: "Apr 28",
    status: "info",
  },
  {
    id: "4",
    title: "Check on veteran outreach request",
    client: "E. O.",
    caseTag: "Veteran outreach case",
    dueDate: "Apr 29",
    status: "normal",
  },
];

export function TaskList() {
  const [highPriorityOpen, setHighPriorityOpen] = useState(true);
  const [upcomingOpen, setUpcomingOpen] = useState(true);

  return (
    <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden bg-card rounded-xl border border-border p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-foreground">My Tasks</h1>
          <Badge
            variant="secondary"
            className="text-xs font-medium px-2 py-0.5"
          >
            32
          </Badge>
        </div>

        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Add Task
        </Button>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between mb-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="gap-2 text-sm">
              <Circle className="h-2 w-2 fill-status-danger text-status-danger" />
              High Priority
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="bg-popover">
            <DropdownMenuItem>All Tasks</DropdownMenuItem>
            <DropdownMenuItem>High Priority</DropdownMenuItem>
            <DropdownMenuItem>Medium Priority</DropdownMenuItem>
            <DropdownMenuItem>Low Priority</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="gap-2 text-sm">
              Sort: Due Date
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-popover">
            <DropdownMenuItem>Due Date</DropdownMenuItem>
            <DropdownMenuItem>Priority</DropdownMenuItem>
            <DropdownMenuItem>Client Name</DropdownMenuItem>
            <DropdownMenuItem>Case Type</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Task Groups */}
      <div className="overflow-y-auto flex-1 min-h-0 -mx-5 px-5">
        {/* High Priority Section */}
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
            <div className="divide-y divide-border">
              {highPriorityTasks.map((task) => (
                <TaskItem key={task.id} task={task} />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Upcoming Section */}
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
            <div className="divide-y divide-border">
              {upcomingTasks.map((task) => (
                <TaskItem key={task.id} task={task} />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  );
}
