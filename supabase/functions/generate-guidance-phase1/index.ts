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
  | "unsupported_question_concepts";

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
 * Multi-gate support-strength validator.
 *
 * Gate 1: empty / missing snippet text
 * Gate 2: snippet text too short
 * Gate 3: all snippets structurally weak (headings, outlines, low prose)
 * Gate 4: question introduces too many unsupported concepts
 * Gate 5: weak topical overlap (secondary signal)
 */
function validateQuestionSupport(
  question: string,
  citedSnippetTexts: string[],
): { supported: boolean; reason?: DropReason; details?: Record<string, unknown> } {
  // Gate 1: no snippets at all
  if (citedSnippetTexts.length === 0) {
    return { supported: false, reason: "no_snippet_text" };
  }

  const combinedText = citedSnippetTexts.join(" ");
  const combinedLen = combinedText.replace(/\s+/g, " ").trim().length;

  // Gate 2: combined text too short
  if (combinedLen < 80) {
    return { supported: false, reason: "snippet_too_short", details: { combinedLen } };
  }

  // Gate 3: structural quality check (aligned with compile-time computeInfoQuality)
  const qualities = citedSnippetTexts.map(computeSnippetSupportQuality);
  const avgQuality = qualities.reduce((a, b) => a + b, 0) / qualities.length;
  const maxQuality = Math.max(...qualities);

  // If even the best snippet is structurally weak, reject
  if (maxQuality < SNIPPET_QUALITY_THRESHOLD) {
    return {
      supported: false,
      reason: "weak_structural_support",
      details: { avgQuality: +avgQuality.toFixed(2), maxQuality: +maxQuality.toFixed(2) },
    };
  }

  // Gate 4: concept coverage — does the question introduce too many unsupported concepts?
  const questionTerms = extractMeaningfulTerms(question);
  const snippetTermSet = new Set(extractMeaningfulTerms(combinedText));

  if (questionTerms.length >= 3) {
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

    // If the question introduces >70% unsupported concepts, reject
    if (coverageRatio < 0.25) {
      return {
        supported: false,
        reason: "unsupported_question_concepts",
        details: {
          coverageRatio: +coverageRatio.toFixed(2),
          questionTermCount: questionTerms.length,
          matchedCount: matched,
          sampleUnmatched: unmatched.slice(0, 5),
        },
      };
    }
  }

  // Gate 5: topical overlap — secondary signal, only if snippets are structurally okay
  // Weight this gate less if structural quality is high
  if (questionTerms.length >= 3) {
    let matched = 0;
    for (const term of questionTerms) {
      if (snippetTermSet.has(term)) matched++;
    }
    const overlapRatio = matched / questionTerms.length;

    // Only reject for weak overlap if structural quality is also mediocre
    const overlapThreshold = avgQuality > 0.7 ? 0.12 : 0.18;
    if (overlapRatio < overlapThreshold) {
      return {
        supported: false,
        reason: "weak_topical_overlap",
        details: {
          overlapRatio: +overlapRatio.toFixed(2),
          avgSnippetQuality: +avgQuality.toFixed(2),
        },
      };
    }
  }

  return { supported: true };
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

Your task is to generate UP TO 12 targeted interview questions that the caseworker should ask the client to gather the factual information needed to complete the template accurately and in compliance with policy.

CRITICAL GROUNDING RULES:

- Only generate a question if the cited policy snippet ACTUALLY SUPPORTS asking it.
- The cited snippet must contain substantive policy text that justifies the question — not just a topically related heading, table of contents entry, or section label.
- Do NOT infer generic intake questions from broad topical relevance alone.
- Do NOT use structural headings, contents pages, index pages, or section listings as support unless they contain substantive guidance text.
- It is ACCEPTABLE and PREFERRED to return fewer than 12 questions if the policy excerpts do not provide sufficient grounding for more.
- Quality and grounding matter more than quantity. 4 well-grounded questions are better than 12 weakly grounded ones.
- If the policy excerpts are too weak, too structural, or too vague to support any meaningful questions, return an empty questions array.

These must be CLIENT-FACING, FACT-FIRST questions.

DO NOT:
- Summarize policy
- Ask abstract legal or regulatory questions
- Ask the client to interpret definitions or determine eligibility
- Ask vague filler questions such as "Is there anything else?"
- Generate questions that go beyond what the cited snippet actually says
- Stretch a citation to cover a question the snippet does not support

The goal is to generate structured investigative questions that help capture concrete facts, grounded in real policy text.

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

- Seek specific factual information (who, what, when, where, how)
- Be answerable with recordable information such as:
    - Dates or times
    - Names and roles
    - Locations
    - Actions taken
    - Current status
    - Documents or agencies involved
- Be phrased in plain, neutral professional language
- Avoid duplication or minor rewording of the same question
- Avoid multi-part compound questions — focus on the most critical fact

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

    // ── 7. Post-generation support-strength validation ─────────
    const validatedQuestions: typeof parsed.questions = [];
    const droppedQuestions: { question: string; reason: string; citationCount: number; details?: Record<string, unknown> }[] = [];

    for (const q of parsed.questions) {
      const citedTexts = q.citations
        .map((cid: string) => snippetMap.get(cid))
        .filter(Boolean) as string[];

      const result = validateQuestionSupport(q.question, citedTexts);

      if (result.supported) {
        validatedQuestions.push(q);
      } else {
        droppedQuestions.push({
          question: q.question.slice(0, 100),
          reason: result.reason ?? "unknown",
          citationCount: q.citations.length,
          ...(result.details ? { details: result.details } : {}),
        });
      }
    }

    console.log(
      `[generate-guidance-phase1] Validation: ${parsed.questions.length} generated → ${validatedQuestions.length} grounded, ${droppedQuestions.length} dropped`
    );
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
