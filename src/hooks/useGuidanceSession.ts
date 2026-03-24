/**
 * useGuidanceSession — Fetch session data + run guidance mutation for the Guidance page.
 *
 * Handles:
 * - Loading session metadata (name, scope, template, existing guidance)
 * - Step A: Invoking compile-policy-pack edge function
 * - Step B: Invoking generate-guidance-phase1 edge function
 * - Polling session for guidance_json after successful generation
 * - Eye event logging for tool runs
 */

import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useEyeLogger } from "./useEyeLogger";
import type { GuidanceOutput } from "@/lib/tools/guidance-types";

export interface GuidanceSessionData {
  id: string;
  sessionId: string;
  caseLabel: string;
  interactionType: string | null;
  templateId: string | null;
  templateName: string | null;
  guidanceScope: string | null;
  guidanceScopeOther: string | null;
  hasPolicyPack: boolean;
  guidanceOutput: GuidanceOutput | null;
  metadata: Record<string, unknown> | null;
  /** Whether skip can proceed: a reusable ready schema exists for this template. */
  skipReady: boolean;
  /** If skipReady and session doesn't have phase2_schema_id yet, this is the reusable schema ID to link. */
  reusableSchemaId: string | null;
}

export type GuidanceRunState = "idle" | "running" | "compiling" | "generating" | "success" | "error";

export interface GuidanceRunError {
  message: string;
  code?: string;
  step?: "compile" | "generate" | "invoke";
}

export function useGuidanceSession(sessionId: string | undefined) {
  const { logEvent } = useEyeLogger();

  const [session, setSession] = useState<GuidanceSessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [runState, setRunState] = useState<GuidanceRunState>("idle");
  const [runError, setRunError] = useState<GuidanceRunError | null>(null);

  // ── Fetch session ────────────────────────────────────────────
  const fetchSession = useCallback(async () => {
    if (!sessionId) {
      setFetchError("No session ID provided");
      setLoading(false);
      return;
    }

    try {
      setFetchError(null);

      // Fetch session by session_id (the text field used in routes)
      const { data, error } = await supabase
        .from("sessions")
        .select("id, session_id, case_label, interaction_type, template_id, guidance_scope, guidance_scope_other, policy_pack_id, metadata, phase2_schema_id")
        .eq("session_id", sessionId)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        setFetchError("Session not found");
        return;
      }

      // Extract guidance output from metadata if it exists
      let guidanceOutput: GuidanceOutput | null = null;
      const meta = data.metadata as Record<string, unknown> | null;
      if (meta?.guidance_phase1 && typeof meta.guidance_phase1 === "object") {
        const gp1 = meta.guidance_phase1 as Record<string, unknown>;
        if (gp1.questions && Array.isArray(gp1.questions)) {
          guidanceOutput = gp1 as unknown as GuidanceOutput;
        }
      }

      // Fetch template name if template_id exists
      let templateName: string | null = null;
      if (data.template_id) {
        const { data: tpl } = await supabase
          .from("kb_templates")
          .select("name")
          .eq("id", data.template_id)
          .maybeSingle();
        templateName = tpl?.name ?? null;
      }

      // Determine skip readiness:
      // 1. Session already has phase2_schema_id linked → skip is trivial
      // 2. Template has a reusable active ready schema → skip can link it (cheap DB write, no LLM)
      // 3. Neither → skip not available; user must generate Guidance once for this template
      let skipReady = !!data.phase2_schema_id;
      let reusableSchemaId: string | null = null;

      if (!skipReady && data.template_id) {
        const { data: existingSchema } = await supabase
          .from("template_phase2_schemas")
          .select("id")
          .eq("template_id", data.template_id)
          .eq("is_active", true)
          .eq("status", "ready")
          .limit(1)
          .maybeSingle();
        if (existingSchema) {
          skipReady = true;
          reusableSchemaId = existingSchema.id;
        }
      }

      setSession({
        id: data.id,
        sessionId: data.session_id,
        caseLabel: data.case_label || "Untitled session",
        interactionType: data.interaction_type,
        templateId: data.template_id,
        templateName,
        guidanceScope: data.guidance_scope,
        guidanceScopeOther: data.guidance_scope_other,
        hasPolicyPack: !!data.policy_pack_id,
        guidanceOutput,
        metadata: meta,
        skipReady,
      });

      // If guidance already exists, mark as success
      if (guidanceOutput) {
        setRunState("success");
      }
    } catch (err) {
      console.error("[useGuidanceSession] fetch error:", err);
      setFetchError("Failed to load session");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  // ── Poll for guidance output after edge function returns ──────
  const pollForGuidance = useCallback(async (dbId: string, maxRetries = 10, delayMs = 1500): Promise<GuidanceOutput | null> => {
    for (let i = 0; i < maxRetries; i++) {
      await new Promise((r) => setTimeout(r, delayMs));

      const { data } = await supabase
        .from("sessions")
        .select("metadata")
        .eq("id", dbId)
        .maybeSingle();

      if (data?.metadata) {
        const meta = data.metadata as Record<string, unknown>;
        if (meta.guidance_phase1 && typeof meta.guidance_phase1 === "object") {
          const gp1 = meta.guidance_phase1 as Record<string, unknown>;
          if (gp1.questions && Array.isArray(gp1.questions)) {
            return gp1 as unknown as GuidanceOutput;
          }
        }
      }
    }
    return null;
  }, []);

  // ── Run guidance (compile → generate) ───────────────────────
  const runGuidance = useCallback(async () => {
    if (!session) return;
    if (!session.templateId) {
      setRunState("error");
      setRunError({ message: "No template attached to this session. Upload a template first.", code: "TEMPLATE_REQUIRED", step: "compile" });
      return;
    }

    const requestId = crypto.randomUUID();
    setRunState("compiling");
    setRunError(null);

    // Eye: tool.run.started
    await logEvent({
      eventType: "tool.run.started",
      sessionId: session.sessionId,
      requestId,
      toolName: "guidance_pipeline",
    });

    try {
      // ── Step A: Compile policy pack ────────────────────────────
      // Skip if session already has a policy pack
      if (!session.hasPolicyPack) {
        console.log("[useGuidanceSession] Compiling policy pack…");

        const { data: compileResponse, error: compileError } = await supabase.functions.invoke(
          "compile-policy-pack",
          {
            body: {
              session_id: session.id,
              template_id: session.templateId,
              guardrails: {},
            },
          }
        );

        if (compileError) {
          throw Object.assign(
            new Error(compileError.message || "Failed to invoke compile-policy-pack"),
            { step: "compile" as const }
          );
        }

        if (compileResponse && !compileResponse.success) {
          const code = compileResponse.code || "COMPILE_FAILED";
          const message = compileResponse.error || "Policy pack compilation failed";
          setRunState("error");
          setRunError({ message, code, step: "compile" });

          await logEvent({
            eventType: "tool.run.failed",
            sessionId: session.sessionId,
            requestId,
            result: "failure",
            toolName: "compile_policy_pack",
            metadata: { error_code: code },
          });
          return;
        }

        // Update local state to reflect compiled pack
        setSession((prev) => prev ? { ...prev, hasPolicyPack: true } : prev);
        console.log("[useGuidanceSession] Policy pack compiled:", compileResponse?.compiled_policy_pack_id);
      } else {
        console.log("[useGuidanceSession] Policy pack already exists, skipping compile step");
      }

      // NOTE: Phase 2 schema ensure is now handled server-side inside
      // generate-guidance-phase1 as a blocking prerequisite.
      // The frontend no longer orchestrates this separately.

      // ── Step B: Generate guidance phase 1 ──────────────────────
      setRunState("generating");

      const { data: response, error } = await supabase.functions.invoke(
        "generate-guidance-phase1",
        { body: { session_id: session.id } }
      );

      if (error) {
        throw Object.assign(
          new Error(error.message || "Edge function invocation failed"),
          { step: "generate" as const }
        );
      }

      // Check for structured error responses
      if (response && !response.success) {
        const code = response.code || "UNKNOWN";
        const message = response.error || "Generation failed";
        setRunState("error");
        setRunError({ message, code, step: "generate" });

        // If domain mismatch, clear the stale policy pack so re-run will recompile
        if (code === "DOMAIN_MISMATCH") {
          await supabase
            .from("sessions")
            .update({ policy_pack_id: null })
            .eq("id", session.id);
          setSession((prev) => prev ? { ...prev, hasPolicyPack: false } : prev);
        }

        await logEvent({
          eventType: "tool.run.failed",
          sessionId: session.sessionId,
          requestId,
          result: "failure",
          toolName: "generate_guidance_phase1",
          metadata: { error_code: code },
        });
        return;
      }

      // ── Step C: Poll for guidance output ───────────────────────
      const output = await pollForGuidance(session.id);

      if (output) {
        setSession((prev) => prev ? { ...prev, guidanceOutput: output } : prev);
        setRunState("success");

        await logEvent({
          eventType: "tool.run.completed",
          sessionId: session.sessionId,
          requestId,
          result: "success",
          toolName: "generate_guidance_phase1",
          metadata: { question_count: output.questions.length },
        });
      } else {
        // Edge function returned success but guidance not found after polling
        setRunState("error");
        setRunError({
          message: "Generation completed but results were not saved. Please try again.",
          code: "POLL_TIMEOUT",
          step: "generate",
        });

        await logEvent({
          eventType: "tool.run.failed",
          sessionId: session.sessionId,
          requestId,
          result: "failure",
          toolName: "generate_guidance_phase1",
          metadata: { error_code: "POLL_TIMEOUT" },
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      const step = (err as { step?: string })?.step === "compile" ? "compile" : 
                   (err as { step?: string })?.step === "generate" ? "generate" : "invoke";

      // ── Recovery check: the backend may have succeeded despite a transient
      //    invoke error (e.g. timeout). Poll the session to see if guidance
      //    was actually persisted before declaring failure. ──
      console.warn("[useGuidanceSession] Invoke error caught, checking if backend succeeded despite error…", message);
      const recoveredOutput = await pollForGuidance(session.id, 5, 2000);
      if (recoveredOutput) {
        console.log("[useGuidanceSession] Recovery succeeded — guidance_phase1 found in session after transient error");
        setSession((prev) => prev ? { ...prev, guidanceOutput: recoveredOutput } : prev);
        setRunState("success");
        setRunError(null);

        await logEvent({
          eventType: "tool.run.completed",
          sessionId: session.sessionId,
          requestId,
          result: "success",
          toolName: "generate_guidance_phase1",
          metadata: { question_count: recoveredOutput.questions.length, recovered_from: "INVOKE_ERROR" },
        });
        return;
      }

      setRunState("error");
      setRunError({ message, code: "INVOKE_ERROR", step });

      await logEvent({
        eventType: "tool.run.failed",
        sessionId: session.sessionId,
        requestId,
        result: "failure",
        toolName: step === "compile" ? "compile_policy_pack" : "generate_guidance_phase1",
        metadata: { error_code: "INVOKE_ERROR", step },
      });
    }
  }, [session, logEvent, pollForGuidance]);

  // ── Clear results ────────────────────────────────────────────
  const clearResults = useCallback(() => {
    setSession((prev) => prev ? { ...prev, guidanceOutput: null } : prev);
    setRunState("idle");
    setRunError(null);
  }, []);

  return {
    session,
    loading,
    fetchError,
    runState,
    runError,
    runGuidance,
    clearResults,
    refetch: fetchSession,
  };
}
