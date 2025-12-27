import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MINIMIZED_TRANSCRIPT_TTL_SECONDS = 30 * 60; // 30 minutes
const PRESIDIO_TIMEOUT_MS = 5000; // 5 second timeout
const PRESIDIO_HEALTH_CACHE_MS = 60000; // 60 seconds health cache

interface RedactRequest {
  session_id: string;
  transcript?: string;
  verification_only?: boolean;
}

interface RedactionCounts {
  phone: number;
  email: number;
  ssn: number;
  dob: number;
  address: number;
  case_id: number;
  generic_id: number;
  person: number;
  location: number;
  organization: number;
  date: number;
}

// Layer 2 status values
type Layer2Status = "COMPLETED" | "FAILED_UNREACHABLE" | "FAILED_TIMEOUT" | "FAILED_ERROR" | "SKIPPED_CONFIG_MISSING" | "SKIPPED";

interface LayerStatus {
  status: string;
  counts?: Partial<RedactionCounts>;
  method?: string;
  skipped_reason?: string;
}

interface RedactionResult {
  minimized_text: string;
  redaction_counts: RedactionCounts;
  verification_result: {
    status: "PASS" | "FAIL";
    categories?: string[];
  };
  redaction: {
    layer1: LayerStatus;
    layer2: LayerStatus;
    layer3: { status: "PASS" | "FAIL"; categories?: string[] };
  };
  minimized_text_source: "ner" | "regex";
}

// Health check cache
let presidioHealthy: boolean | null = null;
let presidioHealthCheckedAt: number = 0;

// Log Eye event for audit trail (no PHI stored)
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
    console.log(`[Eye Event] ${eventType}`, JSON.stringify(eventData));
  } catch (error) {
    console.error("Failed to log Eye event:", error);
  }
}

// ============================================================
// LAYER 1: Deterministic Regex Redaction (Required)
// ============================================================
function regexRedact(text: string): { text: string; counts: Partial<RedactionCounts> } {
  const counts: Partial<RedactionCounts> = {
    phone: 0,
    email: 0,
    ssn: 0,
    dob: 0,
    address: 0,
    case_id: 0,
    generic_id: 0,
  };

  let result = text;

  // Email pattern
  const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  result = result.replace(emailPattern, () => {
    counts.email!++;
    return "[EMAIL]";
  });

  // US phone (loose pattern)
  const phonePattern = /(\+?1[\s.-]?)?(\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/g;
  result = result.replace(phonePattern, () => {
    counts.phone!++;
    return "[PHONE]";
  });

  // SSN pattern
  const ssnPattern = /\b\d{3}-\d{2}-\d{4}\b/g;
  result = result.replace(ssnPattern, () => {
    counts.ssn!++;
    return "[SSN]";
  });

  // DOB pattern
  const dobPattern = /\b(DOB|Date of Birth)\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\b/gi;
  result = result.replace(dobPattern, () => {
    counts.dob!++;
    return "[DOB]";
  });

  // Address pattern (number + street keyword)
  const addressPattern = /\b\d+\s+(N\.?|S\.?|E\.?|W\.?|North|South|East|West)?\s*(Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Drive|Dr\.?|Lane|Ln\.?|Court|Ct\.?|Place|Pl\.?|Way|Circle|Cir\.?)\b[^,.]*(?:[,.]?\s*(?:Apt\.?|Suite|Ste\.?|Unit|#)\s*\d+)?/gi;
  result = result.replace(addressPattern, () => {
    counts.address!++;
    return "[ADDRESS]";
  });

  // Case number / reference ID patterns
  const caseIdPattern = /\b(Case\s*(?:#|No\.?|Number)?|Reference\s*(?:#|No\.?|ID)?|Ref\s*(?:#|No\.?)?)\s*[:\-]?\s*[A-Z0-9\-]+\b/gi;
  result = result.replace(caseIdPattern, () => {
    counts.case_id!++;
    return "[CASE_ID]";
  });

  // Generic ID patterns (e.g., "ID: 12345", "Client ID 987")
  const genericIdPattern = /\b(Client\s*ID|Patient\s*ID|Member\s*ID|Account\s*ID|ID)\s*[:\-#]?\s*\d+\b/gi;
  result = result.replace(genericIdPattern, () => {
    counts.generic_id!++;
    return "[ID]";
  });

  return { text: result, counts };
}

// ============================================================
// LAYER 2: NER Redaction with Presidio (NO FALLBACK)
// ============================================================

interface PresidioResponse {
  redacted_text: string;
  counts: Record<string, number>;
  spans: Array<{ entity_type: string; start: number; end: number }>;
}

// Check if Presidio service is configured and healthy
async function checkPresidioHealth(presidioUrl: string): Promise<boolean> {
  const now = Date.now();
  
  // Return cached result if still valid
  if (presidioHealthy !== null && (now - presidioHealthCheckedAt) < PRESIDIO_HEALTH_CACHE_MS) {
    console.log(`[Presidio] Using cached health status: ${presidioHealthy ? "healthy" : "unhealthy"}`);
    return presidioHealthy;
  }
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second health check timeout
    
    const response = await fetch(`${presidioUrl}/health`, {
      method: "GET",
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const data = await response.json();
      presidioHealthy = data.status === "ok";
      presidioHealthCheckedAt = now;
      console.log(`[Presidio] Health check passed`);
      return true;
    } else {
      console.warn(`[Presidio] Health check failed: HTTP ${response.status}`);
      presidioHealthy = false;
      presidioHealthCheckedAt = now;
      return false;
    }
  } catch (error) {
    console.warn(`[Presidio] Health check error:`, error instanceof Error ? error.message : error);
    presidioHealthy = false;
    presidioHealthCheckedAt = now;
    return false;
  }
}

async function nerRedactWithPresidio(
  sessionId: string,
  text: string,
  supabase: any
): Promise<{ 
  text: string; 
  counts: Partial<RedactionCounts>; 
  layer2Status: Layer2Status;
  method: "presidio" | "none";
}> {
  
  // Check if PRESIDIO_SERVICE_URL is configured
  const presidioUrl = Deno.env.get("PRESIDIO_SERVICE_URL");
  
  if (!presidioUrl) {
    console.warn("[Redact] PRESIDIO_SERVICE_URL not configured - Layer 2 skipped");
    await logEyeEvent(supabase, sessionId, "NER_REDACTION_SKIPPED", {
      reason_code: "config_missing",
    });
    
    return {
      text: text, // Return Layer 1 output unchanged
      counts: { person: 0, location: 0, organization: 0, date: 0 },
      layer2Status: "SKIPPED_CONFIG_MISSING",
      method: "none",
    };
  }

  // Emit NER_REDACTION_STARTED
  await logEyeEvent(supabase, sessionId, "NER_REDACTION_STARTED", {});

  // Check health first (cached)
  const isHealthy = await checkPresidioHealth(presidioUrl);
  if (!isHealthy) {
    console.warn("[Redact] Presidio service unhealthy - Layer 2 failed");
    await logEyeEvent(supabase, sessionId, "NER_REDACTION_FAILED", {
      reason_code: "service_unhealthy",
    });
    
    return {
      text: text, // Return Layer 1 output unchanged
      counts: { person: 0, location: 0, organization: 0, date: 0 },
      layer2Status: "FAILED_UNREACHABLE",
      method: "none",
    };
  }

  // Attempt Presidio call with retry
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), PRESIDIO_TIMEOUT_MS);

      const response = await fetch(`${presidioUrl}/redact-ner`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          text: text,
          language: "en",
          entities: ["PERSON", "LOCATION", "ORGANIZATION", "DATE"],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Presidio service returned HTTP ${response.status}`);
      }

      const data: PresidioResponse = await response.json();

      const counts: Partial<RedactionCounts> = {
        person: data.counts.PERSON || 0,
        location: data.counts.LOCATION || 0,
        organization: data.counts.ORGANIZATION || 0,
        date: data.counts.DATE || 0,
      };

      console.log(`[Redact] Presidio NER completed: ${JSON.stringify(counts)}`);
      
      await logEyeEvent(supabase, sessionId, "NER_REDACTION_COMPLETED", {
        counts,
        method: "presidio",
      });

      return {
        text: data.redacted_text,
        counts,
        layer2Status: "COMPLETED",
        method: "presidio",
      };

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (error instanceof Error && error.name === "AbortError") {
        console.warn(`[Redact] Presidio timeout on attempt ${attempt}`);
        if (attempt < 2) continue; // Retry on timeout
      } else {
        console.warn(`[Redact] Presidio error on attempt ${attempt}: ${lastError.message}`);
        if (attempt < 2) continue; // Retry on transient errors
      }
    }
  }

  // Both attempts failed - determine failure type
  let layer2Status: Layer2Status = "FAILED_ERROR";
  let reasonCode = "error";
  
  if (lastError) {
    if (lastError.name === "AbortError") {
      layer2Status = "FAILED_TIMEOUT";
      reasonCode = "timeout";
    } else if (lastError.message.includes("fetch") || lastError.message.includes("connect") || lastError.message.includes("network")) {
      layer2Status = "FAILED_UNREACHABLE";
      reasonCode = "unreachable";
    }
  }
  
  console.warn(`[Redact] Presidio failed after retries - Layer 2 status: ${layer2Status}`);
  
  await logEyeEvent(supabase, sessionId, "NER_REDACTION_FAILED", {
    reason_code: reasonCode,
    error: lastError?.message,
  });
  
  // Return Layer 1 output unchanged - NO REGEX FALLBACK
  return {
    text: text,
    counts: { person: 0, location: 0, organization: 0, date: 0 },
    layer2Status,
    method: "none",
  };
}

// ============================================================
// LAYER 3: LLM Verification (Classifier only, no rewriting)
// ============================================================
async function verifyWithLLM(
  text: string,
  openAIApiKey: string
): Promise<{ status: "PASS" | "FAIL"; categories?: string[] }> {
  const systemPrompt = `You are a PHI/PII verification classifier. Your ONLY job is to determine if the provided text still contains potentially identifying information.

You must respond with ONLY a JSON object in this exact format:
{"contains_phi": true/false, "categories": ["CATEGORY1", "CATEGORY2"]}

Valid categories: PERSON, LOCATION, CONTACT, ID, DATE, ORGANIZATION, ADDRESS, MEDICAL_ID, SSN

Rules:
- If text contains [REDACTED] style placeholders (like [EMAIL], [PHONE], [SSN], [PERSON_1], etc.), those are SAFE and should NOT be flagged
- Only flag ACTUAL identifying information that was NOT redacted
- Be conservative: if unsure, flag it
- Do NOT rewrite or modify the text
- Do NOT explain your reasoning
- ONLY output the JSON object`;

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
        { role: "user", content: `Analyze this text for remaining PHI/PII:\n\n${text}` },
      ],
      temperature: 0,
      max_tokens: 200,
    }),
  });

  if (!response.ok) {
    console.error("LLM verification failed:", response.status);
    // On LLM failure, default to FAIL to force review
    return { status: "FAIL", categories: ["UNKNOWN"] };
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";

  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.contains_phi === true) {
        return {
          status: "FAIL",
          categories: parsed.categories || [],
        };
      }
    }
    return { status: "PASS" };
  } catch (e) {
    console.error("Failed to parse LLM verification response:", e);
    // Default to FAIL on parse error to be safe
    return { status: "FAIL", categories: ["PARSE_ERROR"] };
  }
}

// ============================================================
// Main Redaction Pipeline
// ============================================================
async function runRedactionPipeline(
  sessionId: string,
  transcript: string,
  openAIApiKey: string,
  supabase: any
): Promise<RedactionResult> {
  const combinedCounts: RedactionCounts = {
    phone: 0,
    email: 0,
    ssn: 0,
    dob: 0,
    address: 0,
    case_id: 0,
    generic_id: 0,
    person: 0,
    location: 0,
    organization: 0,
    date: 0,
  };

  const layerStatuses: {
    layer1: LayerStatus;
    layer2: LayerStatus;
    layer3: { status: "PASS" | "FAIL"; categories?: string[] };
  } = {
    layer1: { status: "COMPLETED", counts: {} },
    layer2: { status: "COMPLETED", counts: {} },
    layer3: { status: "PASS" },
  };

  await logEyeEvent(supabase, sessionId, "REDACTION_STARTED", {
    input_length: transcript.length,
  });

  // ========== LAYER 1: Regex Redaction ==========
  console.log("[Redact] Running Layer 1: Regex Redaction");
  const layer1Result = regexRedact(transcript);
  
  Object.entries(layer1Result.counts).forEach(([key, value]) => {
    combinedCounts[key as keyof RedactionCounts] += value || 0;
  });
  layerStatuses.layer1 = { status: "COMPLETED", counts: layer1Result.counts };

  await logEyeEvent(supabase, sessionId, "REGEX_REDACTION_COMPLETED", {
    counts: layer1Result.counts,
  });

  // ========== LAYER 2: NER Redaction (Presidio - NO FALLBACK) ==========
  console.log("[Redact] Running Layer 2: NER Redaction (Presidio)");
  const layer2Result = await nerRedactWithPresidio(sessionId, layer1Result.text, supabase);
  
  // Only merge counts if Presidio succeeded
  if (layer2Result.layer2Status === "COMPLETED") {
    Object.entries(layer2Result.counts).forEach(([key, value]) => {
      combinedCounts[key as keyof RedactionCounts] += value || 0;
    });
  }

  layerStatuses.layer2 = { 
    status: layer2Result.layer2Status, 
    counts: layer2Result.counts,
    method: layer2Result.method,
  };

  // Determine minimized_text source
  const minimizedTextSource: "ner" | "regex" = layer2Result.layer2Status === "COMPLETED" ? "ner" : "regex";

  await logEyeEvent(supabase, sessionId, "MINIMIZED_TEXT_SET", {
    source_layer: minimizedTextSource,
    layer2_status: layer2Result.layer2Status,
  });

  // ========== LAYER 3: LLM Verification ==========
  console.log("[Redact] Running Layer 3: LLM Verification");
  const verification = await verifyWithLLM(layer2Result.text, openAIApiKey);

  layerStatuses.layer3 = verification;

  if (verification.status === "PASS") {
    await logEyeEvent(supabase, sessionId, "REDACTION_VERIFICATION_PASSED", {});
  } else {
    await logEyeEvent(supabase, sessionId, "REDACTION_VERIFICATION_FAILED", {
      categories: verification.categories,
      layer2_status: layer2Result.layer2Status,
    });
  }

  return {
    minimized_text: layer2Result.text,
    redaction_counts: combinedCounts,
    verification_result: verification,
    redaction: layerStatuses,
    minimized_text_source: minimizedTextSource,
  };
}

// ============================================================
// Layer 3 Verification Only (for re-verification after user edits)
// ============================================================
async function runVerificationOnly(
  sessionId: string,
  text: string,
  openAIApiKey: string,
  supabase: any
): Promise<RedactionResult> {
  await logEyeEvent(supabase, sessionId, "REDACTION_VERIFICATION_RETRY", {
    verification_stage: "layer_3",
  });

  console.log("[Redact] Running Layer 3 verification only (re-check)");
  const verification = await verifyWithLLM(text, openAIApiKey);

  if (verification.status === "PASS") {
    await logEyeEvent(supabase, sessionId, "REDACTION_VERIFICATION_PASSED", {
      verification_stage: "layer_3",
    });
  } else {
    await logEyeEvent(supabase, sessionId, "REDACTION_VERIFICATION_FAILED", {
      categories: verification.categories,
      verification_stage: "layer_3",
    });
  }

  const emptyCounts: RedactionCounts = {
    phone: 0,
    email: 0,
    ssn: 0,
    dob: 0,
    address: 0,
    case_id: 0,
    generic_id: 0,
    person: 0,
    location: 0,
    organization: 0,
    date: 0,
  };

  return {
    minimized_text: text,
    redaction_counts: emptyCounts,
    verification_result: verification,
    redaction: {
      layer1: { status: "SKIPPED" },
      layer2: { status: "SKIPPED" },
      layer3: verification,
    },
    minimized_text_source: "regex",
  };
}

// ============================================================
// HTTP Handler
// ============================================================
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

    const { session_id, transcript: providedTranscript, verification_only }: RedactRequest = await req.json();

    if (!session_id) {
      return new Response(
        JSON.stringify({ error: "session_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

    let result: RedactionResult;

    if (verification_only) {
      console.log(`[Redact] Running verification-only for session ${session_id}`);
      result = await runVerificationOnly(session_id, transcript, openAIApiKey, supabase);
    } else {
      console.log(`[Redact] Starting 3-layer redaction pipeline for session ${session_id}`);

      await supabase
        .from("sessions")
        .update({ state: "REDACTING" })
        .eq("session_id", session_id);

      result = await runRedactionPipeline(session_id, transcript, openAIApiKey, supabase);
    }

    const ttlExpiresAt = new Date(Date.now() + MINIMIZED_TRANSCRIPT_TTL_SECONDS * 1000).toISOString();

    if (!verification_only) {
      await supabase
        .from("ephemeral_artifacts")
        .delete()
        .eq("session_id", session_id)
        .eq("artifact_type", "raw_transcript");
    }

    if (!verification_only) {
      await supabase
        .from("ephemeral_artifacts")
        .upsert({
          session_id,
          artifact_type: "minimized_transcript",
          content: result.minimized_text,
          ttl_expires_at: ttlExpiresAt,
        }, { onConflict: "session_id,artifact_type" });
    }

    if (result.verification_result.status === "PASS") {
      await supabase
        .from("sessions")
        .update({ state: "INPUT_READY" })
        .eq("session_id", session_id);

      console.log(`[Redact] Pipeline complete - PASSED. Minimized length: ${result.minimized_text.length}`);
    } else {
      await supabase
        .from("sessions")
        .update({ state: "VERIFICATION_REVIEW" })
        .eq("session_id", session_id);

      console.log(`[Redact] Pipeline complete - FAILED. Categories: ${result.verification_result.categories?.join(", ")}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        minimized_text: result.minimized_text,
        redaction_counts: result.redaction_counts,
        verification_result: result.verification_result,
        redaction: result.redaction,
        minimized_text_source: result.minimized_text_source,
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
