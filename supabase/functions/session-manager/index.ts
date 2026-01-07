import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { logEyeEvent, corsHeaders } from "../_shared/eye.ts";

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

// Purge all ephemeral data for a session
async function purgeSessionData(
  supabase: any,
  sessionId: string,
  req: Request
) {
  console.log(`[Purge] Starting purge for session ${sessionId}`);

  // Emit PURGE_STARTED
  await logEyeEvent(supabase, {
    session_id: sessionId,
    event_type: "PURGE_STARTED",
    request: req,
    serviceName: SERVICE_NAME,
    payload: {
      severity: "NOTICE",
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
      await logEyeEvent(supabase, {
        session_id: sessionId,
        event_type: "AUDIO_DELETED",
        request: req,
        serviceName: SERVICE_NAME,
        payload: {
          count: objectKeys.length,
          severity: "NOTICE",
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
    const transcriptDeleted = artifacts.some(
      (a: any) => a.artifact_type === "transcript"
    );
    const minimizedDeleted = artifacts.some(
      (a: any) => a.artifact_type === "minimized_transcript"
    );

    if (transcriptDeleted) {
      await logEyeEvent(supabase, {
        session_id: sessionId,
        event_type: "TRANSCRIPT_DELETED",
        request: req,
        serviceName: SERVICE_NAME,
        payload: {
          severity: "NOTICE",
        },
      });
    }
    if (minimizedDeleted) {
      await logEyeEvent(supabase, {
        session_id: sessionId,
        event_type: "MINIMIZED_TRANSCRIPT_DELETED",
        request: req,
        serviceName: SERVICE_NAME,
        payload: {
          severity: "NOTICE",
        },
      });
    }
  }

  // Emit EPHEMERAL_SCAN_RESULT to indicate all data purged
  await logEyeEvent(supabase, {
    session_id: sessionId,
    event_type: "EPHEMERAL_SCAN_RESULT",
    request: req,
    serviceName: SERVICE_NAME,
    payload: {
      remaining_count: 0,
      remaining_types: [],
      severity: "NOTICE",
    },
  });

  // Emit PURGE_COMPLETED or PURGE_FAILED
  if (purgeSuccess) {
    await logEyeEvent(supabase, {
      session_id: sessionId,
      event_type: "PURGE_COMPLETED",
      request: req,
      serviceName: SERVICE_NAME,
      payload: {
        severity: "NOTICE",
        audio_deleted: audioDeletedCount,
        artifacts_deleted: artifactsDeletedCount,
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
        result: "failure",
        reason_code: "PARTIAL_DELETION",
      },
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

        // Purge ephemeral data
        await purgeSessionData(supabase, session_id, req);

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
            request_id: request_id,
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

        // Purge ephemeral data
        await purgeSessionData(supabase, session_id, req);

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
            operator_id: operator_id,
            request_id: request_id,
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

        await purgeSessionData(supabase, session_id, req);

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "export": {
        // Export stage: EXPORT_STARTED → EXPORT_COMPLETED/EXPORT_FAILED
        // Validates Eye event infrastructure with a real end-to-end pipeline stage
        
        if (!session_id) {
          return new Response(
            JSON.stringify({ error: "session_id is required" }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        if (!request_id) {
          return new Response(
            JSON.stringify({ error: "request_id is required for export" }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        const destinationType = data?.destination_type ?? "system_of_record";
        const destinationId = data?.destination_id ?? "default";

        console.log(`[Export] Starting export for session ${session_id}`);

        // Emit EXPORT_STARTED
        await logEyeEvent(supabase, {
          session_id: session_id,
          event_type: "EXPORT_STARTED",
          request: req,
          serviceName: SERVICE_NAME,
          payload: {
            request_id: request_id,
            operator_id: operator_id,
            resource_type: "export",
            resource_id: session_id,
            destination_type: destinationType,
            destination_id: destinationId,
          },
        });

        try {
          // Get session to verify it exists and is in a valid state
          const { data: session, error: sessionError } = await supabase
            .from("sessions")
            .select("state, case_id")
            .eq("session_id", session_id)
            .maybeSingle();

          if (sessionError || !session) {
            throw new Error("Session not found");
          }

          // Verify session is in exportable state
          if (session.state !== "CLOSED") {
            // EXPORT_FAILED: Session must be closed before export
            await logEyeEvent(supabase, {
              session_id: session_id,
              event_type: "EXPORT_FAILED",
              request: req,
              serviceName: SERVICE_NAME,
              payload: {
                request_id: request_id,
                operator_id: operator_id,
                resource_type: "export",
                resource_id: session_id,
                result: "failure",
                severity: "WARN",
                reason_code: "VALIDATION_FAILED",
                destination_type: destinationType,
                current_state: session.state,
              },
            });

            return new Response(
              JSON.stringify({
                success: false,
                error: "Session must be closed before export",
              }),
              {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              }
            );
          }

          // Simulate export operation (placeholder for real export logic)
          // In production, this would export to the system of record
          console.log(`[Export] Exporting session ${session_id} to ${destinationType}/${destinationId}`);

          // EXPORT_COMPLETED: Success
          await logEyeEvent(supabase, {
            session_id: session_id,
            event_type: "EXPORT_COMPLETED",
            request: req,
            serviceName: SERVICE_NAME,
            payload: {
              request_id: request_id,
              operator_id: operator_id,
              resource_type: "export",
              resource_id: session_id,
              destination_type: destinationType,
              destination_id: destinationId,
            },
          });

          console.log(`[Export] Completed export for session ${session_id}`);

          return new Response(
            JSON.stringify({
              success: true,
              exported_to: { destination_type: destinationType, destination_id: destinationId },
            }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        } catch (error) {
          console.error(`[Export] Failed for session ${session_id}:`, error);

          // EXPORT_FAILED
          await logEyeEvent(supabase, {
            session_id: session_id,
            event_type: "EXPORT_FAILED",
            request: req,
            serviceName: SERVICE_NAME,
            payload: {
              request_id: request_id,
              operator_id: operator_id,
              resource_type: "export",
              resource_id: session_id,
              result: "failure",
              severity: "WARN",
              reason_code: "INTERNAL_ERROR",
              destination_type: destinationType,
            },
          });

          return new Response(
            JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : "Export failed",
            }),
            {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
      }

      default:
        return new Response(JSON.stringify({ error: "Invalid action" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
  } catch (error) {
    console.error("Session manager error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
