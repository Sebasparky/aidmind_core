/**
 * LLM Gateway Edge Function
 * 
 * Proxies LLM calls with mandatory authorization check.
 * Emits LLM_CALL_STARTED, LLM_CALL_COMPLETED, or LLM_CALL_FAILED events.
 * 
 * CRITICAL: If no AI_USAGE_APPROVED_BY_SUPERVISOR exists, the call is BLOCKED.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logEyeEvent, deriveTenantId } from "../_shared/eye.ts";
import { corsSecurityHeaders as corsHeaders, enforceTransportSecurity } from "../_shared/security-headers.ts";
import { checkLLMAuthorization } from "../_shared/llm-authorization.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

const SERVICE_NAME = "llm-gateway";

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // MANDATORY security check - no exceptions, no overrides
  const securityResponse = enforceTransportSecurity(req);
  if (securityResponse) return securityResponse;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const requestId = crypto.randomUUID();
  const tenantId = deriveTenantId(req);

  try {
    const body = await req.json();
    const { session_id, operator_id, messages, model = "google/gemini-2.5-flash" } = body;

    if (!session_id) {
      return new Response(
        JSON.stringify({ error: "session_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============================================================
    // AUTHORIZATION CHECK (MANDATORY)
    // ============================================================
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
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const llmResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
    });

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
        { status: llmResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const llmResult = await llmResponse.json();

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
        tokens_used: llmResult.usage?.total_tokens || 0,
        approval_event_id: authResult.approvalEventId,
      },
    });

    // Return result (without storing prompts/completions)
    return new Response(
      JSON.stringify({
        success: true,
        request_id: requestId,
        result: llmResult.choices?.[0]?.message?.content || "",
        model,
        usage: llmResult.usage,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
