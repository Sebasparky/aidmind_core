/**
 * Hook to fetch and track security metrics from Eye events
 * 
 * Provides runtime visibility into:
 * - Rejected insecure requests
 * - TLS version distribution (metadata only)
 * - Security event counts
 * 
 * This hook aggregates security-relevant Eye events for the
 * Security Dashboard panel.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";

// ============================================================
// TYPES
// ============================================================

export interface SecurityEventData {
  type?: string;
  service?: string;
  error_code?: string;
  error_message?: string;
  target_url?: string;
  request_id?: string;
  proto?: string;
  tls_version?: string;
  [key: string]: unknown;
}

export interface RawSecurityEvent {
  id: string;
  event_type: string;
  event_data: SecurityEventData | null;
  created_at: string;
  session_id: string | null;
}

export interface SecurityMetrics {
  // Rejected insecure requests (HTTP, missing HSTS, etc.)
  rejectedInsecureRequests: number;
  rejectedByReason: Record<string, number>;
  
  // TLS version distribution (metadata only - no raw data)
  tlsVersionDistribution: Record<string, number>;
  
  // Security event counts by type
  eventsByType: Record<string, number>;
  
  // Recent security incidents (last 24h)
  recentIncidents: SecurityIncident[];
  
  // Time range
  timeRangeHours: number;
  lastUpdated: Date | null;
}

export interface SecurityIncident {
  id: string;
  timestamp: string;
  type: string;
  service: string;
  errorCode?: string;
  sanitizedMessage: string;
}

// Security-related event types
const SECURITY_EVENT_TYPES = [
  "SECURITY_INSECURE_TRANSPORT",
  "SECURITY_TOKEN_IN_URL",
  "SECURITY_TLS_FAILURE",
  "SECURITY_CERT_VALIDATION_FAILED",
  "SECURITY_INSECURE_URL_REJECTED",
  "SECURITY_SERVICE_UNREACHABLE",
  "SECURITY_INTERNAL_SERVICE_ERROR",
  "SECURITY_HTTP_REJECTED",
  "SECURITY_HSTS_MISSING",
  // Generic security events
  "SECURITY_EVENT",
];

// Patterns to detect security events in other event types
const SECURITY_INDICATOR_PATTERNS = [
  /insecure/i,
  /tls.?fail/i,
  /cert.?invalid/i,
  /http.?reject/i,
  /security/i,
];

// ============================================================
// HOOK
// ============================================================

export interface UseSecurityMetricsOptions {
  timeRangeHours?: number;
  autoRefresh?: boolean;
  refreshIntervalMs?: number;
}

export function useSecurityMetrics(options: UseSecurityMetricsOptions = {}) {
  const {
    timeRangeHours = 24,
    autoRefresh = true,
    refreshIntervalMs = 60000, // 1 minute
  } = options;

  const [events, setEvents] = useState<RawSecurityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchSecurityEvents = useCallback(async () => {
    try {
      setError(null);

      // Calculate time range
      const startTime = new Date(
        Date.now() - timeRangeHours * 60 * 60 * 1000
      ).toISOString();

      // Query security-related events
      const { data, error: fetchError } = await supabase
        .from("eye_events")
        .select("id, event_type, event_data, created_at, session_id")
        .gte("created_at", startTime)
        .order("created_at", { ascending: false })
        .limit(5000);

      if (fetchError) {
        console.error("Failed to fetch security events:", fetchError);
        setError(fetchError.message);
        return;
      }

      // Filter to security-relevant events
      const securityEvents = (data || []).filter((event) => {
        // Direct security event types
        if (SECURITY_EVENT_TYPES.includes(event.event_type)) {
          return true;
        }

        // Check event type for security indicators
        if (
          SECURITY_INDICATOR_PATTERNS.some((p) => p.test(event.event_type))
        ) {
          return true;
        }

        // Check event data for security markers
        const eventData = event.event_data as unknown as SecurityEventData | null;
        if (eventData?.type && typeof eventData.type === "string" && eventData.type.includes("SECURITY")) {
          return true;
        }

        return false;
      }).map((event) => ({
        id: event.id,
        event_type: event.event_type,
        event_data: event.event_data as unknown as SecurityEventData | null,
        created_at: event.created_at,
        session_id: event.session_id,
      })) as RawSecurityEvent[];

      setEvents(securityEvents);
      setLastUpdated(new Date());
    } catch (err) {
      console.error("Error fetching security metrics:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [timeRangeHours]);

  // Initial fetch
  useEffect(() => {
    fetchSecurityEvents();
  }, [fetchSecurityEvents]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(fetchSecurityEvents, refreshIntervalMs);
    return () => clearInterval(interval);
  }, [autoRefresh, refreshIntervalMs, fetchSecurityEvents]);

  // Real-time updates
  useEffect(() => {
    const channel = supabase
      .channel("security_events_changes")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "eye_events",
        },
        (payload) => {
          const newEvent = payload.new as RawSecurityEvent;

          // Check if this is a security event
          const isSecurityEvent =
            SECURITY_EVENT_TYPES.includes(newEvent.event_type) ||
            SECURITY_INDICATOR_PATTERNS.some((p) =>
              p.test(newEvent.event_type)
            );

          if (isSecurityEvent) {
            setEvents((prev) => [newEvent, ...prev]);
            setLastUpdated(new Date());
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Compute metrics from events
  const metrics: SecurityMetrics = useMemo(() => {
    const rejectedByReason: Record<string, number> = {};
    const tlsVersionDistribution: Record<string, number> = {};
    const eventsByType: Record<string, number> = {};
    const recentIncidents: SecurityIncident[] = [];

    let rejectedInsecureRequests = 0;

    for (const event of events) {
      const eventData = event.event_data || ({} as SecurityEventData);

      // Count by event type
      eventsByType[event.event_type] =
        (eventsByType[event.event_type] || 0) + 1;

      // Track rejected requests
      if (
        event.event_type.includes("REJECTED") ||
        event.event_type.includes("INSECURE") ||
        event.event_type.includes("HTTP_REJECTED")
      ) {
        rejectedInsecureRequests++;

        const reason =
          eventData.error_code ||
          eventData.type ||
          event.event_type.replace("SECURITY_", "");
        rejectedByReason[reason] = (rejectedByReason[reason] || 0) + 1;
      }

      // Track TLS versions (metadata only)
      if (eventData.tls_version) {
        tlsVersionDistribution[eventData.tls_version] =
          (tlsVersionDistribution[eventData.tls_version] || 0) + 1;
      } else if (eventData.proto === "https") {
        // Default to TLS 1.3 if not specified but HTTPS
        tlsVersionDistribution["TLS 1.3 (assumed)"] =
          (tlsVersionDistribution["TLS 1.3 (assumed)"] || 0) + 1;
      }

      // Build recent incidents list (max 50)
      if (recentIncidents.length < 50) {
        recentIncidents.push({
          id: event.id,
          timestamp: event.created_at,
          type: event.event_type,
          service: eventData.service || "unknown",
          errorCode: eventData.error_code,
          sanitizedMessage: sanitizeMessage(eventData.error_message || ""),
        });
      }
    }

    return {
      rejectedInsecureRequests,
      rejectedByReason,
      tlsVersionDistribution,
      eventsByType,
      recentIncidents,
      timeRangeHours,
      lastUpdated,
    };
  }, [events, timeRangeHours, lastUpdated]);

  return {
    metrics,
    loading,
    error,
    refresh: fetchSecurityEvents,
  };
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Sanitize error messages for display (remove potential sensitive data)
 */
function sanitizeMessage(message: string): string {
  if (!message) return "";

  // Truncate long messages
  let sanitized = message.slice(0, 200);

  // Remove potential tokens/credentials
  sanitized = sanitized.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[JWT]");
  sanitized = sanitized.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
  sanitized = sanitized.replace(/sk[-_][a-zA-Z0-9]{20,}/g, "[API_KEY]");
  sanitized = sanitized.replace(/password=\S+/gi, "password=[REDACTED]");

  return sanitized;
}

/**
 * Get severity level from event type
 */
export function getSecurityEventSeverity(
  eventType: string
): "critical" | "high" | "medium" | "low" {
  if (
    eventType.includes("TLS_FAILURE") ||
    eventType.includes("CERT_VALIDATION")
  ) {
    return "critical";
  }

  if (
    eventType.includes("INSECURE_TRANSPORT") ||
    eventType.includes("HTTP_REJECTED")
  ) {
    return "high";
  }

  if (
    eventType.includes("TOKEN_IN_URL") ||
    eventType.includes("INSECURE_URL")
  ) {
    return "medium";
  }

  return "low";
}
