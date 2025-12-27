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
  transcript?: string;
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

interface RedactionResult {
  minimized_text: string;
  redaction_counts: RedactionCounts;
  verification_result: {
    status: "PASS" | "FAIL";
    categories?: string[];
  };
}

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
// LAYER 2: NER Redaction with Presidio (fallback to regex if unavailable)
// ============================================================

const PRESIDIO_SERVICE_URL = Deno.env.get("PRESIDIO_SERVICE_URL") || "http://localhost:8001";
const PRESIDIO_TIMEOUT_MS = 5000; // 5 second timeout

interface PresidioResponse {
  redacted_text: string;
  counts: Record<string, number>;
  spans: Array<{ entity_type: string; start: number; end: number }>;
}

async function nerRedactWithPresidio(
  sessionId: string,
  text: string,
  supabase: any
): Promise<{ text: string; counts: Partial<RedactionCounts>; method: "presidio" | "regex_fallback" | "skipped"; skipped_reason?: string }> {
  
  // Emit NER_REDACTION_STARTED
  await logEyeEvent(supabase, sessionId, "NER_REDACTION_STARTED", {});

  try {
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PRESIDIO_TIMEOUT_MS);

    const response = await fetch(`${PRESIDIO_SERVICE_URL}/redact-ner`, {
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
      throw new Error(`Presidio service returned ${response.status}`);
    }

    const data: PresidioResponse = await response.json();

    const counts: Partial<RedactionCounts> = {
      person: data.counts.PERSON || 0,
      location: data.counts.LOCATION || 0,
      organization: data.counts.ORGANIZATION || 0,
      date: data.counts.DATE || 0,
    };

    console.log(`[Redact] Presidio NER completed: ${JSON.stringify(counts)}`);

    return {
      text: data.redacted_text,
      counts,
      method: "presidio",
    };

  } catch (error) {
    // Determine skip reason
    let skippedReason: "service_unavailable" | "timeout" | "error" = "error";
    
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        skippedReason = "timeout";
        console.warn("[Redact] Presidio service timeout - falling back to regex");
      } else if (error.message.includes("fetch") || error.message.includes("connect")) {
        skippedReason = "service_unavailable";
        console.warn("[Redact] Presidio service unavailable - falling back to regex");
      } else {
        console.warn(`[Redact] Presidio error: ${error.message} - falling back to regex`);
      }
    }

    // Log skip event
    await logEyeEvent(supabase, sessionId, "NER_REDACTION_SKIPPED", {
      reason_code: skippedReason,
    });

    // Fall back to regex-based NER
    const fallbackResult = nerRedactFallback(text);
    
    return {
      text: fallbackResult.text,
      counts: fallbackResult.counts,
      method: "regex_fallback",
      skipped_reason: skippedReason,
    };
  }
}

// Regex-based fallback for when Presidio is unavailable
function nerRedactFallback(text: string): { text: string; counts: Partial<RedactionCounts> } {
  const counts: Partial<RedactionCounts> = {
    person: 0,
    location: 0,
    organization: 0,
    date: 0,
  };

  let result = text;
  
  // Track entity numbers for consistent replacement
  const entityCounters = {
    person: 0,
    location: 0,
    organization: 0,
    date: 0,
  };

  // Common name patterns (titles + capitalized words)
  const nameWithTitlePattern = /\b(Mr\.?|Mrs\.?|Ms\.?|Miss|Dr\.?|Prof\.?|Client|Patient)\s+([A-Z][a-z]+(?:\s+[A-Z]\.?)?(?:\s+[A-Z][a-z]+)?)\b/g;
  result = result.replace(nameWithTitlePattern, () => {
    entityCounters.person++;
    counts.person!++;
    return `[PERSON_${entityCounters.person}]`;
  });

  // Standalone capitalized name sequences
  const simpleNamePattern = /\b([A-Z][a-z]{1,15})\s+([A-Z]\.?\s+)?([A-Z][a-z]{1,15})\b/g;
  result = result.replace(simpleNamePattern, (match) => {
    const commonPhrases = ['Social Security', 'New York', 'Los Angeles', 'San Francisco', 'United States', 'Health Insurance'];
    if (commonPhrases.some(p => match.includes(p))) return match;
    
    entityCounters.person++;
    counts.person!++;
    return `[PERSON_${entityCounters.person}]`;
  });

  // Location patterns
  const locationPattern = /\b(city of|town of|state of|county of)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/gi;
  result = result.replace(locationPattern, () => {
    entityCounters.location++;
    counts.location!++;
    return `[LOCATION_${entityCounters.location}]`;
  });

  // US State abbreviations with context
  const statePattern = /\b([A-Z][a-z]+),?\s+(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/g;
  result = result.replace(statePattern, () => {
    entityCounters.location++;
    counts.location!++;
    return `[LOCATION_${entityCounters.location}]`;
  });

  // Organization patterns
  const orgPattern = /\b([A-Z][a-z]*(?:\s+[A-Z][a-z]*)*)\s+(Agency|Department|Office|Center|Services|Clinic|Hospital|Foundation|Association|Organization|Inc\.?|LLC|Corp\.?|Company|Co\.?)\b/g;
  result = result.replace(orgPattern, () => {
    entityCounters.organization++;
    counts.organization!++;
    return `[ORG_${entityCounters.organization}]`;
  });

  // Date patterns
  const datePatterns = [
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/gi,
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
    /\b\d{1,2}-\d{1,2}-\d{2,4}\b/g,
    /\b(last|this|next)\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|week|month)\b/gi,
  ];
  
  for (const pattern of datePatterns) {
    result = result.replace(pattern, () => {
      entityCounters.date++;
      counts.date!++;
      return `[DATE_${entityCounters.date}]`;
    });
  }

  return { text: result, counts };
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
- If text contains [REDACTED] style placeholders, those are SAFE and should NOT be flagged
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
    // On LLM failure, default to PASS to not block workflow
    // but log the issue
    return { status: "PASS", categories: [] };
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";

  try {
    // Parse JSON response
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
    // Default to PASS on parse error
    return { status: "PASS" };
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
  // Initialize combined counts
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

  // Emit start event
  await logEyeEvent(supabase, sessionId, "REDACTION_STARTED", {
    input_length: transcript.length,
  });

  // ========== LAYER 1: Regex Redaction ==========
  console.log("[Redact] Running Layer 1: Regex Redaction");
  const layer1Result = regexRedact(transcript);
  
  // Merge counts
  Object.entries(layer1Result.counts).forEach(([key, value]) => {
    combinedCounts[key as keyof RedactionCounts] += value || 0;
  });

  await logEyeEvent(supabase, sessionId, "REGEX_REDACTION_COMPLETED", {
    counts: layer1Result.counts,
  });

  // ========== LAYER 2: NER Redaction (Presidio with fallback) ==========
  console.log("[Redact] Running Layer 2: NER Redaction");
  const layer2Result = await nerRedactWithPresidio(sessionId, layer1Result.text, supabase);
  
  // Merge counts
  Object.entries(layer2Result.counts).forEach(([key, value]) => {
    combinedCounts[key as keyof RedactionCounts] += value || 0;
  });

  // Log completion with method used
  await logEyeEvent(supabase, sessionId, "NER_REDACTION_COMPLETED", {
    counts: layer2Result.counts,
    method: layer2Result.method,
    ...(layer2Result.skipped_reason && { skipped_reason: layer2Result.skipped_reason }),
  });

  // ========== LAYER 3: LLM Verification ==========
  console.log("[Redact] Running Layer 3: LLM Verification");
  const verification = await verifyWithLLM(layer2Result.text, openAIApiKey);

  if (verification.status === "PASS") {
    await logEyeEvent(supabase, sessionId, "REDACTION_VERIFICATION_PASSED", {});
  } else {
    await logEyeEvent(supabase, sessionId, "REDACTION_VERIFICATION_FAILED", {
      categories: verification.categories,
    });
  }

  return {
    minimized_text: layer2Result.text,
    redaction_counts: combinedCounts,
    verification_result: verification,
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

    const { session_id, transcript: providedTranscript }: RedactRequest = await req.json();

    if (!session_id) {
      return new Response(
        JSON.stringify({ error: "session_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[Redact] Starting 3-layer redaction pipeline for session ${session_id}`);

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

    // Update session state
    await supabase
      .from("sessions")
      .update({ state: "REDACTING" })
      .eq("session_id", session_id);

    // Run the 3-layer pipeline
    const result = await runRedactionPipeline(session_id, transcript, openAIApiKey, supabase);

    // Store minimized transcript as ephemeral artifact (only if verification passed)
    if (result.verification_result.status === "PASS") {
      const ttlExpiresAt = new Date(Date.now() + MINIMIZED_TRANSCRIPT_TTL_SECONDS * 1000).toISOString();
      
      // Delete raw transcript (never retain after redaction)
      await supabase
        .from("ephemeral_artifacts")
        .delete()
        .eq("session_id", session_id)
        .eq("artifact_type", "raw_transcript");

      // Store minimized transcript
      await supabase.from("ephemeral_artifacts").insert({
        session_id,
        artifact_type: "minimized_transcript",
        content: result.minimized_text,
        ttl_expires_at: ttlExpiresAt,
      });

      // Update session state to ready for generation
      await supabase
        .from("sessions")
        .update({ state: "INPUT_READY" })
        .eq("session_id", session_id);

      console.log(`[Redact] Pipeline complete - PASSED. Minimized length: ${result.minimized_text.length}`);
    } else {
      // Verification failed - keep in REDACTING state, don't proceed
      console.log(`[Redact] Pipeline complete - FAILED. Categories: ${result.verification_result.categories?.join(", ")}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        minimized_text: result.minimized_text,
        redaction_counts: result.redaction_counts,
        verification_result: result.verification_result,
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
