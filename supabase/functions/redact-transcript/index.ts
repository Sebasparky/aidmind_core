import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MINIMIZED_TRANSCRIPT_TTL_SECONDS = 30 * 60; // 30 minutes

interface RedactRequest {
  session_id: string;
  transcript?: string; // Optional - will fetch from artifacts if not provided
}

// Log Eye event for audit trail (no PHI)
async function logEyeEvent(
  supabase: any,
  sessionId: string | null,
  eventType: string,
  eventData: Record<string, any> = {}
) {
  try {
    await supabase.from("eye_events").insert({
      session_id: sessionId,
      event_type: eventType,
      event_data: eventData,
    });
    console.log(`[Eye Event] ${eventType}`, eventData);
  } catch (error) {
    console.error("Failed to log Eye event:", error);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const openAIApiKey = Deno.env.get("aidmind-key");
    if (!openAIApiKey) {
      throw new Error("OpenAI API key (aidmind-key) is not configured");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { session_id, transcript: providedTranscript }: RedactRequest = await req.json();

    if (!session_id) {
      return new Response(
        JSON.stringify({ error: "session_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[Redact] Starting redaction for session ${session_id}`);

    // Get transcript from artifacts if not provided
    let transcript: string = providedTranscript || "";
    if (!transcript) {
      const { data: artifact } = await supabase
        .from("ephemeral_artifacts")
        .select("content")
        .eq("session_id", session_id)
        .eq("artifact_type", "raw_transcript")
        .maybeSingle();

      if (!artifact) {
        return new Response(
          JSON.stringify({ error: "No transcript found for session" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      transcript = artifact.content;
    }

    await logEyeEvent(supabase, session_id, "REDACTION_STARTED", {
      transcript_length: transcript.length,
    });

    // Update session state
    await supabase
      .from("sessions")
      .update({ state: "REDACTING" })
      .eq("session_id", session_id);

    // Call OpenAI to minimize/redact the transcript
    const systemPrompt = `You are a PHI (Protected Health Information) minimization assistant for social work case notes. 
Your task is to create a minimized version of the transcript that:
1. Removes or replaces direct identifiers (full names, SSNs, addresses, phone numbers, email addresses)
2. Generalizes dates (e.g., "last Tuesday" becomes "earlier this week")
3. Replaces specific locations with general descriptions
4. Preserves the clinical meaning and essential case information
5. Maintains the context needed for accurate case note generation
6. Keeps the content concise while retaining important details

Output ONLY the minimized transcript, no explanations or metadata.`;

    console.log(`[Redact] Calling OpenAI for minimization`);
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAIApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: transcript },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI API error:", response.status, errorText);
      
      await logEyeEvent(supabase, session_id, "REDACTION_FAILED", {
        reason: "openai_api_error",
        status_code: response.status,
      });

      throw new Error(`OpenAI redaction failed: ${response.status}`);
    }

    const data = await response.json();
    const minimizedTranscript = data.choices[0].message.content;

    console.log(`[Redact] Minimization complete, length: ${minimizedTranscript.length} chars`);

    // Store minimized transcript as ephemeral artifact
    const ttlExpiresAt = new Date(Date.now() + MINIMIZED_TRANSCRIPT_TTL_SECONDS * 1000).toISOString();
    const { error: artifactError } = await supabase.from("ephemeral_artifacts").insert({
      session_id,
      artifact_type: "minimized_transcript",
      content: minimizedTranscript,
      ttl_expires_at: ttlExpiresAt,
    });

    if (artifactError) {
      console.error("Failed to store minimized transcript:", artifactError);
    }

    // Update session state
    await supabase
      .from("sessions")
      .update({ state: "INPUT_READY" })
      .eq("session_id", session_id);

    await logEyeEvent(supabase, session_id, "REDACTION_COMPLETED", {
      original_length: transcript.length,
      minimized_length: minimizedTranscript.length,
      reduction_percent: Math.round((1 - minimizedTranscript.length / transcript.length) * 100),
    });

    console.log(`[Redact] Successfully redacted transcript for session ${session_id}`);

    return new Response(
      JSON.stringify({
        success: true,
        minimized_transcript: minimizedTranscript,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Redaction error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
