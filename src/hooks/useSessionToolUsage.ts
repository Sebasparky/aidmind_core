/**
 * useSessionToolUsage — Derive which tools were used per session from eye_events.
 *
 * Queries eye_events for tool.run.started / tool.run.completed events,
 * extracts distinct tool_name values per session_id.
 *
 * Zero-retention safe: reads metadata-only audit events, no content.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface SessionToolUsage {
  guidanceUsed: boolean;
  reviewerUsed: boolean;
  toolCount: number;
}

const EMPTY_USAGE: SessionToolUsage = {
  guidanceUsed: false,
  reviewerUsed: false,
  toolCount: 0,
};

const TOOL_EVENT_TYPES = [
  "tool.run.started",
  "tool.run.completed",
  "GUIDANCE_GENERATED",
  "GUIDANCE_STARTED",
  "REVIEWER_STARTED",
  "REVIEWER_COMPLETED",
];

/**
 * Fetch tool usage for a batch of session IDs.
 */
export function useSessionToolUsage(sessionIds: string[]): {
  usageMap: Record<string, SessionToolUsage>;
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const [usageMap, setUsageMap] = useState<Record<string, SessionToolUsage>>({});
  const [loading, setLoading] = useState(false);
  const isMounted = useRef(true);

  const fetchUsage = useCallback(async () => {
    if (sessionIds.length === 0) {
      setUsageMap({});
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("eye_events")
        .select("session_id, event_type, event_data")
        .in("session_id", sessionIds)
        .in("event_type", TOOL_EVENT_TYPES);

      if (error) {
        console.error("[useSessionToolUsage] Fetch error:", error.message);
        return;
      }

      if (!isMounted.current) return;

      // Build usage map
      const map: Record<string, Set<string>> = {};
      for (const row of data || []) {
        if (!row.session_id) continue;
        if (!map[row.session_id]) map[row.session_id] = new Set();

        // Extract tool name from event_data or infer from event_type
        const eventData = row.event_data as Record<string, unknown> | null;
        const toolName = (eventData?.tool_name as string) || "";

        if (
          toolName.toLowerCase().includes("guidance") ||
          row.event_type === "GUIDANCE_GENERATED" ||
          row.event_type === "GUIDANCE_STARTED"
        ) {
          map[row.session_id].add("guidance");
        }
        if (
          toolName.toLowerCase().includes("reviewer") ||
          row.event_type === "REVIEWER_STARTED" ||
          row.event_type === "REVIEWER_COMPLETED"
        ) {
          map[row.session_id].add("reviewer");
        }
      }

      // Convert to SessionToolUsage
      const result: Record<string, SessionToolUsage> = {};
      for (const sid of sessionIds) {
        const tools = map[sid] || new Set();
        result[sid] = {
          guidanceUsed: tools.has("guidance"),
          reviewerUsed: tools.has("reviewer"),
          toolCount: tools.size,
        };
      }

      setUsageMap(result);
    } catch (err) {
      console.error("[useSessionToolUsage] Error:", err);
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }, [sessionIds.join(",")]); // stable dep

  useEffect(() => {
    isMounted.current = true;
    fetchUsage();
    return () => {
      isMounted.current = false;
    };
  }, [fetchUsage]);

  // Listen for new eye_events that might update tool usage
  useEffect(() => {
    if (sessionIds.length === 0) return;

    const channel = supabase
      .channel("session-tool-usage")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "eye_events",
        },
        (payload) => {
          const row = payload.new as {
            session_id: string | null;
            event_type: string;
            event_data: Record<string, unknown> | null;
          };
          if (row.session_id && sessionIds.includes(row.session_id) && TOOL_EVENT_TYPES.includes(row.event_type)) {
            // Re-fetch to stay accurate
            fetchUsage();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionIds.join(","), fetchUsage]);

  return { usageMap, loading, refresh: fetchUsage };
}

/** Get usage for a single session, with fallback */
export function getToolUsage(
  usageMap: Record<string, SessionToolUsage>,
  sessionId: string
): SessionToolUsage {
  return usageMap[sessionId] || EMPTY_USAGE;
}
