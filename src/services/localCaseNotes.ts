/**
 * localCaseNotes.ts — Local Phase 2 extraction service.
 *
 * Replaces the generate-guidance-phase2 edge function with a fully
 * local pipeline: fetch schema from DB, reduce fields, call local
 * Ollama model, merge results.
 */

import { supabase } from "@/integrations/supabase/client";
import { callLocalModel, parseModelResponse } from "./localModel";

// ── Types ──────────────────────────────────────────────────

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
  section?: string;
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

export interface LocalPhase2Response {
  success: boolean;
  session_id: string;
  schema_source: string;
  fact_field_count: number;
  answered_field_count: number;
  human_review_field_count: number;
  total_field_count?: number;
  model: string;
  generated_at: string;
  answers: FieldAnswer[];
  error?: string;
}

// ── System prompt (identical to edge function) ─────────────

const SYSTEM_PROMPT = `You are a factual information extraction assistant for social services casework.

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

// ── Field instructions builder (identical to edge function) ─

function buildFieldInstructions(fields: SchemaFieldInput[]): string {
  const sectionMap = new Map<string, SchemaFieldInput[]>();
  for (const f of fields) {
    const section = f.section ?? "General";
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

// ── Main function ──────────────────────────────────────────

const MIN_NOTES_LENGTH = 20;
const LOCAL_MODEL = "llama3";

/**
 * Runs Phase 2 extraction locally via Ollama, replicating
 * the generate-guidance-phase2 edge function behavior.
 */
export async function runLocalCaseNotesExtraction(
  sessionId: string,
  interviewNotes: string,
): Promise<LocalPhase2Response> {
  if (!interviewNotes?.trim() || interviewNotes.trim().length < MIN_NOTES_LENGTH) {
    throw new Error(`Interview notes must be at least ${MIN_NOTES_LENGTH} characters.`);
  }

  // 1. Fetch session to get phase2_schema_id and template_id
  const { data: session, error: sessErr } = await supabase
    .from("sessions")
    .select("id, tenant_id, template_id, phase2_schema_id, metadata")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessErr) throw new Error(`Failed to fetch session: ${sessErr.message}`);
  if (!session) throw new Error("Session not found");
  if (!session.template_id) throw new Error("Session has no template_id assigned");

  // 2. Fetch linked Phase 2 schema
  let allSchemaFields: SchemaFieldInput[] = [];

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
          section: f.section != null ? String(f.section) : undefined,
        }));
      }
    }
  }

  if (allSchemaFields.length === 0) {
    throw new Error("No Phase 2 schema fields found. Ensure template has a linked schema.");
  }

  // 3. Split into extractable vs human-review-only
  const extractableFields = allSchemaFields.filter(
    (f) => f.fact_based && f.matching_mode !== "human_review_only",
  );
  const humanReviewFields = allSchemaFields.filter(
    (f) => !f.fact_based || f.matching_mode === "human_review_only",
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

    return {
      success: true,
      session_id: sessionId,
      schema_source: "linked_local",
      fact_field_count: 0,
      answered_field_count: 0,
      human_review_field_count: allSchemaFields.length,
      model: "none",
      generated_at: new Date().toISOString(),
      answers: skippedAnswers,
    };
  }

  // 4. Build prompt (identical structure to edge function)
  const fieldsJson = buildFieldInstructions(extractableFields);
  const userPrompt = `INTERVIEW NOTES
---------------
${interviewNotes.trim()}

FIELDS TO EXTRACT (grouped by template section)
-------------------------------------------------
${fieldsJson}

For each field, use the matching_mode to determine how to extract. Fields are grouped by their template section — use section context to better understand what each field is asking for. Return JSON now.`;

  // 5. Call local Ollama model
  const rawContent = await callLocalModel(SYSTEM_PROMPT, userPrompt, LOCAL_MODEL);

  // 6. Parse response
  const parsed = parseModelResponse(rawContent);
  if (!Array.isArray(parsed.answers)) {
    throw new Error("Invalid model response: missing 'answers' array");
  }

  const extractedAnswers = parsed.answers.map((a: Record<string, unknown>) => ({
    field_key: String(a.field_key ?? ""),
    answer: a.answer != null ? String(a.answer) : null,
    supporting_excerpt: a.supporting_excerpt != null ? String(a.supporting_excerpt) : null,
  }));

  // 7. Merge: extractable fields get LLM answers, human-review fields get skipped
  const extractedLookup = new Map<string, { field_key: string; answer: string | null; supporting_excerpt: string | null }>(
    extractedAnswers.map((a: any) => [a.field_key, a])
  );

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

  return {
    success: true,
    session_id: sessionId,
    schema_source: "linked_local",
    fact_field_count: extractableFields.length,
    answered_field_count: answeredCount,
    human_review_field_count: humanReviewFields.length,
    total_field_count: allSchemaFields.length,
    model: LOCAL_MODEL,
    generated_at: new Date().toISOString(),
    answers: allAnswers,
  };
}
