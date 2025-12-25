import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { TaskList } from "@/components/dashboard/TaskList";
import { CasesPanel } from "@/components/dashboard/CasesPanel";
import { Button } from "@/components/ui/button";
import { FileEdit } from "lucide-react";
import { LogInteractionModal } from "@/components/dashboard/LogInteractionModal";
import { MindSession } from "@/components/dashboard/MindSession";
import { PendingNotesSection, PendingNote } from "@/components/dashboard/PendingNotesSection";
import { RecentUpdatesSection, RecentUpdate } from "@/components/dashboard/RecentUpdatesSection";
import { toast } from "@/hooks/use-toast";

// Sample pending notes data
const initialPendingNotes: PendingNote[] = [
  {
    id: "pn1",
    caseLabel: "Housing assistance — intake",
    clientLabel: "A. J.",
    interactionType: "phone_call",
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
  },
];

// Sample recent updates data
const recentUpdates: RecentUpdate[] = [
  {
    id: "u1",
    type: "case_updated",
    title: "Case A. J. updated",
    description: "Housing assistance status changed",
    timestamp: new Date(Date.now() - 30 * 60 * 1000),
    read: false,
  },
  {
    id: "u2",
    type: "supervisor_comment",
    title: "Supervisor comment added",
    description: "B. R. case review notes",
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000),
    read: false,
  },
  {
    id: "u3",
    type: "task_due_changed",
    title: "Task due date changed",
    description: "Follow-up call moved to tomorrow",
    timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000),
    read: true,
  },
  {
    id: "u4",
    type: "note_approved",
    title: "Note approved",
    description: "C. T. intake documentation",
    timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000),
    read: true,
  },
];

interface SessionData {
  caseId: string;
  caseLabel: string;
  clientLabel: string;
  interactionType: string;
  timestamp: Date;
}

const Index = () => {
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [pendingNotes, setPendingNotes] = useState<PendingNote[]>(initialPendingNotes);

  const handleStartSession = (
    caseId: string,
    caseLabel: string,
    clientLabel: string,
    interactionType: string
  ) => {
    setSessionData({
      caseId,
      caseLabel,
      clientLabel,
      interactionType,
      timestamp: new Date(),
    });
  };

  const handleCloseSession = () => {
    // Add to pending notes when discarded
    if (sessionData) {
      const newPendingNote: PendingNote = {
        id: crypto.randomUUID(),
        caseLabel: sessionData.caseLabel,
        clientLabel: sessionData.clientLabel,
        interactionType: sessionData.interactionType,
        timestamp: sessionData.timestamp,
      };
      setPendingNotes((prev) => [newPendingNote, ...prev]);
    }
    setSessionData(null);
  };

  const handleSaveSession = (notes: string) => {
    toast({
      description: "Note saved successfully",
    });
    setSessionData(null);
  };

  const handlePendingNoteClick = (note: PendingNote) => {
    // Resume the session for this pending note
    setSessionData({
      caseId: note.id,
      caseLabel: note.caseLabel,
      clientLabel: note.clientLabel,
      interactionType: note.interactionType,
      timestamp: note.timestamp,
    });
    // Remove from pending
    setPendingNotes((prev) => prev.filter((n) => n.id !== note.id));
  };

  // Show Mind session if active
  if (sessionData) {
    return (
      <MindSession
        caseLabel={sessionData.caseLabel}
        clientLabel={sessionData.clientLabel}
        interactionType={sessionData.interactionType}
        timestamp={sessionData.timestamp}
        onClose={handleCloseSession}
        onSave={handleSaveSession}
      />
    );
  }

  return (
    <DashboardLayout>
      <div className="flex flex-col h-full min-h-0 gap-4">
        {/* Primary Action Bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button 
              size="lg" 
              className="gap-2 shadow-sm"
              onClick={() => setLogModalOpen(true)}
            >
              <FileEdit className="h-5 w-5" />
              Log Interaction
            </Button>
          </div>
        </div>

        {/* Status Sections */}
        <div className="flex gap-4">
          {/* Pending Notes */}
          <div className="flex-1 max-w-md">
            <PendingNotesSection 
              pendingNotes={pendingNotes} 
              onNoteClick={handlePendingNoteClick}
            />
          </div>
          
          {/* Recent Updates */}
          <div className="flex-1 max-w-sm">
            <RecentUpdatesSection updates={recentUpdates} />
          </div>
        </div>

        {/* Main Content */}
        <div className="flex flex-1 min-h-0 gap-6">
          <TaskList />
          <CasesPanel />
        </div>
      </div>

      {/* Log Interaction Modal */}
      <LogInteractionModal
        open={logModalOpen}
        onOpenChange={setLogModalOpen}
        onStartSession={handleStartSession}
      />
    </DashboardLayout>
  );
};

export default Index;
