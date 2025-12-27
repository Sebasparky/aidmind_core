// Dashboard context for task, notes, and search state management
import { createContext, useContext, useState, ReactNode, useCallback, useMemo, useEffect } from "react";
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

export type NoteStatus = "exported" | "saved" | "cancelled";
export type InteractionType = "phone-call" | "in-person" | "video-call" | "collateral-contact" | "other";

export interface RecentNote {
  id: string;
  sessionId: string;
  title: string;
  interactionType: InteractionType;
  status: NoteStatus;
  updatedAt: Date;
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
  // Recent notes
  recentNotes: RecentNote[];
  addRecentNote: (note: Omit<RecentNote, "id" | "updatedAt">) => void;
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

// LocalStorage key for recent notes
const RECENT_NOTES_STORAGE_KEY = "aidmind_recent_notes";

// Load recent notes from localStorage
function loadRecentNotes(): RecentNote[] {
  try {
    const stored = localStorage.getItem(RECENT_NOTES_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return parsed.map((note: RecentNote & { updatedAt: string }) => ({
        ...note,
        updatedAt: new Date(note.updatedAt),
      }));
    }
  } catch (e) {
    console.error("Failed to load recent notes from localStorage:", e);
  }
  return [];
}

// Save recent notes to localStorage
function saveRecentNotes(notes: RecentNote[]) {
  try {
    localStorage.setItem(RECENT_NOTES_STORAGE_KEY, JSON.stringify(notes));
  } catch (e) {
    console.error("Failed to save recent notes to localStorage:", e);
  }
}

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [recentNotes, setRecentNotes] = useState<RecentNote[]>(loadRecentNotes);

  // Persist recent notes to localStorage whenever they change
  useEffect(() => {
    saveRecentNotes(recentNotes);
  }, [recentNotes]);

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

  // Add a recent note with upsert logic (prevents duplicates by sessionId)
  const addRecentNote = useCallback((noteData: Omit<RecentNote, "id" | "updatedAt">) => {
    setRecentNotes((prev) => {
      // Check if a note with this sessionId already exists
      const existingIndex = prev.findIndex((n) => n.sessionId === noteData.sessionId);
      
      const newNote: RecentNote = {
        ...noteData,
        id: crypto.randomUUID(),
        updatedAt: new Date(),
      };

      if (existingIndex !== -1) {
        // Update existing note (upsert)
        const updated = [...prev];
        updated[existingIndex] = { ...newNote, id: prev[existingIndex].id };
        // Move to top (most recent first)
        const [movedNote] = updated.splice(existingIndex, 1);
        return [movedNote, ...updated];
      }

      // Add new note at the top
      return [newNote, ...prev];
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
        recentNotes,
        addRecentNote,
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
