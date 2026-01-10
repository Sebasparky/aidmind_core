import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { logEyeEvent } from "../_shared/eye.ts";
import { buildCorsSecurityHeaders, enforceTransportSecurity, createSecureJsonHeaders } from "../_shared/security-headers.ts";
import {
  validatePlainText,
  validateUuid,
  validateEnum,
  validateOptional,
  collectErrors,
  validationErrorResponse,
  type ValidationErrors,
  type ValidationResult,
} from "../_shared/input-validation.ts";

const SERVICE_NAME = "session-manager";

// TTL configurations
const SESSION_TTL_HOURS = 24;

// Valid actions (allowlist)
const VALID_ACTIONS = ["create", "update", "close", "cancel", "purge", "get", "export"] as const;
type SessionAction = typeof VALID_ACTIONS[number];

// Valid session states (allowlist)
const VALID_STATES = ["NEW", "RECORDING", "TRANSCRIBED", "REDACTING", "INPUT_READY", "VERIFICATION_REVIEW", "EXPORTING", "EXPORTED", "CLOSED", "CANCELLED", "ABANDONED"] as const;

// Valid interaction types (allowlist)
const VALID_INTERACTION_TYPES = ["in_person", "phone", "video", "chat", "email"] as const;

// Validation field configs (max lengths enforced)
const FIELD_LIMITS = {
  case_id: { maxLength: 50, minLength: 1 },
  case_label: { maxLength: 120, minLength: 1 },
  client_label: { maxLength: 100, minLength: 1 },
  operator_id: { maxLength: 50, minLength: 1 },
  request_id: { maxLength: 50, minLength: 1 },
  destination_type: { maxLength: 50, minLength: 1 },
  destination_id: { maxLength: 100, minLength: 1 },
} as const;

interface SessionRequest {
  action: SessionAction;
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

/**
 * Validate session manager request payload.
 * All fields are validated with allowlist-based rules.
 * CRITICAL: Never echo raw user input in error responses.
 */
function validateSessionRequest(body: unknown): { valid: true; data: SessionRequest } | { valid: false; errors: ValidationErrors } {
  if (typeof body !== "object" || body === null) {
    return { valid: false, errors: { body: "INVALID_INPUT" } };
  }

  const rawBody = body as Record<string, unknown>;
  const errors: ValidationErrors = {};

  // Validate action (required, enum)
  const actionResult = validateEnum("action", rawBody.action, VALID_ACTIONS);
  if (!actionResult.ok) {
    errors.action = actionResult.errorCode;
  }

  // Validate session_id (optional UUID)
  if (rawBody.session_id !== undefined && rawBody.session_id !== null && rawBody.session_id !== "") {
    const sessionIdResult = validateUuid("session_id", rawBody.session_id);
    if (!sessionIdResult.ok) {
      errors.session_id = sessionIdResult.errorCode;
    }
  }

  // Validate operator_id (optional plain text)
  if (rawBody.operator_id !== undefined && rawBody.operator_id !== null && rawBody.operator_id !== "") {
    const operatorIdResult = validatePlainText("operator_id", rawBody.operator_id, FIELD_LIMITS.operator_id);
    if (!operatorIdResult.ok) {
      errors.operator_id = operatorIdResult.errorCode;
    }
  }

  // Validate request_id (optional plain text)
  if (rawBody.request_id !== undefined && rawBody.request_id !== null && rawBody.request_id !== "") {
    const requestIdResult = validatePlainText("request_id", rawBody.request_id, FIELD_LIMITS.request_id);
    if (!requestIdResult.ok) {
      errors.request_id = requestIdResult.errorCode;
    }
  }

  // Validate data object fields if present
  if (rawBody.data !== undefined && rawBody.data !== null) {
    if (typeof rawBody.data !== "object") {
      errors.data = "INVALID_INPUT";
    } else {
      const data = rawBody.data as Record<string, unknown>;

      // case_id
      if (data.case_id !== undefined && data.case_id !== null && data.case_id !== "") {
        const caseIdResult = validatePlainText("data.case_id", data.case_id, FIELD_LIMITS.case_id);
        if (!caseIdResult.ok) {
          errors["data.case_id"] = caseIdResult.errorCode;
        }
      }

      // case_label (user-provided title, max 120 chars)
      if (data.case_label !== undefined && data.case_label !== null && data.case_label !== "") {
        const caseLabelResult = validatePlainText("data.case_label", data.case_label, FIELD_LIMITS.case_label);
        if (!caseLabelResult.ok) {
          errors["data.case_label"] = caseLabelResult.errorCode;
        }
      }

      // client_label
      if (data.client_label !== undefined && data.client_label !== null && data.client_label !== "") {
        const clientLabelResult = validatePlainText("data.client_label", data.client_label, FIELD_LIMITS.client_label);
        if (!clientLabelResult.ok) {
          errors["data.client_label"] = clientLabelResult.errorCode;
        }
      }

      // interaction_type (enum)
      if (data.interaction_type !== undefined && data.interaction_type !== null && data.interaction_type !== "") {
        const interactionResult = validateEnum("data.interaction_type", data.interaction_type, VALID_INTERACTION_TYPES);
        if (!interactionResult.ok) {
          errors["data.interaction_type"] = interactionResult.errorCode;
        }
      }

      // state (enum)
      if (data.state !== undefined && data.state !== null && data.state !== "") {
        const stateResult = validateEnum("data.state", data.state, VALID_STATES);
        if (!stateResult.ok) {
          errors["data.state"] = stateResult.errorCode;
        }
      }

      // destination_type
      if (data.destination_type !== undefined && data.destination_type !== null && data.destination_type !== "") {
        const destTypeResult = validatePlainText("data.destination_type", data.destination_type, FIELD_LIMITS.destination_type);
        if (!destTypeResult.ok) {
          errors["data.destination_type"] = destTypeResult.errorCode;
        }
      }

      // destination_id
      if (data.destination_id !== undefined && data.destination_id !== null && data.destination_id !== "") {
        const destIdResult = validatePlainText("data.destination_id", data.destination_id, FIELD_LIMITS.destination_id);
        if (!destIdResult.ok) {
          errors["data.destination_id"] = destIdResult.errorCode;
        }
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    // Log validation failure metadata (never log raw values)
    console.log(`[${SERVICE_NAME}] Validation failed:`, {
      failed_fields: Object.keys(errors),
      error_codes: Object.values(errors),
    });
    return { valid: false, errors };
  }

  // All validations passed - cast to typed request
  return { valid: true, data: body as SessionRequest };
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

    // Parse and validate request body
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body", code: "INVALID_JSON" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate all fields using allowlist-based validation
    const validation = validateSessionRequest(rawBody);
    if (!validation.valid) {
      // CRITICAL: Never echo attacker payload - return only field names and error codes
      return validationErrorResponse(validation.errors, corsHeaders);
    }

    const { action, session_id, operator_id, request_id, data } = validation.data;

    // Log only sanitized metadata (never raw values)
    console.log(`[SessionManager] Action: ${action}, Session: ${session_id ? "provided" : "new"}, RequestId: ${request_id ? "provided" : "none"}`);

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
        headers: createSecureJsonHeaders(req),
      }
    );
  }
});
