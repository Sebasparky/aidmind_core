/**
 * generate-guidance-phase2
 *
 * Maps interview notes to fact-based template fields using an LLM.
 * Uses the linked Phase 2 schema (template_phase2_schemas) as the
 * source of truth for field definitions and matching modes.
 *
 * Fields with matching_mode = "human_review_only" are SKIPPED entirely
 * and returned with answer = null, flagged for human review.
 *
 * Part of the Guidance Phase 2 pipeline.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { logEyeEvent } from "../_shared/eye.ts";

const SERVICE_NAME = "generate-guidance-phase2";
const MIN_NOTES_LENGTH = 20;

// ============================================================
// TYPES
// ============================================================

interface SchemaFieldInput {
  field_key: string;
  label: string;
  template_prompt: string;
  fact_based: boolean;
  answer_type: string;
  matching_mode: string;
  allowed_values: string[] | null;
  requires_direct_statement: boolean;
  return_null_if_missing: boolean;
  matching_guidance: string;
  requires_human_review: boolean;
  human_review_reason: string | null;
  sensitivity_level: string;
  ambiguity_level: string;
  extraction_priority: string;
}

/** Legacy field shape from kb_templates.metadata (backward compat only) */
interface LegacyFactField {
  field_key: string;
  label: string;
  type: string;
  question: string;
}

interface FieldAnswer {
  field_key: string;
  label: string;
  question: string;
  answer: string | null;
  confidence: "high" | "medium" | "low";
  supporting_excerpt: string | null;
  matching_mode: string;
  requires_human_review: boolean;
  human_review_reason: string | null;
  skipped: boolean;
}

interface Phase2Output {
  generated_at: string;
  model: string;
  answers: FieldAnswer[];
}

// ============================================================
// LEGACY TEMPLATE METADATA PARSING
// TODO(migration): Remove once all sessions use linked Phase 2 schemas.
// ============================================================

function extractFactBasedFieldsLegacy(metadata: Record<string, unknown>): LegacyFactField[] {
  const fields: LegacyFactField[] = [];
  const sections = metadata.sections;
  if (!Array.isArray(sections)) return fields;

  for (const section of sections) {
    if (!section || typeof section !== "object") continue;
    const sectionFields = (section as Record<string, unknown>).fields;
    if (!Array.isArray(sectionFields)) continue;

    for (const f of sectionFields) {
      if (!f || typeof f !== "object") continue;
      const field = f as Record<string, unknown>;
      if (field.fact_based !== true) continue;
      if (typeof field.field_key !== "string" || typeof field.question !== "string") continue;

      fields.push({
        field_key: field.field_key,
        label: (field.label as string) ?? field.field_key,
        type: (field.type as string) ?? "string",
        question: field.question,
      });
    }
  }

  return fields;
}

// ============================================================
// EXTRACTION WITH MATCHING_MODE CONTEXT
// ============================================================

/**
 * Build the extraction prompt fields list, giving the LLM explicit
 * matching_mode instructions per field so it does constrained matching.
 * v2.1: Groups fields by section for better context.
 */
function buildFieldInstructions(fields: SchemaFieldInput[]): string {
  // Group fields by section for better extraction context
  const sectionMap = new Map<string, SchemaFieldInput[]>();
  for (const f of fields) {
    const section = (f as any).section ?? "General";
    if (!sectionMap.has(section)) sectionMap.set(section, []);
    sectionMap.get(section)!.push(f);
  }

  const sections: Record<string, unknown>[] = [];
  for (const [sectionName, sectionFields] of sectionMap) {
    sections.push({
      section: sectionName,
      fields: sectionFields.map((f) => {
        const instruction: Record<string, unknown> = {
          field_key: f.field_key,
          label: f.label,
          matching_mode: f.matching_mode,
          matching_guidance: f.matching_guidance,
        };
        if (f.allowed_values && f.allowed_values.length > 0) {
          instruction.allowed_values = f.allowed_values;
        }
        if (f.requires_direct_statement) {
          instruction.requires_direct_statement = true;
        }
        return instruction;
      }),
    });
  }

  return JSON.stringify(sections, null, 2);
}

async function generatePhase2Answers(
  interviewNotes: string,
  fields: SchemaFieldInput[],
): Promise<{ answers: { field_key: string; answer: string | null; supporting_excerpt: string | null }[]; model: string }> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const model = "gpt-4o";

  const fieldsJson = buildFieldInstructions(fields);

  const systemPrompt = `You are a factual information extraction assistant for social services casework.

Your task is to extract factual answers from interview notes using CONSTRAINED MATCHING.

You will receive interview notes and a list of fields. Each field has a matching_mode that tells you EXACTLY how to extract:

MATCHING MODES:
- "select_one": Pick EXACTLY ONE value from the allowed_values list. If none clearly match, return null.
- "select_many": Pick ALL values from the allowed_values list that are clearly supported by the notes. Return as a comma-separated string (e.g. "Wages/Salary,Public Assistance"). Do NOT stop after the first match — scan the ENTIRE notes for every applicable allowed value. If none clearly match, return null.
- "boolean_decision": Return "Yes" or "No" only. If unclear, return null.
- "extract_number": Return ONLY a numeric value (digits only, no units or text). If no number is clearly stated, return null.
- "extract_date": Return a date normalized to YYYY-MM-DD format (e.g. "1991-08-14"). Convert common formats: "8/14/91" → "1991-08-14", "03/18/2026" → "2026-03-18", "August 14, 1991" → "1991-08-14". For 2-digit years, assume 00-29 = 2000s and 30-99 = 1900s. If the date is too ambiguous to normalize safely, return null.
- "extract_literal_span": Copy the SMALLEST SUFFICIENT exact text span from the notes. Return only the precise value — a name, a number, a single identifier — not the surrounding sentence or narrative. For example, if the field asks for a nickname and the notes say "most people call me Mari", return "Mari", not "Mari Torres" or the whole sentence. If not found, return null.
- "extract_short_text": Extract a compact factual phrase. Strip narrative wrappers like "she said that…" or "I wrote down…". Return only the factual content in a clean, compact form. For example: "Dr. Helen Morris, Sparrow Family Medicine, 517-555-2210" instead of "Dr. Helen Morris at Sparrow Family Medicine and I wrote down 517-555-2210 for that office". If not found, return null.

STRICT RULES:
- Do NOT guess, infer, interpret, or summarize.
- Do NOT combine unrelated statements.
- Do NOT generate opinions or recommendations.
- For select_one/select_many: ONLY use values from allowed_values. Spelling must match exactly.
- For select_many: you MUST check every allowed_value against the full notes. Return ALL that apply.
- For extract_literal_span: prefer the shortest exact answer that fully satisfies the field.
- For extract_short_text: return compact factual content, not narrative sentences from the notes.
- For extract_date: always normalize to YYYY-MM-DD when possible.
- If requires_direct_statement is true: only extract if explicitly stated, not implied.
- When in doubt, return null.
- supporting_excerpt must be an exact or near-exact quote from the notes.

Return JSON only:
{
  "answers": [
    {
      "field_key": "string",
      "answer": "string or null",
      "supporting_excerpt": "string or null"
    }
  ]
}`;

  const userPrompt = `INTERVIEW NOTES
---------------
${interviewNotes}

FIELDS TO EXTRACT
-----------------
${fieldsJson}

For each field, use the matching_mode to determine how to extract. Return JSON now.`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "unknown");
    throw new Error(`OpenAI API error ${response.status}: ${errText}`);
  }

  const completion = await response.json();
  const rawContent = completion.choices?.[0]?.message?.content;
  if (!rawContent || typeof rawContent !== "string") {
    throw new Error("OpenAI returned empty or invalid content");
  }

  let parsed: { answers?: unknown };
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    throw new Error("OpenAI returned invalid JSON");
  }

  if (!Array.isArray(parsed.answers)) {
    throw new Error("OpenAI response missing 'answers' array");
  }

  return {
    answers: parsed.answers.map((a: Record<string, unknown>) => ({
      field_key: String(a.field_key ?? ""),
      answer: a.answer != null ? String(a.answer) : null,
      supporting_excerpt: a.supporting_excerpt != null ? String(a.supporting_excerpt) : null,
    })),
    model,
  };
}

/** Legacy extraction for old sessions without linked schema */
async function generatePhase2Legacy(
  interviewNotes: string,
  factFields: LegacyFactField[],
): Promise<{ answers: FieldAnswer[]; model: string }> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const model = "gpt-4o";
  const fieldsJson = JSON.stringify(factFields.map((f) => ({ field_key: f.field_key, question: f.question })));

  const systemPrompt = `You are a factual information extraction assistant for social services casework.
Your task is to extract factual answers from interview notes.
For each field: if the notes contain the answer, extract it with a supporting excerpt. Otherwise return null.
STRICT RULES: Do NOT guess. Do NOT infer. Do NOT summarize. Answers must come directly from the notes.
Return JSON: { "answers": [{ "field_key": "string", "answer": "string or null", "supporting_excerpt": "string or null" }] }`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `INTERVIEW NOTES\n${interviewNotes}\n\nFIELDS\n${fieldsJson}\n\nReturn JSON.` },
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "unknown");
    throw new Error(`OpenAI API error ${response.status}: ${errText}`);
  }

  const completion = await response.json();
  const rawContent = completion.choices?.[0]?.message?.content;
  if (!rawContent) throw new Error("OpenAI returned empty content");

  const parsed = JSON.parse(rawContent);
  if (!Array.isArray(parsed.answers)) throw new Error("Missing 'answers' array");

  const fieldLookup = new Map(factFields.map((f) => [f.field_key, f]));
  const answers: FieldAnswer[] = parsed.answers.map((a: Record<string, unknown>) => {
    const key = String(a.field_key ?? "");
    const meta = fieldLookup.get(key);
    return {
      field_key: key,
      label: meta?.label ?? key,
      question: meta?.question ?? "",
      answer: a.answer != null ? String(a.answer) : null,
      confidence: (a.answer != null ? "high" : "low") as "high" | "medium" | "low",
      supporting_excerpt: a.supporting_excerpt != null ? String(a.supporting_excerpt) : null,
      matching_mode: "extract_short_text",
      requires_human_review: false,
      human_review_reason: null,
      skipped: false,
    };
  });

  return { answers, model };
}

// ============================================================
// HELPERS
// ============================================================

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ============================================================
// MAIN HANDLER
// ============================================================

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { success: false, error: "Method not allowed" });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { success: false, error: "Invalid JSON body" });
  }

  const sessionId = body.session_id;
  if (!sessionId || typeof sessionId !== "string" || sessionId.trim().length === 0) {
    return json(400, { success: false, error: "session_id is required" });
  }

  // ── Validate interview_notes from request body (transient, not persisted) ──
  const interviewNotes = body.interview_notes;
  if (!interviewNotes || typeof interviewNotes !== "string" || interviewNotes.trim().length < MIN_NOTES_LENGTH) {
    return json(400, {
      success: false,
      error: `interview_notes is required in the request body (minimum ${MIN_NOTES_LENGTH} characters)`,
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // ── Fetch session ──
  const { data: session, error: sessionErr } = await supabase
    .from("sessions")
    .select("id, tenant_id, template_id, phase2_schema_id, metadata")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionErr) {
    console.error(`[${SERVICE_NAME}] Session fetch error:`, sessionErr.message);
    return json(500, { success: false, error: "Failed to fetch session" });
  }
  if (!session) {
    return json(404, { success: false, error: "Session not found" });
  }
  if (!session.template_id) {
    return json(400, { success: false, error: "Session has no template_id assigned" });
  }

  // ── Try linked Phase 2 schema (preferred path) ──
  let allSchemaFields: SchemaFieldInput[] = [];
  let usedLinkedSchema = false;

  if (session.phase2_schema_id) {
    const { data: schema, error: schemaErr } = await supabase
      .from("template_phase2_schemas")
      .select("schema_json")
      .eq("id", session.phase2_schema_id)
      .maybeSingle();

    if (!schemaErr && schema?.schema_json) {
      const schemaData = schema.schema_json as Record<string, unknown>;
      if (Array.isArray(schemaData.fields)) {
        allSchemaFields = (schemaData.fields as Record<string, unknown>[]).map((f) => ({
          field_key: String(f.field_key ?? ""),
          label: String(f.label ?? ""),
          template_prompt: String(f.template_prompt ?? ""),
          fact_based: f.fact_based === true,
          answer_type: String(f.answer_type ?? "text"),
          matching_mode: String(f.matching_mode ?? "extract_short_text"),
          allowed_values: Array.isArray(f.allowed_values) ? f.allowed_values.map(String) : null,
          requires_direct_statement: f.requires_direct_statement !== false,
          return_null_if_missing: f.return_null_if_missing !== false,
          matching_guidance: String(f.matching_guidance ?? ""),
          requires_human_review: f.requires_human_review === true,
          human_review_reason: f.human_review_reason != null ? String(f.human_review_reason) : null,
          sensitivity_level: String(f.sensitivity_level ?? "low"),
          ambiguity_level: String(f.ambiguity_level ?? "low"),
          extraction_priority: String(f.extraction_priority ?? "medium"),
        }));
        usedLinkedSchema = true;
      }
    }
    if (allSchemaFields.length > 0) {
      console.log(`[${SERVICE_NAME}] Loaded ${allSchemaFields.length} fields from linked schema ${session.phase2_schema_id}`);
    }
  }

  // ── If using linked schema: split into extractable vs human-review-only ──
  if (usedLinkedSchema && allSchemaFields.length > 0) {
    const extractableFields = allSchemaFields.filter(
      (f) => f.fact_based && f.matching_mode !== "human_review_only",
    );
    const humanReviewFields = allSchemaFields.filter(
      (f) => !f.fact_based || f.matching_mode === "human_review_only",
    );

    console.log(
      `[${SERVICE_NAME}] ${extractableFields.length} auto-extractable, ${humanReviewFields.length} human-review-only/non-factual`,
    );

    if (extractableFields.length === 0) {
      // All fields need human review — return them all as skipped
      const skippedAnswers: FieldAnswer[] = allSchemaFields.map((f) => ({
        field_key: f.field_key,
        label: f.label,
        question: f.template_prompt,
        answer: null,
        confidence: "low" as const,
        supporting_excerpt: null,
        matching_mode: f.matching_mode,
        requires_human_review: true,
        human_review_reason: f.human_review_reason,
        skipped: true,
      }));

      return json(200, {
        success: true,
        session_id: sessionId,
        schema_source: "linked",
        fact_field_count: 0,
        answered_field_count: 0,
        human_review_field_count: allSchemaFields.length,
        model: "none",
        generated_at: new Date().toISOString(),
        answers: skippedAnswers,
      });
    }

    // ── Extract only auto-extractable fields ──
    let extractedAnswers: { field_key: string; answer: string | null; supporting_excerpt: string | null }[];
    let model: string;
    try {
      const result = await generatePhase2Answers(interviewNotes.trim(), extractableFields);
      extractedAnswers = result.answers;
      model = result.model;
    } catch (llmErr) {
      console.error(`[${SERVICE_NAME}] LLM error:`, llmErr);
      try {
        await logEyeEvent(supabase, {
          session_id: sessionId,
          event_type: "guidance.phase2.failed",
          serviceName: SERVICE_NAME,
          payload: {
            result: "failure",
            tenant_id: session.tenant_id,
            template_id: session.template_id,
            error: llmErr instanceof Error ? llmErr.message : "Unknown LLM error",
          },
        });
      } catch { /* never break on eye */ }
      return json(502, {
        success: false,
        error: llmErr instanceof Error ? llmErr.message : "LLM generation failed",
      });
    }

    // Build lookup for extracted answers
    const extractedLookup = new Map(extractedAnswers.map((a) => [a.field_key, a]));

    // Merge: extractable fields get LLM answers, human-review fields get skipped
    const allAnswers: FieldAnswer[] = allSchemaFields.map((f) => {
      const isExtractable = f.fact_based && f.matching_mode !== "human_review_only";
      if (isExtractable) {
        const extracted = extractedLookup.get(f.field_key);
        return {
          field_key: f.field_key,
          label: f.label,
          question: f.template_prompt,
          answer: extracted?.answer ?? null,
          confidence: (extracted?.answer != null ? "high" : "low") as "high" | "medium" | "low",
          supporting_excerpt: extracted?.supporting_excerpt ?? null,
          matching_mode: f.matching_mode,
          requires_human_review: f.requires_human_review,
          human_review_reason: f.human_review_reason,
          skipped: false,
        };
      }
      // Human-review-only or non-factual
      return {
        field_key: f.field_key,
        label: f.label,
        question: f.template_prompt,
        answer: null,
        confidence: "low" as const,
        supporting_excerpt: null,
        matching_mode: f.matching_mode,
        requires_human_review: true,
        human_review_reason: f.human_review_reason ?? "Not auto-extractable",
        skipped: true,
      };
    });

    const answeredCount = allAnswers.filter((a) => a.answer !== null).length;
    const generatedAt = new Date().toISOString();

    try {
      await logEyeEvent(supabase, {
        session_id: sessionId,
        event_type: "guidance.phase2.generated",
        serviceName: SERVICE_NAME,
        payload: {
          result: "success",
          schema_source: "linked",
          tenant_id: session.tenant_id,
          template_id: session.template_id,
          total_fields: allSchemaFields.length,
          extractable_fields: extractableFields.length,
          human_review_fields: humanReviewFields.length,
          answered_field_count: answeredCount,
          model,
        },
      });
    } catch { /* never break on eye */ }

    return json(200, {
      success: true,
      session_id: sessionId,
      schema_source: "linked",
      fact_field_count: extractableFields.length,
      answered_field_count: answeredCount,
      human_review_field_count: humanReviewFields.length,
      total_field_count: allSchemaFields.length,
      model,
      generated_at: generatedAt,
      answers: allAnswers,
    });
  }

  // ── FALLBACK: load from template metadata (backward compat) ──
  // TODO(migration): This fallback exists for sessions created before the
  // Phase 2 schema architecture was introduced. Once all active sessions
  // have a linked phase2_schema_id, this block should be removed.
  console.warn(
    `[${SERVICE_NAME}] FALLBACK: No linked Phase 2 schema for session ${sessionId}. ` +
    `Loading fact fields from kb_templates.metadata. This is deprecated — ` +
    `sessions should have phase2_schema_id set during Guidance Phase 1.`,
  );

  const { data: template, error: templateErr } = await supabase
    .from("kb_templates")
    .select("id, tenant_id, name, version, metadata")
    .eq("id", session.template_id)
    .maybeSingle();

  if (templateErr) {
    console.error(`[${SERVICE_NAME}] Template fetch error:`, templateErr.message);
    return json(500, { success: false, error: "Failed to fetch template" });
  }
  if (!template) {
    return json(404, { success: false, error: "Template not found" });
  }
  if (!template.metadata || typeof template.metadata !== "object") {
    return json(400, { success: false, error: "Template metadata is null or malformed" });
  }

  const legacyFields = extractFactBasedFieldsLegacy(template.metadata as Record<string, unknown>);
  if (legacyFields.length === 0) {
    return json(400, {
      success: false,
      error: "No fact-based fields found in template schema or metadata",
    });
  }

  let legacyResult: { answers: FieldAnswer[]; model: string };
  try {
    legacyResult = await generatePhase2Legacy(interviewNotes.trim(), legacyFields);
  } catch (llmErr) {
    console.error(`[${SERVICE_NAME}] Legacy LLM error:`, llmErr);
    try {
      await logEyeEvent(supabase, {
        session_id: sessionId,
        event_type: "guidance.phase2.failed",
        serviceName: SERVICE_NAME,
        payload: {
          result: "failure",
          schema_source: "legacy_fallback",
          tenant_id: session.tenant_id,
          template_id: session.template_id,
          error: llmErr instanceof Error ? llmErr.message : "Unknown LLM error",
        },
      });
    } catch { /* never break on eye */ }
    return json(502, {
      success: false,
      error: llmErr instanceof Error ? llmErr.message : "LLM generation failed",
    });
  }

  const answeredCount = legacyResult.answers.filter((a) => a.answer !== null).length;

  try {
    await logEyeEvent(supabase, {
      session_id: sessionId,
      event_type: "guidance.phase2.generated",
      serviceName: SERVICE_NAME,
      payload: {
        result: "success",
        schema_source: "legacy_fallback",
        tenant_id: session.tenant_id,
        template_id: session.template_id,
        fact_field_count: legacyFields.length,
        answered_field_count: answeredCount,
        model: legacyResult.model,
      },
    });
  } catch { /* never break on eye */ }

  return json(200, {
    success: true,
    session_id: sessionId,
    schema_source: "legacy_fallback",
    fact_field_count: legacyFields.length,
    answered_field_count: answeredCount,
    model: legacyResult.model,
    generated_at: new Date().toISOString(),
    answers: legacyResult.answers,
  });
});
