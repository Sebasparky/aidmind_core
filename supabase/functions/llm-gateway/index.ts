/**
 * LLM Gateway Edge Function
 * 
 * Proxies LLM calls with mandatory authorization check.
 * Emits LLM_CALL_STARTED, LLM_CALL_COMPLETED, or LLM_CALL_FAILED events.
 * 
 * CRITICAL: If no AI_USAGE_APPROVED_BY_SUPERVISOR exists, the call is BLOCKED.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logEyeEvent } from "../_shared/eye.ts";
import { requireUser, assertSessionAccess } from "../_shared/require-user.ts";
import { 
  buildCorsSecurityHeaders, 
  enforceTransportSecurity,
  secureFetch,
  createSecureJsonHeaders,
} from "../_shared/security-headers.ts";
import { checkLLMAuthorization } from "../_shared/llm-authorization.ts";
import {
  validateUuid,
  validatePlainText,
  validateEnum,
  validationErrorResponse,
  type ValidationErrors,
} from "../_shared/input-validation.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

const SERVICE_NAME = "llm-gateway";

// Valid LLM models (allowlist)
const VALID_MODELS = [
  "google/gemini-2.5-flash",
  "google/gemini-2.0-flash",
  "google/gemini-3-flash-preview",
  "anthropic/claude-3-5-sonnet",
  "anthropic/claude-3-5-haiku",
  "openai/gpt-4o",
  "openai/gpt-4o-mini",
] as const;

// Validation field configs
const FIELD_LIMITS = {
  operator_id: { maxLength: 50, minLength: 1 },
} as const;

interface LLMRequest {
  session_id: string;
  operator_id?: string;
  messages: Array<{ role: string; content: string }>;
  model?: string;
}

/**
 * Validate LLM gateway request payload.
 * CRITICAL: Never echo raw user input in error responses.
 */
function validateLLMRequest(body: unknown): { valid: true; data: LLMRequest } | { valid: false; errors: ValidationErrors } {
  if (typeof body !== "object" || body === null) {
    return { valid: false, errors: { body: "INVALID_INPUT" } };
  }

  const rawBody = body as Record<string, unknown>;
  const errors: ValidationErrors = {};

  // Validate session_id (required UUID)
  const sessionIdResult = validateUuid("session_id", rawBody.session_id);
  if (!sessionIdResult.ok) {
    errors.session_id = sessionIdResult.errorCode;
  }

  // Validate operator_id (optional plain text)
  if (rawBody.operator_id !== undefined && rawBody.operator_id !== null && rawBody.operator_id !== "") {
    const operatorIdResult = validatePlainText("operator_id", rawBody.operator_id, FIELD_LIMITS.operator_id);
    if (!operatorIdResult.ok) {
      errors.operator_id = operatorIdResult.errorCode;
    }
  }

  // Validate messages array
  if (!Array.isArray(rawBody.messages)) {
    errors.messages = "INVALID_INPUT";
  } else if (rawBody.messages.length === 0) {
    errors.messages = "REQUIRED";
  } else {
    // Validate each message
    for (let i = 0; i < rawBody.messages.length; i++) {
      const msg = rawBody.messages[i];
      if (typeof msg !== "object" || msg === null) {
        errors[`messages[${i}]`] = "INVALID_INPUT";
        continue;
      }
      
      const msgObj = msg as Record<string, unknown>;
      
      // Validate role (enum: user, assistant, system)
      const roleResult = validateEnum(`messages[${i}].role`, msgObj.role, ["user", "assistant", "system"] as const);
      if (!roleResult.ok) {
        errors[`messages[${i}].role`] = roleResult.errorCode;
      }
      
      // Validate content (plain text, max 50000 chars for LLM context)
      const contentResult = validatePlainText(`messages[${i}].content`, msgObj.content, { maxLength: 50000, minLength: 1, preserveNewlines: true });
      if (!contentResult.ok) {
        errors[`messages[${i}].content`] = contentResult.errorCode;
      }
    }
  }

  // Validate model (optional, defaults to google/gemini-2.5-flash)
  if (rawBody.model !== undefined && rawBody.model !== null && rawBody.model !== "") {
    const modelResult = validateEnum("model", rawBody.model, VALID_MODELS);
    if (!modelResult.ok) {
      errors.model = modelResult.errorCode;
    }
  }

  if (Object.keys(errors).length > 0) {
    console.log(`[${SERVICE_NAME}] Validation failed:`, {
      failed_fields: Object.keys(errors),
      error_codes: Object.values(errors),
    });
    return { valid: false, errors };
  }

  return { valid: true, data: body as LLMRequest };
}

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

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const requestId = crypto.randomUUID();
  let tenantId = "unresolved"; // set from the verified session below; never from a client header

  try {
    // Parse and validate request body
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body", code: "INVALID_JSON" }),
        { status: 400, headers: createSecureJsonHeaders(req) }
      );
    }

    // Validate all fields using allowlist-based validation
    const validation = validateLLMRequest(rawBody);
    if (!validation.valid) {
      // CRITICAL: Never echo attacker payload - return only field names and error codes
      return validationErrorResponse(validation.errors, corsHeaders);
    }

    const { session_id, operator_id, messages, model = "google/gemini-2.5-flash" } = validation.data;

    // Log only sanitized metadata (never raw values)
    console.log(`[${SERVICE_NAME}] Request: session=${session_id ? "provided" : "missing"}, messages=${messages.length}`);

    // session_id already validated as required UUID above - this check is redundant but kept for safety
    if (!session_id) {
      return new Response(
        JSON.stringify({ error: "session_id is required", code: "REQUIRED" }),
        { status: 400, headers: createSecureJsonHeaders(req) }
      );
    }

    // ============================================================
    // AUTHORIZATION CHECK (MANDATORY)
    // ============================================================
    // ── Authenticate caller and bind the request to a session they may access ──
    const callerAuth = await requireUser(req, supabase);
    if (!callerAuth.ok) {
      return new Response(JSON.stringify({ error: callerAuth.error, code: "UNAUTHORIZED" }),
        { status: callerAuth.status, headers: createSecureJsonHeaders(req) });
    }
    const sessionAccess = await assertSessionAccess(supabase, callerAuth.caller, session_id, { allowSupervisor: true });
    if (!sessionAccess.ok) {
      return new Response(JSON.stringify({ error: sessionAccess.error, code: "SESSION_ACCESS_DENIED" }),
        { status: sessionAccess.status, headers: createSecureJsonHeaders(req) });
    }
    tenantId = sessionAccess.tenantId;

    const authResult = await checkLLMAuthorization(supabase, {
      tenantId,
      scope: "organization",
      sessionId: session_id,
      operatorId: operator_id,
      request: req,
      serviceName: SERVICE_NAME,
      requestId,
    });

    if (!authResult.authorized) {
      console.log(`[LLM Gateway] BLOCKED: ${authResult.reason}`);
      return new Response(
        JSON.stringify({
          error: "AI usage not authorized",
          reason: authResult.reason,
          message: "AI usage must be approved by a supervisor before LLM calls are allowed.",
        }),
        { status: 403, headers: createSecureJsonHeaders(req) }
      );
    }

    // ============================================================
    // EMIT LLM_CALL_STARTED
    // ============================================================
    await logEyeEvent(supabase, {
      session_id,
      event_type: "LLM_CALL_STARTED",
      request: req,
      serviceName: SERVICE_NAME,
      payload: {
        operator_id,
        request_id: requestId,
        result: "success",
        severity: "INFO",
        resource_type: "llm_call",
        resource_id: requestId,
        model,
        data_retention_mode: "zero",
        approval_event_id: authResult.approvalEventId,
      },
    });

    // ============================================================
    // MAKE LLM CALL (via Lovable AI Gateway)
    // ============================================================
    if (!LOVABLE_API_KEY) {
      await logEyeEvent(supabase, {
        session_id,
        event_type: "LLM_CALL_FAILED",
        request: req,
        serviceName: SERVICE_NAME,
        payload: {
          operator_id,
          request_id: requestId,
          result: "failure",
          severity: "WARN",
          resource_type: "llm_call",
          resource_id: requestId,
          error_code: "MISSING_API_KEY",
          error_message: "LOVABLE_API_KEY not configured",
        },
      });

      return new Response(
        JSON.stringify({ error: "LLM service not configured" }),
        { status: 500, headers: createSecureJsonHeaders(req) }
      );
    }

    // Use secureFetch for internal service communication (treats network as hostile)
    const llmResult = await secureFetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_completion_tokens: 1000,
      }),
      serviceName: SERVICE_NAME,
      requestId,
      timeoutMs: 60000, // 60 seconds for LLM calls
    });

    if (!llmResult.ok) {
      // Security event already emitted by secureFetch
      await logEyeEvent(supabase, {
        session_id,
        event_type: "LLM_CALL_FAILED",
        request: req,
        serviceName: SERVICE_NAME,
        payload: {
          operator_id,
          request_id: requestId,
          result: "failure",
          severity: "WARN",
          resource_type: "llm_call",
          resource_id: requestId,
          error_code: llmResult.error?.code ?? "SERVICE_ERROR",
          error_message: llmResult.error?.message.slice(0, 200) ?? "Unknown error",
          model,
        },
      });

      return new Response(
        JSON.stringify({ error: "LLM call failed", code: llmResult.error?.code }),
        { status: 502, headers: createSecureJsonHeaders(req) }
      );
    }

    const llmResponse = llmResult.response!;
    
    if (!llmResponse.ok) {
      const errorText = await llmResponse.text();
      
      await logEyeEvent(supabase, {
        session_id,
        event_type: "LLM_CALL_FAILED",
        request: req,
        serviceName: SERVICE_NAME,
        payload: {
          operator_id,
          request_id: requestId,
          result: "failure",
          severity: "WARN",
          resource_type: "llm_call",
          resource_id: requestId,
          error_code: "LLM_API_ERROR",
          error_message: `Status ${llmResponse.status}`,
          model,
        },
      });

      return new Response(
        JSON.stringify({ error: "LLM call failed", status: llmResponse.status }),
        { status: llmResponse.status, headers: createSecureJsonHeaders(req) }
      );
    }

    const llmResponseData = await llmResponse.json();

    // ============================================================
    // EMIT LLM_CALL_COMPLETED
    // ============================================================
    await logEyeEvent(supabase, {
      session_id,
      event_type: "LLM_CALL_COMPLETED",
      request: req,
      serviceName: SERVICE_NAME,
      payload: {
        operator_id,
        request_id: requestId,
        result: "success",
        severity: "NOTICE",
        resource_type: "llm_call",
        resource_id: requestId,
        model,
        data_retention_mode: "zero",
        tokens_used: llmResponseData.usage?.total_tokens || 0,
        approval_event_id: authResult.approvalEventId,
      },
    });

    // Return result (without storing prompts/completions)
    return new Response(
      JSON.stringify({
        success: true,
        request_id: requestId,
        result: llmResponseData.choices?.[0]?.message?.content || "",
        model,
        usage: llmResponseData.usage,
      }),
      { status: 200, headers: createSecureJsonHeaders(req) }
    );

  } catch (error) {
    console.error("[LLM Gateway] Error:", error);

    await logEyeEvent(supabase, {
      session_id: null,
      event_type: "LLM_CALL_FAILED",
      request: req,
      serviceName: SERVICE_NAME,
      payload: {
        request_id: requestId,
        result: "failure",
        severity: "WARN",
        resource_type: "llm_call",
        resource_id: requestId,
        error_code: "EXCEPTION",
        error_message: error instanceof Error ? error.message.slice(0, 200) : "Unknown error",
      },
    });

    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: createSecureJsonHeaders(req) }
    );
  }
});
