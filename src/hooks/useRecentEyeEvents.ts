/**
 * useRecentEyeEvents — Fetch recent Eye audit events for the current user/tenant.
 *
 * Returns metadata-only events (no PHI payloads).
 * Scoped by tenant_id when available.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "./useTenant";

export interface EyeEvent {
  id: string;
  eventType: string;
  sessionId: string | null;
  createdAt: Date;
  eventData: Record<string, unknown> | null;
}

interface UseRecentEyeEventsReturn {
  events: EyeEvent[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useRecentEyeEvents(limit: number = 20): UseRecentEyeEventsReturn {
  const { tenant } = useTenant();
  const [events, setEvents] = useState<EyeEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useRef(true);

  const fetchEvents = useCallback(async () => {
    try {
      setError(null);

      let query = supabase
        .from("eye_events")
        .select("id, event_type, session_id, created_at, event_data")
        .order("created_at", { ascending: false })
        .limit(limit);

      // Scope by tenant if available (tenant_id lives inside event_data jsonb)
      if (tenant?.tenantId) {
        query = query.eq("event_data->>tenant_id", tenant.tenantId);
      }

      const { data, error: fetchErr } = await query;

      if (fetchErr) throw fetchErr;

      if (isMounted.current) {
        setEvents(
          (data || []).map((row) => ({
            id: row.id,
            eventType: row.event_type,
            sessionId: row.session_id,
            createdAt: new Date(row.created_at),
            eventData: row.event_data as Record<string, unknown> | null,
          }))
        );
      }
    } catch (err) {
      console.error("[useRecentEyeEvents] Fetch error:", err);
      if (isMounted.current) {
        setError(err instanceof Error ? err.message : "Failed to load events");
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  }, [limit, tenant?.tenantId]);

  useEffect(() => {
    isMounted.current = true;
    fetchEvents();
    return () => { isMounted.current = false; };
  }, [fetchEvents]);

  return { events, loading, error, refresh: fetchEvents };
}
