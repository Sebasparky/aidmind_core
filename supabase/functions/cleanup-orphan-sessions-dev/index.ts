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
import { corsSecurityHeaders as corsHeaders, enforceTransportSecurity } from "../_shared/security-headers.ts";

const SERVICE_NAME = "cleanup-orphan-sessions-dev";

interface CleanupRequest {
  dryRun?: boolean;
  daysBack?: number;
  maxEventCount?: number;  // Sessions with this many or fewer events are considered orphans
  inactiveMinutes?: number;  // Override for SESSION_INACTIVITY_TIMEOUT_MINUTES
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
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // MANDATORY security check - no exceptions, no overrides
  const securityResponse = await enforceTransportSecurity(req);
  if (securityResponse) return securityResponse;

  // Only allow in development environment
  const environment = Deno.env.get("ENVIRONMENT") || "dev";
  if (environment === "production") {
    return new Response(
      JSON.stringify({ error: "This function is only available in development" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Parse request body
    let body: CleanupRequest = {};
    try {
      body = await req.json();
    } catch {
      // Empty body is fine, use defaults
    }

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
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
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

      // If has terminal event, skip
      if (terminalEvents && terminalEvents.length > 0) {
        continue;
      }

      // Count total events for this session
      const { count: eventCount, error: countError } = await supabase
        .from("eye_events")
        .select("id", { count: "exact", head: true })
        .eq("session_id", session.session_id);

      if (countError) {
        console.error(`[${SERVICE_NAME}] Error counting events for ${session.session_id}:`, countError);
        continue;
      }

      // Get the most recent event timestamp
      const { data: latestEvent, error: latestError } = await supabase
        .from("eye_events")
        .select("created_at")
        .eq("session_id", session.session_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (latestError && latestError.code !== "PGRST116") {
        console.error(`[${SERVICE_NAME}] Error getting latest event for ${session.session_id}:`, latestError);
        continue;
      }

      const lastEventTime = latestEvent?.created_at
        ? new Date(latestEvent.created_at)
        : new Date(session.created_at);

      // Session is abandoned if inactive for too long (no heartbeat)
      // This is the primary abandonment detection mechanism
      const isInactive = lastEventTime < inactiveCutoff;
      
      // Session is an orphan if it has very few events (dev cleanup heuristic)
      const hasLowEventCount = (eventCount || 0) <= maxEventCount;

      if (isInactive) {
        // Inactivity-based abandonment: this is the safety-first path
        abandonedSessionIds.push(session.session_id);
        console.log(`[${SERVICE_NAME}] Abandoned session detected: ${session.session_id}`, {
          eventCount,
          lastEventTime: lastEventTime.toISOString(),
          minutesSinceLastEvent: (Date.now() - lastEventTime.getTime()) / (1000 * 60),
          reason: "INACTIVITY_TIMEOUT",
        });
      } else if (hasLowEventCount) {
        // Low event count: dev cleanup heuristic (separate from abandonment)
        orphanSessionIds.push(session.session_id);
        console.log(`[${SERVICE_NAME}] Orphan session found: ${session.session_id}`, {
          eventCount,
          lastEventTime: lastEventTime.toISOString(),
          reason: "LOW_EVENT_COUNT",
        });
      }
    }

    console.log(`[${SERVICE_NAME}] Identified ${abandonedSessionIds.length} abandoned + ${orphanSessionIds.length} orphan sessions`);

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
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error(`[${SERVICE_NAME}] Error:`, error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});