import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import OpenAI from "https://esm.sh/openai@4.28.0";
import { logEyeEvent } from "../_shared/eye.ts";
import { corsSecurityHeaders } from "../_shared/security-headers.ts";
import { validateUuid } from "../_shared/input-validation.ts";

const openai = new OpenAI({
  apiKey: Deno.env.get("OPENAI_API_KEY")!,
});

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsSecurityHeaders, "Content-Type": "application/json" },
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsSecurityHeaders });
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
    // ── 1. Fetch session and enforce template_id ───────────────
    const { data: session, error: sessionErr } = await supabase
      .from("sessions")
      .select("id, template_id, tenant_id, status, policy_pack_id")
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

    const templateId: string = session.template_id;

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

    // ── 3. Format snippets for LLM ─────────────────────────────
    const snippetIdSet = new Set<string>();
    const formatted = snippets
      .map((s: { snippet_id: string; chunk_text: string }) => {
        snippetIdSet.add(s.snippet_id);
        return `Snippet ID: ${s.snippet_id}\nText: ${s.chunk_text}`;
      })
      .join("\n\n");

    // ── 4. Call LLM ────────────────────────────────────────────
    const model = "gpt-4o";
    const completion = await openai.chat.completions.create({
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: `
You are assisting a social services caseworker preparing to conduct a structured client interview.

You are given policy excerpts that are relevant to the template being completed for this program and jurisdiction.

Your task is to generate exactly 12 targeted interview questions that the caseworker should ask the client to gather the factual information needed to complete the template accurately and in compliance with policy.

These must be CLIENT-FACING, FACT-FIRST questions.

DO NOT:
- Summarize policy
- Ask abstract legal or regulatory questions
- Ask the client to interpret definitions or determine eligibility
- Ask vague filler questions such as "Is there anything else?"

The goal is to generate structured investigative questions that help capture concrete facts.

------------------------------------------------------------
CATEGORY REQUIREMENTS (exact counts)

You must generate:

- Timeline: exactly 2 questions  
- Individuals & Relationships: exactly 2 questions  
- Event / Situation Details: exactly 2 questions  
- Risk / Needs / Safety Factors: exactly 2 questions  
- Agency / Service Involvement: exactly 2 questions  
- Documentation / Evidence / Records: exactly 2 questions  

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
- Do not invent snippet IDs.
- Try to distribute citations across multiple snippets.
- Do not use the same snippet_id for more than 3 questions unless unavoidable.
- Questions must be meaningfully grounded in the cited policy.

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

Exactly 12 questions.
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

    // ── 5. Parse and validate output ───────────────────────────
    const parsed = extractJSON(raw);

    if (!parsed.questions || parsed.questions.length !== 12) {
      throw new Error(`Model did not return exactly 12 questions (got ${parsed.questions?.length ?? 0})`);
    }

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

    // ── 6. Build guidance payload with template_id ─────────────
    const guidancePayload = {
      generated_at: new Date().toISOString(),
      model,
      template_id: templateId,
      questions: parsed.questions,
    };

    // ── 7. Save to session ─────────────────────────────────────
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
        question_count: parsed.questions.length,
        snippet_count: snippetIdSet.size,
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
