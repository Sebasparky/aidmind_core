/**
 * Hook to fetch real Eye events from Supabase
 * Replaces mock data with real database queries
 */

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { EyeEvent, EyeEventType, EventSeverity, EventCategory, EVENT_SEVERITY_MAP } from "@/lib/eye/types";

interface RawEyeEvent {
  id: string;
  event_type: string;
  event_data: Record<string, any> | null;
  created_at: string;
  session_id: string | null;
}

// Transform raw DB event to full EyeEvent shape
function transformEvent(raw: RawEyeEvent): EyeEvent {
  const eventType = raw.event_type as EyeEventType;
  const eventData = raw.event_data || {};
  
  // Get severity from event_data or fall back to default mapping
  const severity: EventSeverity = 
    eventData.severity || 
    EVENT_SEVERITY_MAP[eventType] || 
    "INFO";
  
  return {
    event_id: raw.id,
    event_type: eventType,
    event_version: eventData.event_version ?? 1,
    timestamp: raw.created_at,
    tenant_id: eventData.tenant_id ?? "default",
    environment: eventData.environment ?? "dev",
    actor_type: eventData.actor_type ?? "service",
    actor_id: eventData.actor_id ?? "unknown",
    actor_role: eventData.actor_role ?? null,
    session_id: raw.session_id,
    case_id: eventData.case_id ?? null,
    resource_type: eventData.resource_type ?? "session",
    resource_id: eventData.resource_id ?? raw.session_id ?? raw.id,
    result: eventData.result ?? "success",
    reason_code: eventData.reason_code ?? null,
    request_id: eventData.request_id ?? `req_${raw.id.slice(0, 8)}`,
    severity,
    // Optional fields from event_data
    operator_id: eventData.operator_id,
    redaction_counts: eventData.redaction_counts,
    latency_ms: eventData.latency_ms,
    remaining_count: eventData.remaining_count,
    remaining_types: eventData.remaining_types,
    tags: eventData.tags ?? [],
    bytes_in: eventData.bytes_in,
    bytes_out: eventData.bytes_out,
    ttl_seconds: eventData.ttl_seconds,
  };
}

export interface UseEyeEventsOptions {
  timeRangeHours?: number;
  sessionId?: string;
  autoRefresh?: boolean;
  refreshIntervalMs?: number;
}

export function useEyeEvents(options: UseEyeEventsOptions = {}) {
  const {
    timeRangeHours = 24,
    sessionId,
    autoRefresh = true,
    refreshIntervalMs = 30000, // 30 seconds
  } = options;

  const [events, setEvents] = useState<EyeEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchEvents = useCallback(async () => {
    try {
      setError(null);
      
      // Calculate time range
      const startTime = new Date(Date.now() - timeRangeHours * 60 * 60 * 1000).toISOString();
      
      // Build query
      let query = supabase
        .from("eye_events")
        .select("id, event_type, event_data, created_at, session_id")
        .gte("created_at", startTime)
        .order("created_at", { ascending: false })
        .limit(1000);
      
      // Filter by session if provided
      if (sessionId) {
        query = query.eq("session_id", sessionId);
      }
      
      const { data, error: fetchError } = await query;
      
      if (fetchError) {
        console.error("Failed to fetch eye events:", fetchError);
        setError(fetchError.message);
        return;
      }
      
      // Transform raw events to EyeEvent shape
      const transformedEvents = (data || []).map(transformEvent);
      setEvents(transformedEvents);
      setLastRefresh(new Date());
      
    } catch (err) {
      console.error("Error fetching eye events:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [timeRangeHours, sessionId]);

  // Initial fetch
  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;
    
    const interval = setInterval(fetchEvents, refreshIntervalMs);
    return () => clearInterval(interval);
  }, [autoRefresh, refreshIntervalMs, fetchEvents]);

  // Subscribe to real-time updates
  useEffect(() => {
    const channel = supabase
      .channel("eye_events_changes")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "eye_events",
        },
        (payload) => {
          const newEvent = transformEvent(payload.new as RawEyeEvent);
          
          // Only add if within time range and matches session filter
          const startTime = Date.now() - timeRangeHours * 60 * 60 * 1000;
          const eventTime = new Date(newEvent.timestamp).getTime();
          
          if (eventTime >= startTime) {
            if (!sessionId || newEvent.session_id === sessionId) {
              setEvents((prev) => [newEvent, ...prev]);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [timeRangeHours, sessionId]);

  return {
    events,
    loading,
    error,
    lastRefresh,
    refresh: fetchEvents,
  };
}

// Helper to get events grouped by session
export function groupEventsBySession(events: EyeEvent[]): Map<string, EyeEvent[]> {
  const grouped = new Map<string, EyeEvent[]>();
  
  events.forEach((event) => {
    if (!event.session_id) return;
    
    const existing = grouped.get(event.session_id) || [];
    existing.push(event);
    grouped.set(event.session_id, existing);
  });
  
  return grouped;
}

// Filter events by various criteria
export interface EventFilters {
  categories?: EventCategory[];
  severities?: EventSeverity[];
  sessionId?: string;
  caseId?: string;
  operatorId?: string;
  startDate?: Date;
  endDate?: Date;
}

export function filterEvents(events: EyeEvent[], filters: EventFilters): EyeEvent[] {
  return events.filter((event) => {
    // Filter by session
    if (filters.sessionId && event.session_id !== filters.sessionId) {
      return false;
    }
    
    // Filter by case
    if (filters.caseId && event.case_id !== filters.caseId) {
      return false;
    }
    
    // Filter by operator
    if (filters.operatorId && event.operator_id !== filters.operatorId) {
      return false;
    }
    
    // Filter by severity
    if (filters.severities && filters.severities.length > 0) {
      if (!filters.severities.includes(event.severity as EventSeverity)) {
        return false;
      }
    }
    
    // Filter by date range
    if (filters.startDate) {
      const eventDate = new Date(event.timestamp);
      if (eventDate < filters.startDate) {
        return false;
      }
    }
    
    if (filters.endDate) {
      const eventDate = new Date(event.timestamp);
      if (eventDate > filters.endDate) {
        return false;
      }
    }
    
    return true;
  });
}

// Get purge proof events
export function getPurgeProofEvents(events: EyeEvent[]): EyeEvent[] {
  const purgeTypes = [
    "PURGE_STARTED",
    "PURGE_COMPLETED",
    "PURGE_FAILED",
    "AUDIO_DELETED",
    "TRANSCRIPT_DELETED",
    "MINIMIZED_TRANSCRIPT_DELETED",
    "EPHEMERAL_SCAN_RESULT",
  ];
  return events.filter((e) => purgeTypes.includes(e.event_type));
}

// Get error/warning events
export function getErrorEvents(events: EyeEvent[]): EyeEvent[] {
  return events.filter((e) => 
    e.result === "failure" || 
    e.severity === "WARN" || 
    e.severity === "HIGH" || 
    e.severity === "CRITICAL"
  );
}
