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

// ============================================================
// DEBUG HELPER: Safe logging that masks PHI
// ============================================================

// Mask text for logs - replace letters/numbers with ▒ to show structure without leaking PHI
function maskForLogs(s: string, maxLen = 200): string {
  const snippet = (s ?? "").slice(0, maxLen);
  return snippet.replace(/[A-Za-z0-9]/g, "▒");
}

// Log JSON safely with pretty printing
function logJson(label: string, obj: unknown): void {
  console.log(label, JSON.stringify(obj, null, 2));
}

// Safe fetch wrapper that logs request/response structure without PHI
async function fetchWithLogs(
  tag: string, 
  url: string, 
  init: RequestInit
): Promise<{ res: Response; text: string; json: unknown }> {
  
  // Parse the body to extract structure info
  let bodyObj: Record<string, unknown> | null = null;
  try {
    const bodyStr = typeof init.body === "string" ? init.body : "";
    bodyObj = bodyStr ? JSON.parse(bodyStr) : null;
  } catch {
    bodyObj = null;
  }
  
  // Log request metadata safely (no raw text)
  const textContent = (bodyObj as Record<string, unknown>)?.text as string | undefined;
  logJson(`=== ${tag}_REQUEST ===`, {
    url: url,
    method: init.method ?? "GET",
    keys: bodyObj ? Object.keys(bodyObj) : [],
    language: (bodyObj as Record<string, unknown>)?.language,
    entities: (bodyObj as Record<string, unknown>)?.entities,
    score_threshold: (bodyObj as Record<string, unknown>)?.score_threshold,
    analyzer_results_count: Array.isArray((bodyObj as Record<string, unknown>)?.analyzer_results) 
      ? ((bodyObj as Record<string, unknown>).analyzer_results as unknown[]).length 
      : undefined,
    text_length: textContent?.length ?? 0,
    text_preview_masked: textContent ? maskForLogs(textContent, 200) : undefined,
  });
  
  const t0 = Date.now();
  const res = await fetch(url, init);
  const elapsed = Date.now() - t0;
  const rawText = await res.text();
  
  // Log response metadata
  logJson(`=== ${tag}_RESPONSE_META ===`, {
    status: res.status,
    elapsed_ms: elapsed,
    raw_len: rawText.length,
  });
  
  // Parse response
  let parsed: unknown = null;
  try { 
    parsed = JSON.parse(rawText); 
  } catch { 
    parsed = null; 
  }
  
  if (!parsed) {
    // If JSON parse failed, log masked raw response
    console.log(`=== ${tag}_RESPONSE_RAW_MASKED ===`, maskForLogs(rawText, 500));
  } else {
    // For analyzer response (array of entities)
    const items = Array.isArray(parsed) ? parsed : ((parsed as Record<string, unknown>)?.results as unknown[] ?? []);
    
    if (Array.isArray(items) && items.length > 0 && (items[0] as Record<string, unknown>)?.entity_type !== undefined) {
      // This is an analyzer response - log entity summary
      const entities = items as Array<Record<string, unknown>>;
      const scores = entities
        .map((x) => (x.score ?? x.confidence ?? (x.analysis_explanation as Record<string, unknown>)?.score) as number | undefined)
        .filter((s): s is number => typeof s === "number");
      
      const top30 = entities.slice(0, 30).map((x) => ({
        entity_type: x.entity_type ?? x.entity,
        start: x.start,
        end: x.end,
        score: x.score ?? x.confidence ?? (x.analysis_explanation as Record<string, unknown>)?.score,
      }));
      
      logJson(`=== ${tag}_RESPONSE_SUMMARY ===`, {
        count: entities.length,
        score_min: scores.length > 0 ? Math.min(...scores) : null,
        score_max: scores.length > 0 ? Math.max(...scores) : null,
        score_avg: scores.length > 0 ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(3) : null,
        top_30_entities: top30,
      });
    } else if ((parsed as Record<string, unknown>)?.text !== undefined) {
      // This is an anonymizer response - log structure without text
      const anonResult = parsed as Record<string, unknown>;
      const anonText = anonResult.text as string | undefined;
      logJson(`=== ${tag}_RESPONSE_SUMMARY ===`, {
        has_text: !!anonText,
        text_length: anonText?.length ?? 0,
        text_preview_masked: anonText ? maskForLogs(anonText, 200) : undefined,
        items_count: Array.isArray(anonResult.items) ? (anonResult.items as unknown[]).length : 0,
      });
    } else {
      // Unknown response structure - log keys only
      logJson(`=== ${tag}_RESPONSE_SUMMARY ===`, {
        type: typeof parsed,
        is_array: Array.isArray(parsed),
        keys: typeof parsed === "object" && parsed !== null ? Object.keys(parsed as object) : [],
      });
    }
  }
  
  return { res, text: rawText, json: parsed };
}

// ============================================================
// ENV VAR SANITY CHECK: Log at function start
// ============================================================
function logEnvVarSanityCheck() {
  console.log("=== PRESIDIO ENV VAR SANITY CHECK ===");
  
  const analyzerUrl = Deno.env.get("PRESIDIO_ANALYZER_URL") ?? "";
  const anonymizerUrl = Deno.env.get("PRESIDIO_ANONYMIZER_URL") ?? "";
  const legacyServiceUrl = Deno.env.get("PRESIDIO_SERVICE_URL") ?? "";
  
  console.log("PRESIDIO_ANALYZER_URL:", analyzerUrl || "(NOT SET)");
  console.log("PRESIDIO_ANONYMIZER_URL:", anonymizerUrl || "(NOT SET)");
  console.log("PRESIDIO_SERVICE_URL (legacy):", legacyServiceUrl || "(NOT SET)");
  
  // Check for placeholder characters
  const hasPlaceholder = (url: string) => url.includes("<") || url.includes(">");
  
  if (!analyzerUrl) {
    console.warn("⚠️ WARNING: PRESIDIO_ANALYZER_URL is MISSING - Layer 2 will fail!");
  } else if (hasPlaceholder(analyzerUrl)) {
    console.warn(`⚠️ WARNING: PRESIDIO_ANALYZER_URL contains placeholder '<' or '>' - Layer 2 will fail! Value: ${analyzerUrl}`);
  }
  
  if (!anonymizerUrl) {
    console.warn("⚠️ WARNING: PRESIDIO_ANONYMIZER_URL is MISSING - Layer 2 will fail!");
  } else if (hasPlaceholder(anonymizerUrl)) {
    console.warn(`⚠️ WARNING: PRESIDIO_ANONYMIZER_URL contains placeholder '<' or '>' - Layer 2 will fail! Value: ${anonymizerUrl}`);
  }
  
  console.log("=== END SANITY CHECK ===");
}

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

interface Layer2Error {
  reason: "missing_env_var" | "misconfigured_env" | "invalid_url_for_edge" | "unreachable" | "timeout" | "http_error" | "service_unhealthy" | "unknown";
  detail: string;
  url?: string;
  analyzer_url?: string;
  anonymizer_url?: string;
}

interface LayerStatus {
  status: string;
  counts?: Partial<RedactionCounts>;
  method?: string;
  skipped_reason?: string;
  error?: Layer2Error;
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
// FALLBACK NAME DETECTION
// Detects capitalized standalone names when Presidio misses them
// ============================================================
function detectFallbackNames(
  text: string, 
  existingEntities: Array<{ entity_type: string; start: number; end: number; score: number }>
): Array<{ entity_type: string; start: number; end: number; score: number }> {
  // Common first names that are often missed (expanded list)
  const commonNames = new Set([
    // Female names
    "grace", "chelsea", "michelle", "lauren", "carol", "mary", "candy", "sarah", "jessica",
    "ashley", "amanda", "stephanie", "jennifer", "elizabeth", "megan", "hannah", "emily",
    "nicole", "rachel", "samantha", "rebecca", "victoria", "brittany", "christina", "amber",
    "heather", "melissa", "tiffany", "crystal", "brenda", "linda", "barbara", "patricia",
    "susan", "nancy", "lisa", "betty", "dorothy", "sandra", "ruth", "helen", "sharon",
    "donna", "laura", "cynthia", "kathleen", "amy", "angela", "shirley", "anna", "karen",
    // Male names
    "paul", "michael", "david", "john", "james", "robert", "william", "richard", "joseph",
    "thomas", "charles", "christopher", "daniel", "matthew", "anthony", "mark", "donald",
    "steven", "andrew", "kenneth", "joshua", "kevin", "brian", "george", "timothy", "ronald",
    "edward", "jason", "jeffrey", "ryan", "jacob", "gary", "nicholas", "eric", "jonathan",
    "stephen", "larry", "justin", "scott", "brandon", "raymond", "samuel", "benjamin", "gregory",
    "frank", "patrick", "alexander", "jack", "dennis", "jerry", "tyler", "aaron", "jose",
    // Gender neutral / Additional
    "alex", "jordan", "taylor", "morgan", "casey", "riley", "avery", "quinn", "cameron",
  ]);

  // Create a set of existing entity spans to avoid duplicates
  const existingSpans = new Set(
    existingEntities.map(e => `${e.start}-${e.end}`)
  );

  const fallbackEntities: Array<{ entity_type: string; start: number; end: number; score: number }> = [];
  
  // Pattern: standalone capitalized words that could be names
  // Match word boundaries, capitalized words 2-15 chars
  const namePattern = /\b([A-Z][a-z]{1,14})\b/g;
  let match;
  
  while ((match = namePattern.exec(text)) !== null) {
    const word = match[1];
    const start = match.index;
    const end = start + word.length;
    const spanKey = `${start}-${end}`;
    
    // Skip if already detected by Presidio
    if (existingSpans.has(spanKey)) continue;
    
    // Check if it overlaps with any existing entity
    const overlaps = existingEntities.some(e => 
      (start >= e.start && start < e.end) || (end > e.start && end <= e.end)
    );
    if (overlaps) continue;
    
    // Check if it's a known common name
    const isKnownName = commonNames.has(word.toLowerCase());
    
    // Also check for repeated capitalized words (likely names in conversational context)
    const wordLower = word.toLowerCase();
    const occurrences = (text.toLowerCase().match(new RegExp(`\\b${wordLower}\\b`, "g")) || []).length;
    const isRepeatedCapitalized = occurrences >= 2;
    
    // Skip common non-name words
    const skipWords = new Set([
      "the", "and", "but", "for", "not", "you", "all", "can", "had", "her", "was", "one",
      "our", "out", "are", "his", "has", "have", "this", "will", "your", "from", "they",
      "been", "have", "many", "some", "them", "these", "would", "there", "their", "what",
      "about", "which", "when", "make", "like", "time", "just", "know", "take", "people",
      "into", "year", "good", "could", "them", "than", "then", "look", "only", "come",
      "over", "such", "also", "back", "after", "use", "two", "how", "first", "well",
      "way", "even", "new", "want", "because", "any", "give", "day", "most", "us",
      "okay", "yeah", "yes", "hey", "monday", "tuesday", "wednesday", "thursday", 
      "friday", "saturday", "sunday", "january", "february", "march", "april", "may",
      "june", "july", "august", "september", "october", "november", "december",
      "department", "services", "agency", "office", "school", "hospital", "center",
      "home", "work", "case", "report", "client", "family", "children", "child",
      "mother", "father", "parent", "guardian", "worker", "caseworker", "supervisor",
    ]);
    
    if (skipWords.has(wordLower)) continue;
    
    if (isKnownName || isRepeatedCapitalized) {
      fallbackEntities.push({
        entity_type: "PERSON",
        start,
        end,
        score: isKnownName ? 0.6 : 0.4, // Higher confidence for known names
      });
      existingSpans.add(spanKey);
    }
  }

  return fallbackEntities;
}

// ============================================================
// LAYER 2: NER Redaction with Presidio (NO FALLBACK)
// ============================================================

interface PresidioResponse {
  redacted_text: string;
  counts: Record<string, number>;
  spans: Array<{ entity_type: string; start: number; end: number }>;
}

// Validate a URL for use in Edge Functions
function validatePresidioUrl(url: string | undefined, envVarName: string): { valid: boolean; error?: Layer2Error } {
  if (!url) {
    return {
      valid: false,
      error: {
        reason: "missing_env_var",
        detail: `${envVarName} environment variable is not configured in Supabase secrets`,
      },
    };
  }
  
  // Check for placeholder characters like < or >
  if (url.includes("<") || url.includes(">")) {
    return {
      valid: false,
      error: {
        reason: "misconfigured_env",
        detail: `${envVarName} contains placeholder characters (< or >). Please set a real URL, not a template like 'https://<host>:8001'. Current value: ${url.slice(0, 80)}`,
        url: url,
      },
    };
  }
  
  // Check for proper protocol
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return {
      valid: false,
      error: {
        reason: "misconfigured_env",
        detail: `${envVarName} must start with http:// or https://. Current value: ${url.slice(0, 80)}`,
        url: url,
      },
    };
  }
  
  // Check for localhost - Edge Functions cannot reach localhost
  if (url.includes("localhost") || url.includes("127.0.0.1")) {
    return {
      valid: false,
      error: {
        reason: "invalid_url_for_edge",
        detail: `${envVarName} cannot use localhost or 127.0.0.1. Edge Functions require a publicly accessible endpoint. Current value: ${url}`,
        url: url,
      },
    };
  }
  
  return { valid: true };
}

// Check if Presidio analyzer service is healthy
async function checkPresidioHealth(analyzerUrl: string): Promise<{ healthy: boolean; error?: Layer2Error }> {
  const now = Date.now();
  
  // Return cached result if still valid
  if (presidioHealthy !== null && (now - presidioHealthCheckedAt) < PRESIDIO_HEALTH_CACHE_MS) {
    console.log(`[Presidio] Using cached health status: ${presidioHealthy ? "healthy" : "unhealthy"}`);
    return { healthy: presidioHealthy };
  }
  
  // Presidio Analyzer health endpoint
  const healthUrl = `${analyzerUrl}/health`;
  console.log(`[Presidio] Health check URL: ${healthUrl}`);
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second health check timeout
    
    const response = await fetch(healthUrl, {
      method: "GET",
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    console.log(`[Presidio] Health check status: ${response.status}`);
    
    if (response.ok) {
      presidioHealthy = true;
      presidioHealthCheckedAt = now;
      console.log(`[Presidio] Health check passed`);
      return { healthy: true };
    } else {
      const bodyText = await response.text().catch(() => "");
      console.warn(`[Presidio] Health check failed: HTTP ${response.status}, body: ${bodyText.slice(0, 300)}`);
      presidioHealthy = false;
      presidioHealthCheckedAt = now;
      return { 
        healthy: false, 
        error: { 
          reason: "http_error", 
          detail: `Health check returned HTTP ${response.status}: ${bodyText.slice(0, 200)}`,
          url: healthUrl 
        } 
      };
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.warn(`[Presidio] Health check error: ${err.name} - ${err.message}`);
    if (err.stack) console.warn(`[Presidio] Stack: ${err.stack}`);
    presidioHealthy = false;
    presidioHealthCheckedAt = now;
    
    const isTimeout = err.name === "AbortError";
    return { 
      healthy: false, 
      error: { 
        reason: isTimeout ? "timeout" : "unreachable", 
        detail: `${err.name}: ${err.message}`,
        url: healthUrl 
      } 
    };
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
  error?: Layer2Error;
  verification?: {
    status: "PASS" | "FAIL";
    categories?: string[];
    remaining?: {
      count: number;
      counts: Record<string, number>;
      top_20_entities: Array<{ entity_type: string; start: number; end: number; score?: number }>;
    };
  };
}> {
  
  // ========== ENV VAR CHECK ==========
  const analyzerUrl = Deno.env.get("PRESIDIO_ANALYZER_URL");
  const anonymizerUrl = Deno.env.get("PRESIDIO_ANONYMIZER_URL");
  
  console.log("[L2] PRESIDIO_ANALYZER_URL:", analyzerUrl || "(not set)");
  console.log("[L2] PRESIDIO_ANONYMIZER_URL:", anonymizerUrl || "(not set)");
  
  // Validate Analyzer URL
  const analyzerValidation = validatePresidioUrl(analyzerUrl, "PRESIDIO_ANALYZER_URL");
  if (!analyzerValidation.valid) {
    console.warn(`[L2] Analyzer URL validation failed: ${analyzerValidation.error?.detail}`);
    await logEyeEvent(supabase, sessionId, "NER_REDACTION_SKIPPED", {
      reason_code: analyzerValidation.error?.reason || "config_missing",
      env_var: "PRESIDIO_ANALYZER_URL",
    });
    
    return {
      text: text,
      counts: { person: 0, location: 0, organization: 0, date: 0 },
      layer2Status: "SKIPPED_CONFIG_MISSING",
      method: "none",
      error: {
        ...analyzerValidation.error!,
        analyzer_url: analyzerUrl || undefined,
        anonymizer_url: anonymizerUrl || undefined,
      },
    };
  }
  
  // Validate Anonymizer URL
  const anonymizerValidation = validatePresidioUrl(anonymizerUrl, "PRESIDIO_ANONYMIZER_URL");
  if (!anonymizerValidation.valid) {
    console.warn(`[L2] Anonymizer URL validation failed: ${anonymizerValidation.error?.detail}`);
    await logEyeEvent(supabase, sessionId, "NER_REDACTION_SKIPPED", {
      reason_code: anonymizerValidation.error?.reason || "config_missing",
      env_var: "PRESIDIO_ANONYMIZER_URL",
    });
    
    return {
      text: text,
      counts: { person: 0, location: 0, organization: 0, date: 0 },
      layer2Status: "SKIPPED_CONFIG_MISSING",
      method: "none",
      error: {
        ...anonymizerValidation.error!,
        analyzer_url: analyzerUrl || undefined,
        anonymizer_url: anonymizerUrl || undefined,
      },
    };
  }

  // Emit NER_REDACTION_STARTED
  await logEyeEvent(supabase, sessionId, "NER_REDACTION_STARTED", {
    analyzer_url: analyzerUrl,
    anonymizer_url: anonymizerUrl,
  });

  // ========== HEALTH CHECK (Analyzer) ==========
  const healthResult = await checkPresidioHealth(analyzerUrl!);
  if (!healthResult.healthy) {
    console.warn("[L2] Presidio Analyzer service unhealthy - Layer 2 failed");
    await logEyeEvent(supabase, sessionId, "NER_REDACTION_FAILED", {
      reason_code: "service_unhealthy",
    });
    
    return {
      text: text,
      counts: { person: 0, location: 0, organization: 0, date: 0 },
      layer2Status: "FAILED_UNREACHABLE",
      method: "none",
      error: healthResult.error || {
        reason: "service_unhealthy",
        detail: "Presidio Analyzer health check failed",
        analyzer_url: analyzerUrl,
        anonymizer_url: anonymizerUrl,
      },
    };
  }

  // ========== STEP 1: ANALYZE ==========
  const analyzeUrl = `${analyzerUrl}/analyze`;
  console.log(`[L2] Calling Presidio Analyzer: ${analyzeUrl}`);
  
  let entities: Array<{ entity_type: string; start: number; end: number; score: number }> = [];
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PRESIDIO_TIMEOUT_MS);

    // Request all entity types with explicit inclusion of PERSON variants
    // Use a lower score threshold for PERSON detection (0.3) to catch more names
    const analyzePayload = {
      text: text,
      language: "en",
      entities: [
        "PERSON",           // Standard person detection
        "LOCATION", 
        "ORGANIZATION", 
        "DATE_TIME",
        "NRP",              // Nationality, religious or political group
      ],
      score_threshold: 0.3, // Lower threshold for high recall on names
    };

    console.log(`[L2] Analyzer payload: entities=${analyzePayload.entities.join(",")}, score_threshold=${analyzePayload.score_threshold}`);

    // Use fetchWithLogs for detailed debugging
    const { res: analyzeResponse, text: analyzeBody, json: analyzeJson } = await fetchWithLogs(
      "PRESIDIO_ANALYZE",
      analyzeUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(analyzePayload),
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!analyzeResponse.ok) {
      const error: Layer2Error = {
        reason: "http_error",
        detail: `Presidio Analyzer returned HTTP ${analyzeResponse.status}: ${analyzeBody.slice(0, 200)}`,
        url: analyzeUrl,
        analyzer_url: analyzerUrl,
        anonymizer_url: anonymizerUrl,
      };
      console.warn(`[L2] Analyzer HTTP error: ${error.detail}`);
      
      await logEyeEvent(supabase, sessionId, "NER_REDACTION_FAILED", {
        reason_code: "analyzer_http_error",
        status: analyzeResponse.status,
      });
      
      return {
        text: text,
        counts: { person: 0, location: 0, organization: 0, date: 0 },
        layer2Status: "FAILED_ERROR",
        method: "none",
        error,
      };
    }

    entities = analyzeJson as Array<{ entity_type: string; start: number; end: number; score: number }>;
    
    // Log entity breakdown for debugging
    const personCount = entities.filter(e => e.entity_type === "PERSON").length;
    const locationCount = entities.filter(e => e.entity_type === "LOCATION").length;
    console.log(`[L2] Analyzer found ${entities.length} entities total: ${personCount} PERSON, ${locationCount} LOCATION`);

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`[L2] Analyzer fetch error: ${err.name} - ${err.message}`);
    if (err.stack) console.error(`[L2] Analyzer stack: ${err.stack}`);
    
    const isTimeout = err.name === "AbortError";
    const layer2Error: Layer2Error = {
      reason: isTimeout ? "timeout" : "unreachable",
      detail: `Analyzer: ${err.name}: ${err.message}`,
      url: analyzeUrl,
      analyzer_url: analyzerUrl,
      anonymizer_url: anonymizerUrl,
    };
    
    await logEyeEvent(supabase, sessionId, "NER_REDACTION_FAILED", {
      reason_code: isTimeout ? "analyzer_timeout" : "analyzer_unreachable",
    });
    
    return {
      text: text,
      counts: { person: 0, location: 0, organization: 0, date: 0 },
      layer2Status: isTimeout ? "FAILED_TIMEOUT" : "FAILED_UNREACHABLE",
      method: "none",
      error: layer2Error,
    };
  }

  // ========== FALLBACK NAME DETECTION ==========
  // If Presidio found suspiciously few PERSON entities, run fallback detection
  const personEntities = entities.filter(e => e.entity_type === "PERSON");
  const personCount = personEntities.length;
  
  if (personCount <= 2) {
    console.log(`[L2] Low PERSON count (${personCount}) - running fallback name detection`);
    const fallbackEntities = detectFallbackNames(text, entities);
    
    if (fallbackEntities.length > 0) {
      console.log(`[L2] Fallback detected ${fallbackEntities.length} additional names`);
      entities = [...entities, ...fallbackEntities];
      
      await logEyeEvent(supabase, sessionId, "FALLBACK_NAME_DETECTION", {
        original_person_count: personCount,
        fallback_count: fallbackEntities.length,
      });
    }
  }

  // If still no entities found after fallback, return original text
  if (entities.length === 0) {
    console.log("[L2] No entities found - returning original text");
    await logEyeEvent(supabase, sessionId, "NER_REDACTION_COMPLETED", {
      counts: { person: 0, location: 0, organization: 0, date: 0 },
      method: "presidio",
      entities_found: 0,
    });
    
    return {
      text: text,
      counts: { person: 0, location: 0, organization: 0, date: 0 },
      layer2Status: "COMPLETED",
      method: "presidio",
    };
  }

  // ========== STEP 2: ANONYMIZE ==========
  const anonymizeUrl = `${anonymizerUrl}/anonymize`;
  console.log(`[L2] Calling Presidio Anonymizer: ${anonymizeUrl}`);
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PRESIDIO_TIMEOUT_MS);

    // Build anonymizer operators for deterministic replacement
    const operators: Record<string, { type: string; new_value?: string }> = {
      PERSON: { type: "replace", new_value: "<PERSON>" },
      LOCATION: { type: "replace", new_value: "<LOCATION>" },
      ORGANIZATION: { type: "replace", new_value: "<ORGANIZATION>" },
      DATE_TIME: { type: "replace", new_value: "<DATE_TIME>" },
      NRP: { type: "replace", new_value: "<NRP>" },
    };

    const anonymizePayload = {
      text: text,
      analyzer_results: entities,
      operators: operators,
    };

    // Use fetchWithLogs for detailed debugging
    const { res: anonymizeResponse, text: anonymizeBody, json: anonymizeJson } = await fetchWithLogs(
      "PRESIDIO_ANONYMIZE",
      anonymizeUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(anonymizePayload),
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!anonymizeResponse.ok) {
      const error: Layer2Error = {
        reason: "http_error",
        detail: `Presidio Anonymizer returned HTTP ${anonymizeResponse.status}: ${anonymizeBody.slice(0, 200)}`,
        url: anonymizeUrl,
        analyzer_url: analyzerUrl,
        anonymizer_url: anonymizerUrl,
      };
      console.warn(`[L2] Anonymizer HTTP error: ${error.detail}`);
      
      await logEyeEvent(supabase, sessionId, "NER_REDACTION_FAILED", {
        reason_code: "anonymizer_http_error",
        status: anonymizeResponse.status,
      });
      
      return {
        text: text,
        counts: { person: 0, location: 0, organization: 0, date: 0 },
        layer2Status: "FAILED_ERROR",
        method: "none",
        error,
      };
    }

    const anonymizeResult = anonymizeJson as { text?: string; items?: unknown[] };
    let presidioRedactedText = typeof anonymizeResult.text === "string" ? anonymizeResult.text : "";

    // HARD CHECKS: ensure we never accidentally return the un-redacted text
    if (!presidioRedactedText || presidioRedactedText.trim().length === 0) {
      console.error("[L2] ERROR: Presidio anonymizer returned empty text");
      throw new Error("PRESIDIO_REDACTED_TEXT_EMPTY");
    }

    if (presidioRedactedText === text && entities.length > 0) {
      console.error(
        `[L2] ERROR: Presidio anonymizer returned unchanged text despite ${entities.length} entities`
      );
      throw new Error("PRESIDIO_REDACTED_TEXT_UNCHANGED");
    }

    // ========== STEP 3: VERIFY (ANALYZE AGAIN) ==========
    const verifyBasePayload = {
      language: "en",
      entities: ["PERSON", "LOCATION", "ORGANIZATION", "DATE_TIME", "NRP"],
      score_threshold: 0.3,
    };

    const runVerifyAnalyze = async (tag: string, textToAnalyze: string) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), PRESIDIO_TIMEOUT_MS);

      const { res, text: bodyText, json } = await fetchWithLogs(tag, analyzeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...verifyBasePayload, text: textToAnalyze }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(
          `Presidio verify-analyze returned HTTP ${res.status}: ${bodyText.slice(0, 200)}`
        );
      }

      return json as Array<{
        entity_type?: string;
        entity?: string;
        start: number;
        end: number;
        score?: number;
        confidence?: number;
        analysis_explanation?: { score?: number };
      }>;
    };

    let remainingEntities = await runVerifyAnalyze("PRESIDIO_VERIFY_ANALYZE", presidioRedactedText);

    // Optional 2nd anonymize pass for any leftover entities
    if (Array.isArray(remainingEntities) && remainingEntities.length > 0) {
      console.warn(
        `[L2] Verification analyze found ${remainingEntities.length} leftover entities; running second anonymize pass`
      );

      const secondAnonymizePayload = {
        text: presidioRedactedText,
        analyzer_results: remainingEntities,
        operators,
      };

      const controller2 = new AbortController();
      const timeoutId2 = setTimeout(() => controller2.abort(), PRESIDIO_TIMEOUT_MS);

      const { res: anonymize2Res, text: anonymize2Body, json: anonymize2Json } = await fetchWithLogs(
        "PRESIDIO_ANONYMIZE_2",
        anonymizeUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(secondAnonymizePayload),
          signal: controller2.signal,
        }
      );

      clearTimeout(timeoutId2);

      if (!anonymize2Res.ok) {
        throw new Error(
          `Presidio Anonymize (2nd pass) returned HTTP ${anonymize2Res.status}: ${anonymize2Body.slice(0, 200)}`
        );
      }

      const anonymize2Result = anonymize2Json as { text?: string; items?: unknown[] };
      presidioRedactedText = typeof anonymize2Result.text === "string" ? anonymize2Result.text : "";

      if (!presidioRedactedText || presidioRedactedText.trim().length === 0) {
        console.error("[L2] ERROR: Presidio anonymizer (2nd pass) returned empty text");
        throw new Error("PRESIDIO_REDACTED_TEXT_EMPTY_2");
      }

      if (presidioRedactedText === text) {
        console.error("[L2] ERROR: Presidio anonymizer (2nd pass) still equals input text");
        throw new Error("PRESIDIO_REDACTED_TEXT_UNCHANGED_2");
      }

      remainingEntities = await runVerifyAnalyze("PRESIDIO_VERIFY_ANALYZE_2", presidioRedactedText);
    }

    // Build verification result based on leftover entities
    const remaining = Array.isArray(remainingEntities) ? remainingEntities : [];
    const remainingTypeCounts = remaining.reduce<Record<string, number>>((acc, e) => {
      const t = String(e?.entity_type ?? e?.entity ?? "UNKNOWN");
      acc[t] = (acc[t] || 0) + 1;
      return acc;
    }, {});
    const remainingTypes = Object.keys(remainingTypeCounts);

    const verification =
      remainingTypes.length === 0
        ? { status: "PASS" as const }
        : {
            status: "FAIL" as const,
            categories: remainingTypes,
            remaining: {
              count: remaining.length,
              counts: remainingTypeCounts,
              top_20_entities: remaining.slice(0, 20).map((x) => ({
                entity_type: String(x.entity_type ?? x.entity ?? "UNKNOWN"),
                start: x.start,
                end: x.end,
                score: x.score ?? x.confidence ?? x.analysis_explanation?.score,
              })),
            },
          };

    // Count entities by type (from initial analyze)
    const counts: Partial<RedactionCounts> = {
      person: entities.filter((e) => e.entity_type === "PERSON").length,
      location: entities.filter((e) => e.entity_type === "LOCATION").length,
      organization: entities.filter((e) => e.entity_type === "ORGANIZATION").length,
      date: entities.filter((e) => e.entity_type === "DATE_TIME").length,
    };

    console.log(`[L2] Presidio NER completed: ${JSON.stringify(counts)}`);

    await logEyeEvent(supabase, sessionId, "NER_REDACTION_COMPLETED", {
      counts,
      method: "presidio",
      entities_found: entities.length,
    });

    return {
      text: presidioRedactedText,
      counts,
      layer2Status: "COMPLETED",
      method: "presidio",
      verification,
    };

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`[L2] Anonymizer fetch error: ${err.name} - ${err.message}`);
    if (err.stack) console.error(`[L2] Anonymizer stack: ${err.stack}`);
    
    const isTimeout = err.name === "AbortError";
    const layer2Error: Layer2Error = {
      reason: isTimeout ? "timeout" : "unreachable",
      detail: `Anonymizer: ${err.name}: ${err.message}`,
      url: anonymizeUrl,
      analyzer_url: analyzerUrl,
      anonymizer_url: anonymizerUrl,
    };
    
    await logEyeEvent(supabase, sessionId, "NER_REDACTION_FAILED", {
      reason_code: isTimeout ? "anonymizer_timeout" : "anonymizer_unreachable",
    });
    
    return {
      text: text,
      counts: { person: 0, location: 0, organization: 0, date: 0 },
      layer2Status: isTimeout ? "FAILED_TIMEOUT" : "FAILED_UNREACHABLE",
      method: "none",
      error: layer2Error,
    };
  }
}

// ============================================================
// LAYER 3: LLM Verification (Classifier only, no rewriting)
// Enhanced to detect leftover names more aggressively
// ============================================================

// Pre-LLM check for obvious leftover names
function checkForLeftoverNames(text: string): string[] {
  const categories: string[] = [];
  
  // Common first names that should be redacted
  const commonNames = new Set([
    "grace", "chelsea", "michelle", "lauren", "carol", "mary", "candy", "sarah", "jessica",
    "ashley", "amanda", "stephanie", "jennifer", "elizabeth", "paul", "michael", "david",
    "john", "james", "robert", "william", "richard", "joseph", "thomas", "charles",
  ]);
  
  // Pattern: Capitalized words that are known names and NOT inside brackets
  const namePattern = /\b([A-Z][a-z]{1,14})\b/g;
  let match;
  const foundNames: string[] = [];
  
  while ((match = namePattern.exec(text)) !== null) {
    const word = match[1];
    const position = match.index;
    
    // Check if this is inside a redaction bracket like [PERSON] or <PERSON>
    const beforeText = text.slice(Math.max(0, position - 20), position);
    const afterText = text.slice(position + word.length, position + word.length + 5);
    const isInsideBracket = (beforeText.includes("[") && afterText.includes("]")) ||
                            (beforeText.includes("<") && afterText.includes(">"));
    
    if (!isInsideBracket && commonNames.has(word.toLowerCase())) {
      foundNames.push(word);
    }
  }
  
  if (foundNames.length > 0) {
    console.log(`[L3] Pre-check found ${foundNames.length} potential leftover names: ${foundNames.slice(0, 5).join(", ")}`);
    categories.push("PERSON");
  }
  
  // Check for repeated capitalized tokens (likely names in conversation)
  const capitalizedWords: Record<string, number> = {};
  const capPattern = /\b([A-Z][a-z]{2,14})\b/g;
  
  while ((match = capPattern.exec(text)) !== null) {
    const word = match[1];
    const position = match.index;
    
    // Skip if inside brackets
    const beforeText = text.slice(Math.max(0, position - 5), position);
    if (beforeText.includes("[") || beforeText.includes("<")) continue;
    
    capitalizedWords[word] = (capitalizedWords[word] || 0) + 1;
  }
  
  // Words that appear 3+ times capitalized are suspicious
  const repeatedNames = Object.entries(capitalizedWords)
    .filter(([_, count]) => count >= 3)
    .map(([word, _]) => word);
  
  if (repeatedNames.length > 0 && !categories.includes("PERSON")) {
    console.log(`[L3] Pre-check found repeated capitalized words: ${repeatedNames.join(", ")}`);
    categories.push("PERSON");
  }
  
  return categories;
}

async function verifyWithLLM(
  text: string,
  openAIApiKey: string
): Promise<{ status: "PASS" | "FAIL"; categories?: string[] }> {
  
  // First run pre-LLM pattern check for obvious leftover names
  const preCheckCategories = checkForLeftoverNames(text);
  
  const systemPrompt = `You are a PHI/PII verification classifier. Your ONLY job is to determine if the provided text still contains potentially identifying information.

You must respond with ONLY a JSON object in this exact format:
{"contains_phi": true/false, "categories": ["CATEGORY1", "CATEGORY2"]}

Valid categories: PERSON, LOCATION, CONTACT, ID, DATE, ORGANIZATION, ADDRESS, MEDICAL_ID, SSN

CRITICAL RULES for PERSON detection:
- First names (Grace, Chelsea, Paul, Michelle, etc.) are PERSON identifiers and MUST be flagged
- Names appearing multiple times throughout the text are especially important to flag
- Short names (2-5 letters) are still PERSON identifiers
- Names used in conversation context ("hi Grace", "okay Chelsea") are PERSON identifiers

SAFE patterns (do NOT flag):
- [REDACTED] style placeholders like [EMAIL], [PHONE], [SSN], [PERSON], [LOCATION], <PERSON>, etc.
- Role descriptions like "the client", "the caseworker", "the supervisor"
- Generic references like "the child", "the parent", "the worker"

UNSAFE patterns (MUST flag):
- Any actual first or last names (Grace, Chelsea, Smith, Johnson, etc.)
- Names with titles (Mr. Smith, Ms. Johnson)
- Nicknames or informal names

Be AGGRESSIVE about flagging PERSON - it's better to have false positives than miss names.
Do NOT rewrite or modify the text.
Do NOT explain your reasoning.
ONLY output the JSON object.`;

  try {
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
      // On LLM failure, include pre-check results and default to FAIL
      const fallbackCategories = preCheckCategories.length > 0 ? preCheckCategories : ["UNKNOWN"];
      return { status: "FAIL", categories: fallbackCategories };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      
      // Merge LLM results with pre-check results
      let finalCategories: string[] = [];
      
      if (parsed.contains_phi === true) {
        finalCategories = parsed.categories || [];
      }
      
      // Add pre-check categories that weren't in LLM result
      for (const cat of preCheckCategories) {
        if (!finalCategories.includes(cat)) {
          finalCategories.push(cat);
        }
      }
      
      if (finalCategories.length > 0) {
        return {
          status: "FAIL",
          categories: finalCategories,
        };
      }
      
      return { status: "PASS" };
    }
    
    // Parse error - use pre-check results
    console.error("Failed to parse LLM verification response");
    const fallbackCategories = preCheckCategories.length > 0 ? preCheckCategories : ["PARSE_ERROR"];
    return { status: "FAIL", categories: fallbackCategories };
    
  } catch (e) {
    console.error("Failed to call LLM verification:", e);
    // Default to FAIL on error, include pre-check results
    const fallbackCategories = preCheckCategories.length > 0 ? preCheckCategories : ["PARSE_ERROR"];
    return { status: "FAIL", categories: fallbackCategories };
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
    error: layer2Result.error,
  };

  // Determine minimized_text source
  const minimizedTextSource: "ner" | "regex" = layer2Result.layer2Status === "COMPLETED" ? "ner" : "regex";

  await logEyeEvent(supabase, sessionId, "MINIMIZED_TEXT_SET", {
    source_layer: minimizedTextSource,
    layer2_status: layer2Result.layer2Status,
  });

  // ========== LAYER 3: Verification ==========
  console.log("[Redact] Running Layer 3: Verification");

  const verification =
    layer2Result.layer2Status === "COMPLETED" && layer2Result.verification
      ? layer2Result.verification
      : await verifyWithLLM(layer2Result.text, openAIApiKey);

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
  // Run env var sanity check at function start
  logEnvVarSanityCheck();
  
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
