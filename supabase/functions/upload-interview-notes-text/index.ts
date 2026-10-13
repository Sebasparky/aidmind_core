/**
 * upload-interview-notes-text
 *
 * Accepts a session_id + plain-text interview notes,
 * stores them in sessions.interview_notes, emits an Eye event.
 *
 * Part of the Guidance Phase 2 pipeline.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { logEyeEvent } from "../_shared/eye.ts";
import { requireUser, assertSessionAccess, requireTenantFor } from "../_shared/require-user.ts";

const SERVICE_NAME = "upload-interview-notes-text";
const MIN_NOTES_LENGTH = 20;
const MAX_NOTES_LENGTH = 100_000;

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Only POST
  if (req.method !== "POST") {
    return json(405, { success: false, error: "Method not allowed" });
  }

  // Parse JSON body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { success: false, error: "Invalid JSON body" });
  }

  // Validate session_id
  const sessionId = body.session_id;
  if (!sessionId || typeof sessionId !== "string" || sessionId.trim().length === 0) {
    return json(400, { success: false, error: "session_id is required" });
  }

  // Validate notes_text
  const rawNotes = body.notes_text;
  if (rawNotes === null || rawNotes === undefined || typeof rawNotes !== "string") {
    return json(400, { success: false, error: "notes_text is required" });
  }

  const notesText = rawNotes.trim();
  if (notesText.length === 0) {
    return json(400, { success: false, error: "notes_text is required" });
  }
  if (notesText.length < MIN_NOTES_LENGTH) {
    return json(400, {
      success: false,
      error: `No usable interview notes detected (minimum ${MIN_NOTES_LENGTH} characters)`,
    });
  }
  if (notesText.length > MAX_NOTES_LENGTH) {
    return json(400, {
      success: false,
      error: `notes_text exceeds maximum length (${MAX_NOTES_LENGTH} characters)`,
    });
  }

  // Build Supabase client with service role
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // ── Authenticate caller and authorize the session before any privileged access ──
  const auth = await requireUser(req, supabase);
  if (!auth.ok) return json(auth.status, { success: false, error: auth.error });
  const access = await assertSessionAccess(supabase, auth.caller, sessionId, { allowSupervisor: true });
  if (!access.ok) return json(access.status, { success: false, error: access.error });

  // Fetch session
  const { data: session, error: fetchError } = await supabase
    .from("sessions")
    .select("id, tenant_id")
    .eq("id", sessionId)
    .maybeSingle();

  if (fetchError) {
    console.error(`[${SERVICE_NAME}] Session fetch error:`, fetchError.message);
    return json(500, { success: false, error: "Failed to fetch session" });
  }

  if (!session) {
    return json(404, { success: false, error: "Session not found" });
  }

  // Update session
  const { error: updateError } = await supabase
    .from("sessions")
    .update({
      interview_notes: notesText,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId);

  if (updateError) {
    console.error(`[${SERVICE_NAME}] Update error:`, updateError.message);
    return json(500, { success: false, error: "Failed to update session" });
  }

  const charCount = notesText.length;

  // Eye event (fire-and-forget)
  try {
    await logEyeEvent(supabase, {
      session_id: sessionId,
      event_type: "interview_notes.uploaded",
      serviceName: SERVICE_NAME,
      payload: {
        result: "success",
        tenant_id: session.tenant_id,
        source: "text",
        char_count: charCount,
        uploaded_at: new Date().toISOString(),
      },
    });
  } catch (eyeErr) {
    console.error(`[${SERVICE_NAME}] Eye event error:`, eyeErr);
  }

  return json(200, {
    success: true,
    session_id: sessionId,
    source: "text",
    char_count: charCount,
  });
});
