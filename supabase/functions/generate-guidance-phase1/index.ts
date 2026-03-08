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
  "what", "when", "where", "which", "does", "have", "been", "this", "that",
  "with", "from", "your", "about", "into", "they", "their", "there", "were",
  "will", "would", "could", "should", "other", "first", "last", "most",
  "more", "than", "each", "some", "also", "currently", "specific", "please",
  "describe", "explain", "provide", "information", "details", "related",
  "involved", "during", "before", "after", "between", "through", "under",
]);

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
  | "classification_or_justification_prompt";

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

  const lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);
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
 * Extract meaningful (non-generic) terms from text.
 */
function extractMeaningfulTerms(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !GENERIC_WORDS.has(w));
}

/**
 * Multi-gate support-strength validator with hard/soft hierarchy.
 *
 * HARD gates (immediate reject):
 *   Gate 1: empty / missing snippet text
 *   Gate 2: snippet text too short
 *   Gate 3: all snippets structurally weak (headings, outlines, low prose)
 *
 * SOFT gates (reject only in combination or when snippet quality is low):
 *   Gate 4: concept coverage (question introduces many unsupported terms)
 *   Gate 5: topical overlap (low literal term overlap)
 *
 * A question passes if it clears all hard gates AND at least one of:
 *   - snippet quality is high enough to tolerate soft-gate weakness
 *   - soft gates are not both weak
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
  // These are evaluated together; rejection requires combined weakness.

  const questionTerms = extractMeaningfulTerms(question);
  const snippetTermSet = new Set(extractMeaningfulTerms(combinedText));

  // If question has very few meaningful terms, skip soft gates (simple question = fine)
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

  // Determine quality tier for adaptive thresholds
  // High-quality snippets get more tolerance for wording mismatch
  const isHighQuality = maxQuality >= 0.8 && avgQuality >= 0.6;
  const isMediumQuality = maxQuality >= 0.5;

  // Concept coverage: only hard-reject at very extreme levels,
  // and only when snippet quality can't compensate
  const conceptCoverageThreshold = isHighQuality ? 0.10 : isMediumQuality ? 0.15 : 0.20;
  const conceptFailed = coverageRatio < conceptCoverageThreshold;

  // Topical overlap: secondary signal
  const overlapThreshold = isHighQuality ? 0.08 : isMediumQuality ? 0.12 : 0.18;
  const overlapFailed = coverageRatio < overlapThreshold;

  // Decision logic: reject only when soft signals agree the question is weak
  // For high-quality snippets: both must fail (very tolerant of paraphrasing)
  // For medium-quality: concept failure alone is enough if very low
  // For low-quality: either failure triggers rejection
  if (isHighQuality) {
    // High-quality prose: only reject if coverage is extremely low
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
    // Otherwise: high-quality snippet with some overlap → allow
    return { supported: true };
  }

  if (isMediumQuality) {
    // Medium quality: reject if concept coverage is very poor
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
    // Medium quality + some coverage → allow
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

/**
 * Patterns that indicate a question is really an internal worker/compliance prompt,
 * not a natural client-facing interview question.
 */
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

/**
 * Phrases in a question that strongly suggest internal/process language
 * rather than client-facing interview language.
 */
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

/**
 * Phrases in cited snippets that indicate the source is mainly an
 * internal documentation/workflow instruction rather than interviewable content.
 */
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

/**
 * Validate whether a generated question is truly client/caregiver-facing
 * rather than an internal worker instruction, documentation prompt, or
 * classification/justification prompt.
 *
 * Returns { clientFacing: true } or { clientFacing: false, reason, details }.
 */
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
  // If most of the snippet evidence is documentation instructions and the
  // question also has at least one internal phrase, reject
  if (docOnlyHits >= 2 && internalPhraseHits >= 1) {
    return {
      clientFacing: false,
      reason: "documentation_only_source",
      details: { doc_only_hits: docOnlyHits, internal_phrase_hits: internalPhraseHits },
    };
  }
  // Strong documentation-only signal even without question phrases
  if (docOnlyHits >= 3) {
    return {
      clientFacing: false,
      reason: "documentation_only_source",
      details: { doc_only_hits: docOnlyHits },
    };
  }

  // ── Check 4: Policy jargon not transformed ──
  // Question uses highly technical/process language that wouldn't be natural
  // in a client conversation
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
      // Only reject if the snippet is also mainly classification/justification
      if (docOnlyHits >= 1 || combinedSnippets.includes("reasons for not using") ||
          combinedSnippets.includes("must explain why") ||
          combinedSnippets.includes("justify")) {
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

/* ── Insufficient grounding reason codes ── */
type GroundingCode =
  | "INSUFFICIENT_GROUNDED_SUPPORT"
  | "LOW_INFORMATION_POLICY_PACK"
  | "WEAK_CITATION_SUPPORT";

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

  // ── Validate session_id ──────────────────────────────────────
  if (!session_id) {
    return json(400, { error: "session_id is required", code: "SESSION_ID_REQUIRED" });
  }

  const sessionIdResult = validateUuid("session_id", session_id);
  if (!sessionIdResult.ok) {
    return json(400, { error: "Invalid session_id format", code: "INVALID_SESSION_ID" });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── Eye: tool.run.started ────────────────────────────────────
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
    // ── 1. Fetch session and enforce template_id + guidance_scope ──
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

    // ── 2. Retrieve policy snippets ────────────────────────────
    const snippetResponse = await supabase.rpc("get_policy_snippets_for_session", {
      session_id_input: sessionIdResult.value,
    });

    if (!snippetResponse || snippetResponse.error) {
      throw new Error(
        `Snippet RPC failed: ${snippetResponse?.error?.message ?? "Unknown RPC error"}`
      );
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
      const lines = (s.chunk_text || "").split("\n").map((l: string) => l.trim()).filter(Boolean);
      const proseLines = lines.filter((l: string) => l.length > 50 && /[.,;:?!]/.test(l));
      if (isLowInfo || (lines.length > 3 && proseLines.length === 0)) {
        lowInfoCount++;
      }
    }

    if (lowInfoCount > snippets.length * 0.8) {
      console.warn(`[generate-guidance-phase1] Policy pack is ${Math.round((lowInfoCount/snippets.length)*100)}% low-info snippets`);
      // Still attempt generation but log warning — validation will catch weak questions
    }

    // ── 3. Format snippets for LLM ─────────────────────────────
    const snippetIdSet = new Set<string>();
    const formatted = snippets
      .map((s: { snippet_id: string; chunk_text: string }) => {
        snippetIdSet.add(s.snippet_id);
        return `Snippet ID: ${s.snippet_id}\nText: ${s.chunk_text}`;
      })
      .join("\n\n");

    // ── 4. Build scope context line ──────────────────────────
    let scopeLine = `Session scope/type: ${guidanceScope}`;
    if (guidanceScope === "other" && guidanceScopeOther) {
      scopeLine += `\nScope details: ${guidanceScopeOther}`;
    }

    // ── 5. Call LLM ────────────────────────────────────────────
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
  ]
}

Return 0 to 12 questions. An empty array is valid if evidence is insufficient.
No text outside JSON.
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

    // ── 6. Parse and validate output ───────────────────────────
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

    // ── 7. Post-generation validation: support-strength + client-facing style ──
    const validatedQuestions: typeof parsed.questions = [];
    const droppedQuestions: { question: string; reason: string; citationCount: number; details?: Record<string, unknown> }[] = [];
    const dropReasonCounts: Record<string, number> = {};

    for (const q of parsed.questions) {
      const citedTexts = q.citations
        .map((cid: string) => snippetMap.get(cid))
        .filter(Boolean) as string[];

      // Gate A: Support-strength validation (hard/soft gates)
      const supportResult = validateQuestionSupport(q.question, citedTexts);
      if (!supportResult.supported) {
        const reason = supportResult.reason ?? "unknown";
        dropReasonCounts[reason] = (dropReasonCounts[reason] ?? 0) + 1;
        droppedQuestions.push({
          question: q.question.slice(0, 120),
          reason,
          citationCount: q.citations.length,
          ...(supportResult.details ? { details: supportResult.details } : {}),
        });
        continue;
      }

      // Gate B: Client-facing style validation
      const styleResult = validateClientFacingStyle(q.question, citedTexts);
      if (!styleResult.clientFacing) {
        const reason = styleResult.reason ?? "internal_worker_prompt";
        dropReasonCounts[reason] = (dropReasonCounts[reason] ?? 0) + 1;
        droppedQuestions.push({
          question: q.question.slice(0, 120),
          reason,
          citationCount: q.citations.length,
          ...(styleResult.details ? { details: styleResult.details } : {}),
        });
        continue;
      }

      validatedQuestions.push(q);
    }

    console.log(
      `[generate-guidance-phase1] Validation: ${parsed.questions.length} generated → ${validatedQuestions.length} grounded+client-facing, ${droppedQuestions.length} dropped`
    );
    if (Object.keys(dropReasonCounts).length > 0) {
      console.log(`[generate-guidance-phase1] Drop reason distribution: ${JSON.stringify(dropReasonCounts)}`);
    }
    if (droppedQuestions.length > 0) {
      for (const dq of droppedQuestions) {
        console.log(`[generate-guidance-phase1] DROPPED: reason=${dq.reason} citations=${dq.citationCount} q="${dq.question}"${dq.details ? " details=" + JSON.stringify(dq.details) : ""}`);
      }
    }

    // ── 8. Check if we have enough grounded questions ──────────
    if (validatedQuestions.length < MIN_GROUNDED_QUESTIONS) {
      const reasonCode: GroundingCode = validatedQuestions.length === 0
        ? (lowInfoCount > snippets.length * 0.5 ? "LOW_INFORMATION_POLICY_PACK" : "INSUFFICIENT_GROUNDED_SUPPORT")
        : "WEAK_CITATION_SUPPORT";

      console.warn(
        `[generate-guidance-phase1] Insufficient grounded questions: ${validatedQuestions.length}/${parsed.questions.length}. Reason: ${reasonCode}`
      );

      // Save the insufficient-grounding result to session metadata so UI can display it
      const insufficientPayload = {
        generated_at: new Date().toISOString(),
        model,
        template_id: templateId,
        guidance_scope: guidanceScope,
        ...(guidanceScope === "other" && guidanceScopeOther ? { guidance_scope_other: guidanceScopeOther } : {}),
        questions: validatedQuestions, // may be 0-2 questions
        grounding_status: "insufficient" as const,
        grounding_reason: reasonCode,
        total_generated: parsed.questions.length,
        total_grounded: validatedQuestions.length,
        total_dropped: droppedQuestions.length,
        drop_reason_distribution: dropReasonCounts,
      };

      await supabase.rpc("update_session_guidance_phase1", {
        session_id_input: sessionIdResult.value,
        guidance_json: insufficientPayload,
      });

      // ── Eye: tool.run.completed (with insufficient grounding) ──
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

    // ── 9. Build guidance payload with validated questions ────
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
      total_dropped: droppedQuestions.length,
    };

    // ── 10. Save to session ────────────────────────────────────
    const updateResponse = await supabase.rpc("update_session_guidance_phase1", {
      session_id_input: sessionIdResult.value,
      guidance_json: guidancePayload,
    });

    if (!updateResponse || updateResponse.error) {
      throw new Error(
        `Update RPC failed: ${updateResponse?.error?.message ?? "Unknown RPC error"}`
      );
    }

    // ── Eye: tool.run.completed ────────────────────────────────
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

    // ── Eye: tool.run.failed ───────────────────────────────────
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
