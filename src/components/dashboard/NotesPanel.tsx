import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Search, X, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NoteItem } from "./NoteItem";
import { StartNoteModal } from "./StartNoteModal";
import { useRecentNotes } from "@/hooks/useRecentNotes";
import { Skeleton } from "@/components/ui/skeleton";

// Format relative time from a Date
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return "Just now";
  } else if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  } else if (diffDays === 1) {
    return "Yesterday";
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else {
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
}

export function NotesPanel() {
  const navigate = useNavigate();
  const { notes, loading, error, refresh } = useRecentNotes(20);
  const [localSearch, setLocalSearch] = useState("");
  const [startNoteOpen, setStartNoteOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Transform notes with relative time
  const formattedNotes = useMemo(() => {
    return notes.map((note) => ({
      id: note.id,
      title: note.title,
      interactionType: note.interactionType,
      status: note.status,
      updatedAt: formatRelativeTime(note.updatedAt),
      sessionId: note.sessionId,
    }));
  }, [notes]);

  // Filter notes by title
  const filteredNotes = useMemo(() => {
    if (!localSearch.trim()) {
      return formattedNotes;
    }
    const query = localSearch.toLowerCase();
    return formattedNotes.filter((note) =>
      note.title.toLowerCase().includes(query)
    );
  }, [localSearch, formattedNotes]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refresh();
    setIsRefreshing(false);
  };

  const handleNoteClick = (note: typeof formattedNotes[0]) => {
    // Navigate to session page
    // For terminal states, could show read-only view (future enhancement)
    navigate(`/session?sessionId=${note.sessionId}`);
  };

  const showNoResults = localSearch.trim() && filteredNotes.length === 0;
  const showEmpty = !localSearch.trim() && filteredNotes.length === 0 && !loading;

  return (
    <div className="w-[380px] flex-shrink-0 flex flex-col h-full overflow-hidden bg-card rounded-xl border border-border p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold text-foreground">Recent Notes</h2>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={handleRefresh}
            disabled={isRefreshing}
            title="Refresh notes"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>
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
          placeholder="Search notes..."
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

      {/* Error state */}
      {error && (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={handleRefresh}>
            Try again
          </Button>
        </div>
      )}

      {/* Notes List */}
      <div className="overflow-y-auto flex-1 min-h-0 -mx-5 px-5">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-start gap-3 p-3">
                <Skeleton className="w-8 h-8 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : showEmpty ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm text-muted-foreground">No notes yet</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Start a note session to see it here
            </p>
          </div>
        ) : showNoResults ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm text-muted-foreground">No notes found</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Try adjusting your search
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {filteredNotes.map((note) => (
              <NoteItem 
                key={note.id} 
                note={note} 
                onClick={() => handleNoteClick(note)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
