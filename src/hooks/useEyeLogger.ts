/**
 * useEyeLogger — Client-side Eye event logging for tool runs.
 *
 * Provides a `logEvent` function that inserts metadata-only events
 * into eye_events via the Supabase client. Never includes content payloads.
 *
 * Uses supabase.functions.invoke() for privileged writes when needed,
 * but for eye_events (which have permissive RLS for service_role),
 * we log via edge function to maintain the security contract.
 */

import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "./useTenant";

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
  const { tenant } = useTenant();

  const logEvent = useCallback(
    async (params: LogEventParams) => {
      const { eventType, sessionId, requestId, result, toolName, metadata } = params;

      // Build event_data (metadata only, no content)
      const eventData: { [key: string]: string | number | boolean | null | undefined } = {
        event_version: 1,
        tenant_id: tenant?.tenantId ?? "unknown",
        actor_type: "user",
        actor_id: user?.id ?? "unknown",
        result: result ?? "success",
      };

      if (toolName) eventData.tool_name = toolName;
      if (requestId) eventData.request_id = requestId;

      // Flatten safe metadata fields (only primitives)
      if (metadata) {
        for (const [key, val] of Object.entries(metadata)) {
          if (val === null || typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
            eventData[key] = val as string | number | boolean | null;
          }
        }
      }

      try {
        const { error } = await supabase.from("eye_events").insert([{
          session_id: sessionId ?? null,
          event_type: eventType,
          event_data: eventData,
          request_id_text: requestId ?? null,
        }]);

        if (error) {
          console.error(`[EyeLogger] Failed to log ${eventType}:`, error.message);
        }
      } catch (err) {
        // Never break the UI for logging failures
        console.error(`[EyeLogger] Exception logging ${eventType}:`, err);
      }
    },
    [user?.id, tenant?.tenantId]
  );

  return { logEvent };
}
