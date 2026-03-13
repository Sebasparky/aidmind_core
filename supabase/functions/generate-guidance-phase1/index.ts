import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import OpenAI from "https://esm.sh/openai@4.28.0";
import { logEyeEvent } from "../_shared/eye.ts";
import { buildCorsSecurityHeaders } from "../_shared/security-headers.ts";
import { validateUuid } from "../_shared/input-validation.ts";

const openai = new OpenAI({
  apiKey: Deno.env.get("OPENAI_API_KEY")!,
});

// Dynamic CORS headers — set per-request so the helper can read the Origin
let _corsHeaders: Record<string, string> = {};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ..._corsHeaders, "Content-Type": "application/json" },
  });
}

function extractJSON(text: string) {
  const cleaned = text
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON found in model output");
  return JSON.parse(match[0]);
}

/* ── Support-strength validation ── */

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

const GENERIC_WORDS = new Set([
  "what",
  "when",
  "where",
  "which",
  "does",
  "have",
  "been",
  "this",
  "that",
  "with",
  "from",
  "your",
  "about",
  "into",
  "they",
  "their",
  "there",
  "were",
  "will",
  "would",
  "could",
  "should",
  "other",
  "first",
  "last",
  "most",
  "more",
  "than",
  "each",
  "some",
  "also",
  "currently",
  "specific",
  "please",
  "describe",
  "explain",
  "provide",
  "information",
  "details",
  "related",
  "involved",
  "during",
  "before",
  "after",
  "between",
  "through",
  "under",
]);

/**
 * Naive suffix-based stemming for better paraphrase matching.
 * Strips common English suffixes so "homeless"/"homelessness",
 * "injury"/"injured"/"injuries", "eviction"/"evicting" match.
 */
function naiveStem(word: string): string {
  if (word.length <= 4) return word;
  return word
    .replace(/ness$/, "")
    .replace(/ment$/, "")
    .replace(/tion$/, "")
    .replace(/sion$/, "")
    .replace(/ies$/, "y")
    .replace(/ive$/, "")
    .replace(/ing$/, "")
    .replace(/ous$/, "")
    .replace(/ful$/, "")
    .replace(/able$/, "")
    .replace(/ible$/, "")
    .replace(/ity$/, "")
    .replace(/ally$/, "")
    .replace(/ed$/, "")
    .replace(/er$/, "")
    .replace(/ly$/, "")
    .replace(/es$/, "")
    .replace(/s$/, "");
}

type DropReason =
  | "no_snippet_text"
  | "snippet_too_short"
  | "low_info_phrases"
  | "weak_structural_support"
  | "weak_topical_overlap"
  | "unsupported_question_concepts"
  | "internal_worker_prompt"
  | "documentation_only_source"
  | "policy_jargon_not_transformed"
  | "classification_or_justification_prompt"
  | "specificity_lost";

type ValidationSeverity = "pass" | "soft_fail" | "hard_fail";

interface ValidationSignal {
  severity: ValidationSeverity;
  reason?: DropReason;
  details?: Record<string, unknown>;
}

type ReviewFlag =
  | "specificity_soft_fail"
  | "weak_support_soft_fail"
  | "broad_paraphrase"
  | "partial_qualifier_loss"
  | "low_overlap_but_high_quality_source";

/** Final outcome for each question (3-tier) */
type QuestionOutcome = "pass" | "warning" | "dropped_hard";

/** Per-question diagnostic trace */
interface QuestionTrace {
  original_question: string;
  support_result: { supported: boolean; reason?: string; details?: Record<string, unknown> };
  style_result: { clientFacing: boolean; reason?: string; details?: Record<string, unknown> };
  specificity_result: {
    preserved: boolean;
    score: number;
    lost_qualifiers: string[];
    concept_family: string;
    considered: string[];
    ignored: string[];
  };
  final_outcome: QuestionOutcome;
}

/**
 * Compute structural quality of a snippet (aligned with compile-time computeInfoQuality).
 * Returns 0..1 where 0 = structural junk, 1 = substantive prose.
 */
function computeSnippetSupportQuality(text: string): number {
  if (!text || text.trim().length === 0) return 0;

  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  // Known low-info phrases → immediate low score
  for (const phrase of LOW_INFO_PHRASES) {
    if (lower.includes(phrase)) return 0.05;
  }

  const lines = trimmed
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return 0;

  const headingPattern = /^(\d+[\.\d]*\s|[-•]\s|[A-Z][A-Z\s]{2,}$|#{1,6}\s|section\s+\d)/i;
  let headingLines = 0;
  let shortLines = 0;
  let proseLines = 0;

  for (const line of lines) {
    if (headingPattern.test(line)) headingLines++;
    if (line.length < 40) shortLines++;
    if (line.length > 50 && /[.,;:?!]/.test(line)) proseLines++;
  }

  const headingRatio = headingLines / lines.length;
  const shortRatio = shortLines / lines.length;
  const proseRatio = proseLines / lines.length;

  // Mostly headings/section labels
  if (headingRatio > 0.5 && proseRatio < 0.15) return 0.1;
  // Mostly short lines with no prose
  if (shortRatio > 0.7 && proseRatio < 0.1) return 0.15;
  // Many lines but virtually no prose sentences
  if (lines.length > 5 && proseRatio < 0.08) return 0.2;
  // Very short total
  if (trimmed.length < 100) return 0.25;
  // Low prose
  if (proseRatio < 0.2) return 0.5;

  return 1.0;
}

// Threshold: snippets below this are "structurally weak"
const SNIPPET_QUALITY_THRESHOLD = 0.3;

/**
 * Extract meaningful (non-generic) terms from text, with naive stemming
 * for better paraphrase recognition.
 */
function extractMeaningfulTerms(text: string): string[] {
  const raw = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !GENERIC_WORDS.has(w));
  return raw.map(naiveStem);
}

/**
 * Extract meaningful terms WITHOUT stemming (for checking exact qualifier presence).
 */
function extractRawTerms(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !GENERIC_WORDS.has(w)),
  );
}

/**
 * Multi-gate support-strength validator with hard/soft hierarchy.
 */
function validateQuestionSupport(
  question: string,
  citedSnippetTexts: string[],
): { supported: boolean; reason?: DropReason; details?: Record<string, unknown> } {
  // ── HARD GATE 1: no snippets at all ──
  if (citedSnippetTexts.length === 0) {
    return { supported: false, reason: "no_snippet_text" };
  }

  const combinedText = citedSnippetTexts.join(" ");
  const combinedLen = combinedText.replace(/\s+/g, " ").trim().length;

  // ── HARD GATE 2: combined text too short ──
  if (combinedLen < 80) {
    return { supported: false, reason: "snippet_too_short", details: { combinedLen } };
  }

  // ── HARD GATE 3: structural quality check ──
  const qualities = citedSnippetTexts.map(computeSnippetSupportQuality);
  const avgQuality = qualities.reduce((a, b) => a + b, 0) / qualities.length;
  const maxQuality = Math.max(...qualities);

  if (maxQuality < SNIPPET_QUALITY_THRESHOLD) {
    return {
      supported: false,
      reason: "weak_structural_support",
      details: { avgQuality: +avgQuality.toFixed(2), maxQuality: +maxQuality.toFixed(2) },
    };
  }

  // ── SOFT GATES: concept coverage + topical overlap ──
  const questionTerms = extractMeaningfulTerms(question);
  const snippetTermSet = new Set(extractMeaningfulTerms(combinedText));

  if (questionTerms.length < 3) {
    return { supported: true };
  }

  let matched = 0;
  const unmatched: string[] = [];
  for (const term of questionTerms) {
    if (snippetTermSet.has(term)) {
      matched++;
    } else {
      unmatched.push(term);
    }
  }
  const coverageRatio = matched / questionTerms.length;

  const isHighQuality = maxQuality >= 0.8 && avgQuality >= 0.6;
  const isMediumQuality = maxQuality >= 0.5;

  const conceptCoverageThreshold = isHighQuality ? 0.1 : isMediumQuality ? 0.15 : 0.2;
  const conceptFailed = coverageRatio < conceptCoverageThreshold;

  const overlapThreshold = isHighQuality ? 0.08 : isMediumQuality ? 0.12 : 0.18;
  const overlapFailed = coverageRatio < overlapThreshold;

  if (isHighQuality) {
    if (conceptFailed && overlapFailed) {
      return {
        supported: false,
        reason: "unsupported_question_concepts",
        details: {
          coverageRatio: +coverageRatio.toFixed(2),
          qualityTier: "high",
          questionTermCount: questionTerms.length,
          matchedCount: matched,
          sampleUnmatched: unmatched.slice(0, 5),
        },
      };
    }
    return { supported: true };
  }

  if (isMediumQuality) {
    if (coverageRatio < 0.12) {
      return {
        supported: false,
        reason: "unsupported_question_concepts",
        details: {
          coverageRatio: +coverageRatio.toFixed(2),
          qualityTier: "medium",
          questionTermCount: questionTerms.length,
          matchedCount: matched,
          sampleUnmatched: unmatched.slice(0, 5),
        },
      };
    }
    return { supported: true };
  }

  // Low quality (but above hard gate 3): stricter soft checks
  if (conceptFailed) {
    return {
      supported: false,
      reason: "unsupported_question_concepts",
      details: {
        coverageRatio: +coverageRatio.toFixed(2),
        qualityTier: "low",
        questionTermCount: questionTerms.length,
        matchedCount: matched,
        sampleUnmatched: unmatched.slice(0, 5),
      },
    };
  }

  if (overlapFailed) {
    return {
      supported: false,
      reason: "weak_topical_overlap",
      details: {
        overlapRatio: +coverageRatio.toFixed(2),
        qualityTier: "low",
        avgSnippetQuality: +avgQuality.toFixed(2),
      },
    };
  }

  return { supported: true };
}

/* ── Client-facing question style validator ── */

const INTERNAL_WORKER_PATTERNS: RegExp[] = [
  /what\s+(were|are)\s+the\s+reasons?\s+for\s+(not\s+)?using/i,
  /why\s+(were|was|are|is)\s+responses?\s+\d/i,
  /what\s+narrative\s+is\s+required/i,
  /what\s+should\s+(the\s+)?(case\s*)?worker\s+(explain|document|record|note)/i,
  /what\s+must\s+(be\s+)?documented/i,
  /what\s+category\s+must\s+(the\s+)?case\s+be\s+classified/i,
  /does\s+the\s+record\s+indicate/i,
  /what\s+(case\s+)?coding\s+is\s+required/i,
  /what\s+justification\s+must\s+(be\s+)?provided/i,
  /how\s+should\s+(the\s+)?(case\s*)?manager\s+(explain|justify|document)/i,
  /what\s+(internal\s+)?review\s+is\s+required/i,
  /what\s+supervisory\s+approval\s+is\s+needed/i,
  /what\s+compliance\s+(steps?|requirements?)\s+(are|must)/i,
  /which\s+response\s+option\s+(was|should\s+be)\s+selected/i,
  /what\s+(legal\s+)?basis\s+(was|is)\s+used\s+for/i,
];

const INTERNAL_LANGUAGE_PHRASES: string[] = [
  "must be documented",
  "case record",
  "narrative requirement",
  "case classification",
  "response option",
  "supervisory review",
  "case manager must",
  "worker must explain",
  "coding",
  "legal basis for",
  "compliance requirement",
  "approval is needed",
  "override reason",
  "disposition",
  "substantiation",
  "case finding",
  "administrative review",
];

const DOCUMENTATION_ONLY_SNIPPET_PHRASES: string[] = [
  "the case manager must document",
  "the worker shall explain in the narrative",
  "must be recorded in the case record",
  "document the reasons for",
  "provide justification for",
  "case must be classified as",
  "the record must reflect",
  "narrative must include",
  "the worker must explain why",
  "document why responses 1 through",
  "override must be approved",
  "supervisory approval is required",
  "complete the following form",
  "enter the appropriate code",
  "select the response that",
];

function validateClientFacingStyle(
  question: string,
  citedSnippetTexts: string[],
): { clientFacing: boolean; reason?: DropReason; details?: Record<string, unknown> } {
  const qLower = question.toLowerCase();
  const combinedSnippets = citedSnippetTexts.join(" ").toLowerCase();

  // ── Check 1: Question matches internal worker patterns ──
  for (const pattern of INTERNAL_WORKER_PATTERNS) {
    if (pattern.test(qLower)) {
      return {
        clientFacing: false,
        reason: "internal_worker_prompt",
        details: { matched_pattern: pattern.source.slice(0, 60) },
      };
    }
  }

  // ── Check 2: Question contains multiple internal language phrases ──
  let internalPhraseHits = 0;
  const matchedPhrases: string[] = [];
  for (const phrase of INTERNAL_LANGUAGE_PHRASES) {
    if (qLower.includes(phrase)) {
      internalPhraseHits++;
      matchedPhrases.push(phrase);
    }
  }
  if (internalPhraseHits >= 2) {
    return {
      clientFacing: false,
      reason: "internal_worker_prompt",
      details: { internal_phrase_hits: internalPhraseHits, matched: matchedPhrases },
    };
  }

  // ── Check 3: Cited snippets are predominantly documentation-only ──
  let docOnlyHits = 0;
  for (const phrase of DOCUMENTATION_ONLY_SNIPPET_PHRASES) {
    if (combinedSnippets.includes(phrase)) docOnlyHits++;
  }
  if (docOnlyHits >= 2 && internalPhraseHits >= 1) {
    return {
      clientFacing: false,
      reason: "documentation_only_source",
      details: { doc_only_hits: docOnlyHits, internal_phrase_hits: internalPhraseHits },
    };
  }
  if (docOnlyHits >= 3) {
    return {
      clientFacing: false,
      reason: "documentation_only_source",
      details: { doc_only_hits: docOnlyHits },
    };
  }

  // ── Check 4: Policy jargon not transformed ──
  const JARGON_PATTERNS: RegExp[] = [
    /\brequire\s+protective\s+interventions?\b/i,
    /\bdisposition\s+(category|finding|determination)\b/i,
    /\bcase\s+(classification|coding|finding)\b/i,
    /\bstatutory\s+(requirements?|authority|basis)\b/i,
    /\bpursuant\s+to\s+(section|chapter|statute|rule)\b/i,
    /\badjudication\b/i,
    /\bsubstantiat(e|ion|ed)\b/i,
  ];
  let jargonHits = 0;
  for (const p of JARGON_PATTERNS) {
    if (p.test(qLower)) jargonHits++;
  }
  if (jargonHits >= 2) {
    return {
      clientFacing: false,
      reason: "policy_jargon_not_transformed",
      details: { jargon_hits: jargonHits },
    };
  }

  // ── Check 5: Classification/justification prompt ──
  const CLASSIFICATION_PATTERNS: RegExp[] = [
    /what\s+(type|level|category|tier)\s+of\s+(response|intervention|action)\s+(was|is|should)\b/i,
    /what\s+were\s+the\s+reasons\s+for\s+not\b/i,
    /why\s+(was|were)\s+(legal\s+action|court\s+intervention|removal)/i,
    /what\s+(alternative|other)\s+responses?\s+(were|was)\s+(considered|explored|attempted)\b/i,
  ];
  for (const p of CLASSIFICATION_PATTERNS) {
    if (p.test(qLower)) {
      if (
        docOnlyHits >= 1 ||
        combinedSnippets.includes("reasons for not using") ||
        combinedSnippets.includes("must explain why") ||
        combinedSnippets.includes("justify")
      ) {
        return {
          clientFacing: false,
          reason: "classification_or_justification_prompt",
          details: { matched_classification: true, doc_only_hits: docOnlyHits },
        };
      }
    }
  }

  return { clientFacing: true };
}

/* ── Concept-family classification for concept-scoped specificity ── */

type ConceptFamily =
  | "substance_use"
  | "housing_instability"
  | "unsafe_housing_conditions"
  | "caregiver_capacity"
  | "injury_severity"
  | "immediate_safety_resources"
  | "general_safety"
  | "prior_history"
  | "other";

function classifyQuestionConcept(question: string): ConceptFamily {
  const q = question.toLowerCase();
  if (/\b(substance|drug|alcohol|addiction|intoxicat|sober|sobriety|drinking|using)\b/.test(q)) return "substance_use";
  if (/\b(homeless|homelessness|eviction|evicted|facing\s+eviction|unhoused|shelter)\b/.test(q))
    return "housing_instability";
  if (/\b(physically\s+unsafe|unsafe\s+housing|unsafe.*\bhome|housing.*\bunsafe|structurally\s+unsound)\b/.test(q))
    return "unsafe_housing_conditions";
  if (/\b(ability|able|unable|capable|capacity)\b.{0,30}\b(protect|supervis|care|nurtur|provide|parent)/i.test(q))
    return "caregiver_capacity";
  if (/\b(injur|harm|wound|bruise|fracture|burn|most\s+serious)\b/.test(q)) return "injury_severity";
  if (/\bimmediate\s+safety\s+resource/.test(q) || /\bcommunity\s+service.*\bsafety\s+resource/.test(q))
    return "immediate_safety_resources";
  if (/\b(prior|previous|past)\b.{0,20}\b(report|referral|involvement|history)\b/.test(q)) return "prior_history";
  if (/\b(safe|danger|risk|threat|concern|protective)\b/.test(q)) return "general_safety";
  return "other";
}

/** Which concept families each qualifier is relevant to */
const QUALIFIER_CONCEPT_RELEVANCE: Record<string, ConceptFamily[]> = {
  time_window: ["substance_use", "prior_history"],
  immediate_safety: ["general_safety", "immediate_safety_resources"],
  imminent_risk: ["general_safety", "injury_severity"],
  severity_most_serious: ["injury_severity"],
  purpose_immediate_safety_resources: ["immediate_safety_resources"],
  caregiver_capacity: ["caregiver_capacity", "substance_use"],
  physically_unsafe: ["unsafe_housing_conditions"],
  homeless_or_eviction: ["housing_instability"],
  facing_eviction: ["housing_instability"],
  prior_reports: ["prior_history", "general_safety"],
  medication_assisted_treatment: ["substance_use"],
};

/* ── Specificity-preservation validator (concept-scoped) ── */

const IMPORTANT_QUALIFIER_PATTERNS: {
  snippetDetector: RegExp;
  label: string;
  questionCheck: RegExp;
}[] = [
  {
    snippetDetector: /within\s+the\s+past\s+(year|12\s*months|six\s*months|6\s*months)/i,
    label: "time_window",
    questionCheck: /past\s+(year|12\s*months|six\s*months|6\s*months)|within\s+the\s+(past|last)\s+(year|12|six|6)/i,
  },
  {
    snippetDetector: /\bimmediate\s+(safety|risk|danger|threat|concern)/i,
    label: "immediate_safety",
    questionCheck: /\bimmediate\b/i,
  },
  {
    snippetDetector: /\bimminent\s+(harm|danger|risk|threat)/i,
    label: "imminent_risk",
    questionCheck: /\bimminent\b/i,
  },
  {
    snippetDetector: /\bmost\s+serious\s+(injury|harm|concern|incident)/i,
    label: "severity_most_serious",
    questionCheck: /\bmost\s+serious\b/i,
  },
  {
    snippetDetector: /as\s+immediate\s+safety\s+resource/i,
    label: "purpose_immediate_safety_resources",
    questionCheck: /immediate\s+safety\s+resource/i,
  },
  {
    snippetDetector: /\b(ability|unable)\s+to\s+(provide\s+)?(protection|supervision|care|nurturing)/i,
    label: "caregiver_capacity",
    questionCheck: /(ability|able|unable)\s+to\s+(provide\s+)?(protect|supervis|care|nurtur)/i,
  },
  {
    snippetDetector: /\bphysically\s+unsafe\b/i,
    label: "physically_unsafe",
    questionCheck: /\bphysically\s+unsafe\b|not\s+(physically\s+)?safe/i,
  },
  {
    snippetDetector: /\bhomeless\s+(or|and)\s+(facing\s+)?eviction/i,
    label: "homeless_or_eviction",
    questionCheck: /\bhomeless\b.*\beviction\b|\beviction\b.*\bhomeless\b/i,
  },
  {
    snippetDetector: /\bfacing\s+eviction\b/i,
    label: "facing_eviction",
    questionCheck: /\beviction\b/i,
  },
  {
    snippetDetector: /\bprior\s+(reports?|referrals?|involvement)\b/i,
    label: "prior_reports",
    questionCheck: /\bprior\b|\bprevious\b|\bpast\b/i,
  },
  {
    snippetDetector: /\bmedication[\s-]assisted\s+treatment\b/i,
    label: "medication_assisted_treatment",
    questionCheck: /\bmedication[\s-]assisted\b|\bMAT\b/i,
  },
];

interface SpecificityResult {
  preserved: boolean;
  lostQualifiers: { label: string; snippetEvidence: string }[];
  score: number;
  conceptFamily: ConceptFamily;
  consideredQualifiers: string[];
  ignoredQualifiers: string[];
}

function validateSpecificityPreservation(question: string, citedSnippetTexts: string[]): SpecificityResult {
  const combinedSnippet = citedSnippetTexts.join(" ");
  const conceptFamily = classifyQuestionConcept(question);

  // Detect all qualifiers present in the snippet
  const allDetected: { label: string; snippetEvidence: string; preserved: boolean }[] = [];
  for (const pattern of IMPORTANT_QUALIFIER_PATTERNS) {
    const snippetMatch = combinedSnippet.match(pattern.snippetDetector);
    if (snippetMatch) {
      const preserved = pattern.questionCheck.test(question);
      allDetected.push({
        label: pattern.label,
        snippetEvidence: snippetMatch[0].slice(0, 60),
        preserved,
      });
    }
  }

  if (allDetected.length === 0) {
    return {
      preserved: true,
      lostQualifiers: [],
      score: 1.0,
      conceptFamily,
      consideredQualifiers: [],
      ignoredQualifiers: [],
    };
  }

  // Filter to only qualifiers relevant to this question's concept family
  const relevant: typeof allDetected = [];
  const ignored: string[] = [];

  for (const d of allDetected) {
    const families = QUALIFIER_CONCEPT_RELEVANCE[d.label];
    if (families && families.includes(conceptFamily)) {
      relevant.push(d);
    } else if (conceptFamily === "other") {
      // For "other" concept, consider all qualifiers (conservative)
      relevant.push(d);
    } else {
      ignored.push(d.label);
    }
  }

  if (relevant.length === 0) {
    return {
      preserved: true,
      lostQualifiers: [],
      score: 1.0,
      conceptFamily,
      consideredQualifiers: [],
      ignoredQualifiers: ignored,
    };
  }

  const lost = relevant.filter((d) => !d.preserved);
  const score = (relevant.length - lost.length) / relevant.length;

  return {
    preserved: lost.length === 0,
    lostQualifiers: lost.map((l) => ({ label: l.label, snippetEvidence: l.snippetEvidence })),
    score,
    conceptFamily,
    consideredQualifiers: relevant.map((r) => r.label),
    ignoredQualifiers: ignored,
  };
}

/* ── (Rewrite-before-drop layer removed — single-pass validation only) ── */

type GroundingCode = "INSUFFICIENT_GROUNDED_SUPPORT" | "LOW_INFORMATION_POLICY_PACK" | "WEAK_CITATION_SUPPORT";

const MIN_GROUNDED_QUESTIONS = 3;

Deno.serve(async (req) => {
  _corsHeaders = buildCorsSecurityHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: _corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const requestId = crypto.randomUUID();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body", code: "INVALID_JSON" });
  }

  const { session_id } = body;

  if (!session_id) {
    return json(400, { error: "session_id is required", code: "SESSION_ID_REQUIRED" });
  }

  const sessionIdResult = validateUuid("session_id", session_id);
  if (!sessionIdResult.ok) {
    return json(400, { error: "Invalid session_id format", code: "INVALID_SESSION_ID" });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  await logEyeEvent(supabase, {
    session_id: sessionIdResult.value,
    event_type: "tool.run.started",
    serviceName: "generate-guidance-phase1",
    payload: {
      request_id: requestId,
      resource_type: "tool",
      resource_id: "generate_guidance_phase1",
    },
  });

  try {
    // ── 1. Fetch session ──
    const { data: session, error: sessionErr } = await supabase
      .from("sessions")
      .select("id, template_id, tenant_id, status, policy_pack_id, guidance_scope, guidance_scope_other")
      .eq("id", sessionIdResult.value)
      .maybeSingle();

    if (sessionErr) throw new Error(`Failed to fetch session: ${sessionErr.message}`);
    if (!session) return json(404, { error: "Session not found", code: "SESSION_NOT_FOUND" });

    if (!session.template_id) {
      return json(400, {
        error: "template_id missing for session. Select a template first.",
        code: "TEMPLATE_REQUIRED",
      });
    }

    if (!session.guidance_scope) {
      return json(400, {
        error: "guidance_scope missing for session. Set scope at session creation.",
        code: "SCOPE_REQUIRED",
      });
    }

    const templateId: string = session.template_id;
    const guidanceScope: string = session.guidance_scope;
    const guidanceScopeOther: string | null = session.guidance_scope_other;

    // ── 2. Retrieve policy snippets ──
    const snippetResponse = await supabase.rpc("get_policy_snippets_for_session", {
      session_id_input: sessionIdResult.value,
    });

    if (!snippetResponse || snippetResponse.error) {
      throw new Error(`Snippet RPC failed: ${snippetResponse?.error?.message ?? "Unknown RPC error"}`);
    }

    const snippets = snippetResponse.data;

    if (!snippets || snippets.length === 0) {
      return json(500, {
        error: "No policy snippets found for this session. Ensure a policy pack has been compiled.",
        code: "NO_SNIPPETS",
      });
    }

    // ── 2b. Pre-check: is the policy pack mostly low-information? ──
    const snippetMap = new Map<string, string>();
    let lowInfoCount = 0;
    for (const s of snippets) {
      snippetMap.set(s.snippet_id, s.chunk_text);
      const lower = (s.chunk_text || "").toLowerCase();
      const isLowInfo = LOW_INFO_PHRASES.some((p) => lower.includes(p));
      const lines = (s.chunk_text || "")
        .split("\n")
        .map((l: string) => l.trim())
        .filter(Boolean);
      const proseLines = lines.filter((l: string) => l.length > 50 && /[.,;:?!]/.test(l));
      if (isLowInfo || (lines.length > 3 && proseLines.length === 0)) {
        lowInfoCount++;
      }
    }

    if (lowInfoCount > snippets.length * 0.8) {
      console.warn(
        `[generate-guidance-phase1] Policy pack is ${Math.round((lowInfoCount / snippets.length) * 100)}% low-info snippets`,
      );
    }

    // ── 3. Format snippets for LLM ──
    const snippetIdSet = new Set<string>();
    const formatted = snippets
      .map((s: { snippet_id: string; chunk_text: string }) => {
        snippetIdSet.add(s.snippet_id);
        return `Snippet ID: ${s.snippet_id}\nText: ${s.chunk_text}`;
      })
      .join("\n\n");

    // ── 4. Build scope context line ──
    let scopeLine = `Session scope/type: ${guidanceScope}`;
    if (guidanceScope === "other" && guidanceScopeOther) {
      scopeLine += `\nScope details: ${guidanceScopeOther}`;
    }

    // ── 5. Call LLM ──
    const model = "gpt-4o";
    const completion = await openai.chat.completions.create({
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: `
You are assisting a social services caseworker preparing to conduct a structured client interview.

${scopeLine}

You are given policy excerpts that are relevant to the template being completed for this program and jurisdiction.

Your task is to generate UP TO 12 targeted interview questions that the caseworker should ask the client, caregiver, or involved party to gather the factual information needed to complete the template accurately and in compliance with policy.

CRITICAL GROUNDING RULES:

- Only generate a question if the cited policy snippet ACTUALLY SUPPORTS asking it.
- The cited snippet must contain substantive policy text that justifies the question — not just a topically related heading, table of contents entry, or section label.
- Do NOT infer generic intake questions from broad topical relevance alone.
- Do NOT use structural headings, contents pages, index pages, or section listings as support unless they contain substantive guidance text.
- It is ACCEPTABLE and PREFERRED to return fewer than 12 questions if the policy excerpts do not provide sufficient grounding for more.
- Quality and grounding matter more than quantity. 4 well-grounded questions are better than 12 weakly grounded ones.
- If the policy excerpts are too weak, too structural, or too vague to support any meaningful questions, return an empty questions array.

------------------------------------------------------------
CLIENT-FACING QUESTION REQUIREMENT (CRITICAL)

Every question you generate MUST be something a caseworker could realistically ask a client, caregiver, or involved party face-to-face in plain, conversational language.

GOOD source types for question generation:
- Assessment criteria that identify what facts to collect from a client
- Required factual fields (injuries, household members, dates, services)
- Concrete risk/safety indicators that can be asked about directly
- Household, caregiver, or child condition factors
- Service involvement details the client can confirm or describe
- Housing, substance use, safety indicators the client can report on

BAD source types — DO NOT generate questions directly from these unless you can cleanly transform them into a natural client-facing question:
- Internal worker narrative instructions ("the worker must document why...")
- Case classification or coding rules
- Legal justification requirements ("explain why legal action was initiated instead of...")
- "If X, document Y" instructions meant for the worker's record
- Instructions about what the case manager must explain in the case record
- Supervisory review or approval requirements
- Response-option selection guidance ("select response 1-7")
- Administrative compliance or audit requirements

TRANSFORMATION RULE:
If a policy snippet describes what information must be collected (e.g., "the assessment must include safety factors"), you MAY transform that into a natural client-facing question (e.g., "Are there any current safety concerns for the child in the home?").
But do NOT simply mirror policy jargon back as a question. Translate operational requirements into plain, factual interview questions.

------------------------------------------------------------
SPECIFICITY PRESERVATION (CRITICAL)

When a cited snippet includes a meaningful operational qualifier, PRESERVE it in the question if it improves accuracy and usefulness. Do NOT strip away important scope-limiting detail just to make a question shorter or simpler.

Preserve details such as:
- Time windows ("within the past year", "current", "immediate")
- Severity levels ("most serious injury")
- Safety context ("as immediate safety resources")
- Role-specific facts ("ability to provide protection, supervision, care")
- Concrete conditions ("homeless or facing eviction", "physically unsafe")
- Operational purpose ("to keep the child safe")

GOOD specificity preservation:
- Source says "within the past year" → Question: "Has the primary caretaker had a substance abuse problem within the past year?" (NOT "Has the caretaker ever had a substance abuse problem?")
- Source says "as immediate safety resources" → Question: "Have any community services been recommended or used as immediate safety resources?" (NOT just "Have any community services been recommended?")
- Source says "most serious injury" → Question: "Was any child injured, and if so, what was the most serious injury?" (NOT "Was any child injured?")

BAD over-generalization:
- Do NOT turn "immediate safety resources" into just "services"
- Do NOT turn "within the past year" into "ever" or remove the time bound
- Do NOT turn "facing eviction" into "housing problems" unless the source is genuinely broader
- Do NOT turn "most serious injury" into "any injury"

The question should still sound natural and conversational, but retain the meaningful qualifiers from the source.
------------------------------------------------------------

QUESTION STYLE RULES:
- Use plain spoken language a client or caregiver would understand
- Ask about concrete facts, events, people, dates, conditions, services
- Avoid policy jargon, legal terminology, or process language
- Do NOT ask questions that sound like internal compliance prompts
- Do NOT ask questions about case classification, coding, or disposition
- Do NOT ask questions that are really note-writing prompts for the worker
- Do NOT ask "what were the reasons for not using other responses" or similar justification-style questions

Examples of GOOD questions:
- "Was any child injured, and if so, what was the most serious injury?"
- "Is the family currently homeless or facing eviction?"
- "Have any community services been recommended or used?"
- "Who currently lives in the home with the child?"
- "Has the primary caretaker had a substance abuse problem in the past year?"

Examples of BAD questions (do not generate these):
- "Has legal action been initiated, and if so, what were the reasons for not using other responses?"
- "What category must the case be classified as?"
- "What narrative is required in the case record?"
- "Are there any safety factors present that require protective interventions?" (too jargon-heavy; rephrase as a natural question)

------------------------------------------------------------
DISTINCT FACTUAL DIMENSIONS (CRITICAL)

Before composing questions, identify the distinct factual dimensions supported by the policy excerpts. A factual dimension is a separate piece of information a caseworker may need to collect — for example:

- Who lives in the home (household composition)
- Whether any child was injured (injury presence)
- What the most serious injury was (injury severity)
- Whether the family is homeless or facing eviction (housing instability)
- Whether current housing is physically unsafe (housing conditions)
- Whether the caretaker had a substance abuse problem within the past year (substance use)
- Whether community services were used as immediate safety resources (service involvement)
- Whether the caregiver can provide protection and supervision (caregiver capacity)

ANTI-COLLAPSE RULE:
If a policy excerpt supports multiple distinct factual dimensions, generate SEPARATE questions for each dimension when they are not redundant. Do NOT collapse multiple supported facts into one broader representative question.

Two questions are duplicates ONLY if they seek substantially the same factual answer from the client. Questions are NOT duplicates just because:
- They come from the same snippet
- They fall in the same category
- They relate to the same broad topic area

Examples of DISTINCT, non-duplicate pairs (generate both when supported):
- "Is the family currently homeless or facing eviction?" vs "Is the current housing physically unsafe for the child?" (different conditions)
- "Was any child injured?" vs "What was the most serious injury?" (presence vs severity — but prefer combining into one well-scoped question when natural)
- "Have services been recommended?" vs "Have services been used as immediate safety resources?" (recommendation vs use as safety resource)
- "Has the caretaker had a substance abuse problem within the past year?" vs "Is the caregiver able to provide protection and supervision for the child?" (substance use vs caregiver capacity)

Within any category (e.g., Risk / Needs / Safety Factors), prefer coverage across different supported dimensions rather than stopping after one question from that general topic area. A single dense snippet may justify 2-3 questions if it contains 2-3 genuinely distinct factual dimensions.

------------------------------------------------------------
CATEGORY GUIDANCE (up to 2 per category, as evidence supports)

Aim for coverage across these categories when evidence permits:

- Timeline: up to 2 questions  
- Individuals & Relationships: up to 2 questions  
- Event / Situation Details: up to 2 questions  
- Risk / Needs / Safety Factors: up to 2 questions  
- Agency / Service Involvement: up to 2 questions  
- Documentation / Evidence / Records: up to 2 questions  

Do NOT force questions into a category if the evidence does not support it. Skip categories with insufficient evidence.

------------------------------------------------------------
QUESTION QUALITY RULES

Each question must:

- Be something a caseworker could ask a client or caregiver directly
- Seek specific factual information (who, what, when, where, how)
- Be answerable with recordable information such as:
    - Dates or times
    - Names and roles
    - Locations
    - Actions taken
    - Current status
    - Documents or agencies involved
- Be phrased in plain, neutral, conversational professional language
- Avoid duplication or minor rewording of the same question
- Avoid multi-part compound questions — focus on the most critical fact
- NOT sound like an internal form, compliance check, or case manager note prompt

Prefer questions that produce concise, extractable answers that can be directly mapped into structured fields.

------------------------------------------------------------
TIMELINE CONSIDERATIONS (CRITICAL)

In addition to generating client-facing interview questions, extract explicit timeline-related policy requirements from the provided policy excerpts.

A timeline consideration is a time-bound requirement that affects when a caseworker must act, complete a task, or evaluate a condition.

Only include timeline considerations when the timeframe is explicitly stated in the policy text.

Examples of valid timeline language include:

- within 24 hours
- within 7 days
- within 30 calendar days
- no later than 5 business days
- during the past 12 months
- within the past year
- immediately

Examples of valid timeline considerations:

- "Initial safety assessment must be completed within 24 hours."
- "Follow-up contact must occur within 7 days."
- "Substance abuse history within the past 12 months should be considered."

CRITICAL RULES:

- ONLY include a timeline consideration if the timeframe is explicitly stated in the snippet text.
- DO NOT infer or estimate timelines.
- DO NOT invent deadlines.
- DO NOT convert vague language into a specific timeline.
- If the policy only says things like "promptly", "timely", or "as soon as possible", do NOT treat that as a timeline consideration.
- Each timeline consideration must cite at least one valid snippet_id from the provided excerpts.
- Keep each timeline consideration short, clear, and directly grounded in the policy text.

Return timeline considerations even if there are no questions.

If no explicit timeline language exists in the provided excerpts, return an empty timeline_considerations array.
------------------------------------------------------------
CITATION REQUIREMENTS

- Each question MUST cite at least one valid snippet_id from the provided policy excerpts.
- The cited snippet must contain actual policy substance that supports the question — not just a topically adjacent heading.
- Do not invent snippet IDs.
- Try to distribute citations across multiple snippets.
- Do not use the same snippet_id for more than 3 questions unless unavoidable.

------------------------------------------------------------
Return STRICT JSON only in this format:

{
  "questions": [
    {
      "category": "Timeline",
      "question": "...",
      "citations": ["snippet_id_1"]
    }
  ],
  "timeline_considerations": [
    {
      "timeline": "...",
      "citations": ["snippet_id_1"]
    }
  ]
}

Rules:
- questions: 0–12 items
- timeline_considerations: any number of items (including 0)
- Do not invent snippet IDs
- Return an empty array if no timeline considerations exist
- No text outside JSON
`,
        },
        {
          role: "user",
          content: formatted,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("Model returned empty response");

    // ── 6. Parse and validate output ──
    const parsed = extractJSON(raw);

    if (!parsed.questions || !Array.isArray(parsed.questions)) {
      throw new Error("Model did not return a questions array");
    }

    if (parsed.questions.length > 12) {
      throw new Error(`Model returned more than 12 questions (got ${parsed.questions.length})`);
    }

    // Validate citation IDs
    for (const q of parsed.questions) {
      if (!q.question || !q.citations || q.citations.length === 0) {
        throw new Error("Invalid question format: missing question or citations");
      }

      for (const citation of q.citations) {
        if (!snippetIdSet.has(citation)) {
          throw new Error(`Invalid citation: ${citation}`);
        }
      }
    }

    // ── 6b. Pre-validation diagnostics: log raw generated questions ──
    const HOUSING_TERMS =
      /\b(homeless|homelessness|eviction|evicted|housing|unhoused|shelter|unsheltered|facing\s+eviction)\b/i;

    function classifyQuestionTopic(qText: string): string {
      const lower = qText.toLowerCase();
      if (HOUSING_TERMS.test(lower)) return "housing";
      if (/\b(injur|harm|wound|bruise|fracture|burn)\b/i.test(lower)) return "injury";
      if (/\b(substance|drug|alcohol|addiction|intoxicat)\b/i.test(lower)) return "substance_use";
      if (/\b(community\s+service|agency|resource|referral)\b/i.test(lower)) return "services";
      if (/\b(legal\s+action|court|petition|removal)\b/i.test(lower)) return "legal_action";
      if (/\b(safe|danger|risk|threat|concern)\b/i.test(lower)) return "safety";
      return "other";
    }

    const rawQuestionDiagnostics = parsed.questions.map((q: any, i: number) => ({
      index: i,
      question: q.question.slice(0, 150),
      category: q.category ?? "unknown",
      topic: classifyQuestionTopic(q.question),
      citation_count: q.citations?.length ?? 0,
      citations: (q.citations ?? []).map((c: string) => c.slice(0, 12)),
    }));

    console.log(
      `[generate-guidance-phase1] RAW_QUESTIONS (${parsed.questions.length}): ${JSON.stringify(rawQuestionDiagnostics)}`,
    );

    const housingRaw = rawQuestionDiagnostics.filter((d: any) => d.topic === "housing");
    console.log(
      `[generate-guidance-phase1] HOUSING_DIAGNOSTIC: generated=${housingRaw.length > 0}${housingRaw.length > 0 ? ` questions=${JSON.stringify(housingRaw.map((h: any) => h.question))}` : ""}`,
    );

    // ── 7. Post-generation validation (single-pass, no rewrite) ──
    const validatedQuestions: ((typeof parsed.questions)[0] & {
      validation_status: QuestionOutcome;
      review_flags?: ReviewFlag[];
    })[] = [];
    const droppedQuestions: {
      question: string;
      reason: string;
      citationCount: number;
      details?: Record<string, unknown>;
    }[] = [];
    const dropReasonCounts: Record<string, number> = {};
    const softFailCounts: Record<string, number> = {};
    const questionTraces: QuestionTrace[] = [];
    const finalStatusDistribution: Record<QuestionOutcome, number> = {
      pass: 0,
      warning: 0,
      dropped_hard: 0,
    };

    for (const q of parsed.questions) {
      const citedTexts = q.citations.map((cid: string) => snippetMap.get(cid)).filter(Boolean) as string[];

      const signals: ValidationSignal[] = [];
      const reviewFlags: ReviewFlag[] = [];

      // ── Gate A: Support-strength ──
      const supportResult = validateQuestionSupport(q.question, citedTexts);
      if (!supportResult.supported) {
        const reason = supportResult.reason ?? ("unknown" as DropReason);
        const isHardSupport = ["no_snippet_text", "snippet_too_short", "weak_structural_support"].includes(reason);
        if (isHardSupport) {
          signals.push({ severity: "hard_fail", reason, details: supportResult.details });
        } else {
          signals.push({ severity: "soft_fail", reason, details: supportResult.details });
          if (reason === "weak_topical_overlap") reviewFlags.push("low_overlap_but_high_quality_source");
          else reviewFlags.push("weak_support_soft_fail");
        }
      }

      // ── Gate B: Client-facing style (always hard fail) ──
      const styleResult = validateClientFacingStyle(q.question, citedTexts);
      if (!styleResult.clientFacing) {
        signals.push({
          severity: "hard_fail",
          reason: styleResult.reason ?? "internal_worker_prompt",
          details: styleResult.details,
        });
      }

      // ── Gate C: Specificity preservation ──
      // Improved: only hard-fail at catastrophic loss (score < 0.15)
      // Soft-fail (warning-worthy) only when score < 0.4 (material loss)
      // Score >= 0.4 with minor qualifier loss → pass with no penalty
      const specResult = validateSpecificityPreservation(q.question, citedTexts);
      if (!specResult.preserved) {
        if (specResult.score < 0.15) {
          // Catastrophic specificity loss — nearly all qualifiers dropped
          signals.push({
            severity: "hard_fail",
            reason: "specificity_lost",
            details: {
              specificity_score: +specResult.score.toFixed(2),
              lost_qualifiers: specResult.lostQualifiers.map((lq) => lq.label),
            },
          });
        } else if (specResult.score < 0.4) {
          // Material specificity loss — significant qualifiers missing
          signals.push({
            severity: "soft_fail",
            reason: "specificity_lost",
            details: {
              specificity_score: +specResult.score.toFixed(2),
              lost_qualifiers: specResult.lostQualifiers.map((lq) => lq.label),
            },
          });
          reviewFlags.push("specificity_soft_fail");
        } else {
          // Minor qualifier loss (score >= 0.4) — not worth penalizing
          // Just track it for diagnostics, no signal or flag
        }
      }

      // Build trace
      const trace: QuestionTrace = {
        original_question: q.question.slice(0, 200),
        support_result: {
          supported: supportResult.supported,
          reason: supportResult.reason,
          details: supportResult.details,
        },
        style_result: {
          clientFacing: styleResult.clientFacing,
          reason: styleResult.reason,
          details: styleResult.details,
        },
        specificity_result: {
          preserved: specResult.preserved,
          score: +specResult.score.toFixed(2),
          lost_qualifiers: specResult.lostQualifiers.map((lq) => lq.label),
          concept_family: specResult.conceptFamily,
          considered: specResult.consideredQualifiers,
          ignored: specResult.ignoredQualifiers,
        },
        final_outcome: "pass", // will be updated
      };

      // ── Stage D: Aggregation — decide final outcome ──
      const hardFails = signals.filter((s) => s.severity === "hard_fail");
      const softFails = signals.filter((s) => s.severity === "soft_fail");

      // Hard fails always drop
      if (hardFails.length > 0) {
        const primary = hardFails[0];
        const reason = primary?.reason ?? "unknown";
        dropReasonCounts[reason] = (dropReasonCounts[reason] ?? 0) + 1;
        trace.final_outcome = "dropped_hard";
        finalStatusDistribution.dropped_hard++;
        droppedQuestions.push({
          question: q.question.slice(0, 120),
          reason,
          citationCount: q.citations.length,
          ...(primary?.details ? { details: primary.details } : {}),
        });
        questionTraces.push(trace);
        continue;
      }

      // Soft fails: only drop if multiple soft fails AND snippet quality is genuinely low
      if (softFails.length >= 2) {
        const qualities = citedTexts.map(computeSnippetSupportQuality);
        const maxQuality = qualities.length > 0 ? Math.max(...qualities) : 0;

        // If snippet quality is decent (>= 0.5), keep with warning instead of dropping
        if (maxQuality < 0.4) {
          const primary = softFails[0];
          const reason = primary?.reason ?? "unknown";
          dropReasonCounts[reason] = (dropReasonCounts[reason] ?? 0) + 1;
          trace.final_outcome = "dropped_hard";
          finalStatusDistribution.dropped_hard++;
          droppedQuestions.push({
            question: q.question.slice(0, 120),
            reason: `stacked_soft_fails:${softFails.map((s) => s.reason).join("+")}`,
            citationCount: q.citations.length,
          });
          questionTraces.push(trace);
          continue;
        }
      }

      // ── PASS / WARNING path ──
      for (const sf of softFails) {
        const r = sf.reason ?? "unknown";
        softFailCounts[r] = (softFailCounts[r] ?? 0) + 1;
      }

      // Warning only for genuinely significant concerns:
      // - 2+ soft fails (but kept because snippet quality saved them)
      // - specificity_soft_fail (material qualifier loss, score < 0.4)
      const hasSignificantConcern = softFails.length >= 2 || reviewFlags.includes("specificity_soft_fail");
      const validationStatus: QuestionOutcome = hasSignificantConcern ? "warning" : "pass";

      trace.final_outcome = validationStatus;
      finalStatusDistribution[validationStatus]++;

      const enrichedQ = {
        ...q,
        validation_status: validationStatus,
        ...(reviewFlags.length > 0 ? { review_flags: reviewFlags } : {}),
      };

      if (validationStatus === "warning") {
        console.log(
          `[generate-guidance-phase1] WARNING_KEPT: flags=[${reviewFlags.join(",")}] soft_fails=${softFails.length} q="${q.question.slice(0, 100)}"`,
        );
      }

      validatedQuestions.push(enrichedQ);
      questionTraces.push(trace);
    }

    const strongCount = validatedQuestions.filter((q) => q.validation_status === "pass").length;
    const warningCount = validatedQuestions.filter((q) => q.validation_status === "warning").length;

    // ── Question lifecycle log ──
    const lifecycleLog = parsed.questions.map((q: any) => {
      const trace = questionTraces.find((t) => t.original_question === q.question.slice(0, 200));
      const topic = classifyQuestionTopic(q.question);
      return {
        q: q.question.slice(0, 100),
        topic,
        status: trace?.final_outcome ?? "unknown",
        support: trace?.support_result.supported ? "pass" : (trace?.support_result.reason ?? "fail"),
        style: trace?.style_result.clientFacing ? "pass" : (trace?.style_result.reason ?? "fail"),
        specificity_score: trace?.specificity_result.score ?? "?",
        concept_family: trace?.specificity_result.concept_family ?? "?",
        spec_considered: (trace?.specificity_result.considered ?? []).join(",") || "none",
        spec_ignored: (trace?.specificity_result.ignored ?? []).join(",") || "none",
        spec_lost: (trace?.specificity_result.lost_qualifiers ?? []).join(",") || "none",
      };
    });
    console.log(`[generate-guidance-phase1] QUESTION_LIFECYCLE: ${JSON.stringify(lifecycleLog)}`);

    // ── Housing question final diagnostic ──
    const housingLifecycle = lifecycleLog.filter((l: any) => l.topic === "housing");
    if (housingLifecycle.length > 0) {
      for (const hl of housingLifecycle) {
        console.log(
          `[generate-guidance-phase1] HOUSING_OUTCOME: status=${hl.status} support=${hl.support} style=${hl.style} specificity=${hl.specificity} q="${hl.q}"`,
        );
      }
    } else {
      console.log(`[generate-guidance-phase1] HOUSING_OUTCOME: no housing question was generated by model`);
    }

    console.log(
      `[generate-guidance-phase1] Validation: ${parsed.questions.length} generated → ${strongCount} pass, ${warningCount} warning, ${droppedQuestions.length} dropped`,
    );
    console.log(`[generate-guidance-phase1] Final status distribution: ${JSON.stringify(finalStatusDistribution)}`);
    if (Object.keys(dropReasonCounts).length > 0) {
      console.log(`[generate-guidance-phase1] Drop reason distribution: ${JSON.stringify(dropReasonCounts)}`);
    }
    if (Object.keys(softFailCounts).length > 0) {
      console.log(`[generate-guidance-phase1] Soft fail distribution (kept): ${JSON.stringify(softFailCounts)}`);
    }
    if (droppedQuestions.length > 0) {
      for (const dq of droppedQuestions) {
        console.log(
          `[generate-guidance-phase1] DROPPED: reason=${dq.reason} citations=${dq.citationCount} q="${dq.question}"${dq.details ? " details=" + JSON.stringify(dq.details) : ""}`,
        );
      }
    }

    // ── 7b. Validate timeline_considerations ──────────────────────────
    const TIMELINE_LANGUAGE_RE =
      /\b(within\s+\d+\s+(hours?|days?|business\s+days?|calendar\s+days?|weeks?|months?|years?)|within\s+the\s+past\s+(\d+\s+)?(months?|years?|days?)|during\s+the\s+past\s+(\d+\s+)?(months?|years?)|no\s+later\s+than\s+\d+\s+(days?|hours?|business\s+days?)|immediately)\b/i;

    const rawTimelines: { timeline: string; citations: string[] }[] = Array.isArray(parsed.timeline_considerations)
      ? parsed.timeline_considerations
      : [];

    const validatedTimelines: { timeline: string; citations: string[] }[] = [];
    let timelineDropped = 0;

    for (const tc of rawTimelines) {
      // Structural validation
      if (!tc.timeline || typeof tc.timeline !== "string" || !Array.isArray(tc.citations) || tc.citations.length === 0) {
        timelineDropped++;
        continue;
      }

      // Citation existence validation
      const allCitationsValid = tc.citations.every((cid: string) => snippetIdSet.has(cid));
      if (!allCitationsValid) {
        timelineDropped++;
        continue;
      }

      // Check cited snippet text contains explicit timeline language
      const citedTexts = tc.citations.map((cid: string) => snippetMap.get(cid)).filter(Boolean) as string[];
      const combinedCited = citedTexts.join(" ");
      if (!TIMELINE_LANGUAGE_RE.test(combinedCited)) {
        timelineDropped++;
        continue;
      }

      validatedTimelines.push({ timeline: tc.timeline, citations: tc.citations });
    }

    console.log(
      `[generate-guidance-phase1] TIMELINE_CONSIDERATIONS: generated=${rawTimelines.length} validated=${validatedTimelines.length} dropped=${timelineDropped}`,
    );

    // ── 8. Check if we have enough grounded questions ──
    if (validatedQuestions.length < MIN_GROUNDED_QUESTIONS) {
      const reasonCode: GroundingCode =
        validatedQuestions.length === 0
          ? lowInfoCount > snippets.length * 0.5
            ? "LOW_INFORMATION_POLICY_PACK"
            : "INSUFFICIENT_GROUNDED_SUPPORT"
          : "WEAK_CITATION_SUPPORT";

      console.warn(
        `[generate-guidance-phase1] Insufficient grounded questions: ${validatedQuestions.length}/${parsed.questions.length}. Reason: ${reasonCode}`,
      );

      const insufficientPayload = {
        generated_at: new Date().toISOString(),
        model,
        template_id: templateId,
        guidance_scope: guidanceScope,
        ...(guidanceScope === "other" && guidanceScopeOther ? { guidance_scope_other: guidanceScopeOther } : {}),
        questions: validatedQuestions,
        grounding_status: "insufficient" as const,
        grounding_reason: reasonCode,
        total_generated: parsed.questions.length,
        total_grounded: validatedQuestions.length,
        total_grounded_strong: strongCount,
        total_grounded_warning: warningCount,
        total_dropped: droppedQuestions.length,
        hard_fail_distribution: dropReasonCounts,
        soft_fail_distribution: softFailCounts,
        final_status_distribution: finalStatusDistribution,
        _diagnostics: {
          raw_questions: rawQuestionDiagnostics.map((d: any) => ({
            q: d.question,
            topic: d.topic,
            category: d.category,
          })),
          kept: validatedQuestions.map((q: any) => ({ q: q.question.slice(0, 120), status: q.validation_status })),
          dropped: droppedQuestions.map((dq) => ({ q: dq.question, reason: dq.reason })),
          housing: {
            generated: housingRaw.length > 0,
            outcome: housingLifecycle[0]?.status ?? null,
            raw: housingRaw[0]?.question ?? null,
          },
        },
      };

      await supabase.rpc("update_session_guidance_phase1", {
        session_id_input: sessionIdResult.value,
        guidance_json: insufficientPayload,
      });

      await logEyeEvent(supabase, {
        session_id: sessionIdResult.value,
        event_type: "tool.run.completed",
        serviceName: "generate-guidance-phase1",
        payload: {
          request_id: requestId,
          resource_type: "tool",
          resource_id: "generate_guidance_phase1",
          template_id: templateId,
          guidance_scope: guidanceScope,
          question_count: validatedQuestions.length,
          snippet_count: snippetIdSet.size,
          grounding_status: "insufficient",
          grounding_reason: reasonCode,
          result: "success",
        },
      });

      return json(200, { success: true, grounding_status: "insufficient", grounding_reason: reasonCode });
    }

    // ── 9. Build guidance payload with validated questions ──
    const guidancePayload = {
      generated_at: new Date().toISOString(),
      model,
      template_id: templateId,
      guidance_scope: guidanceScope,
      ...(guidanceScope === "other" && guidanceScopeOther ? { guidance_scope_other: guidanceScopeOther } : {}),
      questions: validatedQuestions,
      grounding_status: "sufficient" as const,
      total_generated: parsed.questions.length,
      total_grounded: validatedQuestions.length,
      total_grounded_strong: strongCount,
      total_grounded_warning: warningCount,
      total_dropped: droppedQuestions.length,
      hard_fail_distribution: dropReasonCounts,
      soft_fail_distribution: softFailCounts,
      final_status_distribution: finalStatusDistribution,
      _diagnostics: {
        raw_questions: rawQuestionDiagnostics.map((d: any) => ({
          q: d.question,
          topic: d.topic,
          category: d.category,
        })),
        kept: validatedQuestions.map((q: any) => ({ q: q.question.slice(0, 120), status: q.validation_status })),
        dropped: droppedQuestions.map((dq) => ({ q: dq.question, reason: dq.reason })),
        housing: {
          generated: housingRaw.length > 0,
          outcome: housingLifecycle[0]?.status ?? null,
          raw: housingRaw[0]?.question ?? null,
        },
      },
    };

    // ── 10. Save to session ──
    const updateResponse = await supabase.rpc("update_session_guidance_phase1", {
      session_id_input: sessionIdResult.value,
      guidance_json: guidancePayload,
    });

    if (!updateResponse || updateResponse.error) {
      throw new Error(`Update RPC failed: ${updateResponse?.error?.message ?? "Unknown RPC error"}`);
    }

    // ── Eye: tool.run.completed ──
    await logEyeEvent(supabase, {
      session_id: sessionIdResult.value,
      event_type: "tool.run.completed",
      serviceName: "generate-guidance-phase1",
      payload: {
        request_id: requestId,
        resource_type: "tool",
        resource_id: "generate_guidance_phase1",
        template_id: templateId,
        guidance_scope: guidanceScope,
        question_count: validatedQuestions.length,
        snippet_count: snippetIdSet.size,
        total_generated: parsed.questions.length,
        total_dropped: droppedQuestions.length,
        result: "success",
      },
    });

    return json(200, { success: true });
  } catch (err) {
    console.error("[generate-guidance-phase1] error:", err);

    await logEyeEvent(supabase, {
      session_id: sessionIdResult.value,
      event_type: "tool.run.failed",
      serviceName: "generate-guidance-phase1",
      payload: {
        request_id: requestId,
        resource_type: "tool",
        resource_id: "generate_guidance_phase1",
        result: "failure",
        severity: "WARN",
        reason_code: err instanceof Error ? err.message.slice(0, 200) : "unknown",
      },
    });

    return json(500, {
      error: err instanceof Error ? err.message : "Unknown error",
      code: "INTERNAL_ERROR",
    });
  }
});
