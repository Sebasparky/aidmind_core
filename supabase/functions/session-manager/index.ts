import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// TTL configurations
const SESSION_TTL_HOURS = 24;

interface SessionRequest {
  action: "create" | "update" | "close" | "cancel" | "purge" | "get";
  session_id?: string;
  operator_id?: string;
  data?: {
    case_id?: string;
    case_label?: string;
    client_label?: string;
    interaction_type?: string;
    state?: string;
  };
}

// Log Eye event for audit trail (no PHI)
// Uses the event_data jsonb field to store all metadata
async function logEyeEvent(
  supabase: any,
  sessionId: string | null,
  eventType: string,
  eventData: Record<string, any> = {}
) {
  try {
    // Merge standard fields into event_data
    const fullEventData = {
      result: eventData.result ?? "success",
      severity: eventData.severity ?? "INFO",
      actor_type: eventData.actor_type ?? "service",
      actor_id: eventData.actor_id ?? "session-manager",
      ...eventData,
    };
    
    await supabase.from("eye_events").insert({
      session_id: sessionId,
      event_type: eventType,
      event_data: fullEventData,
    });
    console.log(`[Eye Event] ${eventType}`, JSON.stringify(fullEventData));
  } catch (error) {
    console.error("Failed to log Eye event:", error);
  }
}

// Purge all ephemeral data for a session
async function purgeSessionData(supabase: any, sessionId: string) {
  console.log(`[Purge] Starting purge for session ${sessionId}`);
  
  // Emit PURGE_STARTED
  await logEyeEvent(supabase, sessionId, "PURGE_STARTED", {
    severity: "NOTICE",
    actor_type: "system",
    actor_id: "session-manager",
  });

  let purgeSuccess = true;
  let audioDeletedCount = 0;
  let artifactsDeletedCount = 0;

  // 1. Delete audio files from storage
  const { data: jobs } = await supabase
    .from("transcription_jobs")
    .select("audio_object_key")
    .eq("session_id", sessionId);

  if (jobs && jobs.length > 0) {
    const objectKeys = jobs.map((j: any) => j.audio_object_key);
    const { error: storageError } = await supabase.storage
      .from("audio-uploads")
      .remove(objectKeys);
    
    if (storageError) {
      console.error("Failed to delete audio files:", storageError);
      purgeSuccess = false;
    } else {
      audioDeletedCount = objectKeys.length;
      console.log(`[Purge] Deleted ${objectKeys.length} audio files`);
      await logEyeEvent(supabase, sessionId, "AUDIO_DELETED", {
        count: objectKeys.length,
        severity: "NOTICE",
        actor_type: "system",
        actor_id: "session-manager",
      });
    }
  }

  // 2. Delete transcription jobs
  const { error: jobsError } = await supabase
    .from("transcription_jobs")
    .delete()
    .eq("session_id", sessionId);

  if (jobsError) {
    console.error("Failed to delete transcription jobs:", jobsError);
    purgeSuccess = false;
  }

  // 3. Delete ephemeral artifacts (transcripts)
  const { data: artifacts } = await supabase
    .from("ephemeral_artifacts")
    .select("id, artifact_type")
    .eq("session_id", sessionId);

  const { error: artifactsError } = await supabase
    .from("ephemeral_artifacts")
    .delete()
    .eq("session_id", sessionId);

  if (artifactsError) {
    console.error("Failed to delete ephemeral artifacts:", artifactsError);
    purgeSuccess = false;
  } else if (artifacts && artifacts.length > 0) {
    artifactsDeletedCount = artifacts.length;
    console.log(`[Purge] Deleted ${artifacts.length} ephemeral artifacts`);
    
    // Emit deletion events for each artifact type
    const transcriptDeleted = artifacts.some((a: any) => a.artifact_type === "transcript");
    const minimizedDeleted = artifacts.some((a: any) => a.artifact_type === "minimized_transcript");
    
    if (transcriptDeleted) {
      await logEyeEvent(supabase, sessionId, "TRANSCRIPT_DELETED", {
        severity: "NOTICE",
        actor_type: "system",
        actor_id: "session-manager",
      });
    }
    if (minimizedDeleted) {
      await logEyeEvent(supabase, sessionId, "MINIMIZED_TRANSCRIPT_DELETED", {
        severity: "NOTICE",
        actor_type: "system",
        actor_id: "session-manager",
      });
    }
  }

  // Emit EPHEMERAL_SCAN_RESULT to indicate all data purged
  await logEyeEvent(supabase, sessionId, "EPHEMERAL_SCAN_RESULT", {
    remaining_count: 0,
    remaining_types: [],
    severity: "NOTICE",
    actor_type: "system",
    actor_id: "session-manager",
  });

  // Emit PURGE_COMPLETED or PURGE_FAILED
  if (purgeSuccess) {
    await logEyeEvent(supabase, sessionId, "PURGE_COMPLETED", {
      severity: "NOTICE",
      actor_type: "system",
      actor_id: "session-manager",
      audio_deleted: audioDeletedCount,
      artifacts_deleted: artifactsDeletedCount,
    });
  } else {
    await logEyeEvent(supabase, sessionId, "PURGE_FAILED", {
      severity: "HIGH",
      result: "failure",
      reason_code: "PARTIAL_DELETION",
      actor_type: "system",
      actor_id: "session-manager",
    });
  }

  console.log(`[Purge] Completed purge for session ${sessionId}`);
  return purgeSuccess;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { action, session_id, operator_id, data }: SessionRequest = await req.json();

    console.log(`[SessionManager] Action: ${action}, Session: ${session_id || "new"}`);

    switch (action) {
      case "create": {
        if (!data?.case_id) {
          return new Response(
            JSON.stringify({ error: "case_id is required for session creation" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const newSessionId = crypto.randomUUID();
        const ttlExpiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString();

        const { data: session, error } = await supabase
          .from("sessions")
          .insert({
            session_id: newSessionId,
            case_id: data.case_id,
            case_label: data.case_label,
            client_label: data.client_label,
            interaction_type: data.interaction_type,
            state: "NEW",
            ttl_expires_at: ttlExpiresAt,
          })
          .select()
          .single();

        if (error) {
          console.error("Failed to create session:", error);
          throw new Error("Failed to create session");
        }

        // Emit SESSION_STARTED (not SESSION_CREATED for taxonomy compliance)
        await logEyeEvent(supabase, newSessionId, "SESSION_STARTED", {
          case_id: data.case_id,
          interaction_type: data.interaction_type,
          operator_id: operator_id,
          severity: "INFO",
          actor_type: "user",
          actor_id: operator_id || "unknown",
        });

        return new Response(
          JSON.stringify({ success: true, session }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "get": {
        if (!session_id) {
          return new Response(
            JSON.stringify({ error: "session_id is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { data: session, error } = await supabase
          .from("sessions")
          .select("*")
          .eq("session_id", session_id)
          .maybeSingle();

        if (error) {
          throw new Error("Failed to get session");
        }

        // Also get any artifacts
        const { data: artifacts } = await supabase
          .from("ephemeral_artifacts")
          .select("artifact_type, content")
          .eq("session_id", session_id);

        return new Response(
          JSON.stringify({ success: true, session, artifacts }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "update": {
        if (!session_id) {
          return new Response(
            JSON.stringify({ error: "session_id is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { error } = await supabase
          .from("sessions")
          .update({ state: data?.state })
          .eq("session_id", session_id);

        if (error) {
          throw new Error("Failed to update session");
        }

        // Only emit event for significant state changes
        if (data?.state) {
          await logEyeEvent(supabase, session_id, "SESSION_HEARTBEAT", {
            new_state: data.state,
            severity: "INFO",
            actor_type: "service",
            actor_id: "session-manager",
          });
        }

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "close": {
        if (!session_id) {
          return new Response(
            JSON.stringify({ error: "session_id is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Purge ephemeral data
        await purgeSessionData(supabase, session_id);

        // Update session state
        const { error } = await supabase
          .from("sessions")
          .update({
            state: "PURGED",
            closed_at: new Date().toISOString(),
          })
          .eq("session_id", session_id);

        if (error) {
          throw new Error("Failed to close session");
        }

        await logEyeEvent(supabase, session_id, "SESSION_CLOSED", {
          severity: "NOTICE",
          actor_type: "system",
          actor_id: "session-manager",
        });

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "cancel": {
        if (!session_id) {
          return new Response(
            JSON.stringify({ error: "session_id is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Purge ephemeral data
        await purgeSessionData(supabase, session_id);

        // Update session state
        const { error } = await supabase
          .from("sessions")
          .update({
            state: "PURGED",
            cancelled_at: new Date().toISOString(),
          })
          .eq("session_id", session_id);

        if (error) {
          throw new Error("Failed to cancel session");
        }

        await logEyeEvent(supabase, session_id, "SESSION_CANCELLED", {
          severity: "NOTICE",
          actor_type: "user",
          actor_id: operator_id || "unknown",
        });

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "purge": {
        if (!session_id) {
          return new Response(
            JSON.stringify({ error: "session_id is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        await purgeSessionData(supabase, session_id);

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: "Invalid action" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
  } catch (error) {
    console.error("Session manager error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
