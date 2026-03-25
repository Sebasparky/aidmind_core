/**
 * localModel.ts — Local LLM inference via Ollama.
 *
 * Provides a generic callLocalModel function and a Phase 2-specific
 * runLocalPhase2Extraction wrapper. Fully browser-side,
 * no backend or Supabase calls.
 */

// ── Types ──────────────────────────────────────────────────

export interface LocalExtractionAnswer {
  field_key: string;
  answer: string | null;
  supporting_excerpt: string | null;
}

export interface LocalExtractionResult {
  answers: LocalExtractionAnswer[];
}

interface ReducedField {
  field_key: string;
  matching_mode: string;
  allowed_values?: string[];
  requires_direct_statement?: boolean;
}

// ── Constants ──────────────────────────────────────────────

const OLLAMA_URL = "http://localhost:11434/api/chat";
const DEFAULT_MODEL = "llama3";
const REQUEST_TIMEOUT_MS = 120_000;

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

// ── Schema reduction ───────────────────────────────────────

/**
 * Strips the full Phase 2 schema down to only the fields and
 * properties the local model needs for extraction.
 */
export function reduceSchema(schemaJson: any): ReducedField[] {
  const sections: any[] =
    schemaJson?.sections ?? schemaJson?.schema?.sections ?? [];

  const reduced: ReducedField[] = [];

  for (const section of sections) {
    const fields: any[] = section?.fields ?? [];
    for (const f of fields) {
      if (f.matching_mode === "human_review_only") continue;

      const entry: ReducedField = {
        field_key: f.field_key,
        matching_mode: f.matching_mode,
      };
      if (Array.isArray(f.allowed_values) && f.allowed_values.length > 0) {
        entry.allowed_values = f.allowed_values;
      }
      if (f.requires_direct_statement === true) {
        entry.requires_direct_statement = true;
      }
      reduced.push(entry);
    }
  }

  return reduced;
}

// ── Prompt building ────────────────────────────────────────

function buildUserPrompt(
  reducedFields: ReducedField[],
  notesText: string,
): string {
  return `schema_json:\n${JSON.stringify(reducedFields, null, 2)}\n\nCase notes:\n${notesText}`;
}

// ── Response parsing ───────────────────────────────────────

/**
 * Extracts JSON from a model response that may be wrapped in
 * markdown code fences or contain leading/trailing prose.
 */
export function parseModelResponse(raw: string): any {
  let cleaned = raw.trim();

  // Strip ```json ... ``` or ``` ... ``` fences
  const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  // If still not starting with {, try to find the first { … last }
  if (!cleaned.startsWith("{")) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      cleaned = cleaned.slice(start, end + 1);
    }
  }

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(
      `[localModel] Failed to parse JSON from model response. Raw content (first 500 chars): ${raw.slice(0, 500)}`,
    );
  }

  return parsed;
}

// ── Generic local model call ───────────────────────────────

/**
 * Calls a local Ollama model with the given system and user prompts.
 * Returns the raw string content from the model response.
 *
 * @param systemPrompt - The system prompt for the model.
 * @param userPrompt   - The user prompt for the model.
 * @param model        - Ollama model name (default: "llama3").
 * @returns Raw string response from the model.
 */
export async function callLocalModel(
  systemPrompt: string,
  userPrompt: string,
  model: string = DEFAULT_MODEL,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        stream: false,
        options: { temperature: 0 },
      }),
    });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new Error(
        `[localModel] Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s. Is Ollama running and is the model loaded?`,
      );
    }
    throw new Error(
      `[localModel] Local model unavailable. Ensure Ollama is running. Detail: ${err?.message ?? err}`,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "(unreadable)");
    throw new Error(
      `[localModel] Ollama returned HTTP ${response.status}: ${body.slice(0, 500)}`,
    );
  }

  const data = await response.json();
  const content: string | undefined = data?.message?.content;

  if (!content?.trim()) {
    throw new Error(
      "[localModel] Ollama returned an empty message content.",
    );
  }

  return content;
}

// ── Phase 2 extraction ─────────────────────────────────────

/**
 * Runs Phase 2 factual extraction locally via Ollama.
 *
 * @param notesText  - The reviewed case notes text.
 * @param schemaJson - The full Phase 2 schema object (will be reduced internally).
 * @param model      - Ollama model name (default: "llama3").
 * @returns Structured extraction answers.
 */
export async function runLocalPhase2Extraction(
  notesText: string,
  schemaJson: any,
  model: string = DEFAULT_MODEL,
): Promise<LocalExtractionResult> {
  if (!notesText?.trim()) {
    throw new Error("[localModel] notesText is empty.");
  }

  // 1. Reduce schema
  const reducedFields = reduceSchema(schemaJson);
  if (reducedFields.length === 0) {
    throw new Error(
      "[localModel] Schema reduction produced zero extractable fields.",
    );
  }

  // 2. Build prompts
  const userPrompt = buildUserPrompt(reducedFields, notesText);

  // 3. Call Ollama
  const content = await callLocalModel(SYSTEM_PROMPT, userPrompt, model);

  // 4. Parse response
  const parsed = parseModelResponse(content);

  if (!parsed || !Array.isArray(parsed.answers)) {
    throw new Error(
      "[localModel] Model response JSON is missing the 'answers' array.",
    );
  }

  return { answers: parsed.answers };
}
