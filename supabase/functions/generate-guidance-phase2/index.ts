/**
 * generate-guidance-phase2
 *
 * Maps interview notes to fact-based template fields using an LLM.
 * Only answers fields marked `fact_based: true` in the template metadata.
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

interface FactField {
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
}

interface Phase2Output {
  generated_at: string;
  model: string;
  answers: FieldAnswer[];
}

// ============================================================
// TEMPLATE METADATA PARSING
// ============================================================

function extractFactBasedFields(metadata: Record<string, unknown>): FactField[] {
  const fields: FactField[] = [];
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
// MODEL ABSTRACTION LAYER
// ============================================================

/**
 * Generate fact-based field mappings from interview notes.
 *
 * This function is the single integration point with the LLM.
 * To swap to a local model later, replace the implementation here
 * without changing the rest of the edge function.
 */
async function generatePhase2FieldMappings(
  interviewNotes: string,
  factFields: FactField[],
): Promise<{ answers: FieldAnswer[]; model: string }> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const model = "gpt-4o";

  const fieldsJson = JSON.stringify(
    factFields.map((f) => ({
      field_key: f.field_key,
      question: f.question,
    })),
  );

  const systemPrompt = `You are a factual information extraction assistant for social services casework.

Your task is to extract factual answers from interview notes.

You will receive:

1. Interview notes from a caseworker interview
2. A list of template fields that require factual answers

The template fields have already been filtered to include ONLY fact-based questions.

This means:
- Every field is valid.
- You do NOT need to determine whether a field is opinionated or appropriate.
- Your only task is to determine whether the interview notes contain the answer.

For each field:
• If the interview notes clearly contain the information needed to answer the question, extract the answer.
• The answer must come directly from the notes.
• Provide a supporting_excerpt that is an exact or near-exact quote from the notes that proves the answer.

If the notes do NOT contain the information needed:
• Set "answer": null
• Set "supporting_excerpt": null

STRICT RULES:
- Do NOT guess.
- Do NOT infer.
- Do NOT interpret.
- Do NOT summarize the notes.
- Do NOT combine unrelated statements to form an answer.
- Do NOT generate opinions, risk judgments, or recommendations.

Answers must be short factual phrases taken from the notes.
If the supporting_excerpt text does not appear in the interview notes, the answer is invalid.

Return JSON only in the following format:
{
  "answers": [
    {
      "field_key": "string",
      "answer": "string or null",
      "supporting_excerpt": "string or null"
    }
  ]
}

If the supporting_excerpt text does not appear in the interview notes, the answer is invalid.`;

  const userPrompt = `INTERVIEW NOTES
---------------
${interviewNotes}

FIELDS TO ANSWER
----------------
${fieldsJson}

For each field determine whether the interview notes contain the factual answer.
Return the JSON response now.`;

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

  // Build a lookup from factFields so we can reattach label/question
  const fieldLookup = new Map(factFields.map((f) => [f.field_key, f]));

  // Validate, normalise, and reattach metadata from factFields
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

  // ── Fetch session (for template_id and tenant context only) ─
  const { data: session, error: sessionErr } = await supabase
    .from("sessions")
    .select("id, tenant_id, template_id, metadata")
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

  // ── Fetch template ────────────────────────────────────────
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

  // ── Extract fact-based fields ─────────────────────────────
  const factFields = extractFactBasedFields(template.metadata as Record<string, unknown>);
  if (factFields.length === 0) {
    return json(400, {
      success: false,
      error: "No fact-based fields found in template metadata",
    });
  }

  // ── Generate field mappings via LLM ───────────────────────
  let answers: FieldAnswer[];
  let model: string;
  try {
    const result = await generatePhase2FieldMappings(interviewNotes.trim(), factFields);
    answers = result.answers;
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
    } catch {
      /* never break on eye */
    }

    return json(502, {
      success: false,
      error: llmErr instanceof Error ? llmErr.message : "LLM generation failed",
    });
  }

  const answeredCount = answers.filter((a) => a.answer !== null).length;

  // ── Merge into session metadata ───────────────────────────
  const phase2Data: Phase2Output = {
    generated_at: new Date().toISOString(),
    model,
    answers,
  };

  const existingMetadata =
    session.metadata && typeof session.metadata === "object" ? (session.metadata as Record<string, unknown>) : {};

  const mergedMetadata = {
    ...existingMetadata,
    guidance_phase2: phase2Data,
  };

  const { error: updateErr } = await supabase
    .from("sessions")
    .update({
      metadata: mergedMetadata,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId);

  if (updateErr) {
    console.error(`[${SERVICE_NAME}] Update error:`, updateErr.message);
    return json(500, { success: false, error: "Failed to update session metadata" });
  }

  // ── Eye event ─────────────────────────────────────────────
  try {
    await logEyeEvent(supabase, {
      session_id: sessionId,
      event_type: "guidance.phase2.generated",
      serviceName: SERVICE_NAME,
      payload: {
        result: "success",
        tenant_id: session.tenant_id,
        template_id: session.template_id,
        fact_field_count: factFields.length,
        answered_field_count: answeredCount,
        model,
      },
    });
  } catch {
    /* never break on eye */
  }

  return json(200, {
    success: true,
    session_id: sessionId,
    fact_field_count: factFields.length,
    answered_field_count: answeredCount,
    model,
  });
});
