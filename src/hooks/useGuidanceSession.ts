/**
 * useGuidanceSession — Fetch session data + run guidance mutation for the Guidance page.
 *
 * Handles:
 * - Loading session metadata (name, scope, template, existing guidance)
 * - Invoking generate-guidance-phase1 edge function
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
}

export type GuidanceRunState = "idle" | "running" | "success" | "error";

export interface GuidanceRunError {
  message: string;
  code?: string;
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
        .select("id, session_id, case_label, interaction_type, template_id, guidance_scope, guidance_scope_other, policy_pack_id, metadata")
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
  const pollForGuidance = useCallback(async (dbId: string, maxRetries = 6, delayMs = 500): Promise<GuidanceOutput | null> => {
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

  // ── Run guidance ─────────────────────────────────────────────
  const runGuidance = useCallback(async () => {
    if (!session) return;

    const requestId = crypto.randomUUID();
    setRunState("running");
    setRunError(null);

    // Eye: tool.run.started
    await logEvent({
      eventType: "tool.run.started",
      sessionId: session.sessionId,
      requestId,
      toolName: "generate_guidance_phase1",
    });

    try {
      const { data: response, error } = await supabase.functions.invoke(
        "generate-guidance-phase1",
        { body: { session_id: session.id } }
      );

      if (error) {
        throw new Error(error.message || "Edge function invocation failed");
      }

      // Check for structured error responses
      if (response && !response.success) {
        const code = response.code || "UNKNOWN";
        const message = response.error || "Generation failed";
        setRunState("error");
        setRunError({ message, code });

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

      // Success — poll for guidance output in session metadata
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
      setRunState("error");
      setRunError({ message, code: "INVOKE_ERROR" });

      await logEvent({
        eventType: "tool.run.failed",
        sessionId: session.sessionId,
        requestId,
        result: "failure",
        toolName: "generate_guidance_phase1",
        metadata: { error_code: "INVOKE_ERROR" },
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
