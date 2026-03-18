/**
 * ensure-phase2-schema
 *
 * Checks if an active Phase 2 extraction schema exists for a given template.
 * If not, generates one using an LLM and stores it in template_phase2_schemas.
 * Links the schema to the session via sessions.phase2_schema_id.
 *
 * Called during the Guidance Phase 1 flow after template selection.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { logEyeEvent } from "../_shared/eye.ts";

const SERVICE_NAME = "ensure-phase2-schema";

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ============================================================
// SCHEMA FIELD CONTRACT
// ============================================================

/**
 * The canonical field shape stored in template_phase2_schemas.schema_json.fields[].
 *
 * matching_mode tells the local extraction model HOW to match:
 *   select_one          — pick exactly one allowed_value
 *   select_many         — pick one or more allowed_values
 *   boolean_decision    — return true / false
 *   extract_number      — return a numeric value
 *   extract_date        — return a date string
 *   extract_literal_span — copy an exact text span from notes
 *   extract_short_text  — extract a short factual phrase
 *   human_review_only   — do NOT auto-extract; flag for human
 *
 * sensitivity_level / ambiguity_level / extraction_priority give the
 * consumer additional safety signals for gating or ordering extraction.
 */
interface SchemaField {
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
  examples: string[];
  requires_human_review: boolean;
  human_review_reason: string | null;
  sensitivity_level: "low" | "medium" | "high";
  ambiguity_level: "low" | "medium" | "high";
  extraction_priority: "high" | "medium" | "low";
}

// ============================================================
// SCHEMA GENERATION
// ============================================================

async function generateSchemaFromTemplate(
  templateName: string,
  templateContent: string,
  templateMetadata: Record<string, unknown>,
): Promise<{ fields: SchemaField[]; model: string }> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const model = "gpt-4o";

  // Build context from template content and metadata
  const metaSections = templateMetadata.sections;
  let existingFieldsHint = "";
  if (Array.isArray(metaSections)) {
    const fieldNames: string[] = [];
    for (const section of metaSections) {
      if (!section || typeof section !== "object") continue;
      const fields = (section as Record<string, unknown>).fields;
      if (!Array.isArray(fields)) continue;
      for (const f of fields) {
        if (f && typeof f === "object" && typeof (f as Record<string, unknown>).field_key === "string") {
          fieldNames.push(
            `${(f as Record<string, unknown>).field_key}: ${(f as Record<string, unknown>).question ?? (f as Record<string, unknown>).label ?? ""}`,
          );
        }
      }
    }
    if (fieldNames.length > 0) {
      existingFieldsHint = `\n\nEXISTING TEMPLATE FIELDS (use these as a starting point):\n${fieldNames.join("\n")}`;
    }
  }

  const systemPrompt = `You are a schema designer for a social services case management system called AidMind.

Your task is to analyze a program template and produce a structured extraction schema that defines what factual information can safely be extracted from interview notes by a narrow local model.

The local model will NOT reason about the form. It will perform constrained matching:
- For categorical fields: select one or more allowed values
- For boolean fields: return true/false
- For numeric fields: extract a number
- For date fields: extract a date
- For text spans: copy exact text from notes
- For human-review fields: skip entirely

YOUR JOB is to classify each field carefully so the local model knows EXACTLY what to do.

FIELD CLASSIFICATION RULES:

1. matching_mode (CRITICAL — tells the local model how to match):
   - "select_one": field has a fixed set of allowed values, pick exactly one
   - "select_many": field has a fixed set of allowed values, pick one or more. Use this when the field naturally accepts multiple simultaneous values (e.g., sources of income, services seeking, substances used).
   - "boolean_decision": yes/no or true/false
   - "extract_number": extract a numeric value
   - "extract_date": extract a date
   - "extract_literal_span": copy an exact text span (name, ID, address line). The extraction model should return the SMALLEST sufficient span, not surrounding narrative.
   - "extract_short_text": extract a short factual phrase (1-5 words)
   - "human_review_only": do NOT auto-extract; too sensitive, ambiguous, or risky

2. sensitivity_level:
   - "high": SSN, insurance IDs, phone numbers, email addresses, exact addresses, emergency contact details, legal identifiers
   - "medium": names, dates of birth, employer info, income amounts
   - "low": general categorical questions (pregnant?, substance use?, housing type?)

3. ambiguity_level:
   - "high": field could easily be confused with another similar field (e.g., physical city vs mailing city), or notes rarely contain clear evidence
   - "medium": field is usually present but can be stated ambiguously
   - "low": field is typically stated clearly and unambiguously

4. extraction_priority:
   - "high": core intake data that is almost always present in notes
   - "medium": commonly available but may be missing
   - "low": rarely explicitly stated, or too sensitive to prioritize

5. requires_human_review — set to true for ANY of:
   - sensitivity_level = "high" (sensitive identifiers)
   - The field requires professional judgment
   - The field is structurally ambiguous (e.g., physical vs mailing address that are easily confused)
   - Mistakes would be costly or harmful
   - The field is rarely documented clearly in narrative notes

6. human_review_reason — when requires_human_review is true, explain WHY:
   - "Sensitive identifier — requires verification"
   - "Structurally ambiguous — easily confused with similar field"
   - "Rarely documented clearly in narrative notes"
   - "Mistakes would be costly to the client"

7. DUPLICATE / SIMILAR FIELD HANDLING:
   - If the template has both physical and mailing address fields, prefix field_keys clearly: physical_city, physical_state, mailing_city, mailing_state
   - Make matching_guidance explicitly distinguish them: "Extract the PHYSICAL address city only, not the mailing address"
   - Set ambiguity_level = "high" for both

8. answer_type should be one of: "text", "categorical_single", "categorical_multi", "boolean", "date", "number"
   - If answer_type is categorical, provide allowed_values

9. fact_based = true ONLY if the field can be answered by direct factual statements in notes
   - Fields requiring judgment → fact_based = false, requires_human_review = true

10. A field CAN be fact_based = true AND requires_human_review = true simultaneously.
    This means: "yes it's factual, but it's too sensitive/ambiguous for auto-extraction."

MATCHING_GUIDANCE QUALITY RULES (CRITICAL for extraction accuracy):

For select_many fields, matching_guidance MUST include:
- "Return ALL allowed values that are clearly supported by the notes, not just the first match."
- Mention that the model should scan the full notes for each allowed value.

For extract_literal_span fields, matching_guidance MUST include:
- "Return the smallest sufficient exact span — just the value itself (e.g., a name, a single number), not the surrounding sentence."
- Specify what kind of span to look for (e.g., "a single person's name", "a nickname only").

For extract_date fields, matching_guidance MUST include:
- "Normalize the date to YYYY-MM-DD format."
- Note common source formats to expect (e.g., "MM/DD/YYYY", "Month DD, YYYY").

For extract_short_text fields, matching_guidance MUST include:
- "Return compact factual content only, stripping narrative wrappers like 'she mentioned that…' or 'I wrote down…'."

IMPORTANT: Do NOT mark all fields as safely extractable. Be conservative.
Expect that for a typical intake form:
- 30-60% of fields should be safely auto-extractable (requires_human_review = false)
- 20-40% should be fact-based but human-review-preferred (requires_human_review = true)
- 10-20% should require professional judgment (fact_based = false)

Return JSON:
{
  "fields": [
    {
      "field_key": "string (snake_case, disambiguated)",
      "label": "string (human-readable label)",
      "template_prompt": "string (original prompt from template)",
      "fact_based": true/false,
      "answer_type": "text|categorical_single|categorical_multi|boolean|date|number",
      "matching_mode": "select_one|select_many|boolean_decision|extract_number|extract_date|extract_literal_span|extract_short_text|human_review_only",
      "allowed_values": ["array"] or null,
      "requires_direct_statement": true/false,
      "return_null_if_missing": true,
      "matching_guidance": "string (specific instruction for narrow extraction model)",
      "examples": ["example note excerpt 1", "example 2"],
      "requires_human_review": true/false,
      "human_review_reason": "string or null",
      "sensitivity_level": "low|medium|high",
      "ambiguity_level": "low|medium|high",
      "extraction_priority": "high|medium|low"
    }
  ]
}`;

  const contentPreview = templateContent.length > 8000
    ? templateContent.slice(0, 8000) + "\n\n[... truncated ...]"
    : templateContent;

  const userPrompt = `TEMPLATE NAME: ${templateName}

TEMPLATE CONTENT:
${contentPreview}
${existingFieldsHint}

Analyze this template and produce the Phase 2 extraction schema.
Remember: be conservative about auto-extraction. Sensitive identifiers, ambiguous duplicates, and rarely-documented fields should be marked requires_human_review = true.
Return JSON only.`;

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
    throw new Error("OpenAI returned empty content");
  }

  let parsed: { fields?: unknown };
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    throw new Error("OpenAI returned invalid JSON");
  }

  if (!Array.isArray(parsed.fields) || parsed.fields.length === 0) {
    throw new Error("OpenAI response missing or empty 'fields' array");
  }

  const VALID_MATCHING_MODES = new Set([
    "select_one", "select_many", "boolean_decision",
    "extract_number", "extract_date", "extract_literal_span",
    "extract_short_text", "human_review_only",
  ]);
  const VALID_SENSITIVITY = new Set(["low", "medium", "high"]);
  const VALID_PRIORITY = new Set(["high", "medium", "low"]);

  // Validate/normalize fields
  const fields: SchemaField[] = parsed.fields.map((f: Record<string, unknown>) => {
    const requiresHumanReview = f.requires_human_review === true ||
      f.sensitivity_level === "high" ||
      f.matching_mode === "human_review_only";

    const rawMode = String(f.matching_mode ?? "extract_short_text");
    const matchingMode = VALID_MATCHING_MODES.has(rawMode) ? rawMode : "extract_short_text";

    const rawSensitivity = String(f.sensitivity_level ?? "low");
    const sensitivityLevel = VALID_SENSITIVITY.has(rawSensitivity) ? rawSensitivity as "low" | "medium" | "high" : "low";

    const rawAmbiguity = String(f.ambiguity_level ?? "low");
    const ambiguityLevel = VALID_SENSITIVITY.has(rawAmbiguity) ? rawAmbiguity as "low" | "medium" | "high" : "low";

    const rawPriority = String(f.extraction_priority ?? "medium");
    const extractionPriority = VALID_PRIORITY.has(rawPriority) ? rawPriority as "high" | "medium" | "low" : "medium";

    // Force human_review_only matching_mode for high-sensitivity fields
    const finalMatchingMode = (sensitivityLevel === "high" && matchingMode !== "human_review_only")
      ? "human_review_only"
      : matchingMode;

    return {
      field_key: String(f.field_key ?? ""),
      label: String(f.label ?? ""),
      template_prompt: String(f.template_prompt ?? ""),
      fact_based: f.fact_based === true,
      answer_type: String(f.answer_type ?? "text"),
      matching_mode: finalMatchingMode,
      allowed_values: Array.isArray(f.allowed_values) ? f.allowed_values.map(String) : null,
      requires_direct_statement: f.requires_direct_statement !== false,
      return_null_if_missing: f.return_null_if_missing !== false,
      matching_guidance: String(f.matching_guidance ?? ""),
      examples: Array.isArray(f.examples) ? f.examples.map(String) : [],
      requires_human_review: requiresHumanReview,
      human_review_reason: requiresHumanReview
        ? String(f.human_review_reason ?? "Requires manual verification")
        : null,
      sensitivity_level: sensitivityLevel,
      ambiguity_level: ambiguityLevel,
      extraction_priority: extractionPriority,
    };
  });

  return { fields, model };
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
  const templateId = body.template_id;

  if (!sessionId || typeof sessionId !== "string") {
    return json(400, { success: false, error: "session_id is required" });
  }
  if (!templateId || typeof templateId !== "string") {
    return json(400, { success: false, error: "template_id is required" });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // ── 1. Check for existing active schema ──
    const { data: existingSchema, error: schemaErr } = await supabase
      .from("template_phase2_schemas")
      .select("id, schema_version, status, source_template_hash")
      .eq("template_id", templateId)
      .eq("is_active", true)
      .maybeSingle();

    if (schemaErr) {
      console.error(`[${SERVICE_NAME}] Schema lookup error:`, schemaErr.message);
      throw new Error(`Failed to look up existing schema: ${schemaErr.message}`);
    }

    // ── 2. Fetch template (needed for generation or hash check) ──
    const { data: template, error: templateErr } = await supabase
      .from("kb_templates")
      .select("id, tenant_id, name, content, content_hash, metadata")
      .eq("id", templateId)
      .maybeSingle();

    if (templateErr) throw new Error(`Failed to fetch template: ${templateErr.message}`);
    if (!template) return json(404, { success: false, error: "Template not found" });

    let schemaId: string;

    if (existingSchema && existingSchema.status === "ready") {
      // Check staleness: if template hash changed, regenerate
      const hashMatch = !template.content_hash || existingSchema.source_template_hash === template.content_hash;

      if (hashMatch) {
        // Reuse existing schema
        schemaId = existingSchema.id;
        console.log(`[${SERVICE_NAME}] Reusing existing schema ${schemaId} (v${existingSchema.schema_version})`);
      } else {
        // Template changed — archive old, generate new
        console.log(`[${SERVICE_NAME}] Template hash changed, regenerating schema`);
        await supabase
          .from("template_phase2_schemas")
          .update({ is_active: false, status: "archived", updated_at: new Date().toISOString() })
          .eq("id", existingSchema.id);

        schemaId = await generateAndStoreSchema(supabase, template, existingSchema.schema_version + 1);
      }
    } else {
      // No active schema — generate
      console.log(`[${SERVICE_NAME}] No active schema found, generating for template ${templateId}`);
      schemaId = await generateAndStoreSchema(supabase, template, 1);
    }

    // ── 3. Link schema to session ──
    const { error: linkErr } = await supabase
      .from("sessions")
      .update({ phase2_schema_id: schemaId, updated_at: new Date().toISOString() })
      .eq("id", sessionId);

    if (linkErr) {
      console.error(`[${SERVICE_NAME}] Failed to link schema to session:`, linkErr.message);
      throw new Error(`Failed to link schema to session: ${linkErr.message}`);
    }

    // ── Eye event ──
    try {
      await logEyeEvent(supabase, {
        session_id: sessionId,
        event_type: "phase2_schema.ensured",
        serviceName: SERVICE_NAME,
        payload: {
          template_id: templateId,
          schema_id: schemaId,
          action: existingSchema?.status === "ready" ? "reused" : "generated",
        },
      });
    } catch { /* never break on eye */ }

    return json(200, {
      success: true,
      schema_id: schemaId,
      action: existingSchema?.status === "ready" ? "reused" : "generated",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[${SERVICE_NAME}] error:`, message);
    return json(500, { success: false, error: message });
  }
});

// ============================================================
// HELPER: Generate schema and store it
// ============================================================

async function generateAndStoreSchema(
  supabase: ReturnType<typeof createClient>,
  template: {
    id: string;
    tenant_id: string;
    name: string;
    content: string;
    content_hash: string | null;
    metadata: unknown;
  },
  version: number,
): Promise<string> {
  const { fields, model } = await generateSchemaFromTemplate(
    template.name,
    template.content,
    (template.metadata as Record<string, unknown>) ?? {},
  );

  const now = new Date().toISOString();
  const factCount = fields.filter((f) => f.fact_based).length;
  const humanReviewCount = fields.filter((f) => f.requires_human_review).length;
  const autoExtractCount = fields.filter((f) => f.fact_based && !f.requires_human_review).length;
  const humanReviewOnlyCount = fields.filter((f) => f.matching_mode === "human_review_only").length;

  const schemaJson = {
    generated_at: now,
    schema_contract_version: "2.0",
    fields,
  };

  const { data: inserted, error: insertErr } = await supabase
    .from("template_phase2_schemas")
    .insert({
      template_id: template.id,
      tenant_id: template.tenant_id,
      schema_version: version,
      status: "ready",
      is_active: true,
      schema_json: schemaJson,
      model,
      source_template_hash: template.content_hash,
      generation_notes: `Generated ${fields.length} fields: ${autoExtractCount} auto-extractable, ${humanReviewCount} human-review, ${humanReviewOnlyCount} human-review-only, ${factCount} fact-based total`,
      generated_at: now,
    })
    .select("id")
    .single();

  if (insertErr) throw new Error(`Failed to store schema: ${insertErr.message}`);
  if (!inserted) throw new Error("Schema insert returned no data");

  console.log(`[${SERVICE_NAME}] Schema ${inserted.id} generated (v${version}, ${fields.length} fields, ${autoExtractCount} auto-extractable, ${humanReviewCount} human-review)`);
  return inserted.id;
}
