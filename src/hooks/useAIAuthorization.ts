/**
 * Hook to manage Generative AI Authorization state
 * 
 * SCOPE: This hook manages authorization for GENERATIVE AI only (chat/completions).
 * It does NOT apply to:
 * - Transcription (Whisper) - non-generative audio-to-text processing
 * - Redaction (Presidio) - rule-based PHI removal
 * 
 * These non-generative steps operate independently and do not require supervisor approval.
 * 
 * This hook provides:
 * - Current authorization status (approved/missing/revoked)
 * - Approval/revocation actions for supervisors
 * - Integration with Eye events (AI_USAGE_APPROVED_BY_SUPERVISOR, etc.)
 */

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AIAuthorizationStatus, AIApprovalScope, AIUsageApproval } from "@/lib/governance/types";
import { EyeEvent } from "@/lib/eye/types";
import { isServerVerifiedEvent } from "@/lib/eye/clientEventContract";
import { useTenant } from "./useTenant";

interface UseAIAuthorizationOptions {
  tenantId?: string;
  scope?: AIApprovalScope;
}

interface AIAuthorizationState {
  status: AIAuthorizationStatus;
  approval: AIUsageApproval | null;
  loading: boolean;
  error: string | null;
}

export function useAIAuthorization(options: UseAIAuthorizationOptions = {}) {
  const { scope = "organization" } = options;
  // Tenant comes from the caller's membership (never a literal default).
  const { tenant } = useTenant();
  const tenantId = options.tenantId ?? tenant?.tenantId ?? null;

  const [state, setState] = useState<AIAuthorizationState>({
    status: "missing",
    approval: null,
    loading: true,
    error: null,
  });

  // Derive authorization status from Eye events
  const deriveAuthorizationStatus = useCallback(async () => {
    if (!tenantId) {
      setState({ status: "missing", approval: null, loading: false, error: null });
      return;
    }
    try {
      setState(prev => ({ ...prev, loading: true, error: null }));

      // Query for latest AI_USAGE_APPROVED_BY_SUPERVISOR or AI_USAGE_APPROVAL_REVOKED
      const { data: events, error } = await supabase
        .from("eye_events")
        .select("id, event_type, event_data, created_at")
        .in("event_type", [
          "AI_USAGE_APPROVED_BY_SUPERVISOR",
          "AI_USAGE_APPROVAL_REVOKED",
        ])
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) {
        setState(prev => ({
          ...prev,
          loading: false,
          error: error.message,
        }));
        return;
      }

      // Find latest relevant event for this scope.
      // Only server-verified supervisor events count; rows written by the former
      // direct-browser path (unverified) are ignored.
      const scopedEvents = (events || []).filter((e: any) => {
        const eventData = (e.event_data || {}) as Record<string, unknown>;
        return (
          eventData.tenant_id === tenantId &&
          eventData.scope === scope &&
          isServerVerifiedEvent(eventData) &&
          eventData.actor_role === "supervisor"
        );
      });

      if (scopedEvents.length === 0) {
        setState({
          status: "missing",
          approval: null,
          loading: false,
          error: null,
        });
        return;
      }

      const latestEvent = scopedEvents[0] as any;
      const eventData = (latestEvent.event_data || {}) as Record<string, unknown>;

      if (latestEvent.event_type === "AI_USAGE_APPROVAL_REVOKED") {
        setState({
          status: "revoked",
          approval: null,
          loading: false,
          error: null,
        });
      } else if (latestEvent.event_type === "AI_USAGE_APPROVED_BY_SUPERVISOR") {
        setState({
          status: "approved",
          approval: {
            id: latestEvent.id,
            scope: (eventData.scope as AIApprovalScope) || "organization",
            tenant_id: (eventData.tenant_id as string) || tenantId,
            approved_by_role: "supervisor",
            approved_by_id: (eventData.operator_id as string) || (eventData.actor_id as string) || "unknown",
            approval_policy_id: (eventData.approval_policy_id as string) || "default",
            approved_at: latestEvent.created_at,
            revoked_at: null,
            expires_at: (eventData.expires_at as string) || null,
          },
          loading: false,
          error: null,
        });
      }
    } catch (err) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      }));
    }
  }, [tenantId, scope]);

  // Initial fetch
  useEffect(() => {
    deriveAuthorizationStatus();
  }, [deriveAuthorizationStatus]);

  // Subscribe to real-time updates
  useEffect(() => {
    const channel = supabase
      .channel("ai_authorization_changes")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "eye_events",
          filter: `event_type=in.(AI_USAGE_APPROVED_BY_SUPERVISOR,AI_USAGE_APPROVAL_REVOKED)`,
        },
        () => {
          deriveAuthorizationStatus();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [deriveAuthorizationStatus]);

  // Approve AI usage — server-verified via record_governance_event
  // (supervisor role, active profile and tenant are checked in the database;
  // the operatorId argument is retained for call-site compatibility only).
  const approve = useCallback(async (_operatorId: string, policyId: string = "default") => {
    const { error } = await supabase.rpc("record_governance_event", {
      p_event_type: "AI_USAGE_APPROVED_BY_SUPERVISOR",
      p_subject_id: policyId,
      p_scope: scope,
      p_metadata: { approval_policy_id: policyId },
    });
    if (error) throw error;
    await deriveAuthorizationStatus();
  }, [scope, deriveAuthorizationStatus]);

  // Revoke AI usage — server-verified via record_governance_event
  const revoke = useCallback(async (_operatorId: string) => {
    const { error } = await supabase.rpc("record_governance_event", {
      p_event_type: "AI_USAGE_APPROVAL_REVOKED",
      p_subject_id: "ai_authorization",
      p_scope: scope,
    });
    if (error) throw error;
    await deriveAuthorizationStatus();
  }, [scope, deriveAuthorizationStatus]);

  return {
    ...state,
    approve,
    revoke,
    refresh: deriveAuthorizationStatus,
  };
}
