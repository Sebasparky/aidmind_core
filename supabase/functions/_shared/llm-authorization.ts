/**
 * LLM Authorization Guard
 * 
 * Enforces AI usage approval before any LLM call.
 * If no AI_USAGE_APPROVED_BY_SUPERVISOR event exists in scope,
 * the call is blocked and AI_USAGE_BLOCKED_NO_APPROVAL is emitted.
 */

import { logEyeEvent } from "./eye.ts";

export interface LLMAuthorizationResult {
  authorized: boolean;
  reason?: string;
  approvalEventId?: string;
}

/**
 * Check if AI usage is authorized for the given tenant/scope.
 * Returns authorization status and emits blocking event if not authorized.
 */
export async function checkLLMAuthorization(
  supabase: any,
  options: {
    tenantId: string;
    scope?: "organization" | "workflow" | "session";
    sessionId: string | null;
    operatorId?: string;
    request?: Request;
    serviceName: string;
    requestId?: string;
  }
): Promise<LLMAuthorizationResult> {
  const { tenantId, scope = "organization", sessionId, operatorId, request, serviceName, requestId } = options;

  try {
    // Query for latest AI authorization event
    const { data: events, error } = await supabase
      .from("eye_events")
      .select("id, event_type, event_data, created_at")
      .in("event_type", [
        "AI_USAGE_APPROVED_BY_SUPERVISOR",
        "AI_USAGE_APPROVAL_REVOKED",
      ])
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("[LLM Auth] Query failed:", error);
      // Fail closed - block if we can't determine authorization
      await emitBlockedEvent(supabase, {
        sessionId,
        operatorId,
        request,
        serviceName,
        requestId,
        reason: "authorization_check_failed",
        tenantId,
        scope,
      });
      return {
        authorized: false,
        reason: "authorization_check_failed",
      };
    }

    // Find latest relevant event for this tenant/scope
    const scopedEvents = (events || []).filter((e: any) => {
      const eventData = (e.event_data || {}) as Record<string, unknown>;
      return (
        eventData.tenant_id === tenantId &&
        eventData.scope === scope
      );
    });

    if (scopedEvents.length === 0) {
      // No authorization events - not authorized
      await emitBlockedEvent(supabase, {
        sessionId,
        operatorId,
        request,
        serviceName,
        requestId,
        reason: "no_approval_exists",
        tenantId,
        scope,
      });
      return {
        authorized: false,
        reason: "no_approval_exists",
      };
    }

    const latestEvent = scopedEvents[0];

    if (latestEvent.event_type === "AI_USAGE_APPROVAL_REVOKED") {
      // Authorization was revoked
      await emitBlockedEvent(supabase, {
        sessionId,
        operatorId,
        request,
        serviceName,
        requestId,
        reason: "approval_revoked",
        tenantId,
        scope,
      });
      return {
        authorized: false,
        reason: "approval_revoked",
      };
    }

    if (latestEvent.event_type === "AI_USAGE_APPROVED_BY_SUPERVISOR") {
      // Check if expired (if expires_at is set)
      const eventData = (latestEvent.event_data || {}) as Record<string, unknown>;
      if (eventData.expires_at) {
        const expiresAt = new Date(eventData.expires_at as string);
        if (expiresAt < new Date()) {
          await emitBlockedEvent(supabase, {
            sessionId,
            operatorId,
            request,
            serviceName,
            requestId,
            reason: "approval_expired",
            tenantId,
            scope,
          });
          return {
            authorized: false,
            reason: "approval_expired",
          };
        }
      }

      // Authorized
      return {
        authorized: true,
        approvalEventId: latestEvent.id,
      };
    }

    // Unexpected state - fail closed
    await emitBlockedEvent(supabase, {
      sessionId,
      operatorId,
      request,
      serviceName,
      requestId,
      reason: "unknown_authorization_state",
      tenantId,
      scope,
    });
    return {
      authorized: false,
      reason: "unknown_authorization_state",
    };
  } catch (err) {
    console.error("[LLM Auth] Exception:", err);
    await emitBlockedEvent(supabase, {
      sessionId,
      operatorId,
      request,
      serviceName,
      requestId,
      reason: "authorization_exception",
      tenantId,
      scope,
    });
    return {
      authorized: false,
      reason: "authorization_exception",
    };
  }
}

/**
 * Emit AI_USAGE_BLOCKED_NO_APPROVAL event
 */
async function emitBlockedEvent(
  supabase: any,
  options: {
    sessionId: string | null;
    operatorId?: string;
    request?: Request;
    serviceName: string;
    requestId?: string;
    reason: string;
    tenantId: string;
    scope: string;
  }
): Promise<void> {
  const { sessionId, operatorId, request, serviceName, requestId, reason, tenantId, scope } = options;

  await logEyeEvent(supabase, {
    session_id: sessionId,
    event_type: "AI_USAGE_BLOCKED_NO_APPROVAL",
    request,
    serviceName,
    payload: {
      operator_id: operatorId,
      request_id: requestId || crypto.randomUUID(),
      result: "failure",
      severity: "HIGH",
      resource_type: "llm_call",
      resource_id: sessionId || "no_session",
      reason_code: reason,
      tenant_id: tenantId,
      scope,
      blocked_at: new Date().toISOString(),
    },
  });
}
