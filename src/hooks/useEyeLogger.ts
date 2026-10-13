/**
 * useEyeLogger — Client-reported lifecycle/tool events.
 *
 * Writes go through the constrained RPC `report_client_event`, which derives
 * actor and tenant from the authenticated user and the referenced session,
 * validates the event type and metadata against an allowlist, and stamps
 * `source: "client_reported", verified: false`. The browser never supplies
 * identity, tenant, or free text. Direct INSERTs into eye_events are not
 * permitted for browser roles.
 */

import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  isClientReportableEventType,
  isValidRequestId,
  sanitizeClientEventMetadata,
} from "@/lib/eye/clientEventContract";

interface LogEventParams {
  eventType: string;
  sessionId?: string | null;
  requestId?: string;
  result?: "success" | "failure" | "partial";
  toolName?: string;
  metadata?: Record<string, unknown>;
}

export function useEyeLogger() {
  const { user } = useAuth();

  const logEvent = useCallback(
    async (params: LogEventParams) => {
      const { eventType, sessionId, requestId, result, toolName, metadata } = params;

      if (!user) return; // nothing to attribute; the RPC would reject anyway
      if (!isClientReportableEventType(eventType)) {
        console.warn(`[EyeLogger] Event type not client-reportable, dropped: ${eventType}`);
        return;
      }

      const { metadata: safeMetadata, dropped } = sanitizeClientEventMetadata({
        ...(metadata ?? {}),
        ...(toolName ? { tool_name: toolName } : {}),
        result: result ?? "success",
      });
      if (dropped.length > 0) {
        console.warn(`[EyeLogger] Dropped metadata keys for ${eventType}:`, dropped.map((d) => `${d.key}(${d.reason})`).join(", "));
      }

      try {
        const { error } = await supabase.rpc("report_client_event", {
          p_event_type: eventType,
          p_session_id: sessionId ?? null,
          p_request_id: isValidRequestId(requestId) ? requestId : null,
          p_metadata: safeMetadata,
        });

        if (error) {
          console.error(`[EyeLogger] Failed to log ${eventType}:`, error.message);
        }
      } catch (err) {
        // Never break the UI for logging failures
        console.error(`[EyeLogger] Exception logging ${eventType}:`, err);
      }
    },
    [user]
  );

  return { logEvent };
}
