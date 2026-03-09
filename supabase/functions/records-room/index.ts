/**
 * Records Room — Retrieve backend edge function
 * 
 * Citation-first, evidence-first retrieval engine.
 * No opinionated synthesis. No advisory language.
 * Surfaces the best evidence from the KB with citations.
 * 
 * Pipeline:
 *   1. Intake analysis (classify query, extract signals)
 *   2. Hybrid candidate recall (semantic + lexical, merged & deduped)
 *   3. Records Room reranking (composite scoring with real metadata)
 *   4. Excerpt assembly (best spans + citations + source access)
 *   5. Response packaging (evidence-first payload)
 * 
 * SAFETY CAPS:
 *   All pipeline stages enforce explicit bounded limits for stability,
 *   performance, UI clarity, and quality. See LIMITS block below.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsSecurityHeaders } from "../_shared/security-headers.ts";
import { logEyeEvent } from "../_shared/eye.ts";

/* ═══════════════════════════════════════════════════════════════
 *  LIMITS — Single source of truth for all safety caps.
 *  Grouped by pipeline stage. Easy to tune.
 * ═══════════════════════════════════════════════════════════════ */

const LIMITS = {
  // ── Stage 0: Input caps ──
  MAX_REQUEST_BODY_BYTES: 512_000,
  MAX_QUERY_INPUT_CHARS: 10_000,
  MAX_PASTED_TEXT_CHARS: 8_000,
  MAX_EMBEDDING_INPUT_CHARS: 12_000,
  MAX_UPLOADED_DOC_CHARS: 6_000,

  // ── Stage 2: Recall caps ──
  MAX_SEMANTIC_RECALL: 40,
  MAX_LEXICAL_RECALL: 40,
  MAX_MERGED_CANDIDATES: 60,

  // ── Stage 3: Reranking caps ──
  MAX_SCORED_CANDIDATES: 50,
  JACCARD_DEDUP_THRESHOLD: 0.75,
  MAX_ADMITTED_CANDIDATES: 9,

  // ── Stage 4: Result assembly caps ──
  MAX_STRONG_EVIDENCE: 5,
  MAX_SUPPORTING_MATERIALS: 4,
  MAX_EXCERPT_CHARS: 600,
  MAX_CONTEXT_CHARS: 3_000,
  MAX_CITATION_LABEL_CHARS: 200,

  // ── Stage 5: Response payload cap ──
  MAX_RESPONSE_PAYLOAD_BYTES: 256_000,

  // ── Future: Model-call safeguards ──
  MAX_MODEL_EXCERPTS: 5,
  MAX_MODEL_CONTEXT_CHARS: 12_000,
  MODEL_CONTEXT_REFUSE_CHARS: 20_000,
} as const;

/* ═══════════════════════════════════════════════════════════════
 *  DIAGNOSTICS TRACKER
 * ═══════════════════════════════════════════════════════════════ */

interface CapEvent {
  cap: string;
  limit: number;
  actual: number;
  action: "truncated" | "trimmed" | "capped" | "refused";
}

class CapDiagnostics {
  private events: CapEvent[] = [];

  record(cap: string, limit: number, actual: number, action: CapEvent["action"]) {
    this.events.push({ cap, limit, actual, action });
    console.log(`[records-room][CAP] ${action}: ${cap} (limit=${limit}, actual=${actual})`);
  }

  get hitCount() { return this.events.length; }
  get all() { return this.events; }
  toJSON() { return this.events; }
}

/* ═══════════════════════════════════════════════════════════════
 *  EMBEDDING PROVIDER — TEMPORARY HOSTED BRIDGE
 * 
 *  ⚠️  LOCAL-FIRST TARGET ARCHITECTURE NOTE:
 *  This is a temporary hosted embedding bridge. The target
 *  architecture calls for local embeddings (e.g. a local
 *  embedding model or self-hosted service) to minimize
 *  frontier-model dependency in the retrieval path.
 * 
 *  TO SWAP TO LOCAL EMBEDDINGS:
 *  1. Replace the body of `embedQuery()` below with a call
 *     to your local embedding service/model.
 *  2. Ensure the output dimension matches what's stored in
 *     document_chunks.embedding (currently 1536 for
 *     text-embedding-3-small).
 *  3. If changing dimension, re-embed all chunks and update
 *     match_document_chunks accordingly.
 *  4. Remove OPENAI_API_KEY dependency from this function.
 * 
 *  The rest of the pipeline is embedding-provider-agnostic.
 * ═══════════════════════════════════════════════════════════════ */

interface EmbeddingProvider {
  embedQuery(text: string): Promise<number[]>;
}

/**
 * TEMPORARY HOSTED BRIDGE — Replace with local embedding provider.
 * See architecture note above.
 */
function createHostedEmbeddingProvider(apiKey: string, model: string): EmbeddingProvider {
  return {
    async embedQuery(text: string): Promise<number[]> {
      // TEMPORARY: Using OpenAI hosted embeddings as a bridge.
      // Replace with local embedding model when available.
      const input = text.slice(0, LIMITS.MAX_EMBEDDING_INPUT_CHARS);
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, input }),
      });

      if (!res.ok) {
        const t = await res.text();
        throw new Error(`Embedding provider error ${res.status}: ${t}`);
      }

      const j = await res.json();
      const vec: number[] = j.data?.[0]?.embedding;
      if (!vec || vec.length !== 1536) {
        throw new Error(`Expected 1536-dim embedding, got ${vec?.length ?? "null"}`);
      }
      return vec;
    },
  };
}

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

/** Tracks which recall branch(es) found this candidate */
type RecallOrigin = "semantic" | "lexical" | "both";

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
  metadata_match: number;
  freshness_score: number;
  section_match_score: number;
  exact_phrase_score: number;
  directness_score: number;
  concept_anchor_score: number;
  collateral_labels: string[];
  primary_boost: boolean;
  recall_origin: RecallOrigin;
  bucket: "strong_evidence" | "supporting_material" | "excluded";
  admission_reason?: string;
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
  /** URL to view the original source document, if available */
  source_url: string | null;
  /** URL to download the original source document, if available */
  download_url: string | null;
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

/* ── Scoring constants ── */

const DEFAULT_MIN_SIMILARITY = 0.25;
const STRONG_EVIDENCE_THRESHOLD = 0.48;
const SUPPORTING_THRESHOLD = 0.36;

/* ── Scoring weights (Records Room v3 — concept-anchor-aware) ── */
const W_SEMANTIC = 0.15;
const W_LEXICAL = 0.08;
const W_AUTHORITY = 0.08;
const W_PROCEDURAL = 0.04;
const W_EXCERPT_DENSITY = 0.03;
const W_METADATA = 0.04;
const W_FRESHNESS = 0.02;
const W_CONTEXT = 0.02;
const W_SECTION_MATCH = 0.14;
const W_EXACT_PHRASE = 0.10;
const W_DIRECTNESS = 0.10;
const W_CONCEPT_ANCHOR = 0.20;

/* ── Low-info detection ── */

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

  const key_phrases: string[] = [];
  const quotedMatches = query.match(/"([^"]+)"/g);
  if (quotedMatches) key_phrases.push(...quotedMatches.map(m => m.replace(/"/g, "")));

  let likely_domain: string | null = null;
  let maxDomainHits = 0;
  for (const [domain, indicators] of Object.entries(DOMAIN_INDICATORS)) {
    const hits = indicators.filter(ind => lower.includes(ind)).length;
    if (hits > maxDomainHits) {
      maxDomainHits = hits;
      likely_domain = domain;
    }
  }

  const agency_references: string[] = [];
  for (const pattern of AGENCY_PATTERNS) {
    const match = query.match(pattern);
    if (match) agency_references.push(match[0]);
  }

  const document_type_signals = DOCUMENT_TYPE_SIGNALS.filter(s => lower.includes(s));

  let needs_clarification = false;
  let clarification_question: string | null = null;

  if (query_type === "ambiguous_short_query" && wordCount < 3 && !likely_domain) {
    needs_clarification = true;
    clarification_question = "Could you provide more detail about what you're looking for? For example, paste the text of a notice or letter, or describe the specific policy or rule you need to find.";
  }

  return {
    query_type, key_phrases, likely_domain, agency_references,
    document_type_signals, needs_clarification, clarification_question,
  };
}

/* ── Lexical scoring (post-recall, for composite formula) ── */

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
  let score = 0.5;
  const source = String(metadata.source_type ?? metadata.source ?? "").toLowerCase();
  const title = String(metadata.title ?? "").toLowerCase();

  if (source.includes("statute") || source.includes("regulation") || source.includes("law")) score += 0.3;
  if (source.includes("handbook") || source.includes("manual") || source.includes("policy")) score += 0.2;
  if (source.includes("guidance") || source.includes("directive")) score += 0.15;
  if (metadata.is_official === true) score += 0.2;
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

/* ── Excerpt density ── */

function computeExcerptDensity(content: string): number {
  const lines = content.split("\n").filter(l => l.trim().length > 0);
  if (lines.length === 0) return 0;
  const proseLines = lines.filter(l => l.trim().length > 60 && /[.,;:?!]/.test(l));
  return Math.min(1, proseLines.length / Math.max(lines.length, 1));
}

/* ═══════════════════════════════════════════════════════════════
 *  METADATA MATCH SCORING — Real, not placeholder
 * 
 *  Computes how well a chunk's metadata aligns with the query
 *  using title overlap, heading overlap, and domain alignment.
 * ═══════════════════════════════════════════════════════════════ */

function computeMetadataMatch(
  query: string,
  metadata: Record<string, unknown>,
  intake: IntakeSignals,
): number {
  let score = 0;
  const queryTokens = new Set(
    query.toLowerCase().split(/\s+/).filter(t => t.length > 3)
  );
  if (queryTokens.size === 0) return 0.3; // neutral default

  // Title overlap: how many query tokens appear in the document title
  const title = String(metadata.title ?? "").toLowerCase();
  if (title) {
    let titleHits = 0;
    for (const t of queryTokens) { if (title.includes(t)) titleHits++; }
    score += (titleHits / queryTokens.size) * 0.4;
  }

  // Section heading overlap
  const heading = String(
    metadata.heading_path ?? metadata.section_heading ?? ""
  ).toLowerCase();
  if (heading) {
    let headingHits = 0;
    for (const t of queryTokens) { if (heading.includes(t)) headingHits++; }
    score += (headingHits / queryTokens.size) * 0.25;
  }

  // Domain alignment: does the chunk's metadata domain match intake signals?
  if (intake.likely_domain) {
    const source = String(metadata.source_type ?? metadata.source ?? "").toLowerCase();
    const allMeta = `${title} ${source} ${heading}`.toLowerCase();
    const domainIndicators = DOMAIN_INDICATORS[intake.likely_domain] ?? [];
    const domainHits = domainIndicators.filter(ind => allMeta.includes(ind)).length;
    if (domainHits > 0) score += Math.min(0.2, domainHits * 0.1);
  }

  // Agency match
  if (intake.agency_references.length > 0) {
    const allMeta = `${title} ${heading}`.toLowerCase();
    for (const agency of intake.agency_references) {
      if (allMeta.includes(agency.toLowerCase())) {
        score += 0.15;
        break;
      }
    }
  }

  return Math.min(1, score);
}

/* ═══════════════════════════════════════════════════════════════
 *  FRESHNESS SCORING — Real, not placeholder
 * 
 *  Uses effective_date / publication_date / updated_at from
 *  document metadata when available. Gracefully returns neutral
 *  0.5 when no date info exists.
 * ═══════════════════════════════════════════════════════════════ */

function computeFreshnessScore(metadata: Record<string, unknown>): number {
  // Try to extract a meaningful date from metadata
  const dateStr = String(
    metadata.effective_date ??
    metadata.publication_date ??
    metadata.updated_at ??
    metadata.created_at ??
    ""
  );

  if (!dateStr) return 0.5; // neutral when no date available

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return 0.5; // unparseable date → neutral

  const now = Date.now();
  const ageMs = now - date.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  // Scoring: recent documents score higher
  // < 90 days → 1.0, < 1 year → 0.8, < 3 years → 0.6, < 5 years → 0.4, older → 0.2
  if (ageDays < 90) return 1.0;
  if (ageDays < 365) return 0.8;
  if (ageDays < 1095) return 0.6;
  if (ageDays < 1825) return 0.4;
  return 0.2;
}

/* ═══════════════════════════════════════════════════════════════
 *  SECTION MATCH SCORING
 *
 *  Detects section-style references in query (e.g. 1229, 1229a,
 *  §1182, "8 U.S.C. 1229a") and rewards candidates that contain
 *  those exact references.
 * ═══════════════════════════════════════════════════════════════ */

const SECTION_REF_PATTERN = /(?:§\s*|section\s+|8\s+u\.?s\.?c\.?\s+)(\d{3,5}[a-z]?(?:-\d+)?)/gi;
const BARE_SECTION_PATTERN = /\b(\d{4}[a-z]?)\b/g;

function extractSectionRefs(text: string): string[] {
  const refs = new Set<string>();
  const lower = text.toLowerCase();

  let m: RegExpExecArray | null;
  const p1 = new RegExp(SECTION_REF_PATTERN.source, "gi");
  while ((m = p1.exec(lower)) !== null) {
    refs.add(m[1].replace(/\s+/g, ""));
  }

  // Also catch bare 4-digit numbers that look like USC section numbers
  const p2 = new RegExp(BARE_SECTION_PATTERN.source, "g");
  while ((m = p2.exec(lower)) !== null) {
    const num = parseInt(m[1], 10);
    // Plausible USC section range (Title 8 is ~1101-1778)
    if (num >= 1100 && num <= 9999) {
      refs.add(m[1]);
    }
  }

  return [...refs];
}

function computeSectionMatchScore(query: string, content: string, metadata: Record<string, unknown>): number {
  const queryRefs = extractSectionRefs(query);
  if (queryRefs.length === 0) return 0.5; // neutral when query has no section refs

  const contentLower = content.toLowerCase();
  const headingLower = String(metadata.heading_path ?? metadata.section_heading ?? "").toLowerCase();
  const allText = contentLower + " " + headingLower;

  let matches = 0;
  for (const ref of queryRefs) {
    // Exact section reference in content or heading
    if (allText.includes(ref)) {
      matches++;
    }
  }

  if (matches === 0) return 0.0; // no section match at all
  if (matches === queryRefs.length) return 1.0; // all sections matched
  return 0.5 + (matches / queryRefs.length) * 0.5;
}

/* ═══════════════════════════════════════════════════════════════
 *  EXACT PHRASE SCORING (v3 — stop-word-preserving for legal phrases)
 *
 *  Rewards candidates containing exact multi-word phrases from
 *  the query. Now preserves stop words so legal phrases like
 *  "notice to appear" are matched as-is.
 * ═══════════════════════════════════════════════════════════════ */

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "shall",
  "should", "may", "might", "can", "could", "to", "of", "in", "for",
  "on", "with", "at", "by", "from", "as", "into", "about", "between",
  "through", "during", "and", "but", "or", "not", "no", "so", "if",
  "than", "that", "this", "it", "its", "what", "which", "who", "whom",
  "how", "when", "where", "why", "does", "mean", "happens",
]);

/**
 * KNOWN LEGAL CONCEPT PHRASES — matched with stop words intact.
 * These are the canonical forms caseworkers actually search for.
 */
const LEGAL_CONCEPT_PHRASES = [
  "notice to appear",
  "removal proceedings",
  "voluntary departure",
  "grounds of inadmissibility",
  "adjustment of status",
  "cancellation of removal",
  "asylum application",
  "credible fear",
  "reasonable fear",
  "withholding of removal",
  "convention against torture",
  "expedited removal",
  "aggravated felony",
  "good moral character",
  "lawful permanent resident",
  "temporary protected status",
  "deferred action",
  "prosecutorial discretion",
  "bond hearing",
  "change of venue",
  "continuance",
  "in absentia",
  "failure to appear",
  "relief from removal",
  "suspension of deportation",
  "registry",
  "judicial review",
  "petition for review",
  "motion to reopen",
  "motion to reconsider",
  "alien registration",
];

/**
 * Extract concept phrases from query — preserving stop words.
 * Returns both full legal phrases found in the query AND
 * n-grams (with stop words) for broader matching.
 */
function extractConceptPhrases(query: string): { legal: string[]; ngrams: string[] } {
  const lower = query.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();

  // Find known legal phrases present in the query
  const legal: string[] = [];
  for (const phrase of LEGAL_CONCEPT_PHRASES) {
    if (lower.includes(phrase)) {
      legal.push(phrase);
    }
  }

  // Also build n-grams WITH stop words intact for general phrase matching
  const words = lower.split(" ").filter(w => w.length > 1);
  const ngrams: string[] = [];
  // Trigrams (with stop words)
  for (let i = 0; i < words.length - 2; i++) {
    ngrams.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  }
  // Bigrams (with stop words)
  for (let i = 0; i < words.length - 1; i++) {
    ngrams.push(`${words[i]} ${words[i + 1]}`);
  }

  return { legal, ngrams };
}

function extractPhrases(text: string): string[] {
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w));

  const phrases: string[] = [];
  // Trigrams
  for (let i = 0; i < words.length - 2; i++) {
    phrases.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  }
  // Bigrams
  for (let i = 0; i < words.length - 1; i++) {
    phrases.push(`${words[i]} ${words[i + 1]}`);
  }
  return phrases;
}

function computeExactPhraseScore(query: string, content: string): number {
  const contentLower = content.toLowerCase();
  const concepts = extractConceptPhrases(query);

  // If we found known legal phrases in the query, weight those MUCH more heavily
  if (concepts.legal.length > 0) {
    let legalHits = 0;
    for (const phrase of concepts.legal) {
      if (contentLower.includes(phrase)) legalHits++;
    }
    // Legal phrase match is the primary signal
    const legalScore = legalHits / concepts.legal.length;

    // Also check n-gram overlap as secondary signal
    let ngramHits = 0;
    for (const ng of concepts.ngrams) {
      if (contentLower.includes(ng)) ngramHits++;
    }
    const ngramScore = concepts.ngrams.length > 0 ? ngramHits / concepts.ngrams.length : 0;

    // Legal phrase match dominates (70/30 split)
    return legalScore * 0.7 + ngramScore * 0.3;
  }

  // No known legal phrases — fall back to n-gram matching (with stop words)
  if (concepts.ngrams.length === 0) return 0.5;
  let hits = 0;
  let totalWeight = 0;
  for (const ng of concepts.ngrams) {
    const wordCount = ng.split(" ").length;
    const weight = wordCount === 3 ? 2.0 : 1.0;
    totalWeight += weight;
    if (contentLower.includes(ng)) hits += weight;
  }
  return totalWeight === 0 ? 0.5 : hits / totalWeight;
}

/* ═══════════════════════════════════════════════════════════════
 *  DIRECTNESS SCORING (v4 — generalized primary vs collateral)
 *
 *  Measures how "primary-governing" a chunk is for the query:
 *  - Is this the main rule/definition/requirement? (primary provision)
 *  - Or is it collateral: appeals, exceptions, amendments, editorial,
 *    penalties, implementation, historical notes, etc.?
 *
 *  Generalized across domains — not hardcoded to immigration.
 * ═══════════════════════════════════════════════════════════════ */

/** Collateral provision signals — content that is secondary/downstream */
const COLLATERAL_SIGNALS: { pattern: RegExp; label: string; penalty: number }[] = [
  { pattern: /\bjudicial review\b/i, label: "downstream_review", penalty: 0.15 },
  { pattern: /\b(appellate|appeal of|review of order|petition for review)\b/i, label: "downstream_review", penalty: 0.12 },
  { pattern: /\b(scope of review|standard of review|court of appeals)\b/i, label: "downstream_review", penalty: 0.12 },
  { pattern: /\b(motion to reopen|motion to reconsider|reconsideration)\b/i, label: "collateral_procedural", penalty: 0.10 },
  { pattern: /\bstay of (removal|deportation|execution)\b/i, label: "collateral_procedural", penalty: 0.08 },
  { pattern: /\b(penalty|penalties|penalized|sanction|fine|forfeiture|civil money)\b/i, label: "penalty_provision", penalty: 0.08 },
  { pattern: /\b(except as provided|notwithstanding|saving clause|transitional|transition rule)\b/i, label: "exception_provision", penalty: 0.06 },
  { pattern: /\b(effective date|amendment|repeal|redesignat|transfer of function)\b/i, label: "editorial_or_historical", penalty: 0.10 },
  { pattern: /\b(editorial note|historical note|prior provision|former section|as amended by)\b/i, label: "editorial_or_historical", penalty: 0.12 },
  { pattern: /\bregulations?\s+(shall|may)\s+(be\s+)?(promulgat|issu|prescrib)/i, label: "implementation_detail", penalty: 0.06 },
];

/** Primary provision signals — content that states the main rule */
const PRIMARY_PROVISION_SIGNALS: { pattern: RegExp; boost: number }[] = [
  { pattern: /\b(means|is defined as|refers to|shall mean|for purposes of this)\b/i, boost: 0.10 },
  { pattern: /\bshall\s+(be|provide|issue|serve|file|submit|notify|require|determine)\b/i, boost: 0.08 },
  { pattern: /\bis\s+(required|entitled|eligible|authorized|prohibited)\b/i, boost: 0.08 },
  { pattern: /\b(eligib(?:le|ility)|qualification|requirement|condition|standard|criteria)\b/i, boost: 0.06 },
  { pattern: /\b(right to|entitled to|obligation|duty|responsibility)\b/i, boost: 0.06 },
  { pattern: /\b(notice\s+(?:shall|must|is)|filing\s+(?:deadline|requirement)|within\s+\d+\s+days)\b/i, boost: 0.06 },
];

interface DirectnessResult {
  score: number;
  collateral_labels: string[];
  primary_boost: boolean;
}

function computeDirectnessScore(query: string, content: string, metadata: Record<string, unknown>): DirectnessResult {
  const queryWords = query.toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w));

  if (queryWords.length === 0) return { score: 0.5, collateral_labels: [], primary_boost: false };

  const contentLower = content.toLowerCase();
  const headingLower = String(metadata.heading_path ?? metadata.section_heading ?? "").toLowerCase();

  let score = 0.5;
  const collateral_labels: string[] = [];

  // 1. Heading contains query concept words
  if (headingLower.length > 0) {
    let headingHits = 0;
    for (const w of queryWords) {
      if (headingLower.includes(w)) headingHits++;
    }
    score += (headingHits / queryWords.length) * 0.25;
  }

  // 2. Opening contains query-relevant language
  const opening = contentLower.slice(0, 200);
  let openingHits = 0;
  for (const w of queryWords) {
    if (opening.includes(w)) openingHits++;
  }
  score += (openingHits / queryWords.length) * 0.15;

  // 3. Primary provision detection
  let primary_boost = false;
  let primaryBoostTotal = 0;
  for (const sig of PRIMARY_PROVISION_SIGNALS) {
    if (sig.pattern.test(contentLower)) {
      primaryBoostTotal += sig.boost;
    }
  }
  primaryBoostTotal = Math.min(0.15, primaryBoostTotal);
  if (primaryBoostTotal > 0.05) {
    primary_boost = true;
    score += primaryBoostTotal;
  }

  // 4. Collateral provision detection — penalize unless query asks about that topic
  const queryLower = query.toLowerCase();
  const queryAsksReview = /\b(review|appeal|reopen|reconsider|motion)\b/i.test(queryLower);
  const queryAsksPenalty = /\b(penalty|sanction|fine|forfeiture)\b/i.test(queryLower);
  const queryAsksException = /\b(exception|notwithstanding|saving)\b/i.test(queryLower);
  const queryAsksHistory = /\b(history|amendment|effective date|repeal)\b/i.test(queryLower);

  for (const sig of COLLATERAL_SIGNALS) {
    if (sig.pattern.test(contentLower)) {
      const skip =
        (sig.label === "downstream_review" && queryAsksReview) ||
        (sig.label === "collateral_procedural" && queryAsksReview) ||
        (sig.label === "penalty_provision" && queryAsksPenalty) ||
        (sig.label === "exception_provision" && queryAsksException) ||
        (sig.label === "editorial_or_historical" && queryAsksHistory);

      if (!skip) {
        score -= sig.penalty;
        collateral_labels.push(sig.label);
      }
    }
  }

  // 5. Exact query phrase in content
  const queryPhrase = queryWords.join(" ");
  if (queryPhrase.length > 6 && contentLower.includes(queryPhrase)) {
    score += 0.1;
  }

  return {
    score: Math.max(0, Math.min(1, score)),
    collateral_labels,
    primary_boost,
  };
}

/* ═══════════════════════════════════════════════════════════════
 *  CONCEPT ANCHOR SCORING (v3)
 *
 *  Measures how central the query's main concept is to a chunk.
 *  This is the strongest signal for "is this chunk actually about
 *  what the user asked for, or merely nearby?"
 *
 *  Signals:
 *    - Does the main concept phrase appear at all?
 *    - How many times does it appear?
 *    - Does it appear in the first 300 chars (opening)?
 *    - Does it appear in heading metadata?
 *    - Are there close variants present?
 *
 *  Also applies an irrelevance penalty: if the chunk matches
 *  only weak secondary terms but misses the main concept entirely,
 *  the score is actively penalized.
 * ═══════════════════════════════════════════════════════════════ */

function computeConceptAnchorScore(query: string, content: string, metadata: Record<string, unknown>): number {
  const concepts = extractConceptPhrases(query);
  const contentLower = content.toLowerCase();
  const headingLower = String(metadata.heading_path ?? metadata.section_heading ?? "").toLowerCase();

  // If we have known legal phrases from the query, use them as anchors
  if (concepts.legal.length > 0) {
    let score = 0;

    for (const phrase of concepts.legal) {
      const phrasePresent = contentLower.includes(phrase);
      const phraseInHeading = headingLower.includes(phrase);
      const phraseInOpening = contentLower.slice(0, 300).includes(phrase);

      if (!phrasePresent) {
        // Main concept phrase completely absent — strong penalty
        score -= 0.3;
        continue;
      }

      // Count occurrences
      let count = 0;
      let searchFrom = 0;
      while (true) {
        const idx = contentLower.indexOf(phrase, searchFrom);
        if (idx === -1) break;
        count++;
        searchFrom = idx + phrase.length;
      }

      // Base: present
      score += 0.4;
      // In heading: strong signal
      if (phraseInHeading) score += 0.25;
      // In opening: strong signal
      if (phraseInOpening) score += 0.15;
      // Multiple occurrences: content is focused on this concept
      if (count >= 3) score += 0.15;
      else if (count >= 2) score += 0.08;
    }

    // Normalize by number of legal phrases
    score = score / concepts.legal.length;
    return Math.max(0, Math.min(1, score + 0.1)); // slight positive baseline offset
  }

  // No known legal phrases — use content-word overlap as a weaker concept anchor
  const queryWords = query.toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w));

  if (queryWords.length === 0) return 0.5;

  let hits = 0;
  let openingHits = 0;
  let headingHits = 0;
  const opening = contentLower.slice(0, 300);

  for (const w of queryWords) {
    if (contentLower.includes(w)) hits++;
    if (opening.includes(w)) openingHits++;
    if (headingLower.includes(w)) headingHits++;
  }

  const coverage = hits / queryWords.length;
  const openingCoverage = openingHits / queryWords.length;
  const headingCoverage = headingHits / queryWords.length;

  // If less than half the query words appear, penalize
  if (coverage < 0.5) {
    return Math.max(0, coverage * 0.4);
  }

  return Math.min(1,
    coverage * 0.45 +
    openingCoverage * 0.25 +
    headingCoverage * 0.2 +
    0.1 // baseline
  );
}

/* ═══════════════════════════════════════════════════════════════
 *  SOURCE TYPE DETECTION
 *
 *  Detects whether content is statute-like (exact matching matters
 *  more) vs handbook-like (semantic relevance can be broader).
 * ═══════════════════════════════════════════════════════════════ */

function isStatuteLikeContent(content: string, metadata: Record<string, unknown>): boolean {
  const title = String(metadata.title ?? "").toLowerCase();
  const source = String(metadata.source_type ?? metadata.source ?? "").toLowerCase();
  const allMeta = `${title} ${source}`;

  if (/\b(statute|code|u\.?s\.?c|title\s+\d|regulation|cfr|act)\b/i.test(allMeta)) return true;
  // Content-based detection: high density of section references and "shall"/"must" language
  const lower = content.toLowerCase();
  const sectionCount = (lower.match(/§|\bsection\s+\d/g) ?? []).length;
  const shallCount = (lower.match(/\bshall\b/g) ?? []).length;
  return sectionCount >= 2 || shallCount >= 3;
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

/* ── Bounded text truncation ── */

function boundedTruncate(
  text: string,
  maxChars: number,
): { text: string; wasTruncated: boolean } {
  if (text.length <= maxChars) return { text, wasTruncated: false };
  const slice = text.slice(0, maxChars);
  const lastSentenceEnd = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf(".\n"),
    slice.lastIndexOf("? "),
    slice.lastIndexOf("! "),
  );
  const cutPoint = lastSentenceEnd > maxChars * 0.5 ? lastSentenceEnd + 1 : maxChars;
  return { text: text.slice(0, cutPoint), wasTruncated: true };
}

/* ── Excerpt extraction (bounded) ── */

function extractBestExcerpt(content: string, query: string, maxLen: number): string {
  const queryTokens = new Set(query.toLowerCase().split(/\s+/).filter(t => t.length > 3));
  const sentences = content.split(/(?<=[.!?])\s+/);

  if (sentences.length <= 3) {
    return content.length > maxLen ? content.slice(0, maxLen) + "…" : content;
  }

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
  maxLen: number,
): string {
  const parts = [docTitle];
  if (sectionHeading) parts.push(`§ ${sectionHeading}`);
  parts.push(`chunk ${chunkIndex}`);
  const label = parts.join(" — ");
  return label.length > maxLen ? label.slice(0, maxLen - 1) + "…" : label;
}

/* ── Records Room composite scoring (v4 — primary-provision-aware) ── */

function scoreCandidate(
  chunk: { similarity: number; content: string; metadata: Record<string, unknown> },
  query: string,
  intake: IntakeSignals,
): {
  composite_score: number;
  lexical_score: number;
  authority_score: number;
  excerpt_density: number;
  metadata_match: number;
  freshness_score: number;
  section_match_score: number;
  exact_phrase_score: number;
  directness_score: number;
  concept_anchor_score: number;
  collateral_labels: string[];
  primary_boost: boolean;
} {
  const lexical_score = computeLexicalScore(query, chunk.content);
  const authority_score = computeAuthorityScore(chunk.metadata);
  const procedural = computeProceduralScore(chunk.content);
  const excerpt_density = computeExcerptDensity(chunk.content);
  const metadata_match = computeMetadataMatch(query, chunk.metadata, intake);
  const freshness_score = computeFreshnessScore(chunk.metadata);
  const context_quality = computeInfoQuality(chunk.content);
  const section_match_score = computeSectionMatchScore(query, chunk.content, chunk.metadata);
  const exact_phrase_score = computeExactPhraseScore(query, chunk.content);
  const directnessResult = computeDirectnessScore(query, chunk.content, chunk.metadata);
  const directness_score = directnessResult.score;
  const concept_anchor_score = computeConceptAnchorScore(query, chunk.content, chunk.metadata);

  const isStatute = isStatuteLikeContent(chunk.content, chunk.metadata);
  const statuteBias = isStatute ? 1.3 : 1.0;

  const composite_score =
    W_SEMANTIC * chunk.similarity +
    W_LEXICAL * lexical_score +
    W_AUTHORITY * authority_score +
    W_PROCEDURAL * procedural +
    W_EXCERPT_DENSITY * excerpt_density +
    W_METADATA * metadata_match +
    W_FRESHNESS * freshness_score +
    W_CONTEXT * context_quality +
    W_SECTION_MATCH * section_match_score * statuteBias +
    W_EXACT_PHRASE * exact_phrase_score * statuteBias +
    W_DIRECTNESS * directness_score +
    W_CONCEPT_ANCHOR * concept_anchor_score * statuteBias;

  return {
    composite_score, lexical_score, authority_score, excerpt_density,
    metadata_match, freshness_score, section_match_score, exact_phrase_score,
    directness_score, concept_anchor_score,
    collateral_labels: directnessResult.collateral_labels,
    primary_boost: directnessResult.primary_boost,
  };
}

/* ── Source access URL builders (signed URLs for private buckets) ── */

async function buildSourceUrls(
  supabase: ReturnType<typeof createClient>,
  doc: { file_path: string | null; metadata: Record<string, unknown>; id?: string } | undefined,
): Promise<{ source_url: string | null; download_url: string | null }> {
  const none = { source_url: null, download_url: null };
  if (!doc) return none;

  // Check for explicit URL in metadata first
  const metaUrl = doc.metadata?.source_url ?? doc.metadata?.file_url ?? doc.metadata?.url;
  if (typeof metaUrl === "string" && metaUrl.startsWith("http")) {
    const metaDownload = doc.metadata?.download_url;
    return {
      source_url: metaUrl,
      download_url: typeof metaDownload === "string" && metaDownload.startsWith("http") ? metaDownload : metaUrl,
    };
  }

  // Derive storage path from file_path or metadata
  const storagePath = doc.file_path
    ?? (typeof doc.metadata?.storage_path === "string" ? doc.metadata.storage_path : null);
  if (!storagePath) {
    console.log(`[records-room][source-url] doc=${doc.id ?? "?"} — no file_path or storage_path, skipping`);
    return none;
  }

  // Derive bucket from metadata or default to kb-documents
  const storageBucket = typeof doc.metadata?.storage_bucket === "string"
    ? doc.metadata.storage_bucket
    : "kb-documents";

  // Generate signed URLs (1 hour expiry) for private buckets
  try {
    const { data: viewData, error: viewErr } = await supabase.storage
      .from(storageBucket)
      .createSignedUrl(storagePath, 3600); // 1 hour

    if (viewErr || !viewData?.signedUrl) {
      console.warn(`[records-room][source-url] doc=${doc.id ?? "?"} bucket=${storageBucket} path=${storagePath} — signed URL failed:`, viewErr?.message ?? "no data");
      return none;
    }

    const { data: dlData, error: dlErr } = await supabase.storage
      .from(storageBucket)
      .createSignedUrl(storagePath, 3600, { download: true });

    console.log(`[records-room][source-url] doc=${doc.id ?? "?"} bucket=${storageBucket} path=${storagePath} — signed URLs generated OK`);

    return {
      source_url: viewData.signedUrl,
      download_url: (dlErr || !dlData?.signedUrl) ? viewData.signedUrl : dlData.signedUrl,
    };
  } catch (err) {
    console.error(`[records-room][source-url] doc=${doc.id ?? "?"} — exception:`, err);
    return none;
  }
}

/* ── Response helpers ── */

let _corsHeaders: Record<string, string> = {};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ..._corsHeaders, "Content-Type": "application/json" },
  });
}

const FAILURE_MESSAGES: Record<string, string> = {
  no_matching_materials: "No matching materials were found in the current knowledge base.",
  weak_match: "Relevant documents may exist, but no source in the current knowledge base closely matches this request.",
  no_direct_excerpt: "Relevant documents were found, but no excerpt directly addresses this question.",
  clarification_needed: "",
};

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

/* ── Payload size enforcement ── */

function enforcePayloadSize(
  response: RetrieveResponse,
  caps: CapDiagnostics,
): RetrieveResponse {
  const encoder = new TextEncoder();
  let payload = JSON.stringify(response);
  let bytes = encoder.encode(payload).length;

  if (bytes <= LIMITS.MAX_RESPONSE_PAYLOAD_BYTES) return response;

  const r = JSON.parse(payload) as RetrieveResponse;
  caps.record("MAX_RESPONSE_PAYLOAD_BYTES", LIMITS.MAX_RESPONSE_PAYLOAD_BYTES, bytes, "trimmed");

  r.diagnostics = { trimmed: true, original_bytes: bytes };
  payload = JSON.stringify(r);
  bytes = encoder.encode(payload).length;
  if (bytes <= LIMITS.MAX_RESPONSE_PAYLOAD_BYTES) return r;

  const trimContext = (items: EvidenceItem[]) => {
    for (const item of items) {
      if (item.expandable_context.length > 500) {
        item.expandable_context = item.expandable_context.slice(0, 500) + "…";
      }
    }
  };
  trimContext(r.strong_evidence);
  trimContext(r.supporting_materials);
  payload = JSON.stringify(r);
  bytes = encoder.encode(payload).length;
  if (bytes <= LIMITS.MAX_RESPONSE_PAYLOAD_BYTES) return r;

  const trimExcerpts = (items: EvidenceItem[]) => {
    for (const item of items) {
      if (item.excerpt_text.length > 300) {
        item.excerpt_text = item.excerpt_text.slice(0, 300) + "…";
      }
    }
  };
  trimExcerpts(r.strong_evidence);
  trimExcerpts(r.supporting_materials);
  payload = JSON.stringify(r);
  bytes = encoder.encode(payload).length;
  if (bytes <= LIMITS.MAX_RESPONSE_PAYLOAD_BYTES) return r;

  caps.record("supporting_materials_dropped", LIMITS.MAX_RESPONSE_PAYLOAD_BYTES, bytes, "trimmed");
  r.supporting_materials = [];

  return r;
}

/* ═══════════════════════════════════════════════════════════════
 *  MAIN HANDLER
 * ═══════════════════════════════════════════════════════════════ */

Deno.serve(async (req) => {
  _corsHeaders = buildCorsSecurityHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: _corsHeaders });
  if (req.method !== "POST") return jsonResponse(405, { error: "Method not allowed" });

  const contentLength = req.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > LIMITS.MAX_REQUEST_BODY_BYTES) {
    return jsonResponse(413, { error: `Request too large (max ${LIMITS.MAX_REQUEST_BODY_BYTES} bytes)` });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabase = createClient(
    supabaseUrl,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) return jsonResponse(500, { error: "OPENAI_API_KEY not configured" });
  const EMBEDDING_MODEL = Deno.env.get("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small";

  /**
   * TEMPORARY HOSTED BRIDGE — Create embedding provider.
   * When local embeddings are available, replace this with:
   *   const embedder = createLocalEmbeddingProvider(serviceUrl);
   */
  const embedder = createHostedEmbeddingProvider(OPENAI_API_KEY, EMBEDDING_MODEL);

  let payload: RetrieveRequest;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  const {
    query: rawQuery,
    tenant_id,
    min_similarity = DEFAULT_MIN_SIMILARITY,
  } = payload;

  if (!rawQuery || typeof rawQuery !== "string" || rawQuery.trim().length === 0) {
    return jsonResponse(400, { error: "query is required" });
  }
  if (!tenant_id || typeof tenant_id !== "string") {
    return jsonResponse(400, { error: "tenant_id is required" });
  }
  if (rawQuery.length > LIMITS.MAX_QUERY_INPUT_CHARS) {
    return jsonResponse(400, { error: `Query too long (max ${LIMITS.MAX_QUERY_INPUT_CHARS} characters)` });
  }

  const startTime = Date.now();
  const caps = new CapDiagnostics();

  try {
    /* ══════════════════════════════════════════════════════════
     *  Stage 1: Intake analysis
     * ══════════════════════════════════════════════════════════ */

    let query = rawQuery.trim();
    if (query.length > LIMITS.MAX_PASTED_TEXT_CHARS) {
      caps.record("MAX_PASTED_TEXT_CHARS", LIMITS.MAX_PASTED_TEXT_CHARS, query.length, "truncated");
      query = query.slice(0, LIMITS.MAX_PASTED_TEXT_CHARS);
    }

    const intake = analyzeIntake(query);
    console.log("[records-room] Intake:", JSON.stringify(intake));

    if (intake.needs_clarification) {
      const response: RetrieveResponse = {
        status: "clarification_needed",
        query_type: intake.query_type,
        clarification_question: intake.clarification_question,
        strong_evidence: [],
        supporting_materials: [],
        failure_state: "clarification_needed",
        failure_message: intake.clarification_question,
        diagnostics: { intake, caps_hit: caps.all, duration_ms: Date.now() - startTime },
      };
      return jsonResponse(200, response);
    }

    /* ══════════════════════════════════════════════════════════
     *  Stage 2: HYBRID Candidate Recall
     *  
     *  Two independent recall branches:
     *    A. Semantic — vector similarity via match_document_chunks
     *    B. Lexical  — Postgres full-text search via search_document_chunks_lexical
     *  
     *  Then merge & dedupe by chunk ID.
     * ══════════════════════════════════════════════════════════ */

    // Truncate for embedding
    let embeddingInput = query;
    if (embeddingInput.length > LIMITS.MAX_EMBEDDING_INPUT_CHARS) {
      caps.record("MAX_EMBEDDING_INPUT_CHARS", LIMITS.MAX_EMBEDDING_INPUT_CHARS, embeddingInput.length, "truncated");
      embeddingInput = embeddingInput.slice(0, LIMITS.MAX_EMBEDDING_INPUT_CHARS);
    }

    // Run both recall branches in parallel
    const queryVec = await embedder.embedQuery(embeddingInput);

    const [semanticResult, lexicalResult] = await Promise.all([
      supabase.rpc("match_document_chunks", {
        p_tenant_id: tenant_id,
        p_query_embedding: JSON.stringify(queryVec),
        p_match_count: LIMITS.MAX_SEMANTIC_RECALL,
        p_min_similarity: min_similarity,
      }),
      supabase.rpc("search_document_chunks_lexical", {
        p_tenant_id: tenant_id,
        p_search_query: query.slice(0, 500), // keep lexical query reasonable
        p_match_count: LIMITS.MAX_LEXICAL_RECALL,
      }),
    ]);

    if (semanticResult.error) throw new Error(`Semantic recall failed: ${semanticResult.error.message}`);

    const semanticCandidates = semanticResult.data ?? [];
    const lexicalCandidates = lexicalResult.error ? [] : (lexicalResult.data ?? []);

    if (lexicalResult.error) {
      console.warn("[records-room] Lexical recall failed (non-fatal):", lexicalResult.error.message);
    }

    console.log(`[records-room] Recall — semantic: ${semanticCandidates.length}, lexical: ${lexicalCandidates.length}`);

    // Merge & dedupe: track which branch each candidate came from
    const candidateMap = new Map<string, {
      chunk: typeof semanticCandidates[0];
      origin: RecallOrigin;
      similarity: number;
      lexical_rank: number;
    }>();

    for (const c of semanticCandidates) {
      candidateMap.set(c.id, {
        chunk: c,
        origin: "semantic",
        similarity: c.similarity,
        lexical_rank: 0,
      });
    }

    for (const c of lexicalCandidates) {
      const existing = candidateMap.get(c.id);
      if (existing) {
        // Found in both branches — boost
        existing.origin = "both";
        existing.lexical_rank = c.rank ?? 0;
      } else {
        // Lexical-only candidate: assign a baseline similarity
        candidateMap.set(c.id, {
          chunk: { ...c, similarity: 0.15 }, // low semantic baseline for lexical-only
          origin: "lexical",
          similarity: 0.15,
          lexical_rank: c.rank ?? 0,
        });
      }
    }

    const mergedCount = candidateMap.size;
    let candidates = Array.from(candidateMap.values());

    // Cap merged pool
    if (candidates.length > LIMITS.MAX_MERGED_CANDIDATES) {
      caps.record("MAX_MERGED_CANDIDATES", LIMITS.MAX_MERGED_CANDIDATES, candidates.length, "capped");
      // Sort by a quick heuristic: semantic similarity + lexical rank presence
      candidates.sort((a, b) => {
        const scoreA = a.similarity + (a.origin === "both" ? 0.1 : 0);
        const scoreB = b.similarity + (b.origin === "both" ? 0.1 : 0);
        return scoreB - scoreA;
      });
      candidates = candidates.slice(0, LIMITS.MAX_MERGED_CANDIDATES);
    }

    // Count origins for diagnostics
    let originSemantic = 0, originLexical = 0, originBoth = 0;
    for (const c of candidates) {
      if (c.origin === "semantic") originSemantic++;
      else if (c.origin === "lexical") originLexical++;
      else originBoth++;
    }

    console.log(`[records-room] Merged pool: ${mergedCount} → ${candidates.length} (semantic-only: ${originSemantic}, lexical-only: ${originLexical}, both: ${originBoth})`);

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
        diagnostics: {
          intake, semantic_count: semanticCandidates.length,
          lexical_count: lexicalCandidates.length, merged_count: 0,
          caps_hit: caps.all, duration_ms: Date.now() - startTime,
        },
      };

      try {
        await logEyeEvent(supabase, {
          session_id: null,
          event_type: "RETRIEVE_SEARCH",
          serviceName: "records-room",
          payload: { tenant_id, query_type: intake.query_type, candidate_count: 0, result: "failure", reason_code: "no_matching_materials" },
        });
      } catch { /* non-critical */ }

      return jsonResponse(200, response);
    }

    /* ══════════════════════════════════════════════════════════
     *  Stage 3: Records Room reranking
     * ══════════════════════════════════════════════════════════ */

    let scored: ScoredChunk[] = [];
    let filteredLowInfo = 0;

    for (const entry of candidates) {
      const c = entry.chunk;
      const content = c.content ?? "";
      const meta = (c.metadata as Record<string, unknown>) ?? {};

      const infoQ = computeInfoQuality(content);
      if (infoQ < 0.2) { filteredLowInfo++; continue; }

      // Enrich metadata with document title from chunk metadata for scoring
      const scores = scoreCandidate(
        { similarity: entry.similarity, content, metadata: meta },
        query,
        intake,
      );

      scored.push({
        chunk_id: c.id,
        document_id: c.document_id,
        chunk_index: c.chunk_index,
        content,
        metadata: meta,
        similarity: entry.similarity,
        composite_score: scores.composite_score,
        info_quality: infoQ,
        lexical_score: scores.lexical_score,
        authority_score: scores.authority_score,
        excerpt_density: scores.excerpt_density,
        metadata_match: scores.metadata_match,
        freshness_score: scores.freshness_score,
        section_match_score: scores.section_match_score,
        exact_phrase_score: scores.exact_phrase_score,
        directness_score: scores.directness_score,
        concept_anchor_score: scores.concept_anchor_score,
        collateral_labels: scores.collateral_labels,
        primary_boost: scores.primary_boost,
        recall_origin: entry.origin,
        bucket: "excluded",
      });
    }

    // Cap scored candidates
    if (scored.length > LIMITS.MAX_SCORED_CANDIDATES) {
      caps.record("MAX_SCORED_CANDIDATES", LIMITS.MAX_SCORED_CANDIDATES, scored.length, "capped");
      scored.sort((a, b) => b.composite_score - a.composite_score);
      scored = scored.slice(0, LIMITS.MAX_SCORED_CANDIDATES);
    } else {
      scored.sort((a, b) => b.composite_score - a.composite_score);
    }

    // Deduplicate + neighbor suppression + bucket assignment
    const admitted: ScoredChunk[] = [];
    const admittedTokenSets: Set<string>[] = [];
    // Track admitted (document_id, chunk_index) for neighbor suppression
    const admittedChunkKeys: { document_id: string; chunk_index: number }[] = [];
    let strongCount = 0;
    let supportingCount = 0;
    let dupeSuppressed = 0;
    let neighborSuppressed = 0;

    for (const chunk of scored) {
      if (admitted.length >= LIMITS.MAX_ADMITTED_CANDIDATES) break;

      // Jaccard dedup
      const tokens = tokenize(chunk.content);
      let isDupe = false;
      for (const existing of admittedTokenSets) {
        if (jaccardSimilarity(tokens, existing) >= LIMITS.JACCARD_DEDUP_THRESHOLD) {
          isDupe = true;
          dupeSuppressed++;
          break;
        }
      }
      if (isDupe) continue;

      // Neighbor-chunk suppression: if a chunk from the same document
      // with adjacent chunk_index is already admitted with a higher score,
      // demote this one (still allow it as supporting, but not strong)
      let isNeighborOfStronger = false;
      for (const ak of admittedChunkKeys) {
        if (ak.document_id === chunk.document_id &&
            Math.abs(ak.chunk_index - chunk.chunk_index) <= 1) {
          isNeighborOfStronger = true;
          break;
        }
      }

      // Concept-anchor gating for supporting materials:
      // If the concept anchor score is very low, skip even supporting admission
      const conceptTooWeak = chunk.concept_anchor_score < 0.15;

      // Build descriptive admission reason
      const buildReason = (base: string): string => {
        const parts = [base];
        if (chunk.primary_boost) parts.push("primary_provision_boost");
        if (chunk.concept_anchor_score >= 0.6) parts.push("concept_central");
        if (chunk.collateral_labels.length > 0) parts.push(...chunk.collateral_labels.map(l => `${l}_demotion`));
        parts.push(`anc=${chunk.concept_anchor_score.toFixed(2)}`);
        parts.push(`dir=${chunk.directness_score.toFixed(2)}`);
        return parts.join(",");
      };

      if (isNeighborOfStronger) {
        if (!conceptTooWeak && supportingCount < LIMITS.MAX_SUPPORTING_MATERIALS && chunk.composite_score >= SUPPORTING_THRESHOLD) {
          chunk.bucket = "supporting_material";
          chunk.admission_reason = buildReason("neighbor_demoted");
          supportingCount++;
          neighborSuppressed++;
        } else {
          neighborSuppressed++;
          continue;
        }
      } else if (chunk.composite_score >= STRONG_EVIDENCE_THRESHOLD && strongCount < LIMITS.MAX_STRONG_EVIDENCE) {
        // Additional gate: heavily collateral chunks should not be strong evidence
        // unless concept anchor is very high
        if (chunk.collateral_labels.length >= 2 && chunk.concept_anchor_score < 0.5) {
          // Demote to supporting instead
          if (supportingCount < LIMITS.MAX_SUPPORTING_MATERIALS) {
            chunk.bucket = "supporting_material";
            chunk.admission_reason = buildReason("collateral_demoted_from_strong");
            supportingCount++;
          } else {
            continue;
          }
        } else {
          chunk.bucket = "strong_evidence";
          chunk.admission_reason = buildReason("strong");
          strongCount++;
        }
      } else if (!conceptTooWeak && chunk.composite_score >= SUPPORTING_THRESHOLD && supportingCount < LIMITS.MAX_SUPPORTING_MATERIALS) {
        chunk.bucket = "supporting_material";
        chunk.admission_reason = buildReason("supporting");
        supportingCount++;
      } else {
        continue;
      }

      admitted.push(chunk);
      admittedTokenSets.push(tokens);
      admittedChunkKeys.push({ document_id: chunk.document_id, chunk_index: chunk.chunk_index });
    }

    // Track admitted origins
    let admittedFromSemantic = 0, admittedFromLexical = 0, admittedFromBoth = 0;
    for (const a of admitted) {
      if (a.recall_origin === "semantic") admittedFromSemantic++;
      else if (a.recall_origin === "lexical") admittedFromLexical++;
      else admittedFromBoth++;
    }

    console.log(`[records-room] Admitted: ${admitted.length} (strong: ${strongCount}, supporting: ${supportingCount}, filtered_low_info: ${filteredLowInfo}, dupe_suppressed: ${dupeSuppressed}, neighbor_suppressed: ${neighborSuppressed})`);
    console.log(`[records-room] Admitted origins — semantic: ${admittedFromSemantic}, lexical: ${admittedFromLexical}, both: ${admittedFromBoth}`);

    // Per-candidate scoring diagnostics for top results
    for (let i = 0; i < Math.min(admitted.length, 5); i++) {
      const a = admitted[i];
      console.log(`[records-room] Rank #${i + 1} [${a.bucket}] chunk=${a.chunk_id.slice(0, 8)} doc=${a.document_id.slice(0, 8)} ci=${a.chunk_index} | sim=${a.similarity.toFixed(3)} lex=${a.lexical_score.toFixed(3)} sec=${a.section_match_score.toFixed(3)} phr=${a.exact_phrase_score.toFixed(3)} dir=${a.directness_score.toFixed(3)} anc=${a.concept_anchor_score.toFixed(3)} auth=${a.authority_score.toFixed(3)} composite=${a.composite_score.toFixed(4)} origin=${a.recall_origin} collateral=[${a.collateral_labels.join(",")}] primary=${a.primary_boost} reason=${a.admission_reason ?? "n/a"}`);
    }

    /* ══════════════════════════════════════════════════════════
     *  Stage 4: Excerpt assembly
     * ══════════════════════════════════════════════════════════ */

    const documentIds = admitted.map(c => c.document_id);
    const docMap = await lookupDocumentTitles(supabase, documentIds);

    // Pre-generate signed URLs for all unique documents in parallel
    const uniqueDocIds = [...new Set(admitted.map(c => c.document_id))];
    const sourceUrlMap = new Map<string, { source_url: string | null; download_url: string | null }>();
    await Promise.all(uniqueDocIds.map(async (docId) => {
      const doc = docMap.get(docId);
      const urls = await buildSourceUrls(supabase, doc ? { ...doc, id: docId } : undefined);
      sourceUrlMap.set(docId, urls);
    }));

    function buildEvidenceItem(chunk: ScoredChunk): EvidenceItem {
      const doc = docMap.get(chunk.document_id);
      const docTitle = doc?.title ?? "Unknown Document";
      const sectionHeading = (chunk.metadata.heading_path as string) ?? (chunk.metadata.section_heading as string) ?? null;

      const excerpt_text = extractBestExcerpt(chunk.content, query, LIMITS.MAX_EXCERPT_CHARS);

      let expandable_context = chunk.content;
      if (expandable_context.length > LIMITS.MAX_CONTEXT_CHARS) {
        caps.record("MAX_CONTEXT_CHARS", LIMITS.MAX_CONTEXT_CHARS, expandable_context.length, "truncated");
        const truncated = boundedTruncate(expandable_context, LIMITS.MAX_CONTEXT_CHARS);
        expandable_context = truncated.text + (truncated.wasTruncated ? "\n\n[Context truncated]" : "");
      }

      const citation_label = buildCitationLabel(docTitle, sectionHeading, chunk.chunk_index, LIMITS.MAX_CITATION_LABEL_CHARS);
      const urls = sourceUrlMap.get(chunk.document_id) ?? { source_url: null, download_url: null };

      return {
        document_title: docTitle,
        section_heading: sectionHeading,
        excerpt_text,
        citation_label,
        page_or_location: chunk.metadata.page ? `Page ${chunk.metadata.page}` : `Chunk ${chunk.chunk_index}`,
        expandable_context,
        source_type: doc?.source ?? (chunk.metadata.source_type as string) ?? null,
        is_official: (chunk.metadata.is_official as boolean) ?? false,
        chunk_id: chunk.chunk_id,
        document_id: chunk.document_id,
        similarity: parseFloat(chunk.similarity.toFixed(4)),
        composite_score: parseFloat(chunk.composite_score.toFixed(4)),
        source_url: urls.source_url,
        download_url: urls.download_url,
      };
    }

    const strong_evidence = admitted
      .filter(c => c.bucket === "strong_evidence")
      .map(buildEvidenceItem);

    const supporting_materials = admitted
      .filter(c => c.bucket === "supporting_material")
      .map(buildEvidenceItem);

    /* ══════════════════════════════════════════════════════════
     *  Stage 5: Determine failure state
     * ══════════════════════════════════════════════════════════ */

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
      failure_state = "no_direct_excerpt";
      failure_message = FAILURE_MESSAGES.no_direct_excerpt;
      status = "success";
    }

    /* ══════════════════════════════════════════════════════════
     *  Stage 6: Diagnostics + response packaging
     * ══════════════════════════════════════════════════════════ */

    const diagnostics: Record<string, unknown> = {
      intake,
      ranking_version: "v4_primary_provision",
      // Recall diagnostics
      semantic_recall_count: semanticCandidates.length,
      lexical_recall_count: lexicalCandidates.length,
      merged_pool_count: mergedCount,
      deduped_merged_count: candidates.length,
      // Origin breakdown in merged pool
      pool_origin_semantic: originSemantic,
      pool_origin_lexical: originLexical,
      pool_origin_both: originBoth,
      // Reranking diagnostics
      filtered_low_info: filteredLowInfo,
      scored_count: scored.length,
      dupe_suppressed: dupeSuppressed,
      neighbor_suppressed: neighborSuppressed,
      admitted_count: admitted.length,
      strong_count: strong_evidence.length,
      supporting_count: supporting_materials.length,
      // Admitted origin breakdown
      admitted_from_semantic: admittedFromSemantic,
      admitted_from_lexical: admittedFromLexical,
      admitted_from_both: admittedFromBoth,
      // Per-candidate scoring breakdown (top 5)
      top_candidates: admitted.slice(0, 5).map((a, i) => ({
        rank: i + 1,
        bucket: a.bucket,
        admission_reason: a.admission_reason ?? "n/a",
        primary_boost: a.primary_boost,
        collateral_labels: a.collateral_labels,
        chunk_id: a.chunk_id,
        chunk_index: a.chunk_index,
        document_id: a.document_id,
        similarity: parseFloat(a.similarity.toFixed(4)),
        lexical_score: parseFloat(a.lexical_score.toFixed(4)),
        section_match_score: parseFloat(a.section_match_score.toFixed(4)),
        exact_phrase_score: parseFloat(a.exact_phrase_score.toFixed(4)),
        directness_score: parseFloat(a.directness_score.toFixed(4)),
        concept_anchor_score: parseFloat(a.concept_anchor_score.toFixed(4)),
        authority_score: parseFloat(a.authority_score.toFixed(4)),
        metadata_match: parseFloat(a.metadata_match.toFixed(4)),
        composite_score: parseFloat(a.composite_score.toFixed(4)),
        recall_origin: a.recall_origin,
      })),
      // Quality metrics
      top_similarity: candidates.length > 0 ? parseFloat(Math.max(...candidates.map(c => c.similarity)).toFixed(4)) : 0,
      avg_composite: admitted.length > 0
        ? parseFloat((admitted.reduce((s, c) => s + c.composite_score, 0) / admitted.length).toFixed(4))
        : 0,
      // Safety
      caps_hit: caps.all,
      caps_hit_count: caps.hitCount,
      failure_state,
      duration_ms: Date.now() - startTime,
      // Architecture note
      embedding_provider: "openai_hosted_bridge",
    };

    console.log("[records-room] Diagnostics:", JSON.stringify(diagnostics));

    try {
      await logEyeEvent(supabase, {
        session_id: null,
        event_type: "RETRIEVE_SEARCH",
        serviceName: "records-room",
        payload: {
          tenant_id,
          query_type: intake.query_type,
          result: strong_evidence.length > 0 ? "success" : supporting_materials.length > 0 ? "partial" : "failure",
          // Existing summary fields
          semantic_recall: semanticCandidates.length,
          lexical_recall: lexicalCandidates.length,
          merged_pool: mergedCount,
          strong_count: strong_evidence.length,
          supporting_count: supporting_materials.length,
          admitted_origins: { semantic: admittedFromSemantic, lexical: admittedFromLexical, both: admittedFromBoth },
          caps_hit_count: caps.hitCount,
          duration_ms: Date.now() - startTime,
          // Rich ranking diagnostics
          ranking_version: "v4_primary_provision",
          failure_state,
          filtered_low_info: filteredLowInfo,
          dupe_suppressed: dupeSuppressed,
          neighbor_suppressed: neighborSuppressed,
          scored_count: scored.length,
          admitted_count: admitted.length,
          top_similarity: candidates.length > 0 ? parseFloat(Math.max(...candidates.map(c => c.similarity)).toFixed(4)) : 0,
          avg_composite: admitted.length > 0
            ? parseFloat((admitted.reduce((s, c) => s + c.composite_score, 0) / admitted.length).toFixed(4))
            : 0,
          top_candidates: admitted.slice(0, 5).map((a, i) => ({
            rank: i + 1,
            bucket: a.bucket,
            admission_reason: a.admission_reason ?? "n/a",
            primary_boost: a.primary_boost,
            collateral_labels: a.collateral_labels,
            chunk_id: a.chunk_id,
            chunk_index: a.chunk_index,
            document_id: a.document_id,
            similarity: parseFloat(a.similarity.toFixed(4)),
            lexical_score: parseFloat(a.lexical_score.toFixed(4)),
            section_match_score: parseFloat(a.section_match_score.toFixed(4)),
            exact_phrase_score: parseFloat(a.exact_phrase_score.toFixed(4)),
            directness_score: parseFloat(a.directness_score.toFixed(4)),
            concept_anchor_score: parseFloat(a.concept_anchor_score.toFixed(4)),
            authority_score: parseFloat(a.authority_score.toFixed(4)),
            metadata_match: parseFloat(a.metadata_match.toFixed(4)),
            composite_score: parseFloat(a.composite_score.toFixed(4)),
            recall_origin: a.recall_origin,
          })),
        },
      });
    } catch { /* non-critical */ }

    let response: RetrieveResponse = {
      status,
      query_type: intake.query_type,
      clarification_question: null,
      strong_evidence,
      supporting_materials,
      failure_state,
      failure_message,
      diagnostics,
    };

    response = enforcePayloadSize(response, caps);

    return jsonResponse(200, response);
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
          caps_hit_count: caps.hitCount,
          result: "failure",
        },
      });
    } catch { /* non-critical */ }

    return jsonResponse(500, { error: "Internal retrieval error" });
  }
});
