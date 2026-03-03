import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { logEyeEvent } from '../_shared/eye.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Maximum character limit for extracted document text.
 * Text originates from document extraction upstream (frontend or preprocessing function).
 */
const MAX_TEXT_LENGTH = 20000;

/**
 * Default limit for policy documents loaded into context.
 */
const DEFAULT_DOCS_LIMIT = 8;

/**
 * Request body for the Reviewer endpoint.
 * 
 * @property session_id - Valid UUID for the session context
 * @property text - Extracted text from a user-uploaded document (PDF/DOCX/etc.),
 *                  provided at request time and used ephemerally. This text is NOT
 *                  stored in the database or file storage.
 */
interface RunReviewerRequest {
  session_id: string;
  text: string;
}

/** Valid severity levels for flags */
type FlagSeverity = 'low' | 'med' | 'high';

interface CategorizedFlag {
  severity: FlagSeverity;
  message: string;
  snippet: string;
}

/**
 * Reviewer output schema with categorized flag arrays.
 * Each category represents a distinct type of issue found in the document.
 */
interface ReviewerOutput {
  tone_flags: CategorizedFlag[];
  bias_flags: CategorizedFlag[];
  policy_language_flags: CategorizedFlag[];
  completeness_flags: CategorizedFlag[];
}

interface ErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function errorResponse(status: number, code: string, message: string) {
  const body: ErrorResponse = { error: { code, message } };
  return jsonResponse(status, body);
}

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

/** Safely log eye event - failures must not break reviewer flow */
async function safeLogEyeEvent(
  supabase: ReturnType<typeof createClient>,
  sessionId: string,
  eventType: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await logEyeEvent(supabase, sessionId, eventType, payload);
  } catch (err) {
    console.error(`Failed to log eye event ${eventType}:`, err);
  }
}

/** Validate that a flag has the correct structure */
function isValidFlag(flag: unknown): flag is CategorizedFlag {
  if (typeof flag !== 'object' || flag === null) {
    return false;
  }
  const f = flag as Record<string, unknown>;
  
  // severity must be 'low', 'med', or 'high'
  if (typeof f.severity !== 'string' || !['low', 'med', 'high'].includes(f.severity)) {
    return false;
  }
  
  // message and snippet must be strings
  if (typeof f.message !== 'string' || typeof f.snippet !== 'string') {
    return false;
  }
  
  return true;
}

/** Validate LLM output matches expected categorized schema */
function validateReviewerOutput(parsed: unknown): parsed is ReviewerOutput {
  if (typeof parsed !== 'object' || parsed === null) {
    return false;
  }

  const obj = parsed as Record<string, unknown>;
  const requiredKeys = ['tone_flags', 'bias_flags', 'policy_language_flags', 'completeness_flags'];
  const actualKeys = Object.keys(obj);

  // Must have exactly 4 keys
  if (actualKeys.length !== 4) {
    return false;
  }

  // Must have the required keys and each must be an array of valid flags
  for (const key of requiredKeys) {
    if (!(key in obj)) {
      return false;
    }
    const value = obj[key];
    if (!Array.isArray(value)) {
      return false;
    }
    for (const flag of value) {
      if (!isValidFlag(flag)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * System prompt for the Reviewer.
 * 
 * The Reviewer analyzes text extracted from a user-uploaded document (PDF/DOCX/etc.)
 * ephemerally and produces CATEGORIZED FLAGS ONLY. It does not rewrite, suggest 
 * alternative wording, provide scores, or render pass/fail judgments.
 * 
 * The Reviewer is grounded in the session's template and policy context.
 */
const SYSTEM_PROMPT = `You are AidMind V1 'Reviewer'.

You analyze text extracted from a user-uploaded document and produce CATEGORIZED FLAGS ONLY.
The document text is provided ephemerally and is not stored.

STRICT RULES:
1. You must ONLY produce flags identifying potential issues.
2. You must NOT rewrite any text.
3. You must NOT suggest alternative wording.
4. You must NOT provide scores, ratings, or pass/fail judgments.
5. You must NOT draft or edit documentation.
6. Flags must be grounded in the template schema and policy rules provided.

FLAG CATEGORIES:
- tone_flags: Issues with professional tone, inappropriate language, or emotional content
- bias_flags: Potential bias, assumptions, or subjective judgments without evidence
- policy_language_flags: Language that conflicts with policy requirements or uses prohibited terms
- completeness_flags: Missing required information, gaps, or incomplete sections per template schema

SEVERITY LEVELS:
- "low": Minor issue, may want to address
- "med": Moderate concern, should address before finalizing
- "high": Critical issue, must address

FLAG STRUCTURE:
Each flag must include:
- severity: "low" | "med" | "high"
- message: Brief description of the issue
- snippet: SHORT excerpt (≤ 20 words) from the document showing where the issue occurs

GROUNDING RULES:
- Reference template.schema_json to identify completeness issues
- Reference policy_pack.rules_json for policy language violations
- Reference policy_documents metadata for additional compliance context
- If no issues are found in a category, return an empty array

Return ONLY valid JSON with exactly these 4 keys:
{
  "tone_flags": [{ "severity": "...", "message": "...", "snippet": "..." }],
  "bias_flags": [{ "severity": "...", "message": "...", "snippet": "..." }],
  "policy_language_flags": [{ "severity": "...", "message": "...", "snippet": "..." }],
  "completeness_flags": [{ "severity": "...", "message": "...", "snippet": "..." }]
}

No additional keys. No markdown. No commentary outside the JSON.`;

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Enforce POST only
  if (req.method !== 'POST') {
    return errorResponse(405, 'METHOD_NOT_ALLOWED', 'Only POST method is allowed');
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const openaiApiKey = Deno.env.get('OPENAI_API_KEY');

  if (!openaiApiKey) {
    console.error('OPENAI_API_KEY is not configured');
    return errorResponse(500, 'CONFIG_ERROR', 'OpenAI API key is not configured');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  let payload: RunReviewerRequest;

  try {
    payload = await req.json();
  } catch {
    return errorResponse(400, 'INVALID_JSON', 'Request body must be valid JSON');
  }

  // ── Validation ──────────────────────────────────────────────────────────────

  const { session_id, text } = payload;

  // session_id required and must be valid UUID
  if (!session_id || typeof session_id !== 'string') {
    return errorResponse(400, 'INVALID_SESSION_ID', 'session_id is required');
  }
  if (!isValidUuid(session_id)) {
    return errorResponse(400, 'INVALID_SESSION_ID', 'session_id must be a valid UUID');
  }

  /**
   * Validate extracted document text.
   * Text originates from document extraction upstream (frontend or preprocessing function).
   * It is used ephemerally and never persisted.
   */
  if (!text || typeof text !== 'string') {
    return errorResponse(400, 'INVALID_TEXT', 'text is required and must be a non-empty string');
  }

  const trimmedText = text.trim();
  if (trimmedText.length === 0) {
    return errorResponse(400, 'INVALID_TEXT', 'text cannot be empty');
  }

  if (trimmedText.length > MAX_TEXT_LENGTH) {
    return errorResponse(400, 'TEXT_TOO_LONG', `text cannot exceed ${MAX_TEXT_LENGTH} characters`);
  }

  try {
    // ── Log REVIEWER_STARTED ──────────────────────────────────────────────────
    // Note: Do NOT include document text or snippets in event payloads (PHI safety)

    await safeLogEyeEvent(supabase, session_id, 'REVIEWER_STARTED', {
      session_id: session_id,
    });

    // ── A. Load Session ─────────────────────────────────────────────────────────

    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('session_id, status, template_id, policy_pack_id')
      .eq('session_id', session_id)
      .maybeSingle();

    if (sessionError) {
      console.error('Error fetching session:', sessionError.message);
      await safeLogEyeEvent(supabase, session_id, 'REVIEWER_FAILED', {
        session_id: session_id,
        reason: 'DB_ERROR fetching session',
      });
      return errorResponse(500, 'DB_ERROR', 'Failed to fetch session');
    }

    if (!session) {
      await safeLogEyeEvent(supabase, session_id, 'REVIEWER_FAILED', {
        session_id: session_id,
        reason: 'Session not found',
      });
      return errorResponse(404, 'SESSION_NOT_FOUND', `Session with id ${session_id} not found`);
    }

    const templateId = session.template_id;
    const policyPackId = session.policy_pack_id;

    if (!templateId) {
      await safeLogEyeEvent(supabase, session_id, 'REVIEWER_FAILED', {
        session_id: session_id,
        reason: 'Session has no template_id',
      });
      return errorResponse(404, 'TEMPLATE_NOT_FOUND', 'Session has no template_id assigned');
    }

    if (!policyPackId) {
      await safeLogEyeEvent(supabase, session_id, 'REVIEWER_FAILED', {
        session_id: session_id,
        reason: 'Session has no policy_pack_id',
      });
      return errorResponse(404, 'POLICY_PACK_NOT_FOUND', 'Session has no policy_pack_id assigned');
    }

    // ── B. Load Template ────────────────────────────────────────────────────────

    const { data: template, error: templateError } = await supabase
      .from('kb_templates')
      .select('template_id, name, version, schema_json')
      .eq('template_id', templateId)
      .eq('is_active', true)
      .maybeSingle();

    if (templateError) {
      console.error('Error fetching template:', templateError.message);
      await safeLogEyeEvent(supabase, session_id, 'REVIEWER_FAILED', {
        session_id: session_id,
        reason: 'DB_ERROR fetching template',
      });
      return errorResponse(500, 'DB_ERROR', 'Failed to fetch template');
    }

    if (!template) {
      await safeLogEyeEvent(supabase, session_id, 'REVIEWER_FAILED', {
        session_id: session_id,
        reason: 'Template not found or inactive',
      });
      return errorResponse(404, 'TEMPLATE_NOT_FOUND', `Template with id ${templateId} not found or inactive`);
    }

    // ── C. Load Policy Pack ─────────────────────────────────────────────────────

    const { data: policyPack, error: policyPackError } = await supabase
      .from('kb_policy_packs')
      .select('policy_pack_id, name, version, rules_json')
      .eq('policy_pack_id', policyPackId)
      .eq('is_active', true)
      .maybeSingle();

    if (policyPackError) {
      console.error('Error fetching policy pack:', policyPackError.message);
      await safeLogEyeEvent(supabase, session_id, 'REVIEWER_FAILED', {
        session_id: session_id,
        reason: 'DB_ERROR fetching policy pack',
      });
      return errorResponse(500, 'DB_ERROR', 'Failed to fetch policy pack');
    }

    if (!policyPack) {
      await safeLogEyeEvent(supabase, session_id, 'REVIEWER_FAILED', {
        session_id: session_id,
        reason: 'Policy pack not found or inactive',
      });
      return errorResponse(404, 'POLICY_PACK_NOT_FOUND', `Policy pack with id ${policyPackId} not found or inactive`);
    }

    // ── D. Load Policy Documents (Metadata Only) ────────────────────────────────

    const { data: rawDocs, error: docsError } = await supabase
      .from('kb_policy_pack_documents')
      .select(`
        weight,
        notes,
        kb_documents!inner (
          document_id,
          title,
          doc_type,
          jurisdiction,
          version,
          storage_path
        )
      `)
      .eq('policy_pack_id', policyPackId)
      .eq('kb_documents.is_active', true)
      .order('weight', { ascending: false })
      .order('created_at', { ascending: false, referencedTable: 'kb_documents' })
      .limit(DEFAULT_DOCS_LIMIT);

    if (docsError) {
      console.error('Error fetching policy documents:', docsError.message);
      await safeLogEyeEvent(supabase, session_id, 'REVIEWER_FAILED', {
        session_id: session_id,
        reason: 'DB_ERROR fetching documents',
      });
      return errorResponse(500, 'DB_ERROR', 'Failed to fetch policy documents');
    }

    // Transform documents for minimized context (no document_id or content needed for LLM)
    const policyDocuments: Array<{
      title: string;
      doc_type: string;
      jurisdiction: string | null;
      version: string | null;
      weight: number;
      notes: string | null;
      has_text: boolean;
    }> = [];

    if (rawDocs && rawDocs.length > 0) {
      for (const row of rawDocs) {
        const doc = row.kb_documents as any;
        // Truncate notes to prevent token bloat (max 300 chars)
        let truncatedNotes = row.notes;
        if (truncatedNotes && truncatedNotes.length > 300) {
          truncatedNotes = truncatedNotes.substring(0, 300);
        }
        policyDocuments.push({
          title: doc.title,
          doc_type: doc.doc_type,
          jurisdiction: doc.jurisdiction,
          version: doc.version,
          weight: row.weight,
          notes: truncatedNotes,
          has_text: doc.storage_path !== null,
        });
      }
    }

    // ── E. Build Minimized Context ──────────────────────────────────────────────

    // Safety guard: default null/empty schema_json and rules_json to {} to avoid model confusion
    const safeSchemaJson = template.schema_json && Object.keys(template.schema_json).length > 0
      ? template.schema_json
      : {};
    const safeRulesJson = policyPack.rules_json && Object.keys(policyPack.rules_json).length > 0
      ? policyPack.rules_json
      : {};

    const minimizedContext = {
      template: {
        name: template.name,
        version: template.version,
        schema_json: safeSchemaJson,
      },
      policy_pack: {
        name: policyPack.name,
        version: policyPack.version,
        rules_json: safeRulesJson,
      },
      policy_documents: policyDocuments,
    };

    // ── F. Call OpenAI LLM ──────────────────────────────────────────────────────
    // NOTE: Extracted document text is used ephemerally for analysis and is not persisted.
    // Neither the input text nor output snippets are stored in the database or logged to Eye events.

    let llmResponse: Response;
    try {
      llmResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0.2,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { 
              role: 'user', 
              content: `Review the following text extracted from a user-uploaded document.
Ground your analysis in the provided template schema and policy rules.

CONTEXT:
${JSON.stringify(minimizedContext)}

TEXT TO REVIEW:
${trimmedText}`
            },
          ],
          response_format: { type: 'json_object' },
        }),
      });
    } catch (fetchErr) {
      console.error('Error calling OpenAI API:', fetchErr);
      await safeLogEyeEvent(supabase, session_id, 'REVIEWER_FAILED', {
        session_id: session_id,
        reason: 'OpenAI API call failed',
      });
      return errorResponse(500, 'LLM_ERROR', 'Failed to call OpenAI API');
    }

    if (!llmResponse.ok) {
      const errorText = await llmResponse.text();
      console.error('OpenAI API error:', llmResponse.status, errorText);
      await safeLogEyeEvent(supabase, session_id, 'REVIEWER_FAILED', {
        session_id: session_id,
        reason: `OpenAI API returned ${llmResponse.status}`,
      });
      return errorResponse(500, 'LLM_ERROR', `OpenAI API returned status ${llmResponse.status}`);
    }

    let llmData: any;
    try {
      llmData = await llmResponse.json();
    } catch {
      console.error('Failed to parse OpenAI response as JSON');
      await safeLogEyeEvent(supabase, session_id, 'REVIEWER_FAILED', {
        session_id: session_id,
        reason: 'OpenAI response not valid JSON',
      });
      return errorResponse(500, 'LLM_ERROR', 'Failed to parse OpenAI response');
    }

    const messageContent = llmData?.choices?.[0]?.message?.content;
    if (!messageContent || typeof messageContent !== 'string') {
      console.error('OpenAI response missing message content');
      await safeLogEyeEvent(supabase, session_id, 'REVIEWER_FAILED', {
        session_id: session_id,
        reason: 'OpenAI response missing content',
      });
      return errorResponse(500, 'LLM_ERROR', 'OpenAI response missing message content');
    }

    // ── G. Parse and Validate Output ────────────────────────────────────────────

    let parsedOutput: unknown;
    try {
      parsedOutput = JSON.parse(messageContent);
    } catch {
      console.error('LLM output is not valid JSON:', messageContent);
      await safeLogEyeEvent(supabase, session_id, 'REVIEWER_FAILED', {
        session_id: session_id,
        reason: 'LLM output not valid JSON',
      });
      return errorResponse(500, 'OUTPUT_SCHEMA_INVALID', 'LLM output is not valid JSON');
    }

    if (!validateReviewerOutput(parsedOutput)) {
      console.error('LLM output does not match expected schema:', parsedOutput);
      await safeLogEyeEvent(supabase, session_id, 'REVIEWER_FAILED', {
        session_id: session_id,
        reason: 'LLM output schema invalid',
      });
      return errorResponse(500, 'OUTPUT_SCHEMA_INVALID', 'LLM output does not match expected schema (must have exactly tone_flags, bias_flags, policy_language_flags, completeness_flags as arrays with severity/message/snippet)');
    }

    // ── H. Log REVIEWER_COMPLETED ───────────────────────────────────────────────
    // Note: Only counts are logged, no document text or flag snippets (PHI safety)

    await safeLogEyeEvent(supabase, session_id, 'REVIEWER_COMPLETED', {
      session_id: session_id,
      counts: {
        tone: parsedOutput.tone_flags.length,
        bias: parsedOutput.bias_flags.length,
        policy: parsedOutput.policy_language_flags.length,
        completeness: parsedOutput.completeness_flags.length,
      },
    });

    // ── I. Return Response ──────────────────────────────────────────────────────

    return jsonResponse(200, {
      tone_flags: parsedOutput.tone_flags,
      bias_flags: parsedOutput.bias_flags,
      policy_language_flags: parsedOutput.policy_language_flags,
      completeness_flags: parsedOutput.completeness_flags,
    });

  } catch (err) {
    console.error('Unexpected error in run-reviewer:', err);
    await safeLogEyeEvent(supabase, session_id, 'REVIEWER_FAILED', {
      session_id: session_id,
      reason: 'Unexpected error',
    });
    return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  }
});
