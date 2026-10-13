import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import OpenAI from "https://esm.sh/openai@4.28.0";
import { logEyeEvent } from "../_shared/eye.ts";
import { buildCorsSecurityHeaders } from "../_shared/security-headers.ts";
import { validateUuid } from "../_shared/input-validation.ts";
import { requireUser, assertSessionAccess, requireTenantFor } from "../_shared/require-user.ts";

const openai = new OpenAI({
  apiKey: Deno.env.get("OPENAI_API_KEY")!,
});

let _corsHeaders: Record<string, string> = {};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ..._corsHeaders, "Content-Type": "application/json" },
  });
}

function extractJSON(text: string) {
  const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON found in model output");
  return JSON.parse(match[0]);
}

/* ── Support-strength validation ── */

const LOW_INFO_PHRASES = [
  "table of contents", "contents page", "list of figures", "list of tables",
  "list of appendices", "appendix index", "revision history", "document control",
  "page intentionally left blank",
];

const GENERIC_WORDS = new Set([
  "what", "when", "where", "which", "does", "have", "been", "this", "that",
  "with", "from", "your", "about", "into", "they", "their", "there", "were",
  "will", "would", "could", "should", "other", "first", "last", "most", "more",
  "than", "each", "some", "also", "currently", "specific", "please", "describe",
  "explain", "provide", "information", "details", "related", "involved", "during",
  "before", "after", "between", "through", "under",
]);

function naiveStem(word: string): string {
  if (word.length <= 4) return word;
  return word
    .replace(/ness$/, "").replace(/ment$/, "").replace(/tion$/, "")
    .replace(/sion$/, "").replace(/ies$/, "y").replace(/ive$/, "")
    .replace(/ing$/, "").replace(/ous$/, "").replace(/ful$/, "")
    .replace(/able$/, "").replace(/ible$/, "").replace(/ity$/, "")
    .replace(/ally$/, "").replace(/ed$/, "").replace(/er$/, "")
    .replace(/ly$/, "").replace(/es$/, "").replace(/s$/, "");
}

type DropReason =
  | "no_snippet_text" | "snippet_too_short" | "low_info_phrases"
  | "weak_structural_support" | "weak_topical_overlap" | "unsupported_question_concepts"
  | "internal_worker_prompt" | "documentation_only_source"
  | "policy_jargon_not_transformed" | "classification_or_justification_prompt"
  | "specificity_lost";

type ValidationSeverity = "pass" | "soft_fail" | "hard_fail";

interface ValidationSignal {
  severity: ValidationSeverity;
  reason?: DropReason;
  details?: Record<string, unknown>;
}

type ReviewFlag =
  | "specificity_soft_fail" | "weak_support_soft_fail" | "broad_paraphrase"
  | "partial_qualifier_loss" | "low_overlap_but_high_quality_source"
  | "schema_driven_relaxed";

type QuestionOutcome = "pass" | "warning" | "dropped_hard";

interface QuestionTrace {
  original_question: string;
  source_tier: "schema" | "policy" | "unknown";
  section_tag: string;
  support_result: { supported: boolean; reason?: string; details?: Record<string, unknown> };
  style_result: { clientFacing: boolean; reason?: string; details?: Record<string, unknown> };
  specificity_result: {
    preserved: boolean; score: number; lost_qualifiers: string[];
    concept_family: string; considered: string[]; ignored: string[];
  };
  final_outcome: QuestionOutcome;
}

function computeSnippetSupportQuality(text: string): number {
  if (!text || text.trim().length === 0) return 0;
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  for (const phrase of LOW_INFO_PHRASES) {
    if (lower.includes(phrase)) return 0.05;
  }
  const lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);
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
  if (headingRatio > 0.5 && proseRatio < 0.15) return 0.1;
  if (shortRatio > 0.7 && proseRatio < 0.1) return 0.15;
  if (lines.length > 5 && proseRatio < 0.08) return 0.2;
  if (trimmed.length < 100) return 0.25;
  if (proseRatio < 0.2) return 0.5;
  return 1.0;
}

const SNIPPET_QUALITY_THRESHOLD = 0.3;

function extractMeaningfulTerms(text: string): string[] {
  const raw = text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/)
    .filter((w) => w.length > 3 && !GENERIC_WORDS.has(w));
  return raw.map(naiveStem);
}

function extractRawTerms(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/)
      .filter((w) => w.length > 3 && !GENERIC_WORDS.has(w)),
  );
}

/**
 * Multi-gate support-strength validator.
 * When isSchemaQuestion=true, thresholds are relaxed since the question
 * is driven by template structure rather than policy alone.
 */
function validateQuestionSupport(
  question: string,
  citedSnippetTexts: string[],
  isSchemaQuestion = false,
): { supported: boolean; reason?: DropReason; details?: Record<string, unknown> } {
  if (citedSnippetTexts.length === 0) {
    // Schema questions with no snippets get a soft pass — they're template-driven
    if (isSchemaQuestion) return { supported: true };
    return { supported: false, reason: "no_snippet_text" };
  }

  const combinedText = citedSnippetTexts.join(" ");
  const combinedLen = combinedText.replace(/\s+/g, " ").trim().length;

  if (combinedLen < 80) {
    if (isSchemaQuestion) return { supported: true }; // template structure is the grounding
    return { supported: false, reason: "snippet_too_short", details: { combinedLen } };
  }

  const qualities = citedSnippetTexts.map(computeSnippetSupportQuality);
  const avgQuality = qualities.reduce((a, b) => a + b, 0) / qualities.length;
  const maxQuality = Math.max(...qualities);

  if (maxQuality < SNIPPET_QUALITY_THRESHOLD) {
    if (isSchemaQuestion) return { supported: true }; // schema-driven, structural grounding OK
    return {
      supported: false, reason: "weak_structural_support",
      details: { avgQuality: +avgQuality.toFixed(2), maxQuality: +maxQuality.toFixed(2) },
    };
  }

  // Soft gates: concept coverage + topical overlap
  const questionTerms = extractMeaningfulTerms(question);
  const snippetTermSet = new Set(extractMeaningfulTerms(combinedText));
  if (questionTerms.length < 3) return { supported: true };

  let matched = 0;
  const unmatched: string[] = [];
  for (const term of questionTerms) {
    if (snippetTermSet.has(term)) matched++;
    else unmatched.push(term);
  }
  const coverageRatio = matched / questionTerms.length;

  // Schema questions get much more lenient overlap requirements
  if (isSchemaQuestion) {
    // Only fail schema questions if there's truly zero overlap with any snippet
    if (coverageRatio < 0.05 && citedSnippetTexts.length > 0) {
      return {
        supported: false, reason: "unsupported_question_concepts",
        details: { coverageRatio: +coverageRatio.toFixed(2), qualityTier: "schema_relaxed", matchedCount: matched },
      };
    }
    return { supported: true };
  }

  const isHighQuality = maxQuality >= 0.8 && avgQuality >= 0.6;
  const isMediumQuality = maxQuality >= 0.5;

  const conceptCoverageThreshold = isHighQuality ? 0.1 : isMediumQuality ? 0.15 : 0.2;
  const overlapThreshold = isHighQuality ? 0.08 : isMediumQuality ? 0.12 : 0.18;

  if (isHighQuality) {
    if (coverageRatio < conceptCoverageThreshold && coverageRatio < overlapThreshold) {
      return {
        supported: false, reason: "unsupported_question_concepts",
        details: { coverageRatio: +coverageRatio.toFixed(2), qualityTier: "high", matchedCount: matched, sampleUnmatched: unmatched.slice(0, 5) },
      };
    }
    return { supported: true };
  }
  if (isMediumQuality) {
    if (coverageRatio < 0.12) {
      return {
        supported: false, reason: "unsupported_question_concepts",
        details: { coverageRatio: +coverageRatio.toFixed(2), qualityTier: "medium", matchedCount: matched, sampleUnmatched: unmatched.slice(0, 5) },
      };
    }
    return { supported: true };
  }

  if (coverageRatio < conceptCoverageThreshold) {
    return {
      supported: false, reason: "unsupported_question_concepts",
      details: { coverageRatio: +coverageRatio.toFixed(2), qualityTier: "low", matchedCount: matched, sampleUnmatched: unmatched.slice(0, 5) },
    };
  }
  if (coverageRatio < overlapThreshold) {
    return {
      supported: false, reason: "weak_topical_overlap",
      details: { overlapRatio: +coverageRatio.toFixed(2), qualityTier: "low", avgSnippetQuality: +avgQuality.toFixed(2) },
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
  "must be documented", "case record", "narrative requirement", "case classification",
  "response option", "supervisory review", "case manager must", "worker must explain",
  "coding", "legal basis for", "compliance requirement", "approval is needed",
  "override reason", "disposition", "substantiation", "case finding", "administrative review",
];

const DOCUMENTATION_ONLY_SNIPPET_PHRASES: string[] = [
  "the case manager must document", "the worker shall explain in the narrative",
  "must be recorded in the case record", "document the reasons for",
  "provide justification for", "case must be classified as",
  "the record must reflect", "narrative must include",
  "the worker must explain why", "document why responses 1 through",
  "override must be approved", "supervisory approval is required",
  "complete the following form", "enter the appropriate code",
  "select the response that",
];

function validateClientFacingStyle(
  question: string, citedSnippetTexts: string[],
): { clientFacing: boolean; reason?: DropReason; details?: Record<string, unknown> } {
  const qLower = question.toLowerCase();
  const combinedSnippets = citedSnippetTexts.join(" ").toLowerCase();

  for (const pattern of INTERNAL_WORKER_PATTERNS) {
    if (pattern.test(qLower)) {
      return { clientFacing: false, reason: "internal_worker_prompt", details: { matched_pattern: pattern.source.slice(0, 60) } };
    }
  }

  let internalPhraseHits = 0;
  const matchedPhrases: string[] = [];
  for (const phrase of INTERNAL_LANGUAGE_PHRASES) {
    if (qLower.includes(phrase)) { internalPhraseHits++; matchedPhrases.push(phrase); }
  }
  if (internalPhraseHits >= 2) {
    return { clientFacing: false, reason: "internal_worker_prompt", details: { internal_phrase_hits: internalPhraseHits, matched: matchedPhrases } };
  }

  let docOnlyHits = 0;
  for (const phrase of DOCUMENTATION_ONLY_SNIPPET_PHRASES) {
    if (combinedSnippets.includes(phrase)) docOnlyHits++;
  }
  if (docOnlyHits >= 2 && internalPhraseHits >= 1) {
    return { clientFacing: false, reason: "documentation_only_source", details: { doc_only_hits: docOnlyHits, internal_phrase_hits: internalPhraseHits } };
  }
  if (docOnlyHits >= 3) {
    return { clientFacing: false, reason: "documentation_only_source", details: { doc_only_hits: docOnlyHits } };
  }

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
  for (const p of JARGON_PATTERNS) { if (p.test(qLower)) jargonHits++; }
  if (jargonHits >= 2) {
    return { clientFacing: false, reason: "policy_jargon_not_transformed", details: { jargon_hits: jargonHits } };
  }

  const CLASSIFICATION_PATTERNS: RegExp[] = [
    /what\s+(type|level|category|tier)\s+of\s+(response|intervention|action)\s+(was|is|should)\b/i,
    /what\s+were\s+the\s+reasons\s+for\s+not\b/i,
    /why\s+(was|were)\s+(legal\s+action|court\s+intervention|removal)/i,
    /what\s+(alternative|other)\s+responses?\s+(were|was)\s+(considered|explored|attempted)\b/i,
  ];
  for (const p of CLASSIFICATION_PATTERNS) {
    if (p.test(qLower)) {
      if (docOnlyHits >= 1 || combinedSnippets.includes("reasons for not using") || combinedSnippets.includes("must explain why") || combinedSnippets.includes("justify")) {
        return { clientFacing: false, reason: "classification_or_justification_prompt", details: { matched_classification: true, doc_only_hits: docOnlyHits } };
      }
    }
  }

  return { clientFacing: true };
}

/* ── Concept-family classification ── */

type ConceptFamily =
  | "substance_use" | "housing_instability" | "unsafe_housing_conditions"
  | "caregiver_capacity" | "injury_severity" | "immediate_safety_resources"
  | "general_safety" | "prior_history" | "other";

function classifyQuestionConcept(question: string): ConceptFamily {
  const q = question.toLowerCase();
  if (/\b(substance|drug|alcohol|addiction|intoxicat|sober|sobriety|drinking|using)\b/.test(q)) return "substance_use";
  if (/\b(homeless|homelessness|eviction|evicted|facing\s+eviction|unhoused|shelter)\b/.test(q)) return "housing_instability";
  if (/\b(physically\s+unsafe|unsafe\s+housing|unsafe.*\bhome|housing.*\bunsafe|structurally\s+unsound)\b/.test(q)) return "unsafe_housing_conditions";
  if (/\b(ability|able|unable|capable|capacity)\b.{0,30}\b(protect|supervis|care|nurtur|provide|parent)/i.test(q)) return "caregiver_capacity";
  if (/\b(injur|harm|wound|bruise|fracture|burn|most\s+serious)\b/.test(q)) return "injury_severity";
  if (/\bimmediate\s+safety\s+resource/.test(q) || /\bcommunity\s+service.*\bsafety\s+resource/.test(q)) return "immediate_safety_resources";
  if (/\b(prior|previous|past)\b.{0,20}\b(report|referral|involvement|history)\b/.test(q)) return "prior_history";
  if (/\b(safe|danger|risk|threat|concern|protective)\b/.test(q)) return "general_safety";
  return "other";
}

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

/* ── Specificity-preservation validator ── */

const IMPORTANT_QUALIFIER_PATTERNS: {
  snippetDetector: RegExp; label: string; questionCheck: RegExp;
}[] = [
  { snippetDetector: /within\s+the\s+past\s+(year|12\s*months|six\s*months|6\s*months)/i, label: "time_window", questionCheck: /past\s+(year|12\s*months|six\s*months|6\s*months)|within\s+the\s+(past|last)\s+(year|12|six|6)/i },
  { snippetDetector: /\bimmediate\s+(safety|risk|danger|threat|concern)/i, label: "immediate_safety", questionCheck: /\bimmediate\b/i },
  { snippetDetector: /\bimminent\s+(harm|danger|risk|threat)/i, label: "imminent_risk", questionCheck: /\bimminent\b/i },
  { snippetDetector: /\bmost\s+serious\s+(injury|harm|concern|incident)/i, label: "severity_most_serious", questionCheck: /\bmost\s+serious\b/i },
  { snippetDetector: /as\s+immediate\s+safety\s+resource/i, label: "purpose_immediate_safety_resources", questionCheck: /immediate\s+safety\s+resource/i },
  { snippetDetector: /\b(ability|unable)\s+to\s+(provide\s+)?(protection|supervision|care|nurturing)/i, label: "caregiver_capacity", questionCheck: /(ability|able|unable)\s+to\s+(provide\s+)?(protect|supervis|care|nurtur)/i },
  { snippetDetector: /\bphysically\s+unsafe\b/i, label: "physically_unsafe", questionCheck: /\bphysically\s+unsafe\b|not\s+(physically\s+)?safe/i },
  { snippetDetector: /\bhomeless\s+(or|and)\s+(facing\s+)?eviction/i, label: "homeless_or_eviction", questionCheck: /\bhomeless\b.*\beviction\b|\beviction\b.*\bhomeless\b/i },
  { snippetDetector: /\bfacing\s+eviction\b/i, label: "facing_eviction", questionCheck: /\beviction\b/i },
  { snippetDetector: /\bprior\s+(reports?|referrals?|involvement)\b/i, label: "prior_reports", questionCheck: /\bprior\b|\bprevious\b|\bpast\b/i },
  { snippetDetector: /\bmedication[\s-]assisted\s+treatment\b/i, label: "medication_assisted_treatment", questionCheck: /\bmedication[\s-]assisted\b|\bMAT\b/i },
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

  const allDetected: { label: string; snippetEvidence: string; preserved: boolean }[] = [];
  for (const pattern of IMPORTANT_QUALIFIER_PATTERNS) {
    const snippetMatch = combinedSnippet.match(pattern.snippetDetector);
    if (snippetMatch) {
      allDetected.push({ label: pattern.label, snippetEvidence: snippetMatch[0].slice(0, 60), preserved: pattern.questionCheck.test(question) });
    }
  }

  if (allDetected.length === 0) {
    return { preserved: true, lostQualifiers: [], score: 1.0, conceptFamily, consideredQualifiers: [], ignoredQualifiers: [] };
  }

  const relevant: typeof allDetected = [];
  const ignored: string[] = [];
  for (const d of allDetected) {
    const families = QUALIFIER_CONCEPT_RELEVANCE[d.label];
    if (families && families.includes(conceptFamily)) relevant.push(d);
    else if (conceptFamily === "other") relevant.push(d);
    else ignored.push(d.label);
  }

  if (relevant.length === 0) {
    return { preserved: true, lostQualifiers: [], score: 1.0, conceptFamily, consideredQualifiers: [], ignoredQualifiers: ignored };
  }

  const lost = relevant.filter((d) => !d.preserved);
  const score = (relevant.length - lost.length) / relevant.length;
  return {
    preserved: lost.length === 0,
    lostQualifiers: lost.map((l) => ({ label: l.label, snippetEvidence: l.snippetEvidence })),
    score, conceptFamily,
    consideredQualifiers: relevant.map((r) => r.label),
    ignoredQualifiers: ignored,
  };
}

/* ── Schema field analysis helpers ── */

interface SchemaField {
  field_id: string;
  label: string;
  section: string;
  content_type: string;
  field_purpose: string[];
  field_group?: string;
  matching_mode?: string;
  description?: string;
}

interface TemplateRequirement {
  section: string;
  field_label: string;
  content_type: string;
  purpose: string;
  priority: "high" | "medium" | "low";
  suggested_question_angle: string;
}

/**
 * Analyze schema fields and produce explicit template requirements
 * that the LLM should use as primary question drivers.
 */
function buildTemplateRequirements(fields: SchemaField[], sections: string[]): {
  requirements: TemplateRequirement[];
  guidanceFieldCount: number;
  narrativeFieldCount: number;
  sectionCoverage: Map<string, SchemaField[]>;
} {
  const sectionCoverage = new Map<string, SchemaField[]>();
  const requirements: TemplateRequirement[] = [];
  let guidanceFieldCount = 0;
  let narrativeFieldCount = 0;

  for (const f of fields) {
    const section = f.section || "General";
    if (!sectionCoverage.has(section)) sectionCoverage.set(section, []);
    sectionCoverage.get(section)!.push(f);

    const isGuidance = f.field_purpose?.includes("guidance");
    const isNarrative = f.content_type === "narrative";

    if (isGuidance) guidanceFieldCount++;
    if (isNarrative) narrativeFieldCount++;

    // Determine priority
    let priority: "high" | "medium" | "low" = "low";
    if (isGuidance && isNarrative) priority = "high";
    else if (isGuidance) priority = "high";
    else if (isNarrative) priority = "high";
    else if (f.content_type === "categorical" || f.content_type === "checkbox") priority = "medium";
    else priority = "medium";

    // Build a suggested question angle from the field metadata
    let angle = "";
    if (isNarrative) {
      angle = `Ask the client to describe/explain information relevant to "${f.label}" — gather context, detail, and rationale that the caseworker can record in this narrative section.`;
    } else if (f.content_type === "categorical" || f.content_type === "checkbox") {
      angle = `Ask about the specific conditions or factors covered by "${f.label}" — determine which categories or issues apply.`;
    } else {
      angle = `Ask about the factual information needed for "${f.label}" — gather specific facts, names, dates, or conditions.`;
    }

    requirements.push({
      section,
      field_label: f.label,
      content_type: f.content_type,
      purpose: f.field_purpose?.join(", ") ?? "extraction",
      priority,
      suggested_question_angle: angle,
    });
  }

  // Sort: high priority first, then medium, then low
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  requirements.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return { requirements, guidanceFieldCount, narrativeFieldCount, sectionCoverage };
}

type GroundingCode = "INSUFFICIENT_GROUNDED_SUPPORT" | "LOW_INFORMATION_POLICY_PACK" | "WEAK_CITATION_SUPPORT";
const MIN_GROUNDED_QUESTIONS = 3;

const HOUSING_TERMS = /\b(homeless|homelessness|eviction|evicted|housing|unhoused|shelter|unsheltered|facing\s+eviction)\b/i;

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

Deno.serve(async (req) => {
  _corsHeaders = buildCorsSecurityHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: _corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const requestId = crypto.randomUUID();

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid JSON body", code: "INVALID_JSON" }); }

  const { session_id } = body;
  if (!session_id) return json(400, { error: "session_id is required", code: "SESSION_ID_REQUIRED" });

  const sessionIdResult = validateUuid("session_id", session_id);
  if (!sessionIdResult.ok) return json(400, { error: "Invalid session_id format", code: "INVALID_SESSION_ID" });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // ── Authenticate caller and authorize the session before any privileged access ──
  const auth = await requireUser(req, supabase);
  if (!auth.ok) return json(auth.status, { error: auth.error, code: "UNAUTHORIZED" });
  const access = await assertSessionAccess(supabase, auth.caller, sessionIdResult.value, { allowSupervisor: true });
  if (!access.ok) return json(access.status, { error: access.error, code: "SESSION_ACCESS_DENIED" });

  await logEyeEvent(supabase, {
    session_id: sessionIdResult.value,
    event_type: "tool.run.started",
    serviceName: "generate-guidance-phase1",
    payload: { request_id: requestId, resource_type: "tool", resource_id: "generate_guidance_phase1" },
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
    if (!session.template_id) return json(400, { error: "template_id missing. Select a template first.", code: "TEMPLATE_REQUIRED" });
    if (!session.guidance_scope) return json(400, { error: "guidance_scope missing. Set scope at session creation.", code: "SCOPE_REQUIRED" });

    const templateId: string = session.template_id;
    const guidanceScope: string = session.guidance_scope;
    const guidanceScopeOther: string | null = session.guidance_scope_other;

    // ── 1b. Ensure Phase 2 schema ──
    {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const ensureUrl = `${supabaseUrl}/functions/v1/ensure-phase2-schema`;

      console.log(`[generate-guidance-phase1] Ensuring Phase 2 schema for template ${templateId}…`);

      let ensureOk = false;
      let ensureAction = "unknown";
      let ensureSchemaId = "";
      let ensureErrorMsg = "";

      try {
        const ensureRes = await fetch(ensureUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionIdResult.value, template_id: templateId }),
        });
        const ensureBody = await ensureRes.json().catch(() => ({}));
        if (ensureRes.ok && ensureBody.success) {
          ensureOk = true;
          ensureAction = ensureBody.action ?? "unknown";
          ensureSchemaId = ensureBody.schema_id ?? "";
          console.log(`[generate-guidance-phase1] Phase 2 schema ensured: ${ensureSchemaId} (${ensureAction})`);
        } else {
          ensureErrorMsg = ensureBody.error ?? `HTTP ${ensureRes.status}`;
          console.error(`[generate-guidance-phase1] Phase 2 schema ensure FAILED: ${ensureErrorMsg}`);
        }
      } catch (fetchErr) {
        ensureErrorMsg = fetchErr instanceof Error ? fetchErr.message : "Network error";
        console.error(`[generate-guidance-phase1] Phase 2 schema ensure fetch error: ${ensureErrorMsg}`);
      }

      if (!ensureOk) {
        await logEyeEvent(supabase, {
          session_id: sessionIdResult.value, event_type: "phase2_schema.ensure_failed",
          serviceName: "generate-guidance-phase1",
          payload: { request_id: requestId, template_id: templateId, result: "failure", severity: "WARN", reason_code: ensureErrorMsg.slice(0, 200) },
        });
        return json(500, { success: false, error: `Failed to ensure Phase 2 schema: ${ensureErrorMsg}`, code: "PHASE2_SCHEMA_ENSURE_FAILED" });
      }
    }

    // ── 1c. Load schema and build template requirements ──
    let schemaFields: SchemaField[] = [];
    let schemaSections: string[] = [];
    let templateRequirements: TemplateRequirement[] = [];
    let guidanceFieldCount = 0;
    let narrativeFieldCount = 0;
    let schemaCoverage = new Map<string, SchemaField[]>();
    let schemaLoaded = false;

    {
      const { data: refreshedSession } = await supabase
        .from("sessions").select("phase2_schema_id").eq("id", sessionIdResult.value).maybeSingle();

      if (refreshedSession?.phase2_schema_id) {
        const { data: schemaData } = await supabase
          .from("template_phase2_schemas").select("schema_json")
          .eq("id", refreshedSession.phase2_schema_id).maybeSingle();

        if (schemaData?.schema_json) {
          const schema = schemaData.schema_json as Record<string, unknown>;
          schemaSections = Array.isArray(schema.sections) ? schema.sections as string[] : [];
          const rawFields = Array.isArray(schema.fields) ? schema.fields as Record<string, unknown>[] : [];

          schemaFields = rawFields.map((f) => ({
            field_id: String(f.field_id ?? ""),
            label: String(f.label ?? ""),
            section: String(f.section ?? "General"),
            content_type: String(f.content_type ?? "factual"),
            field_purpose: Array.isArray(f.field_purpose) ? f.field_purpose.map(String) : ["extraction"],
            field_group: f.field_group ? String(f.field_group) : undefined,
            matching_mode: f.matching_mode ? String(f.matching_mode) : undefined,
            description: f.description ? String(f.description) : undefined,
          }));

          if (schemaFields.length > 0) {
            const analysis = buildTemplateRequirements(schemaFields, schemaSections);
            templateRequirements = analysis.requirements;
            guidanceFieldCount = analysis.guidanceFieldCount;
            narrativeFieldCount = analysis.narrativeFieldCount;
            schemaCoverage = analysis.sectionCoverage;
            schemaLoaded = true;
          }
        }
      }
    }

    console.log(`[generate-guidance-phase1] Schema loaded: ${schemaLoaded}, fields: ${schemaFields.length}, guidance: ${guidanceFieldCount}, narrative: ${narrativeFieldCount}, sections: ${schemaSections.length}`);

    // ── 2. Retrieve policy snippets ──
    const snippetResponse = await supabase.rpc("get_policy_snippets_for_session", { session_id_input: sessionIdResult.value });
    if (!snippetResponse || snippetResponse.error) {
      throw new Error(`Snippet RPC failed: ${snippetResponse?.error?.message ?? "Unknown RPC error"}`);
    }
    const snippets = snippetResponse.data;
    if (!snippets || snippets.length === 0) {
      return json(500, { error: "No policy snippets found. Ensure a policy pack has been compiled.", code: "NO_SNIPPETS" });
    }

    // ── 2b. Pre-check low-info snippets ──
    const snippetMap = new Map<string, string>();
    let lowInfoCount = 0;
    for (const s of snippets) {
      snippetMap.set(s.snippet_id, s.chunk_text);
      const lower = (s.chunk_text || "").toLowerCase();
      const isLowInfo = LOW_INFO_PHRASES.some((p) => lower.includes(p));
      const lines = (s.chunk_text || "").split("\n").map((l: string) => l.trim()).filter(Boolean);
      const proseLines = lines.filter((l: string) => l.length > 50 && /[.,;:?!]/.test(l));
      if (isLowInfo || (lines.length > 3 && proseLines.length === 0)) lowInfoCount++;
    }
    if (lowInfoCount > snippets.length * 0.8) {
      console.warn(`[generate-guidance-phase1] Policy pack is ${Math.round((lowInfoCount / snippets.length) * 100)}% low-info snippets`);
    }

    // ── 2c. Domain-sanity check: detect cross-domain snippet contamination ──
    const DOMAIN_MARKERS: Record<string, { positive: RegExp[]; negative: RegExp[] }> = {
      child_welfare: {
        positive: [/\bchild\s+(welfare|protection|safety|abuse|neglect)\b/i, /\bfoster\s+(care|parent)\b/i, /\bCPS\b/, /\bmaltreatment\b/i, /\bchild(ren)?\s+in\s+(the\s+)?home\b/i],
        negative: [],
      },
      employment_income: {
        positive: [/\b(employment|income|wage|salary|financial|asset|liabilit|earning|vocational|budget)\b/i],
        negative: [/\bchild\s+(welfare|protection|safety|abuse|neglect)\b/i, /\bfoster\s+(care|parent)\b/i, /\bCPS\b/, /\bmaltreatment\b/i],
      },
      mental_health: {
        positive: [/\b(mental\s+health|psychiatric|behavioral\s+health|diagnosis|symptoms)\b/i],
        negative: [],
      },
      substance_use: {
        positive: [/\b(substance\s+(use|abuse)|withdrawal|MAT\b|medication[\s-]assisted|detox)\b/i],
        negative: [],
      },
      housing_homelessness: {
        positive: [/\b(housing|homeless|eviction|shelter|transitional\s+housing)\b/i],
        negative: [],
      },
    };

    const markers = DOMAIN_MARKERS[guidanceScope];
    let domainRelevantSnippets = 0;
    let crossDomainSnippets = 0;
    if (markers) {
      for (const s of snippets) {
        const text = s.chunk_text || "";
        const hasPositive = markers.positive.some(p => p.test(text));
        const hasNegative = markers.negative.length > 0 && markers.negative.some(p => p.test(text));
        if (hasPositive) domainRelevantSnippets++;
        if (hasNegative && !hasPositive) crossDomainSnippets++;
      }
    }

    const domainRelevanceRatio = snippets.length > 0 ? domainRelevantSnippets / snippets.length : 0;
    const crossDomainRatio = snippets.length > 0 ? crossDomainSnippets / snippets.length : 0;
    console.log(`[generate-guidance-phase1] DOMAIN_SANITY: scope=${guidanceScope} relevant=${domainRelevantSnippets}/${snippets.length} (${(domainRelevanceRatio * 100).toFixed(0)}%) cross_domain=${crossDomainSnippets} (${(crossDomainRatio * 100).toFixed(0)}%)`);

    // If >60% of snippets are from a wrong domain and <10% are relevant, the policy pack is contaminated
    const isPolicyPackContaminated = crossDomainRatio > 0.6 && domainRelevanceRatio < 0.1;
    if (isPolicyPackContaminated) {
      console.error(`[generate-guidance-phase1] DOMAIN_MISMATCH: Policy pack appears to be for a different domain than ${guidanceScope}. cross_domain=${(crossDomainRatio * 100).toFixed(0)}% relevant=${(domainRelevanceRatio * 100).toFixed(0)}%`);

      await logEyeEvent(supabase, {
        session_id: sessionIdResult.value,
        event_type: "guidance.domain_mismatch",
        serviceName: "generate-guidance-phase1",
        payload: {
          request_id: requestId,
          guidance_scope: guidanceScope,
          template_id: templateId,
          snippet_count: snippets.length,
          domain_relevant_count: domainRelevantSnippets,
          cross_domain_count: crossDomainSnippets,
          result: "failure",
          severity: "HIGH",
        },
      });

      return json(422, {
        success: false,
        error: `Policy pack domain mismatch: the compiled policy pack does not contain relevant content for scope "${guidanceScope.replace(/_/g, " ")}". The knowledge base may not have documents for this domain. Please upload relevant policy documents and recompile.`,
        code: "DOMAIN_MISMATCH",
        diagnostics: {
          scope: guidanceScope,
          snippet_count: snippets.length,
          domain_relevant: domainRelevantSnippets,
          cross_domain: crossDomainSnippets,
        },
      });
    }

    // ── 3. Format snippets for LLM ──
    const snippetIdSet = new Set<string>();
    const formatted = snippets.map((s: { snippet_id: string; chunk_text: string }) => {
      snippetIdSet.add(s.snippet_id);
      return `Snippet ID: ${s.snippet_id}\nText: ${s.chunk_text}`;
    }).join("\n\n");

    // ── 4. Build scope context ──
    let scopeLine = `Session scope/type: ${guidanceScope.replace(/_/g, " ")}`;
    if (guidanceScope === "other" && guidanceScopeOther) {
      scopeLine += `\nScope details: ${guidanceScopeOther}`;
    }

    // ── 4b. Build template requirements block for prompt ──
    let templateRequirementsBlock = "";
    const isSchemaRich = schemaLoaded && schemaFields.length >= 8 && guidanceFieldCount >= 3;

    if (isSchemaRich) {
      const reqParts: string[] = [];
      reqParts.push("═══════════════════════════════════════════════════════════════");
      reqParts.push("TEMPLATE REQUIREMENTS — PRIMARY QUESTION DRIVER");
      reqParts.push("═══════════════════════════════════════════════════════════════");
      reqParts.push("");
      reqParts.push(`This template has ${schemaFields.length} fields across ${schemaSections.length || schemaCoverage.size} sections.`);
      reqParts.push(`${guidanceFieldCount} fields are marked as guidance-relevant. ${narrativeFieldCount} are narrative (free-text) fields.`);
      reqParts.push("");
      reqParts.push("YOUR QUESTIONS MUST PRIMARILY ADDRESS THESE TEMPLATE REQUIREMENTS.");
      reqParts.push("Policy snippets provide grounding and compliance context, but the template structure determines WHAT to ask about.");
      reqParts.push("");

      // Group requirements by section
      const bySection = new Map<string, TemplateRequirement[]>();
      for (const r of templateRequirements) {
        if (!bySection.has(r.section)) bySection.set(r.section, []);
        bySection.get(r.section)!.push(r);
      }

      const orderedSections = schemaSections.length > 0 ? schemaSections : Array.from(bySection.keys());
      for (const sec of orderedSections) {
        const reqs = bySection.get(sec);
        if (!reqs || reqs.length === 0) continue;

        reqParts.push(`── SECTION: ${sec} ──`);
        for (const r of reqs) {
          const priorityTag = r.priority === "high" ? "★ HIGH" : r.priority === "medium" ? "● MED" : "○ LOW";
          reqParts.push(`  [${priorityTag}] ${r.field_label} (${r.content_type})`);
          reqParts.push(`    → ${r.suggested_question_angle}`);
        }
        reqParts.push("");
      }

      reqParts.push("COVERAGE RULES:");
      reqParts.push("- At least 60% of your questions MUST be driven by HIGH or MEDIUM priority template requirements above.");
      reqParts.push("- Cover at least " + Math.min(Math.ceil(orderedSections.length * 0.4), 6) + " different sections from the template.");
      reqParts.push("- Narrative fields (free-text) are especially important — ensure at least 1-2 questions target narrative areas.");
      reqParts.push("- Do NOT let generic policy-only questions dominate. Template structure is your primary guide.");
      reqParts.push("- You may merge related template requirements into a single well-crafted question when natural.");
      reqParts.push("- Policy snippets help you ground and refine questions, but do NOT ignore template requirements that lack snippet support.");
      reqParts.push("");

      templateRequirementsBlock = reqParts.join("\n");
    }

    // ── 5. Build LLM prompt ──
    const systemPrompt = buildSystemPrompt(scopeLine, templateRequirementsBlock, isSchemaRich);

    const model = "gpt-4o";
    const completion = await openai.chat.completions.create({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: formatted },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("Model returned empty response");

    // ── 6. Parse and validate output ──
    const parsed = extractJSON(raw);
    if (!parsed.questions || !Array.isArray(parsed.questions)) throw new Error("Model did not return a questions array");
    if (parsed.questions.length > 12) throw new Error(`Model returned more than 12 questions (got ${parsed.questions.length})`);

    // Validate citation IDs (allow "TEMPLATE" as a virtual citation for schema-driven questions)
    for (const q of parsed.questions) {
      if (!q.question || !q.citations || q.citations.length === 0) throw new Error("Invalid question format: missing question or citations");
      for (const citation of q.citations) {
        if (citation === "TEMPLATE") continue; // virtual citation for schema-driven questions
        if (!snippetIdSet.has(citation)) throw new Error(`Invalid citation: ${citation}`);
      }
    }

    // ── 6b. Diagnostics ──
    const rawQuestionDiagnostics = parsed.questions.map((q: any, i: number) => ({
      index: i,
      question: q.question.slice(0, 150),
      category: q.category ?? "unknown",
      topic: classifyQuestionTopic(q.question),
      citation_count: q.citations?.length ?? 0,
      citations: (q.citations ?? []).map((c: string) => c.slice(0, 12)),
      source_tier: q.source_tier ?? "unknown",
      template_section: q.template_section ?? null,
    }));

    console.log(`[generate-guidance-phase1] RAW_QUESTIONS (${parsed.questions.length}): ${JSON.stringify(rawQuestionDiagnostics)}`);

    const housingRaw = rawQuestionDiagnostics.filter((d: any) => d.topic === "housing");
    console.log(`[generate-guidance-phase1] HOUSING_DIAGNOSTIC: generated=${housingRaw.length > 0}${housingRaw.length > 0 ? ` questions=${JSON.stringify(housingRaw.map((h: any) => h.question))}` : ""}`);

    // ── 6c. Schema-awareness diagnostics ──
    const schemaQuestionCount = parsed.questions.filter((q: any) => q.source_tier === "schema").length;
    const policyQuestionCount = parsed.questions.filter((q: any) => q.source_tier === "policy" || q.source_tier === "fallback").length;
    const unknownTierCount = parsed.questions.filter((q: any) => !q.source_tier || q.source_tier === "unknown").length;
    const templateSections = new Set(parsed.questions.map((q: any) => q.template_section).filter(Boolean));

    console.log(`[generate-guidance-phase1] SCHEMA_DIAGNOSTICS: schema_driven=${schemaQuestionCount} policy_driven=${policyQuestionCount} unknown_tier=${unknownTierCount} sections_covered=${templateSections.size} schema_loaded=${schemaLoaded} schema_rich=${isSchemaRich}`);

    // ── 7. Post-generation validation ──
    const validatedQuestions: ((typeof parsed.questions)[0] & {
      validation_status: QuestionOutcome;
      review_flags?: ReviewFlag[];
    })[] = [];
    const droppedQuestions: { question: string; reason: string; citationCount: number; details?: Record<string, unknown> }[] = [];
    const dropReasonCounts: Record<string, number> = {};
    const softFailCounts: Record<string, number> = {};
    const questionTraces: QuestionTrace[] = [];
    const finalStatusDistribution: Record<QuestionOutcome, number> = { pass: 0, warning: 0, dropped_hard: 0 };

    for (const q of parsed.questions) {
      const isSchemaQuestion = q.source_tier === "schema";
      const citedTexts = q.citations
        .filter((cid: string) => cid !== "TEMPLATE")
        .map((cid: string) => snippetMap.get(cid))
        .filter(Boolean) as string[];

      const signals: ValidationSignal[] = [];
      const reviewFlags: ReviewFlag[] = [];

      // ── Gate A: Support-strength (relaxed for schema questions) ──
      const supportResult = validateQuestionSupport(q.question, citedTexts, isSchemaQuestion);
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
      if (isSchemaQuestion && supportResult.supported) {
        reviewFlags.push("schema_driven_relaxed");
      }

      // ── Gate B: Client-facing style ──
      const styleResult = validateClientFacingStyle(q.question, citedTexts);
      if (!styleResult.clientFacing) {
        signals.push({ severity: "hard_fail", reason: styleResult.reason ?? "internal_worker_prompt", details: styleResult.details });
      }

      // ── Gate C: Specificity preservation ──
      const specResult = validateSpecificityPreservation(q.question, citedTexts);
      if (!specResult.preserved) {
        if (specResult.score < 0.15) {
          signals.push({ severity: "hard_fail", reason: "specificity_lost", details: { specificity_score: +specResult.score.toFixed(2), lost_qualifiers: specResult.lostQualifiers.map((lq) => lq.label) } });
        } else if (specResult.score < 0.4) {
          signals.push({ severity: "soft_fail", reason: "specificity_lost", details: { specificity_score: +specResult.score.toFixed(2), lost_qualifiers: specResult.lostQualifiers.map((lq) => lq.label) } });
          reviewFlags.push("specificity_soft_fail");
        }
      }

      // Build trace
      const trace: QuestionTrace = {
        original_question: q.question.slice(0, 200),
        source_tier: q.source_tier ?? "unknown",
        section_tag: q.template_section ?? "none",
        support_result: { supported: supportResult.supported, reason: supportResult.reason, details: supportResult.details },
        style_result: { clientFacing: styleResult.clientFacing, reason: styleResult.reason, details: styleResult.details },
        specificity_result: {
          preserved: specResult.preserved, score: +specResult.score.toFixed(2),
          lost_qualifiers: specResult.lostQualifiers.map((lq) => lq.label),
          concept_family: specResult.conceptFamily,
          considered: specResult.consideredQualifiers, ignored: specResult.ignoredQualifiers,
        },
        final_outcome: "pass",
      };

      // ── Stage D: Aggregation ──
      const hardFails = signals.filter((s) => s.severity === "hard_fail");
      const softFails = signals.filter((s) => s.severity === "soft_fail");

      if (hardFails.length > 0) {
        const primary = hardFails[0];
        const reason = primary?.reason ?? "unknown";
        dropReasonCounts[reason] = (dropReasonCounts[reason] ?? 0) + 1;
        trace.final_outcome = "dropped_hard";
        finalStatusDistribution.dropped_hard++;
        droppedQuestions.push({ question: q.question.slice(0, 120), reason, citationCount: q.citations.length, ...(primary?.details ? { details: primary.details } : {}) });
        questionTraces.push(trace);
        continue;
      }

      if (softFails.length >= 2) {
        const qualities = citedTexts.map(computeSnippetSupportQuality);
        const maxQuality = qualities.length > 0 ? Math.max(...qualities) : 0;
        // Schema questions get even more leniency on soft fails
        const qualityThreshold = isSchemaQuestion ? 0.2 : 0.4;
        if (maxQuality < qualityThreshold) {
          const primary = softFails[0];
          const reason = primary?.reason ?? "unknown";
          dropReasonCounts[reason] = (dropReasonCounts[reason] ?? 0) + 1;
          trace.final_outcome = "dropped_hard";
          finalStatusDistribution.dropped_hard++;
          droppedQuestions.push({ question: q.question.slice(0, 120), reason: `stacked_soft_fails:${softFails.map((s) => s.reason).join("+")}`, citationCount: q.citations.length });
          questionTraces.push(trace);
          continue;
        }
      }

      // PASS / WARNING
      for (const sf of softFails) {
        const r = sf.reason ?? "unknown";
        softFailCounts[r] = (softFailCounts[r] ?? 0) + 1;
      }

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
        console.log(`[generate-guidance-phase1] WARNING_KEPT: flags=[${reviewFlags.join(",")}] soft_fails=${softFails.length} q="${q.question.slice(0, 100)}"`);
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
        q: q.question.slice(0, 100), topic,
        tier: trace?.source_tier ?? "unknown",
        section: trace?.section_tag ?? "none",
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

    // Housing diagnostic
    const housingLifecycle = lifecycleLog.filter((l: any) => l.topic === "housing");
    if (housingLifecycle.length > 0) {
      for (const hl of housingLifecycle) {
        console.log(`[generate-guidance-phase1] HOUSING_OUTCOME: status=${hl.status} support=${hl.support} style=${hl.style} specificity=${hl.specificity_score} q="${hl.q}"`);
      }
    } else {
      console.log(`[generate-guidance-phase1] HOUSING_OUTCOME: no housing question was generated by model`);
    }

    console.log(`[generate-guidance-phase1] Validation: ${parsed.questions.length} generated → ${strongCount} pass, ${warningCount} warning, ${droppedQuestions.length} dropped`);
    console.log(`[generate-guidance-phase1] Final status distribution: ${JSON.stringify(finalStatusDistribution)}`);
    if (Object.keys(dropReasonCounts).length > 0) console.log(`[generate-guidance-phase1] Drop reason distribution: ${JSON.stringify(dropReasonCounts)}`);
    if (Object.keys(softFailCounts).length > 0) console.log(`[generate-guidance-phase1] Soft fail distribution (kept): ${JSON.stringify(softFailCounts)}`);
    if (droppedQuestions.length > 0) {
      for (const dq of droppedQuestions) {
        console.log(`[generate-guidance-phase1] DROPPED: reason=${dq.reason} citations=${dq.citationCount} q="${dq.question}"${dq.details ? " details=" + JSON.stringify(dq.details) : ""}`);
      }
    }

    // ── 7b. Section coverage diagnostic ──
    const validatedSections = new Set(validatedQuestions.map((q: any) => q.template_section).filter(Boolean));
    const validatedSchemaDriven = validatedQuestions.filter((q: any) => q.source_tier === "schema").length;
    console.log(`[generate-guidance-phase1] POST_VALIDATION_COVERAGE: sections_covered=${validatedSections.size}/${schemaSections.length} schema_driven_kept=${validatedSchemaDriven}/${schemaQuestionCount} total_kept=${validatedQuestions.length}`);

    // ── 7c. Validate timeline_considerations ──
    const TIMELINE_LANGUAGE_RE = /\b(within\s+\d+\s+(hours?|days?|business\s+days?|calendar\s+days?|weeks?|months?|years?)|within\s+the\s+past\s+(\d+\s+)?(months?|years?|days?)|during\s+the\s+past\s+(\d+\s+)?(months?|years?)|no\s+later\s+than\s+\d+\s+(days?|hours?|business\s+days?)|immediately)\b/i;

    const rawTimelines: { timeline: string; citations: string[] }[] = Array.isArray(parsed.timeline_considerations) ? parsed.timeline_considerations : [];
    const validatedTimelines: { timeline: string; citations: string[] }[] = [];
    let timelineDropped = 0;

    for (const tc of rawTimelines) {
      if (!tc.timeline || typeof tc.timeline !== "string" || !Array.isArray(tc.citations) || tc.citations.length === 0) { timelineDropped++; continue; }
      const allCitationsValid = tc.citations.every((cid: string) => snippetIdSet.has(cid));
      if (!allCitationsValid) { timelineDropped++; continue; }
      const citedTexts = tc.citations.map((cid: string) => snippetMap.get(cid)).filter(Boolean) as string[];
      const combinedCited = citedTexts.join(" ");
      if (!TIMELINE_LANGUAGE_RE.test(combinedCited)) { timelineDropped++; continue; }
      validatedTimelines.push({ timeline: tc.timeline, citations: tc.citations });
    }

    console.log(`[generate-guidance-phase1] TIMELINE_CONSIDERATIONS: generated=${rawTimelines.length} validated=${validatedTimelines.length} dropped=${timelineDropped}`);

    // ── 8. Check grounded count ──
    if (validatedQuestions.length < MIN_GROUNDED_QUESTIONS) {
      const reasonCode: GroundingCode = validatedQuestions.length === 0
        ? (lowInfoCount > snippets.length * 0.5 ? "LOW_INFORMATION_POLICY_PACK" : "INSUFFICIENT_GROUNDED_SUPPORT")
        : "WEAK_CITATION_SUPPORT";

      console.warn(`[generate-guidance-phase1] Insufficient grounded questions: ${validatedQuestions.length}/${parsed.questions.length}. Reason: ${reasonCode}`);

      const insufficientPayload = buildPayload({
        model, templateId, guidanceScope, guidanceScopeOther,
        validatedQuestions, validatedTimelines, strongCount, warningCount,
        droppedQuestions, dropReasonCounts, softFailCounts, finalStatusDistribution,
        rawQuestionDiagnostics, housingRaw, housingLifecycle,
        groundingStatus: "insufficient", groundingReason: reasonCode,
        parsedQuestionCount: parsed.questions.length,
        schemaLoaded, isSchemaRich, schemaQuestionCount, policyQuestionCount,
        validatedSections, schemaSections, guidanceFieldCount, narrativeFieldCount,
      });

      await supabase.rpc("update_session_guidance_phase1", { session_id_input: sessionIdResult.value, guidance_json: insufficientPayload });

      await logEyeEvent(supabase, {
        session_id: sessionIdResult.value, event_type: "tool.run.completed",
        serviceName: "generate-guidance-phase1",
        payload: { request_id: requestId, resource_type: "tool", resource_id: "generate_guidance_phase1", template_id: templateId, guidance_scope: guidanceScope, question_count: validatedQuestions.length, snippet_count: snippetIdSet.size, grounding_status: "insufficient", grounding_reason: reasonCode, result: "success" },
      });

      return json(200, { success: true, grounding_status: "insufficient", grounding_reason: reasonCode });
    }

    // ── 9. Build guidance payload ──
    const guidancePayload = buildPayload({
      model, templateId, guidanceScope, guidanceScopeOther,
      validatedQuestions, validatedTimelines, strongCount, warningCount,
      droppedQuestions, dropReasonCounts, softFailCounts, finalStatusDistribution,
      rawQuestionDiagnostics, housingRaw, housingLifecycle,
      groundingStatus: "sufficient", groundingReason: undefined,
      parsedQuestionCount: parsed.questions.length,
      schemaLoaded, isSchemaRich, schemaQuestionCount, policyQuestionCount,
      validatedSections, schemaSections, guidanceFieldCount, narrativeFieldCount,
    });

    // ── 10. Save to session ──
    const updateResponse = await supabase.rpc("update_session_guidance_phase1", { session_id_input: sessionIdResult.value, guidance_json: guidancePayload });
    if (!updateResponse || updateResponse.error) throw new Error(`Update RPC failed: ${updateResponse?.error?.message ?? "Unknown RPC error"}`);

    await logEyeEvent(supabase, {
      session_id: sessionIdResult.value, event_type: "tool.run.completed",
      serviceName: "generate-guidance-phase1",
      payload: {
        request_id: requestId, resource_type: "tool", resource_id: "generate_guidance_phase1",
        template_id: templateId, guidance_scope: guidanceScope,
        question_count: validatedQuestions.length, snippet_count: snippetIdSet.size,
        total_generated: parsed.questions.length, total_dropped: droppedQuestions.length,
        timeline_generated: rawTimelines.length, timeline_validated: validatedTimelines.length,
        schema_driven: schemaQuestionCount, policy_driven: policyQuestionCount,
        sections_covered: validatedSections.size,
        result: "success",
      },
    });

    return json(200, { success: true });
  } catch (err) {
    console.error("[generate-guidance-phase1] error:", err);
    await logEyeEvent(supabase, {
      session_id: sessionIdResult.value, event_type: "tool.run.failed",
      serviceName: "generate-guidance-phase1",
      payload: { request_id: requestId, resource_type: "tool", resource_id: "generate_guidance_phase1", result: "failure", severity: "WARN", reason_code: err instanceof Error ? err.message.slice(0, 200) : "unknown" },
    });
    return json(500, { error: err instanceof Error ? err.message : "Unknown error", code: "INTERNAL_ERROR" });
  }
});

/* ═══════════════════════════════════════════════════════════════
   SYSTEM PROMPT BUILDER
   Restructured so template requirements are the PRIMARY driver
   when a rich schema is available.
   ═══════════════════════════════════════════════════════════════ */

function buildSystemPrompt(scopeLine: string, templateRequirementsBlock: string, isSchemaRich: boolean): string {
  const schemaFirstPreamble = isSchemaRich ? `
═══════════════════════════════════════════════════════════════
SCHEMA-FIRST GENERATION MODE (ACTIVE)
═══════════════════════════════════════════════════════════════

A rich template schema is available. You MUST use it as the PRIMARY driver for question generation.

TWO-TIER QUESTION CONSTRUCTION:

TIER A — TEMPLATE-DRIVEN QUESTIONS (primary, aim for 60-80% of output):
- Derived directly from the template requirements listed below.
- Each question should help the caseworker gather information needed to complete a specific section/field of the template.
- These questions are grounded by the TEMPLATE STRUCTURE, not just by policy snippets.
- If a policy snippet supports or refines the question, cite it. If no snippet directly supports it but the template clearly needs this information, use "TEMPLATE" as the citation.
- Tag these with "source_tier": "schema" in the output.

TIER B — POLICY-GROUNDED SUPPLEMENTAL QUESTIONS (secondary, 20-40% of output):
- Only generated when the template requirements lack coverage for critical safety/risk/compliance topics.
- These fill genuine gaps — e.g., safety factors, timeline requirements, or compliance needs not already covered by template fields.
- Must cite actual policy snippet IDs.
- Tag these with "source_tier": "policy" in the output.

ANTI-GENERIC-COLLAPSE RULE (CRITICAL):
- Do NOT generate mostly generic domain questions (injury, housing safety, substance abuse) when the template has specific sections like Demographics, Intake Narrative, Behavioral Concerns, Services Required, etc.
- If you find yourself generating only broad safety/risk questions, STOP and reconsider the template requirements.
- The output should feel like "questions tailored to complete THIS specific form" not "generic social services intake questions."
- At least 4 different template sections must be represented in the final questions when the template has 5+ sections.

` : "";

  return `
You are assisting a social services caseworker preparing to conduct a structured client interview.

${scopeLine}

${schemaFirstPreamble}
${templateRequirementsBlock}
You are given policy excerpts relevant to the template being completed.

Your task is to generate UP TO 12 targeted interview questions that help the caseworker gather the factual information needed to complete the template accurately.

------------------------------------------------------------
DOMAIN SCOPE ENFORCEMENT (CRITICAL — READ FIRST)

The session scope is: ${scopeLine}

EVERY question you generate MUST be relevant to this scope and this template.
Do NOT generate questions about topics outside this scope, even if some policy snippets mention them.

Examples of WRONG behavior:
- If scope is "employment income", do NOT ask about children's safety, child welfare, foster care, Friend of the Court, substance abuse affecting children, or CPS.
- If scope is "housing homelessness", do NOT ask about child maltreatment or family court.
- If scope is "mental health", do NOT ask about employment barriers or housing eviction.

If a policy snippet is from a different domain (e.g., child welfare snippets in an employment session), IGNORE that snippet entirely. Do NOT generate questions from off-scope snippets.

Only generate questions that a caseworker would realistically ask in a ${scopeLine.replace("Session scope/type: ", "")} context.
------------------------------------------------------------

${isSchemaRich ? `
IMPORTANT: The template requirements above are your PRIMARY guide for what to ask about.
Policy snippets help you ground questions in compliance context, but template structure determines WHAT information categories to cover.
When a template requirement clearly needs information (e.g., a narrative field about "Reasons for Involvement"), generate a question for it even if no policy snippet perfectly matches — use "TEMPLATE" as citation.
` : `
CRITICAL GROUNDING RULES:
- Only generate a question if the cited policy snippet ACTUALLY SUPPORTS asking it.
- The cited snippet must contain substantive policy text that justifies the question.
- Do NOT infer generic intake questions from broad topical relevance alone.
- Quality and grounding matter more than quantity.
`}

------------------------------------------------------------
CLIENT-FACING QUESTION REQUIREMENT (CRITICAL)

Every question MUST be something a caseworker could realistically ask a client or involved party face-to-face in plain, conversational language.

GOOD source types for question generation:
- Template fields that need factual information from the client
- Assessment criteria that identify what facts to collect
- Required factual fields (injuries, household members, dates, services)
- Concrete risk/safety indicators
- Narrative sections that need client context and explanation

BAD source types — DO NOT generate questions from these:
- Internal worker narrative instructions
- Case classification or coding rules
- Legal justification requirements
- Supervisory review or approval requirements
- Response-option selection guidance
- Administrative compliance or audit requirements

TRANSFORMATION RULE:
If a template field or policy snippet describes what information must be collected, transform it into a natural client-facing question. Do NOT mirror jargon.

------------------------------------------------------------
SPECIFICITY PRESERVATION (CRITICAL)

When a cited snippet or template field includes a meaningful operational qualifier, PRESERVE it in the question.

Preserve: time windows, severity levels, safety context, role-specific facts, concrete conditions, operational purpose.

------------------------------------------------------------
QUESTION STYLE RULES:
- Plain spoken language
- Ask about concrete facts, events, people, dates, conditions, services
- Avoid policy jargon, legal terminology, process language
- Do NOT ask compliance-style or note-writing-style questions

------------------------------------------------------------
DISTINCT FACTUAL DIMENSIONS (CRITICAL)

Identify distinct factual dimensions. Generate SEPARATE questions for each dimension when not redundant.
Two questions are duplicates ONLY if they seek substantially the same answer.

${isSchemaRich ? `
SECTION COVERAGE:
- Distribute questions across different template sections.
- Do NOT cluster all questions in one topic area (e.g., safety/risk).
- Each question should tag which template section it addresses using "template_section".
` : `
CATEGORY GUIDANCE (up to 2 per category):
- Timeline: up to 2
- Individuals & Relationships: up to 2
- Event / Situation Details: up to 2
- Risk / Needs / Safety Factors: up to 2
- Agency / Service Involvement: up to 2
- Documentation / Evidence / Records: up to 2
`}

------------------------------------------------------------
TIMELINE CONSIDERATIONS (CRITICAL)

Extract explicit timeline-related policy requirements from the provided policy excerpts.
Only include when the timeframe is explicitly stated. Do NOT infer or invent deadlines.
Each must cite at least one valid snippet_id.
Return empty array if no explicit timeline language exists.

------------------------------------------------------------
CITATION REQUIREMENTS

- Each question MUST cite at least one valid snippet_id OR use "TEMPLATE" if the question is purely template-driven.
- The cited snippet should contain policy substance that supports or refines the question.
- For schema-driven questions where no snippet directly supports the topic, "TEMPLATE" is acceptable.
- Do not invent snippet IDs.

------------------------------------------------------------
Return STRICT JSON only in this format:

{
  "questions": [
    {
      "category": "Timeline",
      "question": "...",
      "citations": ["snippet_id_1"],
      "source_tier": "schema",
      "template_section": "Section Name"
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
- source_tier: "schema" for template-driven, "policy" for policy-grounded fallback
- template_section: the template section this question addresses (or null if not template-driven)
- timeline_considerations: any number (including 0)
- Do not invent snippet IDs
- No text outside JSON
`;
}

/* ═══════════════════════════════════════════════════════════════
   PAYLOAD BUILDER
   ═══════════════════════════════════════════════════════════════ */

function buildPayload(opts: {
  model: string; templateId: string; guidanceScope: string; guidanceScopeOther: string | null;
  validatedQuestions: any[]; validatedTimelines: any[]; strongCount: number; warningCount: number;
  droppedQuestions: any[]; dropReasonCounts: Record<string, number>; softFailCounts: Record<string, number>;
  finalStatusDistribution: Record<string, number>;
  rawQuestionDiagnostics: any[]; housingRaw: any[]; housingLifecycle: any[];
  groundingStatus: string; groundingReason?: string;
  parsedQuestionCount: number;
  schemaLoaded: boolean; isSchemaRich: boolean; schemaQuestionCount: number; policyQuestionCount: number;
  validatedSections: Set<string>; schemaSections: string[];
  guidanceFieldCount: number; narrativeFieldCount: number;
}) {
  return {
    generated_at: new Date().toISOString(),
    model: opts.model,
    template_id: opts.templateId,
    guidance_scope: opts.guidanceScope,
    ...(opts.guidanceScope === "other" && opts.guidanceScopeOther ? { guidance_scope_other: opts.guidanceScopeOther } : {}),
    questions: opts.validatedQuestions,
    timeline_considerations: opts.validatedTimelines,
    grounding_status: opts.groundingStatus,
    ...(opts.groundingReason ? { grounding_reason: opts.groundingReason } : {}),
    total_generated: opts.parsedQuestionCount,
    total_grounded: opts.validatedQuestions.length,
    total_grounded_strong: opts.strongCount,
    total_grounded_warning: opts.warningCount,
    total_dropped: opts.droppedQuestions.length,
    hard_fail_distribution: opts.dropReasonCounts,
    soft_fail_distribution: opts.softFailCounts,
    final_status_distribution: opts.finalStatusDistribution,
    _diagnostics: {
      schema_awareness: {
        schema_loaded: opts.schemaLoaded,
        schema_rich_mode: opts.isSchemaRich,
        schema_driven_generated: opts.schemaQuestionCount,
        policy_driven_generated: opts.policyQuestionCount,
        sections_in_schema: opts.schemaSections.length,
        sections_covered_in_output: opts.validatedSections.size,
        sections_covered_list: Array.from(opts.validatedSections),
        guidance_fields: opts.guidanceFieldCount,
        narrative_fields: opts.narrativeFieldCount,
      },
      raw_questions: opts.rawQuestionDiagnostics.map((d: any) => ({
        q: d.question, topic: d.topic, category: d.category,
        tier: d.source_tier, section: d.template_section,
      })),
      kept: opts.validatedQuestions.map((q: any) => ({
        q: q.question.slice(0, 120), status: q.validation_status,
        tier: q.source_tier, section: q.template_section,
      })),
      dropped: opts.droppedQuestions.map((dq: any) => ({ q: dq.question, reason: dq.reason })),
      housing: {
        generated: opts.housingRaw.length > 0,
        outcome: opts.housingLifecycle[0]?.status ?? null,
        raw: opts.housingRaw[0]?.question ?? null,
      },
    },
  };
}
