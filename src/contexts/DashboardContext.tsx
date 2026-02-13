// Dashboard context for task, search, and session coordination state management
import { createContext, useContext, useState, useRef, ReactNode, useCallback, useMemo } from "react";
import { toast } from "@/hooks/use-toast";
import { V1_SHOW_PLACEHOLDER_TASKS } from "@/config/features";

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

/**
 * Session highlight target — set by WorkRadar "Open Session" to coordinate
 * cross-panel navigation without DOM scraping.
 */
interface SessionHighlightTarget {
  sessionId: string;
  location: "active" | "history";
}

interface DashboardContextType {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  clearSearch: () => void;
  tasks: Task[];
  completeTask: (taskId: string) => void;
  undoCompleteTask: (taskId: string) => void;
  addTask: (task: Omit<Task, "id" | "createdAt" | "status"> & { id?: string }) => string;
  updateTask: (taskId: string, updates: Partial<Omit<Task, "id" | "createdAt">>) => void;
  deleteTask: (taskId: string) => void;
  restoreTask: (taskId: string) => void;
  activeTasks: Task[];
  completedTasks: Task[];
  isPlaceholderMode: boolean;

  // Session coordination
  registerActiveSessionIds: (ids: string[], source?: string) => void;
  registerHistorySessionIds: (ids: string[], source?: string) => void;
  requestSessionHighlight: (sessionId: string) => void;
  sessionHighlightTarget: SessionHighlightTarget | null;
  clearSessionHighlight: () => void;
}

const DashboardContext = createContext<DashboardContextType | undefined>(undefined);

/**
 * Initial placeholder tasks (DEV / Placeholder data)
 * 
 * V1 placeholder: These are hardcoded demo tasks until the platform
 * task system is connected. When V1_SHOW_PLACEHOLDER_TASKS is false,
 * this data is not used.
 */
const placeholderTasks: Task[] = [
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

const getInitialTasks = (): Task[] => {
  return V1_SHOW_PLACEHOLDER_TASKS ? placeholderTasks : [];
};

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [tasks, setTasks] = useState<Task[]>(getInitialTasks);
  const isPlaceholderMode = V1_SHOW_PLACEHOLDER_TASKS;

  // Session coordination state — refs are the source of truth for the
  // stable requestSessionHighlight callback; state is kept for any
  // downstream UI that may need to react to changes.
  //
  // Seeded with placeholder IDs so highlights work even before panels mount.
  const PLACEHOLDER_ACTIVE_IDS = ["session_4821", "session_4822"];
  const PLACEHOLDER_HISTORY_IDS = ["session_4823", "session_4820", "session_4819"];

  const activeSessionIdsRef = useRef<string[]>(PLACEHOLDER_ACTIVE_IDS);
  const historySessionIdsRef = useRef<string[]>(PLACEHOLDER_HISTORY_IDS);
  const [sessionHighlightTarget, setSessionHighlightTarget] = useState<SessionHighlightTarget | null>(null);

  const clearSearch = useCallback(() => {
    setSearchQuery("");
  }, []);

  const registerActiveSessionIds = useCallback((ids: string[], source?: string) => {
    const normalized = ids.map((id) => id.trim());

    if (normalized.length === 0) {
      if (import.meta.env.DEV) {
        console.warn(
          `[DashboardContext] registerActiveSessionIds called with empty array from "${source ?? "unknown"}". Ignoring to preserve existing registry.`
        );
        console.trace();
      }
      return; // never overwrite with empty
    }

    activeSessionIdsRef.current = normalized;

    if (import.meta.env.DEV) {
      console.log(`[DashboardContext] registerActiveSessionIds (${source ?? "unknown"})`, {
        count: normalized.length,
        first5: normalized.slice(0, 5),
      });
    }
  }, []);

  const registerHistorySessionIds = useCallback((ids: string[], source?: string) => {
    const normalized = ids.map((id) => id.trim());

    if (normalized.length === 0) {
      if (import.meta.env.DEV) {
        console.warn(
          `[DashboardContext] registerHistorySessionIds called with empty array from "${source ?? "unknown"}". Ignoring to preserve existing registry.`
        );
        console.trace();
      }
      return; // never overwrite with empty
    }

    historySessionIdsRef.current = normalized;

    if (import.meta.env.DEV) {
      console.log(`[DashboardContext] registerHistorySessionIds (${source ?? "unknown"})`, {
        count: normalized.length,
        first5: normalized.slice(0, 5),
      });
    }
  }, []);

  const requestSessionHighlight = useCallback((sessionId: string) => {
    const normalized = sessionId.trim();
    const activeIds = activeSessionIdsRef.current;
    const historyIds = historySessionIdsRef.current;

    if (import.meta.env.DEV) {
      console.log("[DashboardContext] requestSessionHighlight", {
        sessionId: normalized,
        hasWhitespace: sessionId !== normalized,
        activeCount: activeIds.length,
        historyCount: historyIds.length,
        activeIds: activeIds.slice(0, 5),
        historyIds: historyIds.slice(0, 5),
      });
    }

    if (activeIds.includes(normalized)) {
      setSessionHighlightTarget({ sessionId: normalized, location: "active" });
    } else if (historyIds.includes(normalized)) {
      setSessionHighlightTarget({ sessionId: normalized, location: "history" });
    } else {
      if (import.meta.env.DEV) {
        console.groupCollapsed(`[DashboardContext] Session not found: ${normalized}`);
        console.log("active registry:", activeIds);
        console.log("history registry:", historyIds);
        console.trace();
        console.groupEnd();

        toast({
          title: `Session not found: ${normalized}`,
          description: `active[${activeIds.length}]: ${activeIds.slice(0, 5).join(", ")} | history[${historyIds.length}]: ${historyIds.slice(0, 5).join(", ")}`,
        });
      } else {
        toast({
          title: "Session not available in this demo dataset.",
        });
      }
    }
  }, []);

  const clearSessionHighlight = useCallback(() => {
    setSessionHighlightTarget(null);
  }, []);

  const completeTask = useCallback((taskId: string) => {
    setTasks((prev) =>
      prev.map((task) =>
        task.id === taskId
          ? { ...task, status: "COMPLETED" as const, completedAt: new Date() }
          : task
      )
    );

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

  const addTask = useCallback((taskData: Omit<Task, "id" | "createdAt" | "status"> & { id?: string }) => {
    const newTask: Task = {
      ...taskData,
      id: taskData.id || crypto.randomUUID(),
      status: "ACTIVE",
      createdAt: new Date(),
    };
    setTasks((prev) => [newTask, ...prev]);
    return newTask.id;
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
        isPlaceholderMode,
        registerActiveSessionIds,
        registerHistorySessionIds,
        requestSessionHighlight,
        sessionHighlightTarget,
        clearSessionHighlight,
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
