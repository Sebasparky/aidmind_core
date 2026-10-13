/**
 * Hook to manage Auditor Access
 * 
 * Provides time-bounded, read-only access for external auditors.
 */

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AuditorAccess } from "@/lib/governance/types";
import { isServerVerifiedEvent } from "@/lib/eye/clientEventContract";
import { useTenant } from "./useTenant";

interface UseAuditorAccessOptions {
  tenantId?: string;
}

interface AuditorAccessState {
  activeAccess: AuditorAccess[];
  loading: boolean;
  error: string | null;
}

export function useAuditorAccess(options: UseAuditorAccessOptions = {}) {
  // Tenant comes from the caller's membership (never a literal default).
  const { tenant } = useTenant();
  const tenantId = options.tenantId ?? tenant?.tenantId ?? null;

  const [state, setState] = useState<AuditorAccessState>({
    activeAccess: [],
    loading: true,
    error: null,
  });

  // Derive active auditor access from Eye events
  const deriveAuditorAccess = useCallback(async () => {
    try {
      setState(prev => ({ ...prev, loading: true, error: null }));

      // Query for AUDITOR_ACCESS_GRANTED and AUDITOR_ACCESS_REVOKED events
      const { data: events, error } = await supabase
        .from("eye_events")
        .select("id, event_type, event_data, created_at")
        .in("event_type", [
          "AUDITOR_ACCESS_GRANTED",
          "AUDITOR_ACCESS_EXPIRED",
          "AUDITOR_ACCESS_REVOKED",
        ])
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) {
        setState(prev => ({
          ...prev,
          loading: false,
          error: error.message,
        }));
        return;
      }

      // Build active access list (granted but not revoked/expired)
      const accessMap = new Map<string, AuditorAccess>();
      const revokedOrExpired = new Set<string>();

      // Process in reverse chronological order
      for (const event of (events || [])) {
        const eventData = (event.event_data || {}) as Record<string, unknown>;
        if (!tenantId || eventData.tenant_id !== tenantId) continue;
        // Only server-verified supervisor actions are authorization evidence.
        if (!isServerVerifiedEvent(eventData) || eventData.actor_role !== "supervisor") continue;

        const auditorId = (eventData.auditor_id as string) || (eventData.operator_id as string);
        if (!auditorId) continue;

        if (
          event.event_type === "AUDITOR_ACCESS_REVOKED" ||
          event.event_type === "AUDITOR_ACCESS_EXPIRED"
        ) {
          revokedOrExpired.add(auditorId);
        } else if (event.event_type === "AUDITOR_ACCESS_GRANTED") {
          if (!revokedOrExpired.has(auditorId) && !accessMap.has(auditorId)) {
            // Check if expired by time
            const expiresAtStr = (eventData.expires_at as string) || event.created_at;
            const expiresAt = new Date(expiresAtStr);
            if (expiresAt > new Date()) {
              accessMap.set(auditorId, {
                id: event.id,
                auditor_id: auditorId,
                tenant_id: tenantId,
                granted_by_role: "supervisor",
                granted_by_id: (eventData.granted_by_id as string) || (eventData.actor_id as string) || "unknown",
                granted_at: event.created_at,
                expires_at: eventData.expires_at as string,
                revoked_at: null,
              });
            }
          }
        }
      }

      setState({
        activeAccess: Array.from(accessMap.values()),
        loading: false,
        error: null,
      });
    } catch (err) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      }));
    }
  }, [tenantId]);

  // Initial fetch
  useEffect(() => {
    deriveAuditorAccess();
  }, [deriveAuditorAccess]);

  // Grant auditor access
  const grantAccess = useCallback(async (
    operatorId: string,
    auditorId: string,
    expiresInHours: number = 24
  ) => {
    try {
      const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();

      // Server-verified via record_governance_event: supervisor role and the
      // subject's auditor role are checked in the database. `operatorId` is
      // retained for call-site compatibility; the actor is derived from auth.uid().
      void operatorId;
      const { error } = await supabase.rpc("record_governance_event", {
        p_event_type: "AUDITOR_ACCESS_GRANTED",
        p_subject_id: auditorId,
        p_expires_at: expiresAt,
      });

      if (error) throw error;
      await deriveAuditorAccess();
    } catch (err) {
      throw err;
    }
  }, [tenantId, deriveAuditorAccess]);

  // Revoke auditor access
  const revokeAccess = useCallback(async (operatorId: string, auditorId: string) => {
    try {
      void operatorId; // actor derived server-side
      const { error } = await supabase.rpc("record_governance_event", {
        p_event_type: "AUDITOR_ACCESS_REVOKED",
        p_subject_id: auditorId,
      });

      if (error) throw error;
      await deriveAuditorAccess();
    } catch (err) {
      throw err;
    }
  }, [tenantId, deriveAuditorAccess]);

  return {
    ...state,
    grantAccess,
    revokeAccess,
    refresh: deriveAuditorAccess,
  };
}
