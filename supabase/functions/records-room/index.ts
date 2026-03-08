/**
 * Records Room — Retrieve backend edge function
 * 
 * Citation-first, evidence-first retrieval engine.
 * No opinionated synthesis. No advisory language.
 * Surfaces the best evidence from the KB with citations.
 * 
 * Pipeline:
 *   1. Intake analysis (classify query, extract signals)
 *   2. Candidate recall (semantic via match_document_chunks)
 *   3. Records Room reranking (composite scoring)
 *   4. Excerpt assembly (best spans + citations)
 *   5. Response packaging (evidence-first payload)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsSecurityHeaders } from "../_shared/security-headers.ts";
import { logEyeEvent } from "../_shared/eye.ts";

/* ── Types ── */

interface RetrieveRequest {
  query: string;
  tenant_id: string;
  max_results?: number;
  min_similarity?: number;
}

type QueryType =
  | "direct_question"
  | "pasted_notice_text"
  | "broad_topic_query"
  | "ambiguous_short_query";

interface IntakeSignals {
  query_type: QueryType;
  key_phrases: string[];
  likely_domain: string | null;
  agency_references: string[];
  document_type_signals: string[];
  needs_clarification: boolean;
  clarification_question: string | null;
}

interface ScoredChunk {
  chunk_id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
  composite_score: number;
  info_quality: number;
  lexical_score: number;
  authority_score: number;
  excerpt_density: number;
  bucket: "strong_evidence" | "supporting_material" | "excluded";
}

interface EvidenceItem {
  document_title: string;
  section_heading: string | null;
  excerpt_text: string;
  citation_label: string;
  page_or_location: string | null;
  expandable_context: string;
  source_type: string | null;
  is_official: boolean;
  chunk_id: string;
  document_id: string;
  similarity: number;
  composite_score: number;
}

type FailureState =
  | "no_matching_materials"
  | "weak_match"
  | "no_direct_excerpt"
  | "clarification_needed"
  | null;

interface RetrieveResponse {
  status: "success" | "no_results" | "clarification_needed" | "error";
  query_type: QueryType;
  clarification_question: string | null;
  strong_evidence: EvidenceItem[];
  supporting_materials: EvidenceItem[];
  failure_state: FailureState;
  failure_message: string | null;
  diagnostics: Record<string, unknown>;
}

/* ── Constants ── */

const MAX_QUERY_CHARS = 8000;
const DEFAULT_MAX_RESULTS = 30;
const DEFAULT_MIN_SIMILARITY = 0.25;
const STRONG_EVIDENCE_THRESHOLD = 0.55;
const SUPPORTING_THRESHOLD = 0.35;

/* ── Scoring weights (Records Room v1) ── */
const W_SEMANTIC = 0.30;
const W_LEXICAL = 0.20;
const W_AUTHORITY = 0.15;
const W_PROCEDURAL = 0.10;
const W_EXCERPT_DENSITY = 0.10;
const W_METADATA = 0.05;
const W_FRESHNESS = 0.05;
const W_CONTEXT = 0.05;

/* ── Low-info detection (reused from compile-policy-pack) ── */

const LOW_INFO_PHRASES = [
  "table of contents", "contents page", "list of figures",
  "list of tables", "list of appendices", "revision history",
  "document control", "page intentionally left blank",
];

function computeInfoQuality(content: string): number {
  if (!content || content.trim().length === 0) return 0;
  const text = content.trim();
  const lower = text.toLowerCase();

  for (const phrase of LOW_INFO_PHRASES) {
    if (lower.includes(phrase)) return 0.1;
  }

  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return 0;

  const headingPattern = /^(\d+[\.\d]*\s|[-•]\s|[A-Z][A-Z\s]{2,}$|#{1,6}\s|section\s+\d)/i;
  let headingLines = 0, shortLines = 0, proseLines = 0;

  for (const line of lines) {
    if (headingPattern.test(line)) headingLines++;
    if (line.length < 40) shortLines++;
    if (line.length > 50 && /[.,;:?!]/.test(line)) proseLines++;
  }

  const headingRatio = headingLines / lines.length;
  const shortRatio = shortLines / lines.length;
  const proseRatio = proseLines / lines.length;

  if (headingRatio > 0.6 && proseRatio < 0.15) return 0.15;
  if (shortRatio > 0.75 && proseRatio < 0.1) return 0.2;
  if (text.length < 100) return 0.3;
  if (lines.length > 5 && proseRatio < 0.1) return 0.35;
  if (proseRatio < 0.25) return 0.7;
  return 1.0;
}

/* ── Intake analysis ── */

const DOMAIN_INDICATORS: Record<string, string[]> = {
  immigration: ["immigration", "visa", "asylum", "deportation", "uscis", "ice", "eoir", "removal", "court appearance", "notice to appear"],
  benefits: ["benefits", "snap", "tanf", "medicaid", "ssi", "ssdi", "denial", "appeal", "eligibility", "recertification"],
  child_welfare: ["child welfare", "cps", "foster", "maltreatment", "child safety", "placement"],
  housing: ["housing", "eviction", "shelter", "homelessness", "section 8", "voucher", "hud"],
  domestic_violence: ["domestic violence", "protective order", "safety plan", "restraining order"],
  employment: ["employment", "unemployment", "job training", "workforce", "labor"],
  disability: ["disability", "ada", "accommodation", "ssi", "ssdi"],
};

const DOCUMENT_TYPE_SIGNALS = [
  "notice", "letter", "summons", "hearing", "denial", "appointment",
  "form", "order", "court", "determination", "decision", "ruling",
  "statute", "regulation", "rule", "policy", "handbook", "manual",
];

const AGENCY_PATTERNS = [
  /\b(uscis|ice|eoir|dhs|hhs|dol|ssa|hud|doj|fema)\b/i,
  /\b(department of|office of|bureau of|administration of)\b/i,
  /\b(state|county|city|federal|municipal)\s+(agency|office|department|court)\b/i,
];

function analyzeIntake(query: string): IntakeSignals {
  const lower = query.toLowerCase();
  const wordCount = query.split(/\s+/).length;

  // Classify query type
  let query_type: QueryType;
  if (wordCount < 5) {
    query_type = "ambiguous_short_query";
  } else if (query.length > 500 || /\b(dear|to whom|re:|subject:|notice|hereby)\b/i.test(query)) {
    query_type = "pasted_notice_text";
  } else if (/\?/.test(query) || /\b(what|how|when|where|who|which|does|can|is|are)\b/i.test(query)) {
    query_type = "direct_question";
  } else {
    query_type = "broad_topic_query";
  }

  // Extract key phrases (simple: longest capitalized sequences and quoted phrases)
  const key_phrases: string[] = [];
  const quotedMatches = query.match(/"([^"]+)"/g);
  if (quotedMatches) key_phrases.push(...quotedMatches.map(m => m.replace(/"/g, "")));
  
  // Likely domain
  let likely_domain: string | null = null;
  let maxDomainHits = 0;
  for (const [domain, indicators] of Object.entries(DOMAIN_INDICATORS)) {
    const hits = indicators.filter(ind => lower.includes(ind)).length;
    if (hits > maxDomainHits) {
      maxDomainHits = hits;
      likely_domain = domain;
    }
  }

  // Agency references
  const agency_references: string[] = [];
  for (const pattern of AGENCY_PATTERNS) {
    const match = query.match(pattern);
    if (match) agency_references.push(match[0]);
  }

  // Document type signals
  const document_type_signals = DOCUMENT_TYPE_SIGNALS.filter(s => lower.includes(s));

  // Clarification logic
  let needs_clarification = false;
  let clarification_question: string | null = null;

  if (query_type === "ambiguous_short_query" && wordCount < 3 && !likely_domain) {
    needs_clarification = true;
    clarification_question = "Could you provide more detail about what you're looking for? For example, paste the text of a notice or letter, or describe the specific policy or rule you need to find.";
  }

  return {
    query_type,
    key_phrases,
    likely_domain,
    agency_references,
    document_type_signals,
    needs_clarification,
    clarification_question,
  };
}

/* ── Lexical scoring ── */

function computeLexicalScore(query: string, content: string): number {
  const queryTokens = new Set(
    query.toLowerCase().split(/\s+/).filter(t => t.length > 2)
  );
  if (queryTokens.size === 0) return 0;

  const contentLower = content.toLowerCase();
  let hits = 0;
  for (const token of queryTokens) {
    if (contentLower.includes(token)) hits++;
  }
  return hits / queryTokens.size;
}

/* ── Authority scoring ── */

function computeAuthorityScore(metadata: Record<string, unknown>): number {
  let score = 0.5; // baseline
  const source = String(metadata.source_type ?? metadata.source ?? "").toLowerCase();
  const title = String(metadata.title ?? "").toLowerCase();

  // Official sources
  if (source.includes("statute") || source.includes("regulation") || source.includes("law")) score += 0.3;
  if (source.includes("handbook") || source.includes("manual") || source.includes("policy")) score += 0.2;
  if (source.includes("guidance") || source.includes("directive")) score += 0.15;
  if (metadata.is_official === true) score += 0.2;

  // Title signals
  if (/\b(code|statute|regulation|rule|act)\b/.test(title)) score += 0.1;
  if (/\b(handbook|manual|guide|policy)\b/.test(title)) score += 0.05;

  return Math.min(1, score);
}

/* ── Procedural usefulness ── */

function computeProceduralScore(content: string): number {
  const lower = content.toLowerCase();
  const signals = [
    "must", "shall", "required", "deadline", "within", "days",
    "appeal", "hearing", "file", "submit", "respond", "appear",
    "eligibility", "determination", "rights", "obligation",
  ];
  let hits = 0;
  for (const s of signals) {
    if (lower.includes(s)) hits++;
  }
  return Math.min(1, hits * 0.07);
}

/* ── Excerpt density (answer-bearing substance) ── */

function computeExcerptDensity(content: string): number {
  const lines = content.split("\n").filter(l => l.trim().length > 0);
  if (lines.length === 0) return 0;

  const proseLines = lines.filter(l => l.trim().length > 60 && /[.,;:?!]/.test(l));
  return Math.min(1, proseLines.length / Math.max(lines.length, 1));
}

/* ── Duplication detection ── */

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().replace(/\s+/g, " ").trim().split(" ").filter(Boolean));
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const t of a) { if (b.has(t)) intersection++; }
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

/* ── Excerpt extraction ── */

function extractBestExcerpt(content: string, query: string, maxLen = 600): string {
  const queryTokens = new Set(query.toLowerCase().split(/\s+/).filter(t => t.length > 3));
  const sentences = content.split(/(?<=[.!?])\s+/);
  
  if (sentences.length <= 3) return content.slice(0, maxLen);

  // Score each sentence by query overlap
  let bestStart = 0;
  let bestScore = -1;
  
  for (let i = 0; i < sentences.length; i++) {
    const windowSentences = sentences.slice(i, i + 3);
    const windowText = windowSentences.join(" ").toLowerCase();
    let score = 0;
    for (const token of queryTokens) {
      if (windowText.includes(token)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestStart = i;
    }
  }

  const excerptSentences = sentences.slice(bestStart, bestStart + 4);
  const excerpt = excerptSentences.join(" ");
  return excerpt.length > maxLen ? excerpt.slice(0, maxLen) + "…" : excerpt;
}

/* ── Citation label builder ── */

function buildCitationLabel(
  docTitle: string,
  sectionHeading: string | null,
  chunkIndex: number,
): string {
  const parts = [docTitle];
  if (sectionHeading) parts.push(`§ ${sectionHeading}`);
  parts.push(`chunk ${chunkIndex}`);
  return parts.join(" — ");
}

/* ── Records Room composite scoring ── */

function scoreCandidate(
  chunk: {
    similarity: number;
    content: string;
    metadata: Record<string, unknown>;
  },
  query: string,
): { composite_score: number; lexical_score: number; authority_score: number; excerpt_density: number } {
  const lexical_score = computeLexicalScore(query, chunk.content);
  const authority_score = computeAuthorityScore(chunk.metadata);
  const procedural = computeProceduralScore(chunk.content);
  const excerpt_density = computeExcerptDensity(chunk.content);
  const metadata_match = 0.5; // TODO: match domain/jurisdiction from intake signals
  const freshness = 0.5; // TODO: use effective_date when available
  const context_quality = computeInfoQuality(chunk.content);

  const composite_score =
    W_SEMANTIC * chunk.similarity +
    W_LEXICAL * lexical_score +
    W_AUTHORITY * authority_score +
    W_PROCEDURAL * procedural +
    W_EXCERPT_DENSITY * excerpt_density +
    W_METADATA * metadata_match +
    W_FRESHNESS * freshness +
    W_CONTEXT * context_quality;

  return { composite_score, lexical_score, authority_score, excerpt_density };
}

/* ── Response helpers ── */

let _corsHeaders: Record<string, string> = {};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ..._corsHeaders, "Content-Type": "application/json" },
  });
}

const FAILURE_MESSAGES: Record<string, string> = {
  no_matching_materials: "No matching materials were found in the current knowledge base.",
  weak_match: "Relevant documents may exist, but no source in the current knowledge base closely matches this request.",
  no_direct_excerpt: "Relevant documents were found, but no excerpt directly addresses this question.",
  clarification_needed: "", // dynamic
};

/* ── Embedding helper ── */

async function embed(text: string, apiKey: string, model: string): Promise<number[]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, input: text.slice(0, MAX_QUERY_CHARS) }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI embeddings error ${res.status}: ${t}`);
  }

  const j = await res.json();
  const vec: number[] = j.data?.[0]?.embedding;
  if (!vec || vec.length !== 1536) {
    throw new Error(`Expected 1536-dim embedding, got ${vec?.length ?? "null"}`);
  }
  return vec;
}

/* ── Document title lookup ── */

async function lookupDocumentTitles(
  supabase: ReturnType<typeof createClient>,
  documentIds: string[],
): Promise<Map<string, { title: string; source: string | null; file_path: string | null; metadata: Record<string, unknown> }>> {
  const map = new Map<string, { title: string; source: string | null; file_path: string | null; metadata: Record<string, unknown> }>();
  if (documentIds.length === 0) return map;

  const uniqueIds = [...new Set(documentIds)];
  const { data, error } = await supabase
    .from("kb_documents")
    .select("id, title, source, file_path, metadata")
    .in("id", uniqueIds);

  if (error) {
    console.error("[records-room] Document title lookup failed:", error.message);
    return map;
  }

  for (const doc of data ?? []) {
    map.set(doc.id, {
      title: doc.title,
      source: doc.source,
      file_path: doc.file_path,
      metadata: (doc.metadata as Record<string, unknown>) ?? {},
    });
  }
  return map;
}

/* ── Main handler ── */

Deno.serve(async (req) => {
  _corsHeaders = buildCorsSecurityHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: _corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) return json(500, { error: "OPENAI_API_KEY not configured" });
  const EMBEDDING_MODEL = Deno.env.get("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small";

  let payload: RetrieveRequest;
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const {
    query,
    tenant_id,
    max_results = DEFAULT_MAX_RESULTS,
    min_similarity = DEFAULT_MIN_SIMILARITY,
  } = payload;

  if (!query || typeof query !== "string" || query.trim().length === 0) {
    return json(400, { error: "query is required" });
  }
  if (!tenant_id || typeof tenant_id !== "string") {
    return json(400, { error: "tenant_id is required" });
  }
  if (query.length > 10000) {
    return json(400, { error: "Query too long (max 10000 characters)" });
  }

  const startTime = Date.now();

  try {
    // ── Stage 1: Intake analysis ──
    const intake = analyzeIntake(query);
    console.log("[records-room] Intake:", JSON.stringify(intake));

    // If clarification needed, return early
    if (intake.needs_clarification) {
      const response: RetrieveResponse = {
        status: "clarification_needed",
        query_type: intake.query_type,
        clarification_question: intake.clarification_question,
        strong_evidence: [],
        supporting_materials: [],
        failure_state: "clarification_needed",
        failure_message: intake.clarification_question,
        diagnostics: { intake, duration_ms: Date.now() - startTime },
      };
      return json(200, response);
    }

    // ── Stage 2: Candidate recall (semantic) ──
    const queryVec = await embed(query, OPENAI_API_KEY, EMBEDDING_MODEL);

    const { data: matches, error: rpcErr } = await supabase.rpc(
      "match_document_chunks",
      {
        p_tenant_id: tenant_id,
        p_query_embedding: JSON.stringify(queryVec),
        p_match_count: max_results,
        p_min_similarity: min_similarity,
      },
    );

    if (rpcErr) throw new Error(`RPC match_document_chunks failed: ${rpcErr.message}`);

    const candidates = matches ?? [];
    console.log(`[records-room] Recall: ${candidates.length} semantic candidates`);

    // No results at all
    if (candidates.length === 0) {
      const response: RetrieveResponse = {
        status: "no_results",
        query_type: intake.query_type,
        clarification_question: null,
        strong_evidence: [],
        supporting_materials: [],
        failure_state: "no_matching_materials",
        failure_message: FAILURE_MESSAGES.no_matching_materials,
        diagnostics: { intake, candidate_count: 0, duration_ms: Date.now() - startTime },
      };

      try {
        await logEyeEvent(supabase, {
          session_id: null,
          event_type: "RETRIEVE_SEARCH",
          serviceName: "records-room",
          payload: {
            tenant_id,
            query_type: intake.query_type,
            candidate_count: 0,
            result: "failure",
            reason_code: "no_matching_materials",
          },
        });
      } catch { /* non-critical */ }

      return json(200, response);
    }

    // ── Stage 3: Records Room reranking ──
    const scored: ScoredChunk[] = [];
    for (const c of candidates) {
      const infoQ = computeInfoQuality(c.content ?? "");
      if (infoQ < 0.2) continue; // filter structural junk

      const scores = scoreCandidate(
        { similarity: c.similarity, content: c.content ?? "", metadata: (c.metadata as Record<string, unknown>) ?? {} },
        query,
      );

      scored.push({
        chunk_id: c.id,
        document_id: c.document_id,
        chunk_index: c.chunk_index,
        content: c.content ?? "",
        metadata: (c.metadata as Record<string, unknown>) ?? {},
        similarity: c.similarity,
        composite_score: scores.composite_score,
        info_quality: infoQ,
        lexical_score: scores.lexical_score,
        authority_score: scores.authority_score,
        excerpt_density: scores.excerpt_density,
        bucket: "excluded",
      });
    }

    // Sort by composite score descending
    scored.sort((a, b) => b.composite_score - a.composite_score);

    // Deduplicate (Jaccard > 0.75 against already-admitted)
    const admitted: ScoredChunk[] = [];
    const admittedTokenSets: Set<string>[] = [];

    for (const chunk of scored) {
      const tokens = tokenize(chunk.content);
      let isDupe = false;
      for (const existing of admittedTokenSets) {
        if (jaccardSimilarity(tokens, existing) >= 0.75) {
          isDupe = true;
          break;
        }
      }
      if (isDupe) continue;

      // Assign bucket
      if (chunk.composite_score >= STRONG_EVIDENCE_THRESHOLD && admitted.filter(a => a.bucket === "strong_evidence").length < 5) {
        chunk.bucket = "strong_evidence";
      } else if (chunk.composite_score >= SUPPORTING_THRESHOLD && admitted.filter(a => a.bucket === "supporting_material").length < 4) {
        chunk.bucket = "supporting_material";
      } else {
        continue; // excluded
      }

      admitted.push(chunk);
      admittedTokenSets.push(tokens);
    }

    console.log(`[records-room] Admitted: ${admitted.length} (strong: ${admitted.filter(a => a.bucket === "strong_evidence").length}, supporting: ${admitted.filter(a => a.bucket === "supporting_material").length})`);

    // ── Stage 4: Excerpt assembly ──
    const documentIds = admitted.map(c => c.document_id);
    const docMap = await lookupDocumentTitles(supabase, documentIds);

    function buildEvidenceItem(chunk: ScoredChunk): EvidenceItem {
      const doc = docMap.get(chunk.document_id);
      const docTitle = doc?.title ?? "Unknown Document";
      const sectionHeading = (chunk.metadata.heading_path as string) ?? (chunk.metadata.section_heading as string) ?? null;

      return {
        document_title: docTitle,
        section_heading: sectionHeading,
        excerpt_text: extractBestExcerpt(chunk.content, query),
        citation_label: buildCitationLabel(docTitle, sectionHeading, chunk.chunk_index),
        page_or_location: chunk.metadata.page ? `Page ${chunk.metadata.page}` : `Chunk ${chunk.chunk_index}`,
        expandable_context: chunk.content,
        source_type: doc?.source ?? (chunk.metadata.source_type as string) ?? null,
        is_official: (chunk.metadata.is_official as boolean) ?? false,
        chunk_id: chunk.chunk_id,
        document_id: chunk.document_id,
        similarity: parseFloat(chunk.similarity.toFixed(4)),
        composite_score: parseFloat(chunk.composite_score.toFixed(4)),
      };
    }

    const strong_evidence = admitted
      .filter(c => c.bucket === "strong_evidence")
      .map(buildEvidenceItem);

    const supporting_materials = admitted
      .filter(c => c.bucket === "supporting_material")
      .map(buildEvidenceItem);

    // ── Stage 5: Determine failure state ──
    let failure_state: FailureState = null;
    let failure_message: string | null = null;
    let status: RetrieveResponse["status"] = "success";

    if (strong_evidence.length === 0 && supporting_materials.length === 0) {
      if (scored.length > 0) {
        failure_state = "weak_match";
        failure_message = FAILURE_MESSAGES.weak_match;
      } else {
        failure_state = "no_matching_materials";
        failure_message = FAILURE_MESSAGES.no_matching_materials;
      }
      status = "no_results";
    } else if (strong_evidence.length === 0 && supporting_materials.length > 0) {
      // Promote: show supporting as results but note no strong evidence
      failure_state = "no_direct_excerpt";
      failure_message = FAILURE_MESSAGES.no_direct_excerpt;
      status = "success"; // still show what we have
    }

    // ── Stage 6: Diagnostics ──
    const diagnostics = {
      intake,
      candidate_count: candidates.length,
      scored_after_filter: scored.length,
      admitted_count: admitted.length,
      strong_count: strong_evidence.length,
      supporting_count: supporting_materials.length,
      top_similarity: candidates.length > 0 ? parseFloat(candidates[0].similarity.toFixed(4)) : 0,
      avg_composite: admitted.length > 0
        ? parseFloat((admitted.reduce((s, c) => s + c.composite_score, 0) / admitted.length).toFixed(4))
        : 0,
      duration_ms: Date.now() - startTime,
    };

    console.log("[records-room] Diagnostics:", JSON.stringify(diagnostics));

    // Eye event
    try {
      await logEyeEvent(supabase, {
        session_id: null,
        event_type: "RETRIEVE_SEARCH",
        serviceName: "records-room",
        payload: {
          tenant_id,
          query_type: intake.query_type,
          candidate_count: candidates.length,
          strong_count: strong_evidence.length,
          supporting_count: supporting_materials.length,
          duration_ms: diagnostics.duration_ms,
          result: strong_evidence.length > 0 ? "success" : supporting_materials.length > 0 ? "partial" : "failure",
        },
      });
    } catch { /* non-critical */ }

    const response: RetrieveResponse = {
      status,
      query_type: intake.query_type,
      clarification_question: null,
      strong_evidence,
      supporting_materials,
      failure_state,
      failure_message,
      diagnostics,
    };

    return json(200, response);
  } catch (err) {
    console.error("[records-room] Error:", err);

    try {
      await logEyeEvent(supabase, {
        session_id: null,
        event_type: "RETRIEVE_SEARCH_ERROR",
        serviceName: "records-room",
        payload: {
          tenant_id,
          error_type: err instanceof Error ? err.constructor.name : "unknown",
          result: "failure",
        },
      });
    } catch { /* non-critical */ }

    return json(500, { error: "Internal retrieval error" });
  }
});
