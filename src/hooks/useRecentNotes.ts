import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type NoteStatus = "exported" | "saved" | "cancelled" | "in_progress";

export interface RecentNote {
  id: string;
  sessionId: string;
  title: string;
  interactionType: string;
  status: NoteStatus;
  updatedAt: Date;
}

type SessionRow = Tables<"sessions">;

// Map session state to UI status
function mapStateToStatus(session: SessionRow): NoteStatus {
  if (session.cancelled_at) return "cancelled";
  if (session.closed_at) return "exported";
  
  switch (session.state) {
    case "EXPORTED":
    case "PURGED":
      return "exported";
    case "CANCELLED":
      return "cancelled";
    case "SAVED_FOR_LATER":
      return "saved";
    default:
      return "in_progress";
  }
}

// Map interaction_type to display format
function normalizeInteractionType(type: string | null): string {
  if (!type) return "other";
  
  // Convert snake_case or camelCase to kebab-case for consistency
  return type.toLowerCase().replace(/_/g, "-").replace(/\s+/g, "-");
}

// Generate title from session data
function generateTitle(session: SessionRow): string {
  if (session.case_label) return session.case_label;
  if (session.client_label) return `Session with ${session.client_label}`;
  return `Session ${session.session_id.slice(0, 8)}`;
}

// Transform a session row to RecentNote
function sessionToNote(session: SessionRow): RecentNote {
  return {
    id: session.id,
    sessionId: session.session_id,
    title: generateTitle(session),
    interactionType: normalizeInteractionType(session.interaction_type),
    status: mapStateToStatus(session),
    updatedAt: new Date(session.updated_at),
  };
}

interface UseRecentNotesReturn {
  notes: RecentNote[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useRecentNotes(limit: number = 20): UseRecentNotesReturn {
  const [notes, setNotes] = useState<RecentNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useRef(true);

  // Fetch sessions from database
  const fetchNotes = useCallback(async () => {
    try {
      setError(null);
      
      const { data, error: fetchError } = await supabase
        .from("sessions")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(limit);

      if (fetchError) {
        throw fetchError;
      }

      if (isMounted.current) {
        const transformedNotes = (data || []).map(sessionToNote);
        setNotes(transformedNotes);
      }
    } catch (err) {
      console.error("[useRecentNotes] Fetch error:", err);
      if (isMounted.current) {
        setError(err instanceof Error ? err.message : "Failed to load notes");
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  }, [limit]);

  // Initial fetch
  useEffect(() => {
    isMounted.current = true;
    fetchNotes();

    return () => {
      isMounted.current = false;
    };
  }, [fetchNotes]);

  // Set up realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel("recent-notes-changes")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "sessions",
        },
        (payload) => {
          const newSession = payload.new as SessionRow;
          const newNote = sessionToNote(newSession);
          
          setNotes((prev) => {
            // Avoid duplicates
            const exists = prev.some((n) => n.sessionId === newNote.sessionId);
            if (exists) return prev;
            
            // Add at the beginning and maintain limit
            return [newNote, ...prev].slice(0, limit);
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "sessions",
        },
        (payload) => {
          const updatedSession = payload.new as SessionRow;
          const updatedNote = sessionToNote(updatedSession);
          
          setNotes((prev) => {
            const existingIndex = prev.findIndex(
              (n) => n.sessionId === updatedNote.sessionId
            );
            
            if (existingIndex === -1) {
              // New session we didn't have, add it
              return [updatedNote, ...prev].slice(0, limit);
            }
            
            // Update existing and move to top (re-sort by updated_at)
            const updated = prev.filter(
              (n) => n.sessionId !== updatedNote.sessionId
            );
            return [updatedNote, ...updated].slice(0, limit);
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "sessions",
        },
        (payload) => {
          const deletedSession = payload.old as SessionRow;
          
          setNotes((prev) =>
            prev.filter((n) => n.sessionId !== deletedSession.session_id)
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [limit]);

  return {
    notes,
    loading,
    error,
    refresh: fetchNotes,
  };
}
