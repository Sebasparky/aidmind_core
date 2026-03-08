import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsSecurityHeaders } from "../_shared/security-headers.ts";
import { logEyeEvent } from "../_shared/eye.ts";

/* ── Types ── */

interface CompileRequest {
  session_id?: string;
  template_id?: string;
  guardrails?: { jurisdiction?: string; program?: string };
  per_query_limit?: number;
  min_similarity?: number;
  max_total_chunks?: number;
}

interface MergedChunk {
  chunk_id: string;
  document_id: string;
  chunk_index: number;
  similarity: number;
  content: string;
  metadata: Record<string, unknown>;
  query_indices: number[];
  evidence_usefulness: number; // 0..1 score for operational usefulness
}

/* ── Hard limits ── */
const HARD_MAX_TOTAL_CHUNKS = 80;

/* ── Greedy selector tuning constants ── */

// Weights for the dynamic scoring function (must sum to 1.0)
const W_SIMILARITY = 0.28;
const W_NOVELTY = 0.25;
const W_COVERAGE = 0.20;
const W_DIVERSITY = 0.07;
const W_USEFULNESS = 0.20; // evidence usefulness weight

// Jaccard threshold: chunks above this vs ANY selected chunk get a heavy novelty penalty
const JACCARD_HARD_SKIP = 0.80;
// Containment: if >85% of candidate tokens already appear in the union of selected text, hard skip
const CONTAINMENT_HARD_SKIP = 0.85;
// Adjacent chunk window for diversity penalty (same document)
const ADJACENT_WINDOW = 2;
// Minimum region spacing to get full diversity bonus (same document)
const IDEAL_REGION_SPACING = 8;
// Greedy window size: consider this many top-unseen candidates per iteration
const GREEDY_WINDOW = 6;
// Safety cap: absolute max chunks from a single document (secondary guardrail only)
const DOC_SAFETY_CAP = 10;

/* ── Low-information chunk detection ── */

const LOW_INFO_PHRASES = [
  "table of contents",
  "contents page",
  "list of figures",
  "list of tables",
  "list of appendices",
  "appendix index",
  "revision history",
  "document control",
  "page intentionally left blank",
];

/**
 * Compute a low-information penalty score for a chunk.
 * Returns 0..1 where 0 = definitely low-info (filter out), 1 = high-info (keep).
 */
function computeInfoQuality(content: string): number {
  if (!content || content.trim().length === 0) return 0;

  const text = content.trim();
  const lower = text.toLowerCase();
  const totalLen = text.length;

  // 1. Check for known low-info phrases
  for (const phrase of LOW_INFO_PHRASES) {
    if (lower.includes(phrase)) return 0.1;
  }

  // 2. Analyze line structure
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return 0;

  // Count lines that look like headings/section numbers (short, numbered, no sentence structure)
  const headingPattern = /^(\d+[\.\d]*\s|[-•]\s|[A-Z][A-Z\s]{2,}$|#{1,6}\s|section\s+\d)/i;
  let headingLines = 0;
  let shortLines = 0; // lines under 40 chars
  let proseLines = 0; // lines with at least one sentence-like structure

  for (const line of lines) {
    if (headingPattern.test(line)) headingLines++;
    if (line.length < 40) shortLines++;
    // Prose: contains at least one period, question mark, or comma and is >50 chars
    if (line.length > 50 && /[.,;:?!]/.test(line)) proseLines++;
  }

  const headingRatio = headingLines / lines.length;
  const shortRatio = shortLines / lines.length;
  const proseRatio = proseLines / lines.length;

  // 3. Mostly headings/section labels = low info
  if (headingRatio > 0.6 && proseRatio < 0.15) return 0.15;

  // 4. Mostly very short lines with no prose
  if (shortRatio > 0.75 && proseRatio < 0.1) return 0.2;

  // 5. Very short overall content (under 100 chars of substance)
  if (totalLen < 100) return 0.3;

  // 6. Low prose density (lots of lines but very few with real sentences)
  if (lines.length > 5 && proseRatio < 0.1) return 0.35;

  // 7. Moderate quality
  if (proseRatio < 0.25) return 0.7;

  return 1.0;
}

// Threshold: chunks with infoQuality below this are excluded entirely
const INFO_QUALITY_EXCLUDE = 0.2;
// Chunks between EXCLUDE and this threshold get a similarity penalty
const INFO_QUALITY_PENALTY_THRESHOLD = 0.5;

/* ── Evidence usefulness scoring ── */

/**
 * Scope-specific operational terms that indicate high-value assessment/intake content.
 * These augment the generic positive signals when a scope is active.
 */
const SCOPE_OPERATIONAL_TERMS: Record<string, string[]> = {
  child_welfare: [
    "safety assessment", "risk factors", "family assessment", "caregiver",
    "household", "home visit", "maltreatment", "child safety", "placement",
    "prior reports", "protective services", "family supports", "parenting",
    "living arrangement", "supervision", "abuse", "neglect", "permanency",
    "family functioning", "child wellbeing", "kinship", "reunification",
    "case plan", "safety plan", "family risk", "child risk",
  ],
  mental_health: [
    "symptoms", "functioning", "treatment history", "medications",
    "safety concerns", "crisis", "psychiatric", "diagnosis", "providers",
    "prior care", "suicidal", "self-harm", "behavioral health",
    "mental status", "clinical assessment", "therapy", "counseling",
    "psychosocial", "trauma", "anxiety", "depression",
  ],
  substance_use: [
    "use patterns", "substances used", "treatment history", "withdrawal",
    "medication-assisted", "recovery", "relapse", "co-occurring",
    "prior services", "sobriety", "dosage", "frequency", "route of use",
    "overdose", "detox", "harm reduction", "screening", "CAGE", "AUDIT",
  ],
  domestic_violence: [
    "safety planning", "lethality", "protective order", "power and control",
    "survivor", "perpetrator", "incident", "escalation", "children exposed",
    "shelter", "danger assessment", "coercive control",
  ],
  housing_homelessness: [
    "housing history", "eviction", "shelter", "barriers to housing",
    "housing stability", "chronic homelessness", "rapid re-housing",
    "lease", "landlord", "utility", "housing assessment",
  ],
};

/**
 * Generic positive signals indicating assessment/intake/interview utility.
 */
const USEFULNESS_POSITIVE_PHRASES: string[] = [
  "assessment", "screening", "intake", "interview", "evaluate", "determine",
  "document", "documentation", "required information", "data collection",
  "risk factors", "safety factors", "indicators", "criteria", "checklist",
  "responsibilities", "required reporting", "must assess", "shall document",
  "caseworker", "case worker", "worker must", "worker shall", "worker should",
  "information gathering", "questions to ask", "areas to explore",
  "factors to consider", "elements to assess", "items to document",
  "referral", "service coordination", "agency involvement", "provider",
  "records", "case plan", "service plan", "treatment plan",
  "household composition", "family members", "caregiver", "parent",
  "child", "children", "placement", "living arrangement",
  "safety", "risk", "protective factors", "strengths",
  "prior history", "prior services", "prior contact", "prior involvement",
  "visit", "home visit", "observation",
];

/**
 * Concrete case-fact nouns that indicate operational content.
 */
const USEFULNESS_FACT_NOUNS: string[] = [
  "child", "parent", "caregiver", "household", "family", "placement",
  "safety", "risk", "services", "referral", "treatment", "records",
  "case plan", "assessment", "screening", "documentation", "visit",
  "agency", "provider", "medication", "diagnosis", "symptoms",
  "income", "housing", "employment", "education", "transportation",
];

/**
 * Negative signals indicating non-operational content.
 */
const USEFULNESS_NEGATIVE_PHRASES: string[] = [
  "references", "bibliography", "legal and related references",
  "source/date", "works cited", "further reading",
  "purpose of this document", "vision", "mission statement",
  "strategic plan", "overview of the program", "background",
  "history of the program", "legislative history", "certification",
  "administrative rule", "funding", "appropriation", "budget",
  "title iv-e", "federal match", "reimbursement rate",
  "advocacy", "public awareness", "community education campaign",
  "preamble", "whereas", "be it enacted", "be it resolved",
  "table of contents", "list of figures", "appendix index",
];

/**
 * Compute evidence usefulness: how likely is this chunk to support
 * generating concrete, factual, client-facing intake/assessment questions?
 *
 * Returns 0..1 where:
 *   0   = not useful for question generation (abstract/admin/reference)
 *   0.5 = neutral / uncertain
 *   1   = highly useful (assessment guidance, risk factors, documentation requirements)
 *
 * Tuning constants:
 *   POSITIVE_PHRASE_WEIGHT = 0.04  — per positive phrase hit
 *   NEGATIVE_PHRASE_WEIGHT = 0.08  — per negative phrase hit (penalty)
 *   FACT_NOUN_WEIGHT       = 0.025 — per fact noun hit
 *   SCOPE_TERM_WEIGHT      = 0.035 — per scope-specific operational term hit
 *   MAX_RAW_SCORE          = 1.0   — cap before normalization
 */
const POSITIVE_PHRASE_WEIGHT = 0.04;
const NEGATIVE_PHRASE_WEIGHT = 0.08;
const FACT_NOUN_WEIGHT = 0.025;
const SCOPE_TERM_WEIGHT = 0.035;

function computeEvidenceUsefulness(content: string, scope?: string | null): number {
  if (!content || content.trim().length < 50) return 0.1;

  const lower = content.toLowerCase();

  // Count positive phrase hits
  let positiveHits = 0;
  for (const phrase of USEFULNESS_POSITIVE_PHRASES) {
    if (lower.includes(phrase)) positiveHits++;
  }

  // Count fact noun hits (deduplicated by checking word boundaries)
  let factHits = 0;
  for (const noun of USEFULNESS_FACT_NOUNS) {
    // Use simple includes for multi-word, regex for single words
    if (noun.includes(" ")) {
      if (lower.includes(noun)) factHits++;
    } else {
      if (new RegExp(`\\b${noun}\\b`).test(lower)) factHits++;
    }
  }

  // Count negative phrase hits
  let negativeHits = 0;
  for (const phrase of USEFULNESS_NEGATIVE_PHRASES) {
    if (lower.includes(phrase)) negativeHits++;
  }

  // Count scope-specific operational term hits
  let scopeHits = 0;
  if (scope && SCOPE_OPERATIONAL_TERMS[scope]) {
    for (const term of SCOPE_OPERATIONAL_TERMS[scope]) {
      if (lower.includes(term)) scopeHits++;
    }
  }

  // Detect instructional / imperative language (strong positive signal)
  const imperativePatterns = [
    /\b(must|shall|should|required to|need to)\s+(assess|document|evaluate|screen|determine|collect|gather|record|report|verify|obtain)\b/,
    /\b(assess|evaluate|screen|document|determine|identify|review|examine|investigate)\s+(the|each|all|any|whether)\b/,
  ];
  let imperativeBonus = 0;
  for (const p of imperativePatterns) {
    if (p.test(lower)) imperativeBonus += 0.08;
  }

  // Detect enumerated lists of factors/criteria (strong positive signal)
  const lines = content.split("\n").filter(l => l.trim().length > 0);
  const numberedOrBulletedLines = lines.filter(l => /^\s*(\d+[\.\)]\s|[-•●]\s)/.test(l));
  const enumerationBonus = numberedOrBulletedLines.length >= 3 ? 0.06 : 0;

  // Compute raw score
  const rawScore = (
    positiveHits * POSITIVE_PHRASE_WEIGHT +
    factHits * FACT_NOUN_WEIGHT +
    scopeHits * SCOPE_TERM_WEIGHT +
    imperativeBonus +
    enumerationBonus -
    negativeHits * NEGATIVE_PHRASE_WEIGHT
  );

  // Normalize to 0..1 with a baseline of 0.3 (neutral content gets ~0.3)
  const normalized = Math.max(0, Math.min(1, 0.3 + rawScore));
  return parseFloat(normalized.toFixed(3));
}

/* ── Interviewability scoring ── */

/**
 * Compute how likely a chunk's content can be transformed into a natural
 * client-facing interview question (vs being internal-only worker instructions).
 *
 * Returns 0..1 where:
 *   0   = internal-only (documentation instructions, case coding, justification requirements)
 *   0.5 = neutral / mixed
 *   1   = highly interviewable (assessment factors, risk indicators, factual fields)
 *
 * This score is stored in chunk metadata for downstream use by the generation validator.
 */
const INTERVIEWABLE_POSITIVE: string[] = [
  "injury", "injuries", "injured", "household", "who lives",
  "substance abuse", "substance use", "housing", "homeless", "eviction",
  "safety concern", "safety factor", "risk factor", "protective factor",
  "caregiver", "parent", "child", "children", "family member",
  "prior services", "community services", "agency involved",
  "referral", "treatment", "medication", "diagnosis",
  "employment", "income", "education", "transportation",
  "living arrangement", "placement", "supervision",
  "mental health", "behavioral health", "symptoms",
  "domestic violence", "intimate partner",
  "dates", "when did", "how long", "how often",
];

const INTERVIEWABLE_NEGATIVE: string[] = [
  "the worker must document",
  "case manager must explain",
  "narrative must include",
  "must be recorded in the case record",
  "document the reasons for",
  "provide justification",
  "case must be classified",
  "select the response",
  "enter the appropriate code",
  "supervisory approval",
  "override must be approved",
  "complete the following form",
  "case finding",
  "case coding",
  "disposition category",
  "substantiation determination",
  "response option",
  "responses 1 through",
  "administrative review",
  "record must reflect",
];

function computeInterviewability(content: string): number {
  if (!content || content.trim().length < 50) return 0.3;

  const lower = content.toLowerCase();

  let posHits = 0;
  for (const phrase of INTERVIEWABLE_POSITIVE) {
    if (lower.includes(phrase)) posHits++;
  }

  let negHits = 0;
  for (const phrase of INTERVIEWABLE_NEGATIVE) {
    if (lower.includes(phrase)) negHits++;
  }

  const raw = posHits * 0.04 - negHits * 0.10;
  return parseFloat(Math.max(0, Math.min(1, 0.5 + raw)).toFixed(3));
}

/* ── Helpers ── */

let _corsHeaders: Record<string, string> = {};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ..._corsHeaders, "Content-Type": "application/json" },
  });
}

function chunkTemplate(
  content: string,
  targetSize = 1500,
  overlap = 200,
): string[] {
  if (content.length <= targetSize) return [content];

  const paragraphs = content.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > targetSize && current.length > 0) {
      chunks.push(current.trim());
      const overlapText = current.slice(-overlap);
      current = overlapText + "\n\n" + para;
    } else {
      current += (current ? "\n\n" : "") + para;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  const final: string[] = [];
  for (const c of chunks) {
    if (c.length <= targetSize) {
      final.push(c);
    } else {
      let i = 0;
      while (i < c.length) {
        final.push(c.slice(i, i + targetSize));
        i += targetSize - overlap;
      }
    }
  }
  return final;
}

const MAX_QUERY_CHARS = 12000;

function truncateForEmbedding(text: string, maxChars = MAX_QUERY_CHARS): string {
  return text.length <= maxChars ? text : text.slice(0, maxChars);
}

/* ── Scope-aware retrieval ── */

/**
 * Domain-specific retrieval terms keyed by guidance_scope value.
 * These augment retrieval queries so embedding search finds scope-relevant policy.
 */
const SCOPE_RETRIEVAL_TERMS: Record<string, string> = {
  child_welfare:
    "child welfare, child safety, family services, child protective services, CPS, caregiver assessment, maltreatment, foster care, kinship placement, parenting support, home environment safety, parent-child risk, permanency planning",
  mental_health:
    "mental health, behavioral health, psychiatric assessment, symptoms screening, risk assessment, safety planning, treatment history, medications, clinical assessment, crisis intervention, therapy, counseling referral",
  substance_use:
    "substance use, substance abuse screening, use patterns, treatment history, withdrawal, medication-assisted treatment, MAT, recovery supports, co-occurring disorders, behavioral health intake, relapse prevention, prior services",
  social_welfare:
    "social welfare, public assistance, benefits eligibility, case management, client needs assessment, social services, community resources, supportive services, service coordination",
  housing_homelessness:
    "housing, homelessness, housing instability, shelter, transitional housing, permanent supportive housing, eviction prevention, rapid re-housing, housing assessment, barriers to housing",
  domestic_violence:
    "domestic violence, intimate partner violence, safety planning, protective orders, survivor services, lethality assessment, power and control, trauma-informed care, shelter services, risk factors",
  immigration_refugee:
    "immigration, refugee, asylum, resettlement, cultural adjustment, legal status, language access, immigration services, refugee support, documentation, eligibility verification",
  employment_income:
    "employment, income support, job readiness, vocational services, workforce development, employment barriers, financial assistance, benefits, job training, career planning",
  disability_services:
    "disability, disability services, accessibility, accommodations, independent living, assistive technology, disability assessment, supported employment, personal care, functional limitations",
  elder_services:
    "elder services, aging, senior care, long-term care, caregiver support, elder abuse, geriatric assessment, home and community-based services, Medicare, Medicaid, activities of daily living",
  reentry_justice:
    "reentry, criminal justice, reintegration, parole, probation, community supervision, recidivism, transitional services, post-incarceration, justice-involved, barriers to reentry",
};

/**
 * Detect whether a template section is broad/generic (low domain-specificity).
 * Returns 0..1 where 0 = very generic, 1 = highly specific.
 */
function computeSectionSpecificity(section: string): number {
  const lower = section.toLowerCase();
  const lines = lower.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return 0;

  // Generic field patterns common in broad intake templates
  const genericPatterns = [
    /\b(name|address|phone|email|date of birth|dob|ssn|social security)\b/,
    /\b(contact\s+info|demographics|household|living situation)\b/,
    /\b(additional\s+notes|comments|other\s+information|general\s+notes)\b/,
    /\b(services\s+sought|referral\s+source|reason\s+for\s+referral)\b/,
    /\b(prior\s+history|legal\s+status|current\s+concerns)\b/,
    /\b(signature|date|form\s+number|page\s+\d)\b/,
    /\b(emergency\s+contact|marital\s+status|gender|race|ethnicity)\b/,
  ];

  // Domain-specific patterns that indicate the section itself is already targeted
  const specificPatterns = [
    /\b(child\s+safety|maltreatment|foster|placement|CPS|protective\s+services)\b/i,
    /\b(mental\s+health|psychiatric|behavioral\s+health|symptoms|diagnosis)\b/i,
    /\b(substance\s+use|withdrawal|MAT|recovery|sobriety|relapse)\b/i,
    /\b(housing\s+stability|homelessness|shelter|eviction)\b/i,
    /\b(domestic\s+violence|intimate\s+partner|safety\s+plan|protective\s+order)\b/i,
    /\b(treatment\s+plan|clinical\s+assessment|risk\s+assessment|safety\s+assessment)\b/i,
    /\b(eligibility|benefits\s+determination|service\s+authorization)\b/i,
  ];

  let genericHits = 0;
  let specificHits = 0;

  for (const p of genericPatterns) {
    if (p.test(lower)) genericHits++;
  }
  for (const p of specificPatterns) {
    if (p.test(lower)) specificHits++;
  }

  // Short sections with few prose lines tend to be generic
  const proseLines = lines.filter((l) => l.length > 50 && /[.,;:?!]/.test(l)).length;
  const isShortAndStructural = lines.length > 0 && proseLines / lines.length < 0.2;

  if (specificHits >= 2) return 1.0;
  if (specificHits === 1 && genericHits <= 1) return 0.8;
  if (genericHits >= 3 || (genericHits >= 2 && isShortAndStructural)) return 0.1;
  if (genericHits >= 1) return 0.4;
  if (isShortAndStructural && lines.length < 5) return 0.3;

  return 0.6;
}

function buildRetrievalQuery(
  section: string,
  guardrails: { jurisdiction?: string; program?: string },
  scope?: string | null,
): string {
  const parts: string[] = [];
  if (guardrails.jurisdiction) parts.push(`Jurisdiction: ${guardrails.jurisdiction}`);
  if (guardrails.program) parts.push(`Program: ${guardrails.program}`);

  // Scope-aware query construction
  const scopeTerms = scope ? SCOPE_RETRIEVAL_TERMS[scope] : null;
  const specificity = computeSectionSpecificity(section);

  // Operational intent phrases that steer retrieval toward assessment-useful content
  const OPERATIONAL_INTENTS = [
    "intake assessment guidance",
    "caseworker interview questions",
    "required information to collect",
    "risk and safety factors to assess",
    "documentation requirements",
  ];

  // Scope-specific operational steering phrases
  const SCOPE_OPERATIONAL_INTENTS: Record<string, string> = {
    child_welfare:
      "child safety assessment, caregiver/family assessment, household information collection, risk factors, maltreatment indicators, service involvement, documentation requirements, case planning",
    mental_health:
      "mental health screening, symptoms assessment, treatment history, medication review, safety/crisis assessment, clinical intake, provider coordination",
    substance_use:
      "substance use screening, use patterns assessment, treatment history, withdrawal risk, recovery supports, prior services, medication-assisted treatment documentation",
    domestic_violence:
      "danger/lethality assessment, safety planning, incident documentation, children's exposure, protective factors, service coordination",
    housing_homelessness:
      "housing assessment, barriers documentation, housing history, stability factors, service needs, resource coordination",
  };

  const scopeOpsIntent = scope ? SCOPE_OPERATIONAL_INTENTS[scope] : null;

  if (scopeTerms) {
    if (specificity <= 0.3) {
      // Very broad/generic section → strong scope + operational steering
      parts.push(
        `Find practical assessment guidance, screening criteria, risk factors, documentation requirements, and caseworker interview guidance relevant to the following intake section, specifically in the context of ${scopeTerms}.`,
      );
      if (scopeOpsIntent) {
        parts.push(`Prioritize content about: ${scopeOpsIntent}.`);
      }
      parts.push(
        `Focus on content that helps a caseworker determine what facts to collect, what risks to assess, and what to document during a client interaction.`,
      );
    } else if (specificity <= 0.6) {
      // Moderately broad → moderate scope + operational steering
      parts.push(
        `Find policy text with practical assessment guidance relevant to this template section. Domain context: ${scopeTerms}.`,
      );
      parts.push(
        `Prefer content about: ${OPERATIONAL_INTENTS.slice(0, 3).join(", ")}.`,
      );
    } else {
      // Already specific → light scope hint + light operational hint
      parts.push(
        `Find policy text relevant to this template section (domain: ${scope?.replace(/_/g, " ")}). Prefer practical assessment and documentation guidance.`,
      );
    }
  } else {
    // No scope → still add operational intent
    parts.push(
      `Find policy text relevant to completing this section of the template. Prefer practical intake, assessment, or documentation guidance over general program background.`,
    );
  }

  parts.push(section);
  return truncateForEmbedding(parts.join("\n"));
}

/* ── Text analysis helpers ── */

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenize(text: string): Set<string> {
  return new Set(normalizeText(text).split(" ").filter(Boolean));
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const t of a) {
    if (b.has(t)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

function containmentRatio(candidate: Set<string>, unionSet: Set<string>): number {
  if (candidate.size === 0) return 1;
  let contained = 0;
  for (const t of candidate) {
    if (unionSet.has(t)) contained++;
  }
  return contained / candidate.size;
}

/* ── Greedy selector ── */

interface SelectionState {
  selected: MergedChunk[];
  selectedTokenSets: Set<string>[];
  // Union of all tokens across selected chunks — for containment check
  unionTokens: Set<string>;
  // Per-document: list of selected chunk_indices
  docIndices: Map<string, number[]>;
  // Per-document: count of selected chunks
  docCount: Map<string, number>;
  // Per-query: how many selected chunks cover this query index
  queryCoverage: Map<number, number>;
  // Total number of unique query indices across all candidates
  totalQueries: number;
}

interface SelectionDiagnostics {
  total_raw_matches: number;
  unique_after_id_dedupe: number;
  filtered_low_info: number;
  final_selected: number;
  hard_skipped_jaccard: number;
  hard_skipped_containment: number;
  hard_skipped_doc_cap: number;
  documents_represented: number;
  queries_covered: number;
  queries_total: number;
  avg_similarity: number;
}

function initState(totalQueries: number): SelectionState {
  return {
    selected: [],
    selectedTokenSets: [],
    unionTokens: new Set(),
    docIndices: new Map(),
    docCount: new Map(),
    queryCoverage: new Map(),
    totalQueries,
  };
}

/**
 * Compute novelty score for a candidate against current selection state.
 * Returns 0..1 where 1 = fully novel, 0 = fully redundant.
 */
function computeNovelty(
  candidateTokens: Set<string>,
  state: SelectionState,
): number {
  if (state.selected.length === 0) return 1;

  // Check containment against union — fast global check
  const unionContainment = containmentRatio(candidateTokens, state.unionTokens);
  // Invert: high containment = low novelty
  const noveltyFromUnion = 1 - unionContainment;

  // Also check max pairwise Jaccard — catches near-duplicates even if union is large
  let maxJaccard = 0;
  for (const existing of state.selectedTokenSets) {
    const j = jaccardSimilarity(candidateTokens, existing);
    if (j > maxJaccard) maxJaccard = j;
  }
  const noveltyFromJaccard = 1 - maxJaccard;

  // Take the more conservative (lower) novelty estimate
  return Math.min(noveltyFromUnion, noveltyFromJaccard);
}

/**
 * Compute query coverage gain: how much does this candidate improve
 * coverage of under-served template queries?
 * Returns 0..1 where 1 = covers entirely uncovered queries.
 */
function computeCoverageGain(
  queryIndices: number[],
  state: SelectionState,
): number {
  if (queryIndices.length === 0) return 0;

  let gain = 0;
  for (const qi of queryIndices) {
    const currentCoverage = state.queryCoverage.get(qi) ?? 0;
    // Diminishing returns: first chunk covering a query = 1.0, second = 0.5, third = 0.25, etc.
    gain += 1 / (1 + currentCoverage);
  }
  // Normalize by number of query indices this chunk covers
  return gain / queryIndices.length;
}

/**
 * Compute document-region diversity score.
 * Rewards chunks that come from regions of a document not yet represented.
 * Returns 0..1 where 1 = maximally diverse placement.
 */
function computeRegionDiversity(
  docId: string,
  chunkIndex: number,
  state: SelectionState,
): number {
  const existing = state.docIndices.get(docId);
  if (!existing || existing.length === 0) return 1; // New document = max diversity

  // Find minimum distance to any already-selected chunk from same document
  let minDist = Infinity;
  for (const idx of existing) {
    const d = Math.abs(chunkIndex - idx);
    if (d < minDist) minDist = d;
  }

  if (minDist <= ADJACENT_WINDOW) {
    // Very close = low diversity (but not hard-skipped; scoring handles it)
    return 0.1;
  }

  // Scale linearly up to IDEAL_REGION_SPACING
  return Math.min(1, minDist / IDEAL_REGION_SPACING);
}

/**
 * Compute the dynamic composite score for a candidate chunk.
 * Now includes evidence usefulness as a weighted signal.
 */
function scoreCandidate(
  chunk: MergedChunk,
  candidateTokens: Set<string>,
  state: SelectionState,
  maxSimilarity: number,
): number {
  // Normalize similarity to 0..1 range relative to the best candidate
  const simNorm = maxSimilarity > 0 ? chunk.similarity / maxSimilarity : 0;

  const novelty = computeNovelty(candidateTokens, state);
  const coverage = computeCoverageGain(chunk.query_indices, state);
  const diversity = computeRegionDiversity(chunk.document_id, chunk.chunk_index, state);
  const usefulness = chunk.evidence_usefulness;

  return (
    W_SIMILARITY * simNorm +
    W_NOVELTY * novelty +
    W_COVERAGE * coverage +
    W_DIVERSITY * diversity +
    W_USEFULNESS * usefulness
  );
}

/**
 * Add a chunk to the selection state.
 */
function addToState(chunk: MergedChunk, tokens: Set<string>, state: SelectionState): void {
  state.selected.push(chunk);
  state.selectedTokenSets.push(tokens);

  // Update union tokens
  for (const t of tokens) {
    state.unionTokens.add(t);
  }

  // Update doc indices
  const docIdx = state.docIndices.get(chunk.document_id) ?? [];
  docIdx.push(chunk.chunk_index);
  state.docIndices.set(chunk.document_id, docIdx);

  // Update doc count
  state.docCount.set(chunk.document_id, (state.docCount.get(chunk.document_id) ?? 0) + 1);

  // Update query coverage
  for (const qi of chunk.query_indices) {
    state.queryCoverage.set(qi, (state.queryCoverage.get(qi) ?? 0) + 1);
  }
}

/**
 * Windowed greedy selector.
 *
 * Candidates arrive sorted by base cosine similarity descending.
 * At each iteration, we look at the next GREEDY_WINDOW unseen candidates,
 * compute their dynamic scores against the current selected set,
 * pick the best one, and continue.
 *
 * This lets the algorithm skip locally-redundant high-similarity clusters
 * and reach deeper into the candidate stream for diverse, high-value chunks.
 */
function greedySelect(
  candidates: MergedChunk[],
  maxTotal: number,
  totalQueries: number,
  scope?: string | null,
): { selected: MergedChunk[]; diagnostics: SelectionDiagnostics } {
  // --- Low-information chunk filtering ---
  let filteredLowInfo = 0;
  const qualityCandidates: MergedChunk[] = [];
  for (const c of candidates) {
    const iq = computeInfoQuality(c.content);
    if (iq < INFO_QUALITY_EXCLUDE) {
      filteredLowInfo++;
      continue;
    }
    // Compute evidence usefulness for each candidate
    const usefulness = computeEvidenceUsefulness(c.content, scope);
    const enriched = { ...c, evidence_usefulness: usefulness };

    // Apply a similarity penalty for borderline info-quality chunks
    if (iq < INFO_QUALITY_PENALTY_THRESHOLD) {
      qualityCandidates.push({ ...enriched, similarity: enriched.similarity * iq });
    } else {
      qualityCandidates.push(enriched);
    }
  }
  if (filteredLowInfo > 0) {
    console.log(`[compile-policy-pack] Filtered ${filteredLowInfo} low-information chunks`);
  }

  // Sort by similarity descending as the base ordering
  const sorted = [...qualityCandidates].sort((a, b) => b.similarity - a.similarity);
  const maxSimilarity = sorted.length > 0 ? sorted[0].similarity : 1;

  const state = initState(totalQueries);

  const diag: SelectionDiagnostics = {
    total_raw_matches: 0, // filled by caller
    unique_after_id_dedupe: candidates.length,
    filtered_low_info: filteredLowInfo,
    final_selected: 0,
    hard_skipped_jaccard: 0,
    hard_skipped_containment: 0,
    hard_skipped_doc_cap: 0,
    documents_represented: 0,
    queries_covered: 0,
    queries_total: totalQueries,
    avg_similarity: 0,
    avg_evidence_usefulness: 0,
    usefulness_distribution: { high: 0, medium: 0, low: 0 },
  };

  // Pre-tokenize all candidates (one-time cost)
  const tokenCache = new Map<string, Set<string>>();
  for (const c of sorted) {
    tokenCache.set(c.chunk_id, tokenize(c.content));
  }

  // Track which candidates have been consumed (selected or hard-skipped)
  const consumed = new Set<string>();
  // Pointer into the sorted array
  let pointer = 0;

  while (state.selected.length < maxTotal) {
    // Gather next window of unconsumed candidates
    const window: MergedChunk[] = [];
    let scan = pointer;
    while (window.length < GREEDY_WINDOW && scan < sorted.length) {
      const c = sorted[scan];
      if (!consumed.has(c.chunk_id)) {
        window.push(c);
      }
      scan++;
    }

    if (window.length === 0) break; // Exhausted all candidates

    // Evaluate each candidate in the window
    let bestScore = -Infinity;
    let bestIdx = -1;
    let bestTokens: Set<string> | null = null;
    const hardSkipped: string[] = [];

    for (let i = 0; i < window.length; i++) {
      const chunk = window[i];
      const tokens = tokenCache.get(chunk.chunk_id)!;

      // Hard skip: document safety cap
      const docCnt = state.docCount.get(chunk.document_id) ?? 0;
      if (docCnt >= DOC_SAFETY_CAP) {
        hardSkipped.push(chunk.chunk_id);
        diag.hard_skipped_doc_cap++;
        continue;
      }

      // Hard skip: near-duplicate (Jaccard)
      let isNearDupe = false;
      for (const existing of state.selectedTokenSets) {
        if (jaccardSimilarity(tokens, existing) >= JACCARD_HARD_SKIP) {
          isNearDupe = true;
          break;
        }
      }
      if (isNearDupe) {
        hardSkipped.push(chunk.chunk_id);
        diag.hard_skipped_jaccard++;
        continue;
      }

      // Hard skip: containment
      if (state.selected.length > 0 && containmentRatio(tokens, state.unionTokens) >= CONTAINMENT_HARD_SKIP) {
        hardSkipped.push(chunk.chunk_id);
        diag.hard_skipped_containment++;
        continue;
      }

      // Compute dynamic score (now includes evidence usefulness)
      const score = scoreCandidate(chunk, tokens, state, maxSimilarity);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
        bestTokens = tokens;
      }
    }

    // Mark hard-skipped candidates as consumed
    for (const id of hardSkipped) {
      consumed.add(id);
    }

    if (bestIdx === -1) {
      // All candidates in this window were hard-skipped; advance pointer and retry
      pointer = scan;
      continue;
    }

    // Add best candidate to selection
    const chosen = window[bestIdx];
    addToState(chosen, bestTokens!, state);
    consumed.add(chosen.chunk_id);

    // Advance pointer past consumed candidates at the front
    while (pointer < sorted.length && consumed.has(sorted[pointer].chunk_id)) {
      pointer++;
    }
  }

  // Compute diagnostics
  diag.final_selected = state.selected.length;
  diag.documents_represented = state.docIndices.size;
  diag.queries_covered = state.queryCoverage.size;

  if (state.selected.length > 0) {
    let simSum = 0;
    let usefulnessSum = 0;
    for (const c of state.selected) {
      simSum += c.similarity;
      usefulnessSum += c.evidence_usefulness;
      // Classify usefulness tier
      if (c.evidence_usefulness >= 0.6) (diag as any).usefulness_distribution.high++;
      else if (c.evidence_usefulness >= 0.4) (diag as any).usefulness_distribution.medium++;
      else (diag as any).usefulness_distribution.low++;
    }
    diag.avg_similarity = parseFloat((simSum / state.selected.length).toFixed(4));
    (diag as any).avg_evidence_usefulness = parseFloat((usefulnessSum / state.selected.length).toFixed(4));
  }

  // Log per-chunk diagnostics for the selected set
  const chunkDiagnostics = state.selected.map((c, idx) => ({
    rank: idx + 1,
    chunk_id: c.chunk_id.slice(0, 8),
    doc_id: c.document_id.slice(0, 8),
    chunk_index: c.chunk_index,
    similarity: parseFloat(c.similarity.toFixed(4)),
    usefulness: c.evidence_usefulness,
    content_preview: c.content.slice(0, 120).replace(/\n/g, " "),
  }));
  console.log("[compile-policy-pack] Selected chunks detail:", JSON.stringify(chunkDiagnostics));

  console.log("[compile-policy-pack] Greedy selection diagnostics:", JSON.stringify(diag));

  return { selected: state.selected, diagnostics: diag };
}

/* ── Embedding helper ── */

async function embed(
  text: string,
  apiKey: string,
  model: string,
): Promise<number[]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, input: text }),
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

/* ── Main handler ── */

Deno.serve(async (req) => {
  _corsHeaders = buildCorsSecurityHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: _corsHeaders });
  if (req.method !== "POST") return json(405, { success: false, error: "Method not allowed" });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) return json(500, { success: false, error: "OPENAI_API_KEY not configured" });
  const EMBEDDING_MODEL = Deno.env.get("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small";

  let payload: CompileRequest;
  try {
    payload = await req.json();
  } catch {
    return json(400, { success: false, error: "Invalid JSON body" });
  }

  const {
    session_id,
    template_id,
    guardrails = {},
    per_query_limit = 30,
    min_similarity = 0.28,
    max_total_chunks: requested_max_total_chunks = 250,
  } = payload;

  const max_total_chunks = Math.min(
    Math.max(1, requested_max_total_chunks),
    HARD_MAX_TOTAL_CHUNKS,
  );

  if (!session_id) return json(400, { success: false, error: "session_id is required" });
  if (!template_id) return json(400, { success: false, error: "template_id is required" });

  let retrieval_run_id: string | null = null;

  try {
    // 1. Load session
    const { data: session, error: sessErr } = await supabase
      .from("sessions")
      .select("id, tenant_id, status, guidance_scope, guidance_scope_other")
      .eq("id", session_id)
      .maybeSingle();

    if (sessErr) throw new Error(`Failed to fetch session: ${sessErr.message}`);
    if (!session) return json(404, { success: false, error: "Session not found" });

    const { tenant_id } = session;
    const sessionScope: string | null = session.guidance_scope ?? null;
    console.log(`[compile-policy-pack] Session scope: ${sessionScope ?? "none"}`);


    // 2. Load template (tenant-scoped with global fallback)
    const { data: tenantTemplate, error: tmplErr1 } = await supabase
      .from("kb_templates")
      .select("id, content")
      .eq("id", template_id)
      .eq("tenant_id", tenant_id)
      .maybeSingle();

    if (tmplErr1) throw new Error(`Failed to fetch template: ${tmplErr1.message}`);

    let template = tenantTemplate;
    if (!template) {
      const { data: globalTemplate, error: tmplErr2 } = await supabase
        .from("kb_templates")
        .select("id, content")
        .eq("id", template_id)
        .is("tenant_id", null)
        .maybeSingle();

      if (tmplErr2) throw new Error(`Failed to fetch global template: ${tmplErr2.message}`);
      template = globalTemplate;
    }

    if (!template) return json(404, { success: false, error: "Template not found" });
    if (!template.content || template.content.trim().length === 0) {
      return json(409, { success: false, error: "Template content is empty" });
    }

    // 3. Update session status to guidance_generating
    const { error: statusErr } = await supabase
      .from("sessions")
      .update({ status: "guidance_generating" })
      .eq("id", session_id);

    if (statusErr) throw new Error(`Failed to update session status: ${statusErr.message}`);

    try {
      await logEyeEvent(supabase, {
        session_id,
        event_type: "POLICY_PACK_COMPILATION_STARTED",
        serviceName: "compile-policy-pack",
        payload: { tenant_id, template_id, guardrails },
      });
    } catch (err) {
      console.error("Eye event failed:", err);
    }

    // 4. Insert retrieval_runs row with status='started'
    const { data: runRow, error: runInsertErr } = await supabase
      .from("retrieval_runs")
      .insert({
        tenant_id,
        session_id,
        template_id,
        guardrails,
        params: { per_query_limit, min_similarity, max_total_chunks },
        status: "started",
      })
      .select("id")
      .single();

    if (runInsertErr) throw new Error(`Failed to insert retrieval_run: ${runInsertErr.message}`);
    retrieval_run_id = runRow.id;

    // 5. Generate scope-aware retrieval queries from template sections
    const sections = chunkTemplate(template.content);

    // Diagnostics: log scope influence per section
    const sectionDiagnostics = sections.map((s, i) => {
      const specificity = computeSectionSpecificity(s);
      const scopeInfluence = sessionScope
        ? specificity <= 0.3 ? "strong" : specificity <= 0.6 ? "moderate" : "light"
        : "none";
      return { section: i, specificity: parseFloat(specificity.toFixed(2)), scopeInfluence };
    });
    console.log(`[compile-policy-pack] Scope-aware retrieval diagnostics:`, JSON.stringify({
      scope: sessionScope,
      sections: sectionDiagnostics,
    }));

    const queries = sections.map((s) => buildRetrievalQuery(s, guardrails, sessionScope));

    // 6. Embed + retrieve per query, merge results by chunk_id
    const chunkMap = new Map<string, MergedChunk>();
    let totalRawMatches = 0;

    for (let qi = 0; qi < queries.length; qi++) {
      const vec = await embed(queries[qi], OPENAI_API_KEY, EMBEDDING_MODEL);

      const { data: matches, error: rpcErr } = await supabase.rpc(
        "match_document_chunks",
        {
          p_tenant_id: tenant_id,
          p_query_embedding: vec,
          p_match_count: per_query_limit,
          p_min_similarity: min_similarity,
        },
      );

      if (rpcErr) throw new Error(`RPC match_document_chunks failed (query ${qi}): ${rpcErr.message}`);

      for (const m of matches ?? []) {
        totalRawMatches++;
        if (
          m.id == null ||
          m.document_id == null ||
          m.chunk_index == null ||
          m.similarity == null
        ) {
          throw new Error(
            "RPC match_document_chunks returned unexpected shape. Expected fields: id, document_id, chunk_index, similarity",
          );
        }

        const existing = chunkMap.get(m.id);
        if (existing) {
          if (m.similarity > existing.similarity) {
            existing.similarity = m.similarity;
          }
          existing.query_indices.push(qi);
        } else {
          chunkMap.set(m.id, {
            chunk_id: m.id,
            document_id: m.document_id,
            chunk_index: m.chunk_index,
            similarity: m.similarity,
            content: m.content ?? "",
            metadata: m.metadata ?? {},
            query_indices: [qi],
            evidence_usefulness: 0, // computed later in greedySelect
          });
        }
      }
    }

    // 7. Greedy diversity-aware chunk selection (now scope-aware for usefulness scoring)
    const { selected: merged, diagnostics } = greedySelect(
      [...chunkMap.values()],
      max_total_chunks,
      queries.length,
      sessionScope,
    );
    diagnostics.total_raw_matches = totalRawMatches;
    console.log("[compile-policy-pack] Final diagnostics (with raw count):", JSON.stringify(diagnostics));

    // 8. Update retrieval_runs with results
    const { error: runUpdateErr } = await supabase
      .from("retrieval_runs")
      .update({
        query_count: queries.length,
        selected_chunk_count: merged.length,
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", retrieval_run_id);

    if (runUpdateErr) throw new Error(`Failed to update retrieval_run: ${runUpdateErr.message}`);

    // 9. Insert compiled_policy_pack
    const { data: packRow, error: packErr } = await supabase
      .from("compiled_policy_packs")
      .insert({
        tenant_id,
        session_id,
        template_id,
        retrieval_run_id,
        status: "compiled",
        metadata: {
          total_queries: queries.length,
          selected_chunk_count: merged.length,
          selection_diagnostics: diagnostics,
          scope_used: sessionScope,
          per_chunk_usefulness: merged.map((c, i) => ({
            rank: i + 1,
            doc_id: c.document_id.slice(0, 8),
            chunk_index: c.chunk_index,
            similarity: parseFloat(c.similarity.toFixed(4)),
            usefulness: c.evidence_usefulness,
          })),
        },
      })
      .select("id")
      .single();

    if (packErr) throw new Error(`Failed to insert compiled_policy_pack: ${packErr.message}`);
    const compiled_policy_pack_id = packRow.id;

    // 9b. Update session with policy_pack_id
    const { error: sessionUpdateErr } = await supabase
      .from("sessions")
      .update({ policy_pack_id: compiled_policy_pack_id })
      .eq("id", session_id);

    if (sessionUpdateErr) {
      throw new Error(
        `Failed to update session with policy_pack_id: ${sessionUpdateErr.message}`
      );
    }

    // 10. Insert compiled_policy_pack_chunks in batches
    const chunkRows = merged.map((c, idx) => ({
      compiled_policy_pack_id,
      tenant_id,
      document_id: c.document_id,
      chunk_id: c.chunk_id,
      chunk_index: c.chunk_index,
      similarity: c.similarity,
      rank: idx + 1,
      metadata: {
        query_indices: c.query_indices,
        evidence_usefulness: c.evidence_usefulness,
        interviewability: computeInterviewability(c.content),
      },
    }));

    const BATCH_SIZE = 50;
    for (let i = 0; i < chunkRows.length; i += BATCH_SIZE) {
      const batch = chunkRows.slice(i, i + BATCH_SIZE);
      const { error: insertErr } = await supabase
        .from("compiled_policy_pack_chunks")
        .insert(batch);
      if (insertErr) {
        throw new Error(`Failed to insert pack chunks at index ${i}: ${insertErr.message}`);
      }
    }

    // 11. Log completion
    try {
      await logEyeEvent(supabase, {
        session_id,
        event_type: "POLICY_PACK_COMPILATION_COMPLETED",
        serviceName: "compile-policy-pack",
        payload: { compiled_policy_pack_id, retrieval_run_id, query_count: queries.length, selected_chunk_count: merged.length },
      });
    } catch (err) {
      console.error("Eye event failed:", err);
    }

    // 12. Build preview (max 240 chars, never full content)
    const top_chunks_preview = merged.slice(0, 5).map((c) => ({
      document_id: c.document_id,
      chunk_index: c.chunk_index,
      similarity: c.similarity,
      content_preview: c.content.slice(0, 240),
    }));

    return json(200, {
      success: true,
      compiled_policy_pack_id,
      retrieval_run_id,
      query_count: queries.length,
      selected_chunk_count: merged.length,
      selection_diagnostics: diagnostics,
      top_chunks_preview,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[compile-policy-pack] error:", message);

    // Mark retrieval_run as failed if it was created
    if (retrieval_run_id) {
      try {
        await supabase
          .from("retrieval_runs")
          .update({ status: "failed", error: message, completed_at: new Date().toISOString() })
          .eq("id", retrieval_run_id);
      } catch (_) {
        // best-effort
      }
    }

    try {
      await logEyeEvent(supabase, {
        session_id: session_id!,
        event_type: "POLICY_PACK_COMPILATION_FAILED",
        serviceName: "compile-policy-pack",
        payload: { reason_code: message },
      });
    } catch (_) {
      // never fail due to logging
    }
    return json(500, { success: false, error: message });
  }
});
