import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CleanupRequest {
  dryRun?: boolean;
  daysBack?: number;
  maxEventCount?: number; // Sessions with this many or fewer events are considered orphans
  inactiveMinutes?: number; // Sessions with no events in this many minutes are considered abandoned
}

interface CleanupResponse {
  matchedSessions: number;
  updatedSessions: number;
  insertedEvents: number;
  sessionIds: string[];
  dryRun: boolean;
  criteria: {
    daysBack: number;
    maxEventCount: number;
    inactiveMinutes: number;
  };
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

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

    const dryRun = body.dryRun ?? true; // Default to dry run for safety
    const daysBack = body.daysBack ?? 7;
    const maxEventCount = body.maxEventCount ?? 3; // Sessions with 3 or fewer events
    const inactiveMinutes = body.inactiveMinutes ?? 30; // No events in 30 minutes

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);

    const inactiveCutoff = new Date();
    inactiveCutoff.setMinutes(inactiveCutoff.getMinutes() - inactiveMinutes);

    console.log(`[cleanup-orphan-sessions-dev] Starting cleanup with params:`, {
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
      console.error("[cleanup-orphan-sessions-dev] Error fetching sessions:", sessionsError);
      throw sessionsError;
    }

    console.log(`[cleanup-orphan-sessions-dev] Found ${openSessions?.length || 0} open sessions`);

    if (!openSessions || openSessions.length === 0) {
      return new Response(
        JSON.stringify({
          matchedSessions: 0,
          updatedSessions: 0,
          insertedEvents: 0,
          sessionIds: [],
          dryRun,
          criteria: { daysBack, maxEventCount, inactiveMinutes },
        } as CleanupResponse),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 2: For each open session, check if it has terminal events or is abandoned
    const orphanSessionIds: string[] = [];

    for (const session of openSessions) {
      // Check for terminal events
      const { data: terminalEvents, error: terminalError } = await supabase
        .from("eye_events")
        .select("id")
        .eq("session_id", session.session_id)
        .in("event_type", ["SESSION_CLOSED", "SESSION_CANCELLED", "WIP_BUNDLE_EXPORTED"])
        .limit(1);

      if (terminalError) {
        console.error(`[cleanup-orphan-sessions-dev] Error checking terminal events for ${session.session_id}:`, terminalError);
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
        console.error(`[cleanup-orphan-sessions-dev] Error counting events for ${session.session_id}:`, countError);
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
        console.error(`[cleanup-orphan-sessions-dev] Error getting latest event for ${session.session_id}:`, latestError);
        continue;
      }

      const lastEventTime = latestEvent?.created_at
        ? new Date(latestEvent.created_at)
        : new Date(session.created_at);

      // Session is orphan if:
      // 1. Has very few events (maxEventCount or fewer), OR
      // 2. Has been inactive for too long (no events in inactiveMinutes)
      const hasLowEventCount = (eventCount || 0) <= maxEventCount;
      const isInactive = lastEventTime < inactiveCutoff;

      if (hasLowEventCount || isInactive) {
        orphanSessionIds.push(session.session_id);
        console.log(`[cleanup-orphan-sessions-dev] Orphan session found: ${session.session_id}`, {
          eventCount,
          lastEventTime: lastEventTime.toISOString(),
          hasLowEventCount,
          isInactive,
        });
      }
    }

    console.log(`[cleanup-orphan-sessions-dev] Identified ${orphanSessionIds.length} orphan sessions`);

    if (orphanSessionIds.length === 0) {
      return new Response(
        JSON.stringify({
          matchedSessions: 0,
          updatedSessions: 0,
          insertedEvents: 0,
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
          matchedSessions: orphanSessionIds.length,
          updatedSessions: 0,
          insertedEvents: 0,
          sessionIds: orphanSessionIds,
          dryRun: true,
          criteria: { daysBack, maxEventCount, inactiveMinutes },
        } as CleanupResponse),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 3: Soft cleanup - update sessions and insert terminal events
    let updatedSessions = 0;
    let insertedEvents = 0;

    for (const sessionId of orphanSessionIds) {
      // Update session row
      const { error: updateError } = await supabase
        .from("sessions")
        .update({
          cancelled_at: new Date().toISOString(),
          state: "CANCELLED",
        })
        .eq("session_id", sessionId);

      if (updateError) {
        console.error(`[cleanup-orphan-sessions-dev] Failed to update session ${sessionId}:`, updateError);
        continue;
      }
      updatedSessions++;

      // Insert backfill Eye event
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
            actor_id: "cleanup-orphan-sessions-dev",
            tags: ["DEV_CLEANUP"],
          },
        });

      if (eventError) {
        console.error(`[cleanup-orphan-sessions-dev] Failed to insert event for ${sessionId}:`, eventError);
        continue;
      }
      insertedEvents++;

      console.log(`[cleanup-orphan-sessions-dev] Cleaned up session: ${sessionId}`);
    }

    const response: CleanupResponse = {
      matchedSessions: orphanSessionIds.length,
      updatedSessions,
      insertedEvents,
      sessionIds: orphanSessionIds,
      dryRun: false,
      criteria: { daysBack, maxEventCount, inactiveMinutes },
    };

    console.log(`[cleanup-orphan-sessions-dev] Cleanup complete:`, response);

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("[cleanup-orphan-sessions-dev] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
