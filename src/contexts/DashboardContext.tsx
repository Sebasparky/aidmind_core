// Dashboard context for task and search state management
import { createContext, useContext, useState, ReactNode, useCallback, useMemo } from "react";
import { toast } from "@/hooks/use-toast";

export interface Task {
  id: string;
  title: string;
  clientLabel?: string;
  caseId?: string;
  caseLabel?: string;
  dueDate?: string;
  priority: "NORMAL" | "HIGH";
  status: "ACTIVE" | "COMPLETED";
  createdAt: Date;
  completedAt?: Date;
}

interface DashboardContextType {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  clearSearch: () => void;
  tasks: Task[];
  completeTask: (taskId: string) => void;
  undoCompleteTask: (taskId: string) => void;
  addTask: (task: Omit<Task, "id" | "createdAt" | "status">) => void;
  updateTask: (taskId: string, updates: Partial<Omit<Task, "id" | "createdAt">>) => void;
  deleteTask: (taskId: string) => void;
  restoreTask: (taskId: string) => void;
  activeTasks: Task[];
  completedTasks: Task[];
}

const DashboardContext = createContext<DashboardContextType | undefined>(undefined);

// Initial mock tasks
const initialTasks: Task[] = [
  {
    id: "1",
    title: "Follow up on housing assistance intake",
    clientLabel: "A. J.",
    caseId: "1",
    caseLabel: "Housing assistance — intake",
    dueDate: "Today · 5:00 PM",
    priority: "HIGH",
    status: "ACTIVE",
    createdAt: new Date("2024-04-20"),
  },
  {
    id: "2",
    title: "Gather missing consent form",
    clientLabel: "B. R.",
    caseId: "2",
    caseLabel: "Medical support case",
    dueDate: "Tomorrow · 9:00 AM",
    priority: "HIGH",
    status: "ACTIVE",
    createdAt: new Date("2024-04-18"),
  },
  {
    id: "3",
    title: "Complete job placement review",
    clientLabel: "C. T.",
    caseId: "3",
    caseLabel: "Job placement review",
    dueDate: "Apr 28",
    priority: "NORMAL",
    status: "ACTIVE",
    createdAt: new Date("2024-04-22"),
  },
  {
    id: "4",
    title: "Check on veteran outreach request",
    clientLabel: "E. O.",
    caseId: "4",
    caseLabel: "Veteran outreach case",
    dueDate: "Apr 29",
    priority: "NORMAL",
    status: "ACTIVE",
    createdAt: new Date("2024-04-23"),
  },
  {
    id: "5",
    title: "Schedule follow-up call",
    clientLabel: "F. K.",
    caseId: "5",
    caseLabel: "Emergency shelter placement",
    dueDate: "May 2",
    priority: "NORMAL",
    status: "ACTIVE",
    createdAt: new Date("2024-04-25"),
  },
];

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [tasks, setTasks] = useState<Task[]>(initialTasks);

  const clearSearch = useCallback(() => {
    setSearchQuery("");
  }, []);

  const completeTask = useCallback((taskId: string) => {
    setTasks((prev) =>
      prev.map((task) =>
        task.id === taskId
          ? { ...task, status: "COMPLETED" as const, completedAt: new Date() }
          : task
      )
    );

    // Show undo toast
    const { dismiss } = toast({
      description: "Task completed",
      action: (
        <button
          onClick={() => {
            setTasks((prev) =>
              prev.map((task) =>
                task.id === taskId
                  ? { ...task, status: "ACTIVE" as const, completedAt: undefined }
                  : task
              )
            );
            dismiss();
          }}
          className="text-sm font-medium text-primary hover:text-primary/80 transition-colors px-3 py-1 rounded-md bg-primary/10 hover:bg-primary/20"
        >
          Undo
        </button>
      ),
      duration: 5000,
    });
  }, []);

  const undoCompleteTask = useCallback((taskId: string) => {
    setTasks((prev) =>
      prev.map((task) =>
        task.id === taskId
          ? { ...task, status: "ACTIVE" as const, completedAt: undefined }
          : task
      )
    );
  }, []);

  const addTask = useCallback((taskData: Omit<Task, "id" | "createdAt" | "status">) => {
    const newTask: Task = {
      ...taskData,
      id: crypto.randomUUID(),
      status: "ACTIVE",
      createdAt: new Date(),
    };
    setTasks((prev) => [newTask, ...prev]);
  }, []);

  const updateTask = useCallback((taskId: string, updates: Partial<Omit<Task, "id" | "createdAt">>) => {
    setTasks((prev) =>
      prev.map((task) =>
        task.id === taskId ? { ...task, ...updates } : task
      )
    );
  }, []);

  const deleteTask = useCallback((taskId: string) => {
    let deletedTask: Task | null = null;
    
    setTasks((prev) => {
      deletedTask = prev.find((t) => t.id === taskId) || null;
      return prev.filter((t) => t.id !== taskId);
    });

    // Show undo toast for delete
    if (deletedTask) {
      const taskToRestore = deletedTask;
      const { dismiss } = toast({
        description: "Task deleted",
        action: (
          <button
            onClick={() => {
              setTasks((prev) => [...prev, taskToRestore]);
              dismiss();
            }}
            className="text-sm font-medium text-primary hover:text-primary/80 transition-colors px-3 py-1 rounded-md bg-primary/10 hover:bg-primary/20"
          >
            Undo
          </button>
        ),
        duration: 5000,
      });
    }
  }, []);

  const restoreTask = useCallback((taskId: string) => {
    setTasks((prev) =>
      prev.map((task) =>
        task.id === taskId
          ? { ...task, status: "ACTIVE" as const, completedAt: undefined }
          : task
      )
    );

    const { dismiss } = toast({
      description: "Task restored",
      action: (
        <button
          onClick={() => {
            setTasks((prev) =>
              prev.map((task) =>
                task.id === taskId
                  ? { ...task, status: "COMPLETED" as const, completedAt: new Date() }
                  : task
              )
            );
            dismiss();
          }}
          className="text-sm font-medium text-primary hover:text-primary/80 transition-colors px-3 py-1 rounded-md bg-primary/10 hover:bg-primary/20"
        >
          Undo
        </button>
      ),
      duration: 5000,
    });
  }, []);

  const activeTasks = useMemo(
    () => tasks.filter((t) => t.status === "ACTIVE"),
    [tasks]
  );

  const completedTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.status === "COMPLETED")
        .sort((a, b) => (b.completedAt?.getTime() || 0) - (a.completedAt?.getTime() || 0)),
    [tasks]
  );

  return (
    <DashboardContext.Provider
      value={{
        searchQuery,
        setSearchQuery,
        clearSearch,
        tasks,
        completeTask,
        undoCompleteTask,
        addTask,
        updateTask,
        deleteTask,
        restoreTask,
        activeTasks,
        completedTasks,
      }}
    >
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard() {
  const context = useContext(DashboardContext);
  if (context === undefined) {
    throw new Error("useDashboard must be used within a DashboardProvider");
  }
  return context;
}

// Available cases for task assignment
export const availableCases = [
  { id: "1", label: "Housing assistance — intake", client: "A. J." },
  { id: "2", label: "Medical support case", client: "B. R." },
  { id: "3", label: "Job placement review", client: "C. T." },
  { id: "4", label: "Veteran outreach case", client: "E. O." },
  { id: "5", label: "Emergency shelter placement", client: "F. K." },
];
