/**
 * Session Heartbeat Hook
 * 
 * Emits SESSION_HEARTBEAT events at regular intervals while a session is active.
 * These heartbeats represent LIVENESS only, not progress.
 * 
 * Design rationale:
 * - Heartbeats are used to detect abandonment (loss of liveness signals)
 * - Interval of 30 seconds provides reasonable granularity without excessive load
 * - Heartbeats stop when session becomes terminal (closed, cancelled, purged)
 * - No PHI is included in heartbeat events
 * 
 * This is critical for regulated-system compliance:
 * - Sessions without heartbeats for SESSION_INACTIVITY_TIMEOUT_MINUTES are auto-purged
 * - Closing a tab silently results in safe auto-purge after timeout
 */

import { useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Heartbeat interval: 2 minutes (120 seconds)
 * 
 * RATIONALE (noise reduction):
 * - 30-second heartbeats create ~120 events/hour per session
 * - With 20 concurrent users, this is ~2,400 events/hour
 * - 2-minute intervals reduce this to ~600 events/hour (75% reduction)
 * - Still provides reliable inactivity detection within the 30-minute timeout window
 * - ~15 heartbeats expected before inactivity threshold is reached
 */
const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000;

interface UseSessionHeartbeatOptions {
  sessionId: string | null;
  isActive: boolean;  // Only emit heartbeats when session is active (not terminal)
}

export function useSessionHeartbeat({ sessionId, isActive }: UseSessionHeartbeatOptions) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastHeartbeatRef = useRef<number>(0);

  const emitHeartbeat = useCallback(async () => {
    if (!sessionId || !isActive) return;

    // Prevent duplicate heartbeats within 5 seconds
    const now = Date.now();
    if (now - lastHeartbeatRef.current < 5000) return;
    lastHeartbeatRef.current = now;

    const requestId = `hb_${sessionId}_${now}`;

    try {
      // Client-reported via constrained RPC; actor/tenant are derived server-side.
      const { error } = await supabase.rpc("report_client_event", {
        p_event_type: "SESSION_HEARTBEAT",
        p_session_id: sessionId,
        p_request_id: requestId,
        p_metadata: {},
      });

      if (error) {
        console.error("[Heartbeat] Failed to emit:", error);
      } else {
        console.log("[Heartbeat] Emitted for session:", sessionId);
      }
    } catch (err) {
      console.error("[Heartbeat] Error:", err);
    }
  }, [sessionId, isActive]);

  useEffect(() => {
    if (!sessionId || !isActive) {
      // Clear interval when session is not active
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Emit initial heartbeat when session becomes active
    emitHeartbeat();

    // Set up interval for subsequent heartbeats
    intervalRef.current = setInterval(emitHeartbeat, HEARTBEAT_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [sessionId, isActive, emitHeartbeat]);

  // Also emit heartbeat on user activity (optional enhancement)
  // This ensures heartbeats are sent even if the interval hasn't fired yet
  useEffect(() => {
    if (!sessionId || !isActive) return;

    const handleActivity = () => {
      // Only emit if it's been more than 10 seconds since last heartbeat
      if (Date.now() - lastHeartbeatRef.current > 10000) {
        emitHeartbeat();
      }
    };

    // Listen for meaningful user interactions
    window.addEventListener("click", handleActivity);
    window.addEventListener("keydown", handleActivity);

    return () => {
      window.removeEventListener("click", handleActivity);
      window.removeEventListener("keydown", handleActivity);
    };
  }, [sessionId, isActive, emitHeartbeat]);

  return { emitHeartbeat };
}