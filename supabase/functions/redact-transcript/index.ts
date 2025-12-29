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
  redact_agency_refs?: boolean; // Feature flag for agency reference redaction (default: false)
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
// PRE-NER NORMALIZATION: Clean ASR/typing artifacts safely
// ============================================================

// Check if position is at sentence start (after . ? ! \n or start of text)
function isSentenceStart(text: string, pos: number): boolean {
  if (pos === 0) return true;
  const before = text.slice(0, pos).trimEnd();
  if (before.length === 0) return true;
  const lastChar = before[before.length - 1];
  return /[.!?\n]/.test(lastChar);
}

// Check if token is within a name-introducer window
function isInNameIntroducerWindow(text: string, pos: number): boolean {
  const windowSize = 30; // Check ~30 chars before
  const before = text.slice(Math.max(0, pos - windowSize), pos).toLowerCase();
  const introducers = [
    "my name is", "this is", "i am", "i'm", "called", "named",
    "mr.", "mrs.", "ms.", "dr.", "mr ", "mrs ", "ms ", "dr "
  ];
  return introducers.some(intro => before.includes(intro));
}

// Check if position is inside a placeholder like <PERSON> or [CASE_ID]
function isInsidePlaceholder(text: string, pos: number): boolean {
  // Find the last < or [ before pos
  let bracketStart = -1;
  for (let i = pos - 1; i >= 0; i--) {
    if (text[i] === '<' || text[i] === '[') {
      bracketStart = i;
      break;
    }
    if (text[i] === '>' || text[i] === ']') {
      break; // Found close before open, so not inside
    }
  }
  if (bracketStart === -1) return false;
  
  // Find next > or ] after pos
  const closeChar = text[bracketStart] === '<' ? '>' : ']';
  const nextClose = text.indexOf(closeChar, pos);
  return nextClose !== -1;
}

interface NormalizationResult {
  text: string;
  changes: Array<{ original: string; normalized: string; position: number }>;
}

// All possible apostrophe-like characters to normalize
const APOSTROPHE_VARIANTS = /[\u0027\u0060\u00B4\u02B9\u02BC\u02C8\u0313\u0315\u055A\u05F3\u2018\u2019\u201B\u2032\uFF07'`´]/g;

function preNerNormalize(text: string): NormalizationResult {
  const changes: Array<{ original: string; normalized: string; position: number }> = [];
  let result = text;
  
  // Step 1: Normalize ALL apostrophe variants to standard ASCII apostrophe (')
  // This is critical for consistent pattern matching in agency redaction
  result = result.replace(APOSTROPHE_VARIANTS, "'");
  
  // Step 2: Collapse repeated whitespace
  result = result.replace(/[ \t]+/g, " ");
  
  // Step 3: Collapse duplicate immediate words (e.g., "Mis misstate" → "misstate")
  // Pattern: word repeated immediately (case-insensitive)
  const duplicatePattern = /\b([A-Za-z]+)\s+\1\b/gi;
  let dupMatch;
  const duplicateOffsets: Array<{ start: number; end: number; replacement: string }> = [];
  
  while ((dupMatch = duplicatePattern.exec(result)) !== null) {
    const fullMatch = dupMatch[0];
    const word = dupMatch[1];
    const start = dupMatch.index;
    
    // Skip if inside placeholder
    if (isInsidePlaceholder(result, start)) continue;
    
    // Keep lowercase version
    duplicateOffsets.push({
      start,
      end: start + fullMatch.length,
      replacement: word.toLowerCase(),
    });
  }
  
  // Apply duplicate collapses in reverse order
  for (let i = duplicateOffsets.length - 1; i >= 0; i--) {
    const { start, end, replacement } = duplicateOffsets[i];
    const original = result.slice(start, end);
    result = result.slice(0, start) + replacement + result.slice(end);
    changes.push({ original, normalized: replacement, position: start });
  }
  
  // Step 4: Fix stray mid-sentence capitalization
  // Pattern: Titlecase token not at sentence start, not in name window
  const titleCasePattern = /\b([A-Z][a-z]{2,})\b/g;
  let tcMatch;
  const titleCaseOffsets: Array<{ start: number; end: number; replacement: string }> = [];
  
  while ((tcMatch = titleCasePattern.exec(result)) !== null) {
    const word = tcMatch[1];
    const start = tcMatch.index;
    
    // Skip if inside placeholder
    if (isInsidePlaceholder(result, start)) continue;
    
    // Skip if at sentence start
    if (isSentenceStart(result, start)) continue;
    
    // Skip if in name introducer window
    if (isInNameIntroducerWindow(result, start)) continue;
    
    // Skip if preceded by punctuation (could be title or heading)
    const charBefore = start > 0 ? result[start - 1] : "";
    if (/[:\-"']/.test(charBefore)) continue;
    
    // Check what's before - should be a normal word (not punctuation boundary)
    const beforeText = result.slice(Math.max(0, start - 15), start);
    const lastWord = beforeText.match(/[a-zA-Z]+\s*$/);
    if (!lastWord) continue; // Don't lowercase if no preceding word
    
    // Common words that get ASR-capitalized mid-sentence (typos/errors)
    const commonMidSentenceWords = new Set([
      "dental", "medical", "mental", "financial", "physical", "emotional",
      "social", "legal", "general", "special", "personal", "professional",
      "improvement", "appointment", "development", "assessment", "treatment",
      "misstate", "understand", "remember", "explain", "describe",
    ]);
    
    if (commonMidSentenceWords.has(word.toLowerCase())) {
      titleCaseOffsets.push({
        start,
        end: start + word.length,
        replacement: word.toLowerCase(),
      });
    }
  }
  
  // Apply title case fixes in reverse order
  for (let i = titleCaseOffsets.length - 1; i >= 0; i--) {
    const { start, end, replacement } = titleCaseOffsets[i];
    const original = result.slice(start, end);
    result = result.slice(0, start) + replacement + result.slice(end);
    changes.push({ original, normalized: replacement, position: start });
  }
  
  return { text: result, changes };
}

// ============================================================
// CASE_ID REGEX DETECTION (runs before Presidio)
// STRICT VERSION: Only redacts tokens that look like real IDs
// ============================================================

interface CaseIdResult {
  text: string;
  count: number;
  candidatesFound: number;
  candidatesRedacted: number;
  examples: string[];
}

// Check if a candidate string looks like a real case ID
function isValidCaseId(candidate: string): boolean {
  // Must contain at least 1 digit
  if (!/\d/.test(candidate)) {
    return false;
  }
  
  // Must be at least 4 characters
  if (candidate.length < 4) {
    return false;
  }
  
  // Check against known structured ID formats
  const validFormats = [
    /^\d{6,}$/,                           // 6+ digits: 123456
    /^[A-Z]{2,10}-\d{2,}$/i,              // Letter prefix + digits: ABC-12345
    /^\d{2,}-\d{2,}(-\d{2,})?$/,          // Digit groups: 12-34-56
    /^[A-Z]{1,4}\d{4,}$/i,                // Short prefix + digits: A12345, AB1234
    /^\d{4,}[A-Z]{1,4}$/i,                // Digits + suffix: 12345A
    /^[A-Z0-9]{6,}$/i,                    // Mixed alphanumeric 6+ chars (already validated has digit)
  ];
  
  return validFormats.some(f => f.test(candidate));
}

// Case ID context keywords
const CASE_ID_KEYWORDS = [
  "case id", "case #", "case number", "case no", "caseid",
  "ref #", "ref:", "reference", "reference #", "reference id",
  "incident #", "incident", "report #", "report id",
  "intake #", "intake", "docket", "docket #",
  "file #", "file id", "file number",
  "record id", "record #", "record number",
  "matter #", "matter id",
];

function redactCaseIds(text: string): CaseIdResult {
  let result = text;
  let count = 0;
  let candidatesFound = 0;
  let removedFalsePositives = 0;
  const examples: string[] = [];
  
  // Don't match inside existing placeholders
  const isInsideTag = (pos: number, txt: string): boolean => {
    for (let i = pos - 1; i >= 0; i--) {
      if (txt[i] === '<' || txt[i] === '[') {
        const closeIdx = txt.indexOf(txt[i] === '<' ? '>' : ']', pos);
        return closeIdx !== -1;
      }
      if (txt[i] === '>' || txt[i] === ']') break;
    }
    return false;
  };
  
  // CLEANUP: Remove any stray [CASE_ID] tokens from buggy previous runs
  // These are false positives - remove them entirely (replace with empty string)
  result = result.replace(/\s*\[CASE_ID\]\s*/gi, (match) => {
    removedFalsePositives++;
    // Preserve a single space if surrounded by spaces
    return ' ';
  });
  
  // Pattern 1: Already has [CASE_ID: <actual_id>] placeholder - convert to <CASE_ID> only if it has an ID with digits
  result = result.replace(/\[CASE_ID:\s*([^\]]+)\]/gi, (match, idPart) => {
    // Only convert if the ID part contains at least one digit
    if (/\d/.test(idPart)) {
      count++;
      if (examples.length < 3) examples.push(maskForLogs(`[CASE_ID:${idPart}]`, 20));
      return "<CASE_ID>";
    }
    // No digits = not a real ID, remove it
    removedFalsePositives++;
    return '';
  });
  
  // Build a map of keyword positions for context checking
  const keywordPositions: Array<{ start: number; end: number; keyword: string }> = [];
  for (const keyword of CASE_ID_KEYWORDS) {
    const escapedKeyword = keyword.replace(/[#]/g, '\\#').replace(/\s+/g, '\\s*');
    const regex = new RegExp(`\\b${escapedKeyword}`, 'gi');
    let match;
    while ((match = regex.exec(result)) !== null) {
      keywordPositions.push({
        start: match.index,
        end: match.index + match[0].length,
        keyword: keyword,
      });
    }
  }
  
  // Pattern 2: ID tokens near keywords (within ~40 chars after keyword)
  // Matches alphanumeric tokens that could be IDs
  const idTokenPattern = /\b([A-Z0-9][A-Z0-9\-_]{3,})\b/gi;
  const replacements: Array<{ start: number; end: number }> = [];
  
  let idMatch;
  while ((idMatch = idTokenPattern.exec(result)) !== null) {
    const candidate = idMatch[1];
    const matchStart = idMatch.index;
    const matchEnd = idMatch.index + idMatch[0].length;
    
    candidatesFound++;
    
    // Skip if inside a tag
    if (isInsideTag(matchStart, result)) {
      continue;
    }
    
    // STRICT: Must contain at least 1 digit
    if (!/\d/.test(candidate)) {
      continue;
    }
    
    // Check if near a keyword (within ~40 chars after any keyword end)
    const isNearKeyword = keywordPositions.some(kw => {
      const distance = matchStart - kw.end;
      return distance >= 0 && distance <= 40;
    });
    
    if (!isNearKeyword) {
      continue;
    }
    
    // Validate the candidate looks like a real ID (already confirmed has digit above)
    if (!isValidCaseId(candidate)) {
      continue;
    }
    
    // Mark for replacement
    replacements.push({ start: matchStart, end: matchEnd });
    if (examples.length < 3) examples.push(maskForLogs(candidate, 20));
  }
  
  // Apply replacements in reverse order to preserve indices
  replacements.sort((a, b) => b.start - a.start);
  for (const rep of replacements) {
    result = result.slice(0, rep.start) + "<CASE_ID>" + result.slice(rep.end);
    count++;
  }
  
  // Log cleanup stats
  if (removedFalsePositives > 0) {
    console.log(`[CaseID] Removed ${removedFalsePositives} false positive [CASE_ID] tokens`);
  }
  
  return { text: result, count, candidatesFound, candidatesRedacted: count, examples };
}

// ============================================================
// AGENCY REFERENCE REDACTION (always enabled, runs post-Presidio)
// Explicit agency names → <AGENCY>
// Generic agency references → <AGENCY_REF>
// ============================================================

interface AgencyResult {
  text: string;
  agencyCount: number;
  agencyRefCount: number;
  patterns: string[];
}

// Explicit agency names/acronyms - ORDER MATTERS (longer phrases first!)
// These patterns match the FULL phrase and replace entirely with <AGENCY>
// Note: After preNerNormalize, all apostrophes should be standard ASCII ('), but we match both for safety
const AGENCY_NAMES: Array<{ pattern: RegExp; name: string }> = [
  // Full names with "department of" (longest first to avoid partial matches)
  { pattern: /\b(?:the\s+)?department\s+of\s+child(?:ren)?'?s?\s+(?:and\s+)?(?:family\s+)?services\b/gi, name: "dept_children_services" },
  { pattern: /\b(?:the\s+)?division\s+of\s+child(?:ren)?'?s?\s+services\b/gi, name: "div_children_services" },
  { pattern: /\b(?:the\s+)?department\s+of\s+child\s+services\b/gi, name: "dept_child_services" },
  { pattern: /\b(?:the\s+)?department\s+of\s+social\s+services\b/gi, name: "dept_social_services" },
  { pattern: /\b(?:the\s+)?department\s+of\s+human\s+services\b/gi, name: "dept_human_services" },
  { pattern: /\b(?:the\s+)?department\s+of\s+family\s+services\b/gi, name: "dept_family_services" },
  // Phrases without "department of"
  { pattern: /\b(?:the\s+)?child\s+protective\s+services\b/gi, name: "child_protective_services" },
  { pattern: /\b(?:the\s+)?child(?:ren)?'?s?\s+services\b/gi, name: "children_services" },
  { pattern: /\b(?:the\s+)?child\s+welfare(?:\s+services)?\b/gi, name: "child_welfare" },
  { pattern: /\b(?:the\s+)?family\s+(?:and\s+)?child(?:ren)?'?s?\s+services\b/gi, name: "family_children_services" },
  { pattern: /\b(?:the\s+)?family\s+services\b/gi, name: "family_services" },
  { pattern: /\b(?:the\s+)?social\s+services\b/gi, name: "social_services" },
  { pattern: /\b(?:the\s+)?human\s+services\b/gi, name: "human_services" },
  // Acronyms (standalone) - case sensitive for acronyms
  { pattern: /\bCPS\b/g, name: "CPS" },
  { pattern: /\bDCS\b/g, name: "DCS" },
  { pattern: /\bDCFS\b/g, name: "DCFS" },
  { pattern: /\bDFCS\b/g, name: "DFCS" },
  { pattern: /\bDCF\b/g, name: "DCF" },
  { pattern: /\bDSS\b/g, name: "DSS" },
  { pattern: /\bDHHS\b/g, name: "DHHS" },
  { pattern: /\bDHS\b/g, name: "DHS" },
  { pattern: /\bHHS\b/g, name: "HHS" },
];

// DDS with context (worker, caseworker, etc.) → <AGENCY> or <AGENCY_ROLE>
const DDS_CONTEXT_PATTERNS = [
  // "my/our/the/a DDS worker" → "$1 <AGENCY_ROLE>"
  { pattern: /\b(my|our|the|a)\s+DDS\s+(worker|caseworker|case\s*worker|staff|employee|representative|supervisor|rep)\b/gi, replacement: "$1 <AGENCY_ROLE>" },
  // "DDS worker", "DDS caseworker" etc → <AGENCY_ROLE>
  { pattern: /\bDDS\s+(worker|caseworker|case\s*worker|staff|employee|representative|supervisor|rep)\b/gi, replacement: "<AGENCY_ROLE>" },
  // "from DDS", "at DDS" etc → preposition + <AGENCY>
  { pattern: /\b(from|at|with|by|through)\s+DDS\b/gi, replacement: "$1 <AGENCY>" },
];

// Generic agency references → <AGENCY_REF>
const AGENCY_REF_PATTERNS = [
  /\bour\s+agency\b/gi,
  /\bour\s+department\b/gi,
  /\bthe\s+agency\b/gi,
  /\bthe\s+department\b/gi,
  /\bthis\s+agency\b/gi,
  /\bthis\s+department\b/gi,
];

// Cleanup patterns for fixing awkward output from previous passes
// Note: After preNerNormalize, all apostrophes should be standard ASCII (')
const AGENCY_CLEANUP_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Fix "<AGENCY_REF> of children's services" → <AGENCY>
  { pattern: /<AGENCY_REF>\s+of\s+child(?:ren)?'?s?\s+services/gi, replacement: "<AGENCY>" },
  { pattern: /<AGENCY_REF>\s+of\s+child\s+services/gi, replacement: "<AGENCY>" },
  { pattern: /<AGENCY_REF>\s+of\s+family\s+services/gi, replacement: "<AGENCY>" },
  { pattern: /<AGENCY_REF>\s+of\s+social\s+services/gi, replacement: "<AGENCY>" },
  { pattern: /<AGENCY_REF>\s+of\s+human\s+services/gi, replacement: "<AGENCY>" },
  // Fix any leftover "of children's services" fragments after <AGENCY>
  { pattern: /<AGENCY>\s+of\s+child(?:ren)?'?s?\s+services/gi, replacement: "<AGENCY>" },
  // Fix double tags
  { pattern: /<AGENCY>\s*<AGENCY>/gi, replacement: "<AGENCY>" },
  { pattern: /<AGENCY_REF>\s*<AGENCY_REF>/gi, replacement: "<AGENCY_REF>" },
  { pattern: /<AGENCY_REF>\s*<AGENCY>/gi, replacement: "<AGENCY>" },
  { pattern: /<AGENCY>\s*<AGENCY_REF>/gi, replacement: "<AGENCY>" },
];

// Leftover org name fragments that should have been caught
// Note: After preNerNormalize, all apostrophes should be standard ASCII (')
const LEFTOVER_ORG_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  // Standalone "children's services" that wasn't caught
  { pattern: /\bchild(?:ren)?'?s?\s+services\b/gi, name: "children_services_leftover" },
  // Standalone "child protective" without "services"
  { pattern: /\bchild\s+protective\b/gi, name: "child_protective_leftover" },
];

function redactAgencyRefs(text: string): AgencyResult {
  let result = text;
  let agencyCount = 0;
  let agencyRefCount = 0;
  const patterns: string[] = [];
  
  // 1. Redact explicit agency names → <AGENCY> (order matters - longest first)
  for (const { pattern, name } of AGENCY_NAMES) {
    result = result.replace(pattern, () => {
      agencyCount++;
      if (!patterns.includes(name)) patterns.push(name);
      return "<AGENCY>";
    });
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
  }
  
  // 2. Redact DDS with context → <AGENCY> or <AGENCY_ROLE>
  for (const { pattern, replacement } of DDS_CONTEXT_PATTERNS) {
    result = result.replace(pattern, (...args) => {
      agencyCount++;
      if (!patterns.includes("DDS_context")) patterns.push("DDS_context");
      // Handle backreferences in replacement string
      let finalReplacement = replacement;
      // args: [fullMatch, group1, group2, ..., offset, string]
      for (let i = 1; i < args.length - 2; i++) {
        if (args[i]) {
          finalReplacement = finalReplacement.replace(new RegExp(`\\$${i}`, 'g'), args[i]);
        }
      }
      return finalReplacement;
    });
    pattern.lastIndex = 0;
  }
  
  // 3. Redact generic agency references → <AGENCY_REF>
  for (const pattern of AGENCY_REF_PATTERNS) {
    result = result.replace(pattern, () => {
      agencyRefCount++;
      if (!patterns.includes("agency_ref")) patterns.push("agency_ref");
      return "<AGENCY_REF>";
    });
    pattern.lastIndex = 0;
  }
  
  // 4. Cleanup pass - fix awkward patterns like "<AGENCY_REF> of children's services"
  for (const { pattern, replacement } of AGENCY_CLEANUP_PATTERNS) {
    const before = result;
    result = result.replace(pattern, replacement);
    if (result !== before) {
      if (!patterns.includes("cleanup")) patterns.push("cleanup");
    }
    pattern.lastIndex = 0;
  }
  
  // 5. Final sweep - catch any leftover org name fragments
  for (const { pattern, name } of LEFTOVER_ORG_PATTERNS) {
    const before = result;
    result = result.replace(pattern, () => {
      agencyCount++;
      if (!patterns.includes(name)) patterns.push(name);
      return "<AGENCY>";
    });
    pattern.lastIndex = 0;
  }
  
  // 6. Final cleanup - collapse multiple spaces and fix spacing around tags
  result = result.replace(/\s+/g, ' ');
  result = result.replace(/\s+([.,!?;:])/g, '$1');
  
  return { text: result, agencyCount, agencyRefCount, patterns };
}

// ============================================================
// FINAL AGENCY CLEANUP (runs AFTER all redaction passes)
// Fixes awkward fragments and catches any remaining org leaks
// ============================================================

interface FinalCleanupResult {
  text: string;
  replacementsMade: number;
  patternsMatched: string[];
  issuesFound: string[];
}

function finalAgencyCleanup(text: string): FinalCleanupResult {
  let result = text;
  let replacementsMade = 0;
  const patternsMatched: string[] = [];
  const issuesFound: string[] = [];
  
  // ========== RULE 1: Fix bad splices ==========
  // "<AGENCY_REF> of children's services" → <AGENCY>
  // Note: After preNerNormalize, all apostrophes should be standard ASCII (')
  const badSplicePatterns: Array<{ pattern: RegExp; name: string }> = [
    { pattern: /<AGENCY_REF>\s+of\s+(?:the\s+)?department\s+of\s+child(?:ren)?'?s?\s+services/gi, name: "agency_ref_of_dept" },
    { pattern: /<AGENCY_REF>\s+of\s+child(?:ren)?'?s?\s+services/gi, name: "agency_ref_of_children_services" },
    { pattern: /<AGENCY_REF>\s+of\s+child\s+services/gi, name: "agency_ref_of_child_services" },
    { pattern: /<AGENCY_REF>\s+of\s+family\s+services/gi, name: "agency_ref_of_family_services" },
    { pattern: /<AGENCY_REF>\s+of\s+social\s+services/gi, name: "agency_ref_of_social_services" },
    { pattern: /<AGENCY_REF>\s+of\s+human\s+services/gi, name: "agency_ref_of_human_services" },
    // Also fix if <AGENCY> somehow got this suffix
    { pattern: /<AGENCY>\s+of\s+child(?:ren)?'?s?\s+services/gi, name: "agency_of_children_services" },
    { pattern: /<AGENCY>\s+of\s+child\s+services/gi, name: "agency_of_child_services" },
  ];
  
  for (const { pattern, name } of badSplicePatterns) {
    const before = result;
    result = result.replace(pattern, "<AGENCY>");
    if (result !== before) {
      replacementsMade++;
      patternsMatched.push(name);
    }
    pattern.lastIndex = 0;
  }
  
  // ========== RULE 2: Replace remaining org phrase leaks ==========
  // These are phrases that should have been caught but weren't
  // Note: After preNerNormalize, all apostrophes should be standard ASCII (')
  const orgLeakPatterns: Array<{ pattern: RegExp; replacement: string; name: string }> = [
    // Full department names → <AGENCY>
    { pattern: /\b(?:the\s+)?department\s+of\s+child(?:ren)?'?s?\s+(?:and\s+)?(?:family\s+)?services\b/gi, replacement: "<AGENCY>", name: "dept_children_services" },
    { pattern: /\b(?:the\s+)?division\s+of\s+child(?:ren)?'?s?\s+services\b/gi, replacement: "<AGENCY>", name: "div_children_services" },
    // Standalone "Children's Services" → <AGENCY>
    { pattern: /\bchild(?:ren)?'?s?\s+services\b/gi, replacement: "<AGENCY>", name: "children_services" },
    // "child protective services" → <AGENCY>
    { pattern: /\bchild\s+protective\s+services\b/gi, replacement: "<AGENCY>", name: "child_protective_services" },
    // "child welfare" → <AGENCY>
    { pattern: /\bchild\s+welfare(?:\s+services)?\b/gi, replacement: "<AGENCY>", name: "child_welfare" },
    // "social services" → <AGENCY>
    { pattern: /\b(?:the\s+)?social\s+services\b/gi, replacement: "<AGENCY>", name: "social_services" },
    // "family services" → <AGENCY>
    { pattern: /\b(?:the\s+)?family\s+services\b/gi, replacement: "<AGENCY>", name: "family_services" },
    // Generic references → <AGENCY_REF> (only when clearly an agency reference)
    { pattern: /\bour\s+department\b/gi, replacement: "<AGENCY_REF>", name: "our_department" },
    { pattern: /\bour\s+agency\b/gi, replacement: "<AGENCY_REF>", name: "our_agency" },
    { pattern: /\bthe\s+department\b/gi, replacement: "<AGENCY_REF>", name: "the_department" },
    { pattern: /\bthe\s+agency\b/gi, replacement: "<AGENCY_REF>", name: "the_agency" },
  ];
  
  for (const { pattern, replacement, name } of orgLeakPatterns) {
    const before = result;
    result = result.replace(pattern, replacement);
    if (result !== before) {
      replacementsMade++;
      patternsMatched.push(name);
    }
    pattern.lastIndex = 0;
  }
  
  // ========== RULE 3: Collapse double agency tokens ==========
  const collapsePatterns: Array<{ pattern: RegExp; replacement: string; name: string }> = [
    { pattern: /<AGENCY>\s*<AGENCY>/gi, replacement: "<AGENCY>", name: "double_agency" },
    { pattern: /<AGENCY_REF>\s*<AGENCY_REF>/gi, replacement: "<AGENCY_REF>", name: "double_agency_ref" },
    { pattern: /<AGENCY_REF>\s*<AGENCY>/gi, replacement: "<AGENCY>", name: "agency_ref_then_agency" },
    { pattern: /<AGENCY>\s*<AGENCY_REF>/gi, replacement: "<AGENCY>", name: "agency_then_agency_ref" },
    // Also handle with "of" in between
    { pattern: /<AGENCY>\s+of\s+<AGENCY>/gi, replacement: "<AGENCY>", name: "agency_of_agency" },
    { pattern: /<AGENCY_REF>\s+of\s+<AGENCY>/gi, replacement: "<AGENCY>", name: "agency_ref_of_agency" },
  ];
  
  for (const { pattern, replacement, name } of collapsePatterns) {
    const before = result;
    result = result.replace(pattern, replacement);
    if (result !== before) {
      replacementsMade++;
      patternsMatched.push(name);
    }
    pattern.lastIndex = 0;
  }
  
  // ========== FINAL VALIDATION: Check for remaining issues ==========
  // These are patterns that should NOT exist in the final output
  // Note: After preNerNormalize, all apostrophes should be standard ASCII (')
  const validationPatterns = [
    { pattern: /of\s+child(?:ren)?'?s?\s+services/gi, issue: "of_children_services" },
    { pattern: /\bchildren'?s?\s+services\b/gi, issue: "children_services_literal" },
    { pattern: /<AGENCY_REF>\s+of\b/gi, issue: "agency_ref_of" },
  ];
  
  for (const { pattern, issue } of validationPatterns) {
    if (pattern.test(result)) {
      issuesFound.push(issue);
      console.warn(`[FinalCleanup] Validation failed: found "${issue}" in output`);
    }
    pattern.lastIndex = 0;
  }
  
  // Clean up multiple spaces
  result = result.replace(/\s+/g, ' ').trim();
  
  return { text: result, replacementsMade, patternsMatched, issuesFound };
}

//
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

  // Case number / reference ID patterns - STRICT: only match if contains digits
  // This is a legacy fallback; primary detection is in redactCaseIds()
  const caseIdPattern = /\b(Case\s*(?:#|No\.?|Number)|Reference\s*(?:#|No\.?|ID)|Ref\s*(?:#|No\.?))\s*[:\-]?\s*([A-Z0-9\-]{4,})\b/gi;
  result = result.replace(caseIdPattern, (match, prefix, idPart) => {
    // STRICT: Only redact if the ID part contains at least one digit
    if (!/\d/.test(idPart)) {
      return match; // Not a real ID, leave unchanged
    }
    counts.case_id!++;
    return "<CASE_ID>";
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

    // ========== STEP 4: LEFTOVER CANDIDATE NAME SWEEP ==========
    // Detect likely person-name tokens that Presidio missed and run a final anonymize pass
    const COMMON_NON_NAMES = new Set([
      // Days
      "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
      // Months
      "January", "February", "March", "April", "May", "June", "July", 
      "August", "September", "October", "November", "December",
      // Common words at sentence start
      "I", "OK", "Yeah", "Yes", "No", "The", "This", "That", "There", "Here",
      "What", "When", "Where", "Who", "Why", "How", "It", "We", "They", "He", "She",
      "Well", "Right", "Good", "Sure", "Okay", "Great", "Just", "And", "But", "So",
      // Family roles (not names)
      "Mom", "Dad", "Mother", "Father", "Grandma", "Grandpa", "Grandmother", "Grandfather",
      "Aunt", "Uncle", "Brother", "Sister", "Cousin", "Son", "Daughter", "Parent",
      // Common nouns that appear capitalized
      "Children", "Services", "Department", "Case", "Network", "Safety", "County",
      "Court", "Judge", "Attorney", "Lawyer", "Worker", "Office", "Center", "Agency",
      "Police", "Hospital", "School", "Doctor", "Nurse", "Teacher", "Manager",
      // Acronyms / abbreviations
      "DDS", "CPS", "DSS", "DCF", "DCFS", "HHS", "SSA", "SSI", "TANF", "SNAP",
      // Misc
      "Everything", "Nothing", "Something", "Anything", "Someone", "Everyone",
      "Today", "Tomorrow", "Yesterday", "Morning", "Afternoon", "Evening", "Night",
    ]);

    // Helper to check if a position is inside a redaction tag
    const isInsideTag = (pos: number, text: string): boolean => {
      let depth = 0;
      for (let i = 0; i < pos; i++) {
        if (text[i] === '<') depth++;
        else if (text[i] === '>') depth = Math.max(0, depth - 1);
      }
      return depth > 0;
    };

    // Regex to find candidate names: capitalized words 3+ chars
    const candidateNameRegex = /\b[A-Z][a-z]{2,}(?:-[A-Z][a-z]{2,})?\b/g;
    const candidateMatches: Array<{ token: string; start: number; end: number }> = [];
    let match;

    while ((match = candidateNameRegex.exec(presidioRedactedText)) !== null) {
      candidateMatches.push({
        token: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });
    }

    // Filter candidates
    const extraSpans: Array<{ entity_type: string; start: number; end: number; score: number }> = [];
    const excludedCandidates: string[] = [];

    for (const candidate of candidateMatches) {
      const { token, start, end } = candidate;

      // Skip if in allowlist
      if (COMMON_NON_NAMES.has(token)) {
        excludedCandidates.push(token);
        continue;
      }

      // Skip if it's a placeholder tag (starts with < or token looks like a tag)
      if (token.startsWith("<") || presidioRedactedText.slice(start - 1, start) === "<") {
        excludedCandidates.push(token);
        continue;
      }

      // Skip if inside a redaction tag like <PERSON>
      if (isInsideTag(start, presidioRedactedText)) {
        excludedCandidates.push(token);
        continue;
      }

      // Skip if preceded/followed by brackets indicating ID tags [CASE_ID]
      const before = presidioRedactedText.slice(Math.max(0, start - 1), start);
      const after = presidioRedactedText.slice(end, end + 1);
      if (before === "[" || after === "]" || before === "<" || after === ">") {
        excludedCandidates.push(token);
        continue;
      }

      // Valid candidate - add as PERSON span
      extraSpans.push({
        entity_type: "PERSON",
        start,
        end,
        score: 0.99,
      });
    }

    // Deduplicate spans (same start/end)
    const uniqueSpans = extraSpans.filter((span, idx, arr) => {
      return arr.findIndex(s => s.start === span.start && s.end === span.end) === idx;
    });

    // Sort by start and remove overlaps (keep first/longest)
    uniqueSpans.sort((a, b) => a.start - b.start);
    const nonOverlappingSpans: typeof uniqueSpans = [];
    for (const span of uniqueSpans) {
      const last = nonOverlappingSpans[nonOverlappingSpans.length - 1];
      if (!last || span.start >= last.end) {
        nonOverlappingSpans.push(span);
      }
    }

    // Log the sweep results
    const sampleDetected = nonOverlappingSpans.slice(0, 10).map(s => ({
      token: presidioRedactedText.slice(s.start, s.end),
      start: s.start,
      end: s.end,
    }));

    console.log(JSON.stringify({
      event: "LEFTOVER_SWEEP_SUMMARY",
      total_candidates_found: candidateMatches.length,
      total_candidates_excluded: excludedCandidates.length,
      total_spans_added: nonOverlappingSpans.length,
      sample_detected: sampleDetected,
    }));

    await logEyeEvent(supabase, sessionId, "LEFTOVER_SWEEP_SUMMARY", {
      total_candidates_found: candidateMatches.length,
      total_candidates_excluded: excludedCandidates.length,
      total_spans_added: nonOverlappingSpans.length,
      sample_detected: sampleDetected,
    });

    // Run third anonymize pass if we found leftover candidates
    if (nonOverlappingSpans.length > 0) {
      console.log(`[L2] Running 3rd anonymize pass for ${nonOverlappingSpans.length} leftover name candidates`);

      const thirdAnonymizePayload = {
        text: presidioRedactedText,
        analyzer_results: nonOverlappingSpans,
        operators,
      };

      const controller3 = new AbortController();
      const timeoutId3 = setTimeout(() => controller3.abort(), PRESIDIO_TIMEOUT_MS);

      const { res: anonymize3Res, text: anonymize3Body, json: anonymize3Json } = await fetchWithLogs(
        "PRESIDIO_ANONYMIZE_3_SWEEP",
        anonymizeUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(thirdAnonymizePayload),
          signal: controller3.signal,
        }
      );

      clearTimeout(timeoutId3);

      if (!anonymize3Res.ok) {
        console.error(`[L2] 3rd anonymize pass failed: HTTP ${anonymize3Res.status}`);
        // Don't throw - continue with current text
      } else {
        const anonymize3Result = anonymize3Json as { text?: string; items?: unknown[] };
        const newText = typeof anonymize3Result.text === "string" ? anonymize3Result.text : "";

        if (newText && newText.trim().length > 0) {
          presidioRedactedText = newText;
          console.log(`[L2] 3rd anonymize pass succeeded, new text length: ${presidioRedactedText.length}`);
        }
      }

      // Final verification
      remainingEntities = await runVerifyAnalyze("PRESIDIO_VERIFY_ANALYZE_FINAL", presidioRedactedText);
    } else {
      console.log(JSON.stringify({ event: "LEFTOVER_SWEEP_NONE_FOUND" }));
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
  supabase: any,
  options: { redact_agency_refs?: boolean } = {}
): Promise<RedactionResult> {
  const { redact_agency_refs = false } = options;
  
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

  // ========== INPUT LOGGING ==========
  console.log(JSON.stringify({
    event: "INPUT_SUMMARY",
    raw_length: transcript.length,
    preview_masked: maskForLogs(transcript, 200),
    redact_agency_refs,
  }));

  await logEyeEvent(supabase, sessionId, "REDACTION_STARTED", {
    input_length: transcript.length,
    redact_agency_refs,
  });

  // ========== STEP 1: PRE-NER NORMALIZATION ==========
  console.log("[Redact] Running Step 1: Pre-NER Normalization");
  const normResult = preNerNormalize(transcript);
  let workingText = normResult.text;
  
  // Log normalization summary
  const normExamples = normResult.changes.slice(0, 3).map(c => ({
    original: maskForLogs(c.original, 20),
    normalized: maskForLogs(c.normalized, 20),
  }));
  console.log(JSON.stringify({
    event: "NORMALIZATION_SUMMARY",
    tokens_changed: normResult.changes.length,
    examples: normExamples,
  }));

  await logEyeEvent(supabase, sessionId, "NORMALIZATION_COMPLETED", {
    tokens_changed: normResult.changes.length,
  });

  // ========== STEP 2: CASE_ID REDACTION ==========
  console.log("[Redact] Running Step 2: Case ID Redaction");
  const caseIdResult = redactCaseIds(workingText);
  workingText = caseIdResult.text;
  combinedCounts.case_id += caseIdResult.count;
  
  console.log(JSON.stringify({
    event: "CASE_ID_REDACTION_SUMMARY",
    count: caseIdResult.count,
    examples: caseIdResult.examples,
  }));

  await logEyeEvent(supabase, sessionId, "CASE_ID_REDACTION_COMPLETED", {
    count: caseIdResult.count,
  });

  // ========== STEP 3: AGENCY REDACTION (always enabled, runs post-regex) ==========
  console.log("[Redact] Running Step 3: Agency Reference Redaction");
  const agencyResult = redactAgencyRefs(workingText);
  workingText = agencyResult.text;
  
  console.log(JSON.stringify({
    event: "AGENCY_REDACTION_SUMMARY",
    agency_count: agencyResult.agencyCount,
    agency_ref_count: agencyResult.agencyRefCount,
    patterns: agencyResult.patterns,
  }));

  await logEyeEvent(supabase, sessionId, "AGENCY_REDACTION_COMPLETED", {
    agency_count: agencyResult.agencyCount,
    agency_ref_count: agencyResult.agencyRefCount,
  });

  // ========== STEP 4: LAYER 1 - Regex Redaction ==========
  console.log("[Redact] Running Layer 1: Regex Redaction");
  const layer1Result = regexRedact(workingText);
  workingText = layer1Result.text;
  
  Object.entries(layer1Result.counts).forEach(([key, value]) => {
    if (key !== 'case_id') { // case_id already counted above
      combinedCounts[key as keyof RedactionCounts] += value || 0;
    }
  });
  layerStatuses.layer1 = { status: "COMPLETED", counts: layer1Result.counts };

  await logEyeEvent(supabase, sessionId, "REGEX_REDACTION_COMPLETED", {
    counts: layer1Result.counts,
  });

  // ========== STEP 5: LAYER 2 - NER Redaction (Presidio) ==========
  console.log("[Redact] Running Layer 2: NER Redaction (Presidio)");
  const layer2Result = await nerRedactWithPresidio(sessionId, workingText, supabase);
  
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

  // Log Presidio counts
  console.log(JSON.stringify({
    event: "PRESIDIO_COUNTS",
    pass1_counts: layer2Result.counts,
    layer2_status: layer2Result.layer2Status,
  }));

  // Determine minimized_text source
  const minimizedTextSource: "ner" | "regex" = layer2Result.layer2Status === "COMPLETED" ? "ner" : "regex";
  
  // Get the text from layer 2 result
  let finalText = layer2Result.text;

  await logEyeEvent(supabase, sessionId, "MINIMIZED_TEXT_SET", {
    source_layer: minimizedTextSource,
    layer2_status: layer2Result.layer2Status,
  });

  // ========== STEP 6: FINAL AGENCY CLEANUP ==========
  console.log("[Redact] Running Step 6: Final Agency Cleanup");
  const cleanupResult = finalAgencyCleanup(finalText);
  finalText = cleanupResult.text;
  
  console.log(JSON.stringify({
    event: "FINAL_AGENCY_CLEANUP_SUMMARY",
    replacements_made: cleanupResult.replacementsMade,
    patterns_matched: cleanupResult.patternsMatched,
    issues_found: cleanupResult.issuesFound,
  }));

  await logEyeEvent(supabase, sessionId, "FINAL_AGENCY_CLEANUP_COMPLETED", {
    replacements_made: cleanupResult.replacementsMade,
    patterns_matched: cleanupResult.patternsMatched,
  });

  // ========== STEP 7: LAYER 3 - Verification ==========
  console.log("[Redact] Running Layer 3: Verification");

  const verification =
    layer2Result.layer2Status === "COMPLETED" && layer2Result.verification
      ? layer2Result.verification
      : await verifyWithLLM(finalText, openAIApiKey);

  layerStatuses.layer3 = verification;

  if (verification.status === "PASS") {
    await logEyeEvent(supabase, sessionId, "REDACTION_VERIFICATION_PASSED", {});
  } else {
    await logEyeEvent(supabase, sessionId, "REDACTION_VERIFICATION_FAILED", {
      categories: verification.categories,
      layer2_status: layer2Result.layer2Status,
    });
  }

  // Final preview log
  console.log(JSON.stringify({
    event: "FINAL_PREVIEW_MASKED",
    length: finalText.length,
    preview: maskForLogs(finalText, 200),
  }));

  console.log(`[Redact] Pipeline complete - ${verification.status}. Minimized length: ${finalText.length}`);

  return {
    minimized_text: finalText,
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

    const { session_id, transcript: providedTranscript, verification_only, redact_agency_refs }: RedactRequest = await req.json();

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

      result = await runRedactionPipeline(session_id, transcript, openAIApiKey, supabase, {
        redact_agency_refs: redact_agency_refs ?? false,
      });
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
