import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { logEyeEvent } from "../_shared/eye.ts";

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

  const { tenant_id, user_id, metadata } = payload;

  if (!tenant_id) {
    return json(400, { success: false, error: "tenant_id is required" });
  }

  try {
    const { data: session, error } = await supabase
      .from("sessions")
      .insert({
        tenant_id,
        user_id: user_id ?? null,
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
      payload: { tenant_id, user_id: user_id ?? null },
    });

    return json(200, { success: true, session });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[start-session] error:", message);
    return json(500, { success: false, error: message });
  }
});
