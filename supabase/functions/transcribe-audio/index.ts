import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Supported transcription models
const SUPPORTED_MODELS = ["gpt-4o-mini-transcribe", "gpt-4o-transcribe", "whisper-1"];
const DEFAULT_MODEL = "gpt-4o-mini-transcribe";

// TTL configurations (in seconds)
const TRANSCRIPT_TTL_SECONDS = 30 * 60; // 30 minutes
const AUDIO_TTL_SECONDS = 60 * 60; // 1 hour

interface TranscribeRequest {
  session_id: string;
  audio_object_key: string;
  model?: string;
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
  // Handle CORS preflight
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

    const { session_id, audio_object_key, model: requestedModel }: TranscribeRequest = await req.json();

    if (!session_id || !audio_object_key) {
      return new Response(
        JSON.stringify({ error: "session_id and audio_object_key are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate model selection
    const model = requestedModel && SUPPORTED_MODELS.includes(requestedModel) 
      ? requestedModel 
      : DEFAULT_MODEL;

    console.log(`[Transcribe] Starting transcription for session ${session_id} with model ${model}`);

    // Log transcription started
    await logEyeEvent(supabase, session_id, "TRANSCRIPTION_STARTED", {
      model,
      audio_object_key_hash: audio_object_key.substring(0, 8) + "...",
    });

    // Create transcription job record
    const ttlExpiresAt = new Date(Date.now() + AUDIO_TTL_SECONDS * 1000).toISOString();
    const { data: jobData, error: jobError } = await supabase
      .from("transcription_jobs")
      .insert({
        session_id,
        audio_object_key,
        model,
        status: "processing",
        ttl_expires_at: ttlExpiresAt,
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (jobError) {
      console.error("Failed to create transcription job:", jobError);
      throw new Error("Failed to create transcription job");
    }

    // Download audio file from storage
    console.log(`[Transcribe] Downloading audio from storage: ${audio_object_key}`);
    const { data: audioData, error: downloadError } = await supabase.storage
      .from("audio-uploads")
      .download(audio_object_key);

    if (downloadError || !audioData) {
      console.error("Failed to download audio:", downloadError);
      await supabase
        .from("transcription_jobs")
        .update({ status: "failed", error_message: "Failed to download audio file" })
        .eq("id", jobData.id);
      
      await logEyeEvent(supabase, session_id, "TRANSCRIPTION_FAILED", {
        reason: "download_failed",
      });
      
      throw new Error("Failed to download audio file from storage");
    }

    // Determine file extension and MIME type from object key
    const fileExtension = audio_object_key.split('.').pop()?.toLowerCase() || 'webm';
    const mimeTypes: Record<string, string> = {
      'mp3': 'audio/mpeg',
      'mp4': 'audio/mp4',
      'm4a': 'audio/mp4',
      'wav': 'audio/wav',
      'webm': 'audio/webm',
      'ogg': 'audio/ogg',
      'mpeg': 'audio/mpeg',
    };
    const mimeType = mimeTypes[fileExtension] || 'audio/mpeg';
    const fileName = `audio.${fileExtension}`;
    
    console.log(`[Transcribe] File extension: ${fileExtension}, MIME type: ${mimeType}`);

    // Prepare form data for OpenAI
    const formData = new FormData();
    const audioBlob = new Blob([audioData], { type: mimeType });
    formData.append("file", audioBlob, fileName);
    formData.append("model", model);
    formData.append("response_format", "text");

    // Call OpenAI transcription API with retry logic
    console.log(`[Transcribe] Calling OpenAI API with model: ${model}`);
    console.log(`[Transcribe] API key present: ${!!openAIApiKey}, length: ${openAIApiKey?.length || 0}`);
    
    let openAIResponse: Response | null = null;
    let lastError: string = "";
    const maxRetries = 2;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        // Wait before retry (exponential backoff)
        const waitTime = Math.pow(2, attempt) * 1000;
        console.log(`[Transcribe] Retrying after ${waitTime}ms (attempt ${attempt + 1})`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      
      openAIResponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openAIApiKey}`,
        },
        body: formData,
      });
      
      if (openAIResponse.ok) {
        break;
      }
      
      lastError = await openAIResponse.text();
      console.error(`OpenAI API error (attempt ${attempt + 1}):`, openAIResponse.status, lastError);
      
      // Don't retry on 4xx errors (except 429)
      if (openAIResponse.status !== 429 && openAIResponse.status >= 400 && openAIResponse.status < 500) {
        break;
      }
    }

    if (!openAIResponse || !openAIResponse.ok) {
      const statusCode = openAIResponse?.status || 500;
      
      await supabase
        .from("transcription_jobs")
        .update({ 
          status: "failed", 
          error_message: `OpenAI API error: ${statusCode}` 
        })
        .eq("id", jobData.id);

      await logEyeEvent(supabase, session_id, "TRANSCRIPTION_FAILED", {
        reason: "openai_api_error",
        status_code: statusCode,
        error_details: lastError.substring(0, 200),
      });

      // Provide more helpful error messages
      let userMessage = `OpenAI transcription failed: ${statusCode}`;
      if (statusCode === 429) {
        userMessage = "OpenAI rate limit exceeded. Please check your API key quota/billing or try again later.";
      } else if (statusCode === 401) {
        userMessage = "OpenAI API key is invalid or expired.";
      }

      throw new Error(userMessage);
    }

    const transcriptText = await openAIResponse.text();
    console.log(`[Transcribe] Transcription complete, length: ${transcriptText.length} chars`);

    // Store transcript as ephemeral artifact
    const transcriptTtl = new Date(Date.now() + TRANSCRIPT_TTL_SECONDS * 1000).toISOString();
    const { error: artifactError } = await supabase.from("ephemeral_artifacts").insert({
      session_id,
      artifact_type: "raw_transcript",
      content: transcriptText,
      ttl_expires_at: transcriptTtl,
    });

    if (artifactError) {
      console.error("Failed to store transcript artifact:", artifactError);
    }

    // Update transcription job status
    await supabase
      .from("transcription_jobs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobData.id);

    // Update session state
    await supabase
      .from("sessions")
      .update({ state: "TRANSCRIBED" })
      .eq("session_id", session_id);

    // Log transcription completed
    await logEyeEvent(supabase, session_id, "TRANSCRIPTION_COMPLETED", {
      model,
      transcript_length: transcriptText.length,
      job_id: jobData.id,
    });

    console.log(`[Transcribe] Successfully transcribed audio for session ${session_id}`);

    return new Response(
      JSON.stringify({
        success: true,
        transcript: transcriptText,
        model,
        job_id: jobData.id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Transcription error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
