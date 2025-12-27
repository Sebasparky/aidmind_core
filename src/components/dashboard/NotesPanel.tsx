import { useState, useMemo } from "react";
import { Search, X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NoteItem, Note } from "./NoteItem";
import { useDashboard } from "@/contexts/DashboardContext";
import { StartNoteModal } from "./StartNoteModal";

// Sample notes data representing completed session outcomes only
const sampleNotes: Note[] = [
  {
    id: "1",
    title: "Phone call re housing assistance",
    interactionType: "phone-call",
    status: "exported",
    updatedAt: "1 hour ago",
  },
  {
    id: "2",
    title: "Follow-up on medical support",
    interactionType: "in-person",
    status: "saved",
    updatedAt: "2 hours ago",
  },
  {
    id: "3",
    title: "Job placement discussion",
    interactionType: "phone-call",
    status: "exported",
    updatedAt: "Yesterday",
  },
  {
    id: "4",
    title: "Shelter placement coordination",
    interactionType: "collateral-contact",
    status: "cancelled",
    updatedAt: "Mar 25",
  },
  {
    id: "5",
    title: "Benefits enrollment call",
    interactionType: "phone-call",
    status: "saved",
    updatedAt: "Mar 20",
  },
];

export function NotesPanel() {
  const { searchQuery } = useDashboard();
  const [localSearch, setLocalSearch] = useState("");
  const [startNoteOpen, setStartNoteOpen] = useState(false);

  // Combine global and local search
  const effectiveSearch = searchQuery || localSearch;

  // Filter notes by title
  const filteredNotes = useMemo(() => {
    if (!effectiveSearch.trim()) {
      return sampleNotes;
    }
    const query = effectiveSearch.toLowerCase();
    return sampleNotes.filter((note) =>
      note.title.toLowerCase().includes(query)
    );
  }, [effectiveSearch]);

  const showNoResults = effectiveSearch.trim() && filteredNotes.length === 0;

  return (
    <div className="w-[380px] flex-shrink-0 flex flex-col h-full overflow-hidden bg-card rounded-xl border border-border p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-foreground">Recent Notes</h2>
        <Button onClick={() => setStartNoteOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Start Note
        </Button>
      </div>

      {/* Start Note Modal */}
      <StartNoteModal open={startNoteOpen} onOpenChange={setStartNoteOpen} />

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search notes and tasks..."
          className="pl-10 pr-10 h-10 bg-card border-border"
          aria-label="Search notes"
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
        />
        {localSearch && (
          <button
            onClick={() => setLocalSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Notes List */}
      <div className="overflow-y-auto flex-1 min-h-0 -mx-5 px-5">
        {showNoResults ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm text-muted-foreground">No notes found</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Try adjusting your search
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {filteredNotes.map((note) => (
              <NoteItem key={note.id} note={note} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
