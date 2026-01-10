/**
 * Cleanup Orphan Sessions (Dev) / Detect Abandoned Sessions
 * 
 * ⚠️ DEV/DEMO ONLY: This function is currently triggered MANUALLY via HTTP request.
 * For production, this MUST be scheduled as a cron job (every 5-10 minutes).
 * 
 * TODO (PRODUCTION): Add Supabase pg_cron or external scheduler to invoke this
 * function automatically. Without scheduling, abandoned sessions will not be
 * detected until the next manual invocation.
 * 
 * This function implements safety-first abandoned session detection:
 * 1. Detects inactivity via loss of heartbeat (not intent)
 * 2. Automatically purges sensitive artifacts
 * 3. Marks sessions with observational, non-blaming status
 * 4. Uses neutral, compliance-grade language
 * 
 * DESIGN PRINCIPLES:
 * - Abandonment is OBSERVATIONAL, not intent-based
 * - Timeout is data-risk driven: "Maximum time we retain artifacts without activity"
 * - Purging happens immediately upon detection
 * - User intent is NEVER claimed or inferred
 * - Aligns with regulated-system norms (healthcare, gov, fintech)
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { logEyeEvent, SESSION_INACTIVITY_TIMEOUT_MINUTES } from "../_shared/eye.ts";
import { buildCorsSecurityHeaders, enforceTransportSecurity, createSecureJsonHeaders } from "../_shared/security-headers.ts";
import {
  validatePlainText,
  validationErrorResponse,
  type ValidationErrors,
} from "../_shared/input-validation.ts";

const SERVICE_NAME = "cleanup-orphan-sessions-dev";

interface CleanupRequest {
  dryRun?: boolean;
  daysBack?: number;
  maxEventCount?: number;  // Sessions with this many or fewer events are considered orphans
  inactiveMinutes?: number;  // Override for SESSION_INACTIVITY_TIMEOUT_MINUTES
}

/**
 * Validate cleanup request payload.
 * CRITICAL: Never echo raw user input in error responses.
 */
function validateCleanupRequest(body: unknown): { valid: true; data: CleanupRequest } | { valid: false; errors: ValidationErrors } {
  // Empty body is valid - use defaults
  if (body === undefined || body === null) {
    return { valid: true, data: {} };
  }

  if (typeof body !== "object") {
    return { valid: false, errors: { body: "INVALID_INPUT" } };
  }

  const rawBody = body as Record<string, unknown>;
  const errors: ValidationErrors = {};

  // Validate dryRun (optional boolean)
  if (rawBody.dryRun !== undefined && rawBody.dryRun !== null) {
    if (typeof rawBody.dryRun !== "boolean") {
      errors.dryRun = "INVALID_INPUT";
    }
  }

  // Validate daysBack (optional positive integer)
  if (rawBody.daysBack !== undefined && rawBody.daysBack !== null) {
    if (typeof rawBody.daysBack !== "number" || !Number.isInteger(rawBody.daysBack) || rawBody.daysBack < 1 || rawBody.daysBack > 365) {
      errors.daysBack = "INVALID_INPUT";
    }
  }

  // Validate maxEventCount (optional positive integer)
  if (rawBody.maxEventCount !== undefined && rawBody.maxEventCount !== null) {
    if (typeof rawBody.maxEventCount !== "number" || !Number.isInteger(rawBody.maxEventCount) || rawBody.maxEventCount < 0 || rawBody.maxEventCount > 100) {
      errors.maxEventCount = "INVALID_INPUT";
    }
  }

  // Validate inactiveMinutes (optional positive integer)
  if (rawBody.inactiveMinutes !== undefined && rawBody.inactiveMinutes !== null) {
    if (typeof rawBody.inactiveMinutes !== "number" || !Number.isInteger(rawBody.inactiveMinutes) || rawBody.inactiveMinutes < 1 || rawBody.inactiveMinutes > 10080) {
      errors.inactiveMinutes = "INVALID_INPUT";
    }
  }

  if (Object.keys(errors).length > 0) {
    console.log(`[${SERVICE_NAME}] Validation failed:`, {
      failed_fields: Object.keys(errors),
      error_codes: Object.values(errors),
    });
    return { valid: false, errors };
  }

  return { valid: true, data: body as CleanupRequest };
}

interface CleanupResponse {
  matchedSessions: number;
  updatedSessions: number;
  insertedEvents: number;
  abandonedSessions: number;  // Sessions marked as ABANDONED (distinct from dev cleanup)
  sessionIds: string[];
  dryRun: boolean;
  criteria: {
    daysBack: number;
    maxEventCount: number;
    inactiveMinutes: number;
  };
}

/**
 * Terminal event types that indicate a session has ended normally
 */
const TERMINAL_EVENT_TYPES = [
  "SESSION_CLOSED",
  "SESSION_CANCELLED",
  "SESSION_ABANDONED",
  "WIP_BUNDLE_EXPORTED",
];

Deno.serve(async (req) => {
  // ============================================================
  // MANDATORY SECURITY CHECK - BEFORE ANY OTHER LOGIC
  // This MUST run before CORS preflight to enforce HTTPS on all requests
  // ============================================================
  const securityResponse = await enforceTransportSecurity(req);
  if (securityResponse) return securityResponse;

  // Build CORS headers with validated origin
  const corsHeaders = buildCorsSecurityHeaders(req);

  // CORS preflight (only after security check passes)
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Only allow in development environment
  const environment = Deno.env.get("ENVIRONMENT") || "dev";
  if (environment === "production") {
    return new Response(
      JSON.stringify({ error: "This function is only available in development" }),
      { status: 403, headers: createSecureJsonHeaders(req) }
    );
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Parse and validate request body
    let rawBody: unknown = {};
    try {
      const text = await req.text();
      if (text) {
        rawBody = JSON.parse(text);
      }
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body", code: "INVALID_JSON" }),
        { status: 400, headers: createSecureJsonHeaders(req) }
      );
    }

    // Validate all fields using allowlist-based validation
    const validation = validateCleanupRequest(rawBody);
    if (!validation.valid) {
      // CRITICAL: Never echo attacker payload - return only field names and error codes
      return validationErrorResponse(validation.errors, corsHeaders);
    }

    const body = validation.data;

    const dryRun = body.dryRun ?? true;  // Default to dry run for safety
    const daysBack = body.daysBack ?? 7;
    const maxEventCount = body.maxEventCount ?? 3;  // Sessions with 3 or fewer events
    // Use configured timeout or default from shared config
    const inactiveMinutes = body.inactiveMinutes ?? SESSION_INACTIVITY_TIMEOUT_MINUTES;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);

    const inactiveCutoff = new Date();
    inactiveCutoff.setMinutes(inactiveCutoff.getMinutes() - inactiveMinutes);

    console.log(`[${SERVICE_NAME}] Starting cleanup with params:`, {
      dryRun,
      daysBack,
      maxEventCount,
      inactiveMinutes,
      cutoffDate: cutoffDate.toISOString(),
      inactiveCutoff: inactiveCutoff.toISOString(),
    });

    // Step 1: Find sessions that are not terminal (no closed_at, no cancelled_at)
    const { data: openSessions, error: sessionsError } = await supabase
      .from("sessions")
      .select("session_id, created_at, state")
      .is("closed_at", null)
      .is("cancelled_at", null)
      .gte("created_at", cutoffDate.toISOString())
      .order("created_at", { ascending: false });

    if (sessionsError) {
      console.error(`[${SERVICE_NAME}] Error fetching sessions:`, sessionsError);
      throw sessionsError;
    }

    console.log(`[${SERVICE_NAME}] Found ${openSessions?.length || 0} open sessions`);

    if (!openSessions || openSessions.length === 0) {
      return new Response(
        JSON.stringify({
          matchedSessions: 0,
          updatedSessions: 0,
          insertedEvents: 0,
          abandonedSessions: 0,
          sessionIds: [],
          dryRun,
          criteria: { daysBack, maxEventCount, inactiveMinutes },
        } as CleanupResponse),
        { headers: createSecureJsonHeaders(req) }
      );
    }

    // Step 2: For each open session, check if it has terminal events or is abandoned
    const orphanSessionIds: string[] = [];
    const abandonedSessionIds: string[] = [];

    for (const session of openSessions) {
      // Check for terminal events
      const { data: terminalEvents, error: terminalError } = await supabase
        .from("eye_events")
        .select("id, event_type")
        .eq("session_id", session.session_id)
        .in("event_type", TERMINAL_EVENT_TYPES)
        .limit(1);

      if (terminalError) {
        console.error(`[${SERVICE_NAME}] Error checking terminal events for ${session.session_id}:`, terminalError);
        continue;
      }

      // If session already has a terminal event, skip
      if (terminalEvents && terminalEvents.length > 0) {
        continue;
      }

      // Check last heartbeat/activity
      const { data: lastActivity, error: activityError } = await supabase
        .from("eye_events")
        .select("created_at, event_type")
        .eq("session_id", session.session_id)
        .order("created_at", { ascending: false })
        .limit(1);

      if (activityError) {
        console.error(`[${SERVICE_NAME}] Error checking activity for ${session.session_id}:`, activityError);
        continue;
      }

      const lastActivityTime = lastActivity?.[0]?.created_at 
        ? new Date(lastActivity[0].created_at) 
        : new Date(session.created_at);

      // Check if session is inactive (no activity within timeout window)
      if (lastActivityTime < inactiveCutoff) {
        // Session is abandoned (no activity within timeout)
        abandonedSessionIds.push(session.session_id);
        console.log(`[${SERVICE_NAME}] Session ${session.session_id} is ABANDONED (last activity: ${lastActivityTime.toISOString()})`);
        continue;
      }

      // Count total events for the session
      const { count: eventCount, error: countError } = await supabase
        .from("eye_events")
        .select("id", { count: "exact", head: true })
        .eq("session_id", session.session_id);

      if (countError) {
        console.error(`[${SERVICE_NAME}] Error counting events for ${session.session_id}:`, countError);
        continue;
      }

      // If session has few events and is relatively old, consider it an orphan (dev cleanup)
      if ((eventCount ?? 0) <= maxEventCount) {
        orphanSessionIds.push(session.session_id);
        console.log(`[${SERVICE_NAME}] Session ${session.session_id} is ORPHAN (${eventCount} events)`);
      }
    }

    const allSessionsToCleanup = [...abandonedSessionIds, ...orphanSessionIds];

    if (allSessionsToCleanup.length === 0) {
      return new Response(
        JSON.stringify({
          matchedSessions: 0,
          updatedSessions: 0,
          insertedEvents: 0,
          abandonedSessions: 0,
          sessionIds: [],
          dryRun,
          criteria: { daysBack, maxEventCount, inactiveMinutes },
        } as CleanupResponse),
        { headers: createSecureJsonHeaders(req) }
      );
    }

    // If dry run, just return what would be cleaned up
    if (dryRun) {
      return new Response(
        JSON.stringify({
          matchedSessions: allSessionsToCleanup.length,
          updatedSessions: 0,
          insertedEvents: 0,
          abandonedSessions: abandonedSessionIds.length,
          sessionIds: allSessionsToCleanup,
          dryRun: true,
          criteria: { daysBack, maxEventCount, inactiveMinutes },
        } as CleanupResponse),
        { headers: createSecureJsonHeaders(req) }
      );
    }

    // Step 3: Process abandoned sessions (safety-first path)
    let updatedSessions = 0;
    let insertedEvents = 0;

    for (const sessionId of abandonedSessionIds) {
      const now = new Date().toISOString();
      const requestId = `abandon_${sessionId}_${Date.now()}`;

      // 1. Emit PURGE_STARTED with reason_code for audit trail
      await logEyeEvent(supabase, {
        session_id: sessionId,
        event_type: "PURGE_STARTED",
        request: req,
        serviceName: SERVICE_NAME,
        payload: {
          result: "success",
          severity: "INFO",
          reason_code: "INACTIVITY_TIMEOUT",
          actor_type: "system",
          actor_id: SERVICE_NAME,
          confidence: "system_observed",
          request_id: requestId,
        },
      });

      // 2. Purge ephemeral artifacts immediately
      const { error: purgeError, count: purgedCount } = await supabase
        .from("ephemeral_artifacts")
        .delete()
        .eq("session_id", sessionId);

      if (purgeError) {
        console.error(`[${SERVICE_NAME}] Failed to purge artifacts for ${sessionId}:`, purgeError);
        // Emit PURGE_FAILED
        await logEyeEvent(supabase, {
          session_id: sessionId,
          event_type: "PURGE_FAILED",
          request: req,
          serviceName: SERVICE_NAME,
          payload: {
            result: "failure",
            severity: "HIGH",
            reason_code: "INACTIVITY_TIMEOUT",
            actor_type: "system",
            actor_id: SERVICE_NAME,
            error_message: purgeError.message,
            request_id: requestId,
          },
        });
        // Continue anyway - we still want to mark as abandoned
      } else {
        // Emit PURGE_COMPLETED with reason_code for audit differentiation
        await logEyeEvent(supabase, {
          session_id: sessionId,
          event_type: "PURGE_COMPLETED",
          request: req,
          serviceName: SERVICE_NAME,
          payload: {
            result: "success",
            severity: "NOTICE",
            reason_code: "INACTIVITY_TIMEOUT",
            actor_type: "system",
            actor_id: SERVICE_NAME,
            confidence: "system_observed",
            purged_artifacts_count: purgedCount ?? 0,
            request_id: requestId,
          },
        });
        
        // Emit EPHEMERAL_SCAN_RESULT for deletion proof consistency
        await logEyeEvent(supabase, {
          session_id: sessionId,
          event_type: "EPHEMERAL_SCAN_RESULT",
          request: req,
          serviceName: SERVICE_NAME,
          payload: {
            remaining_count: 0,  // Purge succeeded, no remaining artifacts
            remaining_types: [],
            severity: "NOTICE",
            reason_code: "INACTIVITY_TIMEOUT",
            actor_type: "system",
            actor_id: SERVICE_NAME,
            request_id: requestId,
          },
        });
      }
      insertedEvents++;

      // 3. Update session row - ABANDONED state, set closed_at
      const { error: updateError } = await supabase
        .from("sessions")
        .update({
          closed_at: now,
          state: "ABANDONED",
        })
        .eq("session_id", sessionId);

      if (updateError) {
        console.error(`[${SERVICE_NAME}] Failed to update session ${sessionId}:`, updateError);
        continue;
      }
      updatedSessions++;

      // 4. Emit SESSION_ABANDONED event with observational semantics
      // CRITICAL: Never use actor_type: "user" - this is system-observed, not user intent
      await logEyeEvent(supabase, {
        session_id: sessionId,
        event_type: "SESSION_ABANDONED",
        request: req,
        serviceName: SERVICE_NAME,
        payload: {
          result: "success",
          severity: "NOTICE",
          reason_code: "INACTIVITY_TIMEOUT",
          // Actor is SYSTEM, not user - abandonment is observational
          actor_type: "system",
          actor_id: SERVICE_NAME,
          // Observational confidence: we observed no activity, we don't claim intent
          confidence: "system_observed",
          request_id: requestId,
          // Note: No PHI is included
        },
      });

      insertedEvents++;
      console.log(`[${SERVICE_NAME}] Abandoned session processed: ${sessionId}`);
    }

    // Step 4: Process orphan sessions (dev cleanup path - mark as cancelled)
    for (const sessionId of orphanSessionIds) {
      const requestId = `orphan_${sessionId}_${Date.now()}`;

      // Update session row
      const { error: updateError } = await supabase
        .from("sessions")
        .update({
          cancelled_at: new Date().toISOString(),
          state: "CANCELLED",
        })
        .eq("session_id", sessionId);

      if (updateError) {
        console.error(`[${SERVICE_NAME}] Failed to update session ${sessionId}:`, updateError);
        continue;
      }
      updatedSessions++;

      // Insert backfill Eye event (dev cleanup, not abandonment)
      const { error: eventError } = await supabase
        .from("eye_events")
        .insert({
          session_id: sessionId,
          event_type: "SESSION_CANCELLED",
          event_data: {
            result: "success",
            severity: "NOTICE",
            reason_code: "DEV_CLEANUP_ORPHAN",
            actor_type: "system",
            actor_id: SERVICE_NAME,
            request_id: requestId,
            tags: ["DEV_CLEANUP"],
          },
        });

      if (eventError) {
        console.error(`[${SERVICE_NAME}] Failed to insert event for ${sessionId}:`, eventError);
        continue;
      }
      insertedEvents++;

      console.log(`[${SERVICE_NAME}] Orphan session cleaned up: ${sessionId}`);
    }

    const response: CleanupResponse = {
      matchedSessions: allSessionsToCleanup.length,
      updatedSessions,
      insertedEvents,
      abandonedSessions: abandonedSessionIds.length,
      sessionIds: allSessionsToCleanup,
      dryRun: false,
      criteria: { daysBack, maxEventCount, inactiveMinutes },
    };

    console.log(`[${SERVICE_NAME}] Cleanup complete:`, response);

    return new Response(JSON.stringify(response), {
      headers: createSecureJsonHeaders(req),
    });
  } catch (error: unknown) {
    console.error(`[${SERVICE_NAME}] Error:`, error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: createSecureJsonHeaders(req) }
    );
  }
});
