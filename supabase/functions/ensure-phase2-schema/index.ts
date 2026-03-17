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
// SCHEMA GENERATION
// ============================================================

interface SchemaField {
  field_key: string;
  label: string;
  template_prompt: string;
  fact_based: boolean;
  answer_type: string;
  allowed_values: string[] | null;
  requires_direct_statement: boolean;
  return_null_if_missing: boolean;
  matching_guidance: string;
  examples: string[];
  requires_human_review: boolean;
}

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

  const systemPrompt = `You are a schema designer for a social services case management system.

Your task is to analyze a program template and produce a structured extraction schema that defines what factual information can be extracted from interview notes.

For each field in the template, determine:
1. Whether it is fact-based (can be answered from interview notes alone)
2. What type of answer is expected
3. What matching guidance a local model would need to extract it

CRITICAL RULES:
- Only mark fields as fact_based=true if they can be answered by direct factual statements in notes
- Fields requiring judgment, risk assessment, or professional opinion should be fact_based=false and requires_human_review=true
- Be conservative: if unsure, set fact_based=false
- answer_type should be one of: "text", "categorical_single", "categorical_multi", "boolean", "date", "number"
- If answer_type is categorical, provide allowed_values
- matching_guidance should be a clear instruction for a narrow extraction model
- examples should show 2-3 typical note excerpts that would match

Return JSON:
{
  "fields": [
    {
      "field_key": "string (snake_case identifier)",
      "label": "string (human-readable label)",
      "template_prompt": "string (original prompt from template)",
      "fact_based": true/false,
      "answer_type": "text|categorical_single|categorical_multi|boolean|date|number",
      "allowed_values": ["array"] or null,
      "requires_direct_statement": true/false,
      "return_null_if_missing": true,
      "matching_guidance": "string (instruction for extraction model)",
      "examples": ["example note excerpt 1", "example 2"],
      "requires_human_review": true/false
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

  // Validate/normalize fields
  const fields: SchemaField[] = parsed.fields.map((f: Record<string, unknown>) => ({
    field_key: String(f.field_key ?? ""),
    label: String(f.label ?? ""),
    template_prompt: String(f.template_prompt ?? ""),
    fact_based: f.fact_based === true,
    answer_type: String(f.answer_type ?? "text"),
    allowed_values: Array.isArray(f.allowed_values) ? f.allowed_values.map(String) : null,
    requires_direct_statement: f.requires_direct_statement !== false,
    return_null_if_missing: f.return_null_if_missing !== false,
    matching_guidance: String(f.matching_guidance ?? ""),
    examples: Array.isArray(f.examples) ? f.examples.map(String) : [],
    requires_human_review: f.requires_human_review === true,
  }));

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

  const schemaJson = {
    generated_at: now,
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
      generation_notes: `Generated ${fields.length} fields (${factCount} fact-based, ${humanReviewCount} human-review)`,
      generated_at: now,
    })
    .select("id")
    .single();

  if (insertErr) throw new Error(`Failed to store schema: ${insertErr.message}`);
  if (!inserted) throw new Error("Schema insert returned no data");

  console.log(`[${SERVICE_NAME}] Schema ${inserted.id} generated (v${version}, ${fields.length} fields)`);
  return inserted.id;
}
