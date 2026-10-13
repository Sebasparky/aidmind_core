import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { logEyeEvent } from "../_shared/eye.ts";
import { requireUser, assertSessionAccess, requireTenantFor } from "../_shared/require-user.ts";

interface StartSessionRequest {
  tenant_id?: string;
  user_id?: string;
  metadata?: Record<string, unknown>;
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { success: false, error: "Method not allowed" });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let payload: StartSessionRequest;
  try {
    payload = await req.json();
  } catch {
    return json(400, { success: false, error: "Invalid JSON body" });
  }

  const { tenant_id: requested_tenant_id, metadata } = payload;

  // ── Authenticate caller; tenant from membership, owner = caller ──
  const auth = await requireUser(req, supabase);
  if (!auth.ok) return json(auth.status, { success: false, error: auth.error });
  const tenantRes = requireTenantFor(auth.caller, requested_tenant_id);
  if (!tenantRes.ok) return json(tenantRes.status, { success: false, error: tenantRes.error });
  const tenant_id = tenantRes.tenantId;
  const user_id = auth.caller.userId;

  try {
    const { data: session, error } = await supabase
      .from("sessions")
      .insert({
        tenant_id,
        user_id,
        status: "initialized",
        metadata: metadata && typeof metadata === "object" ? metadata : {},
      })
      .select("*")
      .single();

    if (error) throw new Error(`Failed to create session: ${error.message}`);

    await logEyeEvent(supabase, {
      session_id: session.id,
      event_type: "SESSION_STARTED",
      serviceName: "start-session",
      payload: { tenant_id, user_id },
    });

    return json(200, { success: true, session });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[start-session] error:", message);
    return json(500, { success: false, error: message });
  }
});
