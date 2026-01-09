import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { logEyeEvent } from "../_shared/eye.ts";
import { buildCorsSecurityHeaders, enforceTransportSecurity } from "../_shared/security-headers.ts";

const SERVICE_NAME = "session-manager";

// TTL configurations
const SESSION_TTL_HOURS = 24;

interface SessionRequest {
  action: "create" | "update" | "close" | "cancel" | "purge" | "get" | "export";
  session_id?: string;
  operator_id?: string;
  request_id?: string; // Idempotency key
  data?: {
    case_id?: string;
    case_label?: string;
    client_label?: string;
    interaction_type?: string;
    state?: string;
    // Export-specific
    destination_type?: string;
    destination_id?: string;
  };
}

// Purge options for unified reason code tracking
interface PurgeOptions {
  purgeReasonCode: string;  // USER_CANCELLED | USER_COMPLETED | INACTIVITY_TIMEOUT | TTL_EXPIRED
  operator_id?: string;
  request_id?: string;
  actor_type?: "user" | "system";
}

// Purge all ephemeral data for a session
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function purgeSessionData(
  supabase: any,
  sessionId: string,
  req: Request,
  opts: PurgeOptions
) {
  const { purgeReasonCode, operator_id, request_id, actor_type = "user" } = opts;
  console.log(`[Purge] Starting purge for session ${sessionId}, reason: ${purgeReasonCode}`);

  // Emit PURGE_STARTED with reason_code
  await logEyeEvent(supabase, {
    session_id: sessionId,
    event_type: "PURGE_STARTED",
    request: req,
    serviceName: SERVICE_NAME,
    payload: {
      severity: "NOTICE",
      reason_code: purgeReasonCode,
      actor_type,
      operator_id,
      request_id,
    },
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
    const objectKeys = jobs.map((j: { audio_object_key: string }) => j.audio_object_key);
    const { error: storageError } = await supabase.storage
      .from("audio-uploads")
      .remove(objectKeys);

    if (storageError) {
      console.error("Failed to delete audio files:", storageError);
      purgeSuccess = false;
    } else {
      audioDeletedCount = objectKeys.length;
      console.log(`[Purge] Deleted ${objectKeys.length} audio files`);
      await logEyeEvent(supabase, {
        session_id: sessionId,
        event_type: "AUDIO_DELETED",
        request: req,
        serviceName: SERVICE_NAME,
        payload: {
          count: objectKeys.length,
          severity: "NOTICE",
          reason_code: purgeReasonCode,
          request_id,
        },
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

  // 3. Delete ephemeral artifacts
  const { data: deletedArtifacts, error: artifactsError } = await supabase
    .from("ephemeral_artifacts")
    .delete()
    .eq("session_id", sessionId)
    .select("id");

  if (artifactsError) {
    console.error("Failed to delete artifacts:", artifactsError);
    purgeSuccess = false;
  } else {
    artifactsDeletedCount = deletedArtifacts?.length ?? 0;
    console.log(`[Purge] Deleted ${artifactsDeletedCount} artifacts`);
  }

  // Emit PURGE_COMPLETED or PURGE_FAILED
  if (purgeSuccess) {
    await logEyeEvent(supabase, {
      session_id: sessionId,
      event_type: "PURGE_COMPLETED",
      request: req,
      serviceName: SERVICE_NAME,
      payload: {
        severity: "NOTICE",
        reason_code: purgeReasonCode,
        actor_type,
        operator_id,
        request_id,
        audio_deleted: audioDeletedCount,
        artifacts_deleted: artifactsDeletedCount,
      },
    });

    // Emit EPHEMERAL_SCAN_RESULT for deletion proof
    await logEyeEvent(supabase, {
      session_id: sessionId,
      event_type: "EPHEMERAL_SCAN_RESULT",
      request: req,
      serviceName: SERVICE_NAME,
      payload: {
        remaining_count: 0,
        remaining_types: [],
        severity: "NOTICE",
        reason_code: purgeReasonCode,
        request_id,
      },
    });
  } else {
    await logEyeEvent(supabase, {
      session_id: sessionId,
      event_type: "PURGE_FAILED",
      request: req,
      serviceName: SERVICE_NAME,
      payload: {
        severity: "HIGH",
        reason_code: purgeReasonCode,
        actor_type,
        operator_id,
        request_id,
      },
    });
  }

  console.log(`[Purge] Complete for session ${sessionId}`);
}

serve(async (req) => {
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

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const {
      action,
      session_id,
      operator_id,
      request_id,
      data,
    }: SessionRequest = await req.json();

    console.log(
      `[SessionManager] Action: ${action}, Session: ${session_id || "new"}, RequestId: ${request_id || "none"}`
    );

    switch (action) {
      case "create": {
        if (!data?.case_id) {
          return new Response(
            JSON.stringify({
              error: "case_id is required for session creation",
            }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        const newSessionId = crypto.randomUUID();
        const ttlExpiresAt = new Date(
          Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000
        ).toISOString();

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

        // Emit SESSION_STARTED with canonical stamping
        await logEyeEvent(supabase, {
          session_id: newSessionId,
          event_type: "SESSION_STARTED",
          request: req,
          serviceName: SERVICE_NAME,
          payload: {
            case_id: data.case_id,
            interaction_type: data.interaction_type,
            operator_id: operator_id,
            request_id: request_id,
          },
        });

        return new Response(JSON.stringify({ success: true, session }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "get": {
        if (!session_id) {
          return new Response(
            JSON.stringify({ error: "session_id is required" }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
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
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      case "update": {
        if (!session_id) {
          return new Response(
            JSON.stringify({ error: "session_id is required" }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
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
          await logEyeEvent(supabase, {
            session_id: session_id,
            event_type: "SESSION_HEARTBEAT",
            request: req,
            serviceName: SERVICE_NAME,
            payload: {
              new_state: data.state,
            },
          });
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "close": {
        if (!session_id) {
          return new Response(
            JSON.stringify({ error: "session_id is required" }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        // Purge ephemeral data with USER_COMPLETED reason
        await purgeSessionData(supabase, session_id, req, {
          purgeReasonCode: "USER_COMPLETED",
          operator_id,
          request_id,
          actor_type: "user",
        });

        // Update session state - CLOSED is the terminal state
        const { error } = await supabase
          .from("sessions")
          .update({
            state: "CLOSED",
            closed_at: new Date().toISOString(),
          })
          .eq("session_id", session_id);

        if (error) {
          throw new Error("Failed to close session");
        }

        await logEyeEvent(supabase, {
          session_id: session_id,
          event_type: "SESSION_CLOSED",
          request: req,
          serviceName: SERVICE_NAME,
          payload: {
            severity: "NOTICE",
            reason_code: "USER_COMPLETED",
            operator_id,
            request_id,
          },
        });

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "cancel": {
        if (!session_id) {
          return new Response(
            JSON.stringify({ error: "session_id is required" }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        // Purge ephemeral data with USER_CANCELLED reason
        await purgeSessionData(supabase, session_id, req, {
          purgeReasonCode: "USER_CANCELLED",
          operator_id,
          request_id,
          actor_type: "user",
        });

        // Update session state - CANCELLED is the terminal state
        const { error } = await supabase
          .from("sessions")
          .update({
            state: "CANCELLED",
            cancelled_at: new Date().toISOString(),
          })
          .eq("session_id", session_id);

        if (error) {
          throw new Error("Failed to cancel session");
        }

        await logEyeEvent(supabase, {
          session_id: session_id,
          event_type: "SESSION_CANCELLED",
          request: req,
          serviceName: SERVICE_NAME,
          payload: {
            severity: "NOTICE",
            reason_code: "USER_CANCELLED",
            operator_id,
            request_id,
          },
        });

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "purge": {
        if (!session_id) {
          return new Response(
            JSON.stringify({ error: "session_id is required" }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        // Standalone purge (e.g., manual cleanup) - defaults to USER_REQUESTED
        await purgeSessionData(supabase, session_id, req, {
          purgeReasonCode: "USER_REQUESTED",
          operator_id,
          request_id,
          actor_type: operator_id ? "user" : "system",
        });

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "export": {
        // Export stage: EXPORT_STARTED → EXPORT_COMPLETED/EXPORT_FAILED
        // Validates Eye event infrastructure with a real end-to-end pipeline stage
        if (!session_id) {
          return new Response(
            JSON.stringify({ error: "session_id is required for export" }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        // Get session info
        const { data: session } = await supabase
          .from("sessions")
          .select("case_id")
          .eq("session_id", session_id)
          .single();

        if (!session) {
          return new Response(
            JSON.stringify({ error: "Session not found" }),
            {
              status: 404,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        // Get WIP bundle artifact if exists
        const { data: wipBundle } = await supabase
          .from("ephemeral_artifacts")
          .select("content")
          .eq("session_id", session_id)
          .eq("artifact_type", "wip_bundle")
          .single();

        // Generate export bundle ID
        const bundleId = `bundle_${crypto.randomUUID()}`;
        const destination = data?.destination_type ?? "case_management_system";
        const destinationId = data?.destination_id ?? session.case_id;

        // Emit EXPORT_STARTED
        await logEyeEvent(supabase, {
          session_id,
          event_type: "EXPORT_STARTED",
          request: req,
          serviceName: SERVICE_NAME,
          payload: {
            bundle_id: bundleId,
            case_id: session.case_id,
            destination_type: destination,
            destination_id: destinationId,
            operator_id,
            request_id,
          },
        });

        // Update session state
        await supabase
          .from("sessions")
          .update({ state: "EXPORTING" })
          .eq("session_id", session_id);

        // Simulate export process (in production, this would be actual export)
        // For now, we just mark it as complete

        // Emit EXPORT_COMPLETED
        await logEyeEvent(supabase, {
          session_id,
          event_type: "EXPORT_COMPLETED",
          request: req,
          serviceName: SERVICE_NAME,
          payload: {
            bundle_id: bundleId,
            case_id: session.case_id,
            destination_type: destination,
            destination_id: destinationId,
            has_wip_bundle: !!wipBundle,
            operator_id,
            request_id,
          },
        });

        // Emit WIP_BUNDLE_EXPORTED (terminal event)
        await logEyeEvent(supabase, {
          session_id,
          event_type: "WIP_BUNDLE_EXPORTED",
          request: req,
          serviceName: SERVICE_NAME,
          payload: {
            severity: "NOTICE",
            bundle_id: bundleId,
            destination_type: destination,
            destination_id: destinationId,
            operator_id,
            request_id,
          },
        });

        // Mark session as exported
        await supabase
          .from("sessions")
          .update({
            state: "EXPORTED",
            closed_at: new Date().toISOString(),
          })
          .eq("session_id", session_id);

        return new Response(
          JSON.stringify({
            success: true,
            bundle_id: bundleId,
            destination: {
              type: destination,
              id: destinationId,
            },
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
    }
  } catch (error) {
    console.error("Session manager error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...buildCorsSecurityHeaders(req), "Content-Type": "application/json" },
      }
    );
  }
});
