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
  data?: {
    case_id?: string;
    case_label?: string;
    client_label?: string;
    interaction_type?: string;
    state?: string;
  };
}

// Log Eye event for audit trail (no PHI)
async function logEyeEvent(
  supabase: any,
  sessionId: string | null,
  eventType: string,
  eventData: Record<string, any> = {}
) {
  try {
    await supabase.from("eye_events").insert({
      session_id: sessionId,
      event_type: eventType,
      event_data: eventData,
    });
    console.log(`[Eye Event] ${eventType}`, eventData);
  } catch (error) {
    console.error("Failed to log Eye event:", error);
  }
}

// Purge all ephemeral data for a session
async function purgeSessionData(supabase: any, sessionId: string) {
  console.log(`[Purge] Starting purge for session ${sessionId}`);

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
    } else {
      console.log(`[Purge] Deleted ${objectKeys.length} audio files`);
      await logEyeEvent(supabase, sessionId, "AUDIO_FILES_PURGED", {
        count: objectKeys.length,
      });
    }
  }

  // 2. Delete transcription jobs (cascade will handle this with session delete)
  const { error: jobsError } = await supabase
    .from("transcription_jobs")
    .delete()
    .eq("session_id", sessionId);

  if (jobsError) {
    console.error("Failed to delete transcription jobs:", jobsError);
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
  } else if (artifacts) {
    console.log(`[Purge] Deleted ${artifacts.length} ephemeral artifacts`);
    await logEyeEvent(supabase, sessionId, "EPHEMERAL_ARTIFACTS_PURGED", {
      count: artifacts.length,
      types: artifacts.map((a: any) => a.artifact_type),
    });
  }

  console.log(`[Purge] Completed purge for session ${sessionId}`);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { action, session_id, data }: SessionRequest = await req.json();

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

        await logEyeEvent(supabase, newSessionId, "SESSION_CREATED", {
          case_id: data.case_id,
          interaction_type: data.interaction_type,
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

        await logEyeEvent(supabase, session_id, "SESSION_STATE_UPDATED", {
          new_state: data?.state,
        });

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

        await logEyeEvent(supabase, session_id, "SESSION_CLOSED", {});

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

        await logEyeEvent(supabase, session_id, "SESSION_CANCELLED", {});

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
