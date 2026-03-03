import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { logEyeEvent } from "../_shared/eye.ts";

type SessionAction = "create" | "get" | "update_status" | "close" | "cancel";

interface SessionRequest {
  action: SessionAction;
  session_id?: string;
  data?: {
    tenant_id?: string;
    user_id?: string;
    status?: string;
    template_id?: string | null;
    interview_notes?: string | null;
    metadata_patch?: Record<string, unknown>;
  };
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const ALLOWED_TRANSITIONS: Record<string, Set<string>> = {
  initialized: new Set(["template_selected", "cancelled", "failed"]),
  template_selected: new Set(["guidance_generating", "cancelled", "failed"]),
  guidance_generating: new Set(["guidance_ready", "failed", "cancelled"]),
  guidance_ready: new Set(["notes_completed", "closed", "cancelled"]),
  notes_completed: new Set(["closed", "cancelled"]),
  failed: new Set(["cancelled", "closed"]),
  cancelled: new Set(),
  closed: new Set(),
};

function assertTransition(current: string, next: string) {
  const allowed = ALLOWED_TRANSITIONS[current];
  if (!allowed || !allowed.has(next)) {
    const err = new Error(
      `Invalid transition: "${current}" -> "${next}". Allowed from "${current}": ${
        allowed ? [...allowed].join(", ") || "(none)" : "(unknown status)"
      }`
    );
    (err as any).status = 409;
    throw err;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { success: false, error: "Method not allowed" });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let payload: SessionRequest;
  try {
    payload = await req.json();
  } catch {
    return json(400, { success: false, error: "Invalid JSON body" });
  }

  const { action, session_id, data } = payload;

  try {
    switch (action) {
      // ── CREATE ──────────────────────────────────────────────
      case "create": {
        if (!data?.tenant_id) return json(400, { success: false, error: "data.tenant_id is required" });

        const { data: session, error } = await supabase
          .from("sessions")
          .insert({
            tenant_id: data.tenant_id,
            user_id: data.user_id ?? null,
            status: "initialized",
            metadata: {},
          })
          .select("*")
          .single();

        if (error) throw new Error(`Failed to create session: ${error.message}`);

        await logEyeEvent(supabase, session.id, "SESSION_STARTED", {
          actor: "session-manager",
          tenant_id: data.tenant_id,
          user_id: data.user_id ?? null,
        });

        return json(200, { success: true, session });
      }

      // ── GET ─────────────────────────────────────────────────
      case "get": {
        if (!session_id) return json(400, { success: false, error: "session_id is required" });

        const { data: session, error } = await supabase
          .from("sessions")
          .select("*")
          .eq("id", session_id)
          .maybeSingle();

        if (error) throw new Error(`Failed to get session: ${error.message}`);
        if (!session) return json(404, { success: false, error: "Session not found" });

        return json(200, { success: true, session });
      }

      // ── UPDATE_STATUS ───────────────────────────────────────
      case "update_status": {
        if (!session_id) return json(400, { success: false, error: "session_id is required" });
        if (!data?.status) return json(400, { success: false, error: "data.status is required" });

        const { data: session, error: fetchErr } = await supabase
          .from("sessions")
          .select("id, tenant_id, status, metadata")
          .eq("id", session_id)
          .maybeSingle();

        if (fetchErr) throw new Error(`Failed to fetch session: ${fetchErr.message}`);
        if (!session) return json(404, { success: false, error: "Session not found" });

        // Idempotent check
        if (session.status === data.status) {
          return json(200, { success: true, session_id, status: data.status, idempotent: true });
        }

        assertTransition(session.status, data.status);

        const patch: Record<string, unknown> = {
          status: data.status,
        };

        if ("template_id" in (data ?? {})) patch.template_id = data!.template_id;
        if ("interview_notes" in (data ?? {})) patch.interview_notes = data!.interview_notes;

        if (data.metadata_patch && typeof data.metadata_patch === "object") {
          patch.metadata = { ...(session.metadata ?? {}), ...data.metadata_patch };
        }

        const { error: updateErr } = await supabase
          .from("sessions")
          .update(patch)
          .eq("id", session_id);

        if (updateErr) throw new Error(`Failed to update session: ${updateErr.message}`);

        await logEyeEvent(supabase, session_id, "SESSION_STATUS_CHANGED", {
          actor: "session-manager",
          from_status: session.status,
          to_status: data.status,
        });

        return json(200, { success: true, session_id, status: data.status });
      }

      // ── CLOSE / CANCEL ─────────────────────────────────────
      case "close":
      case "cancel": {
        if (!session_id) return json(400, { success: false, error: "session_id is required" });

        const terminalStatus = action === "close" ? "closed" : "cancelled";

        const { data: session, error: fetchErr } = await supabase
          .from("sessions")
          .select("id, status")
          .eq("id", session_id)
          .maybeSingle();

        if (fetchErr) throw new Error(`Failed to fetch session: ${fetchErr.message}`);
        if (!session) return json(404, { success: false, error: "Session not found" });

        // Idempotent
        if (session.status === terminalStatus) {
          return json(200, { success: true, session_id, status: terminalStatus, idempotent: true });
        }

        assertTransition(session.status, terminalStatus);

        const { error: updateErr } = await supabase
          .from("sessions")
          .update({ status: terminalStatus })
          .eq("id", session_id);

        if (updateErr) throw new Error(`Failed to update session: ${updateErr.message}`);

        const eventName = action === "close" ? "SESSION_CLOSED" : "SESSION_CANCELLED";
        await logEyeEvent(supabase, session_id, eventName, { actor: "session-manager" });

        return json(200, { success: true, session_id, status: terminalStatus });
      }

      default:
        return json(400, { success: false, error: `Invalid action: "${action}"` });
    }
  } catch (e) {
    const status = (e as any)?.status ?? 500;
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[session-manager] error:", message);
    return json(status, { success: false, error: message });
  }
});
