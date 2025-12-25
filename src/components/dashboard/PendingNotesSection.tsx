import { FileText, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PendingNote {
  id: string;
  caseLabel: string;
  clientLabel: string;
  interactionType: string;
  timestamp: Date;
}

interface PendingNotesSectionProps {
  pendingNotes: PendingNote[];
  onNoteClick?: (note: PendingNote) => void;
}

const interactionLabels: Record<string, string> = {
  phone_call: "Phone call",
  in_person: "In-person visit",
  meeting: "Meeting",
  other: "Interaction",
};

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  return `${diffDays}d ago`;
}

export function PendingNotesSection({ pendingNotes, onNoteClick }: PendingNotesSectionProps) {
  if (pendingNotes.length === 0) return null;

  return (
    <div className="bg-status-warning-muted border border-status-warning/20 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <FileText className="h-4 w-4 text-status-warning" />
        <h3 className="text-sm font-medium text-foreground">
          Pending Notes
        </h3>
        <span className="text-xs text-muted-foreground">
          ({pendingNotes.length})
        </span>
      </div>
      
      <div className="space-y-2">
        {pendingNotes.map((note) => (
          <button
            key={note.id}
            onClick={() => onNoteClick?.(note)}
            className={cn(
              "w-full flex items-center justify-between p-2.5 rounded-md text-left transition-colors",
              "bg-background/60 hover:bg-background border border-border/50"
            )}
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground truncate">
                {note.clientLabel} — {interactionLabels[note.interactionType]}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {note.caseLabel} · {formatTimeAgo(note.timestamp)}
              </p>
            </div>
            <div className="flex items-center gap-2 ml-3 flex-shrink-0">
              <span className="text-xs text-status-warning font-medium">
                Needs documentation
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
