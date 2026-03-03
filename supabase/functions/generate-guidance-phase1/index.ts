import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import OpenAI from "https://esm.sh/openai@4.28.0";

const openai = new OpenAI({
  apiKey: Deno.env.get("OPENAI_API_KEY")!,
});

function extractJSON(text: string) {
  const cleaned = text
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON found");
  return JSON.parse(match[0]);
}

serve(async (req) => {
  try {
    const { session_id } = await req.json();

    if (!session_id) {
      return new Response(JSON.stringify({ error: "session_id required" }), { status: 400 });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const snippetResponse = await supabase.rpc("get_policy_snippets_for_session", { session_id_input: session_id });

    if (!snippetResponse || snippetResponse.error) throw snippetResponse?.error || new Error("Snippet RPC failed");

    const snippets = snippetResponse.data;

    if (!snippets || snippets.length === 0) throw new Error("No snippets found");

    const snippetIdSet = new Set<string>();
    const formatted = snippets
      .map((s: any) => {
        snippetIdSet.add(s.snippet_id);
        return `Snippet ID: ${s.snippet_id}\nText: ${s.chunk_text}`;
      })
      .join("\n\n");

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
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
    if (!raw) throw new Error("Model returned empty");

    const parsed = extractJSON(raw);

    if (!parsed.questions || parsed.questions.length !== 12)
      throw new Error("Model did not return exactly 12 questions");

    for (const q of parsed.questions) {
      if (!q.question || !q.citations || q.citations.length === 0) throw new Error("Invalid question format");

      for (const citation of q.citations) {
        if (!snippetIdSet.has(citation)) throw new Error(`Invalid citation: ${citation}`);
      }
    }

    const guidancePayload = {
      generated_at: new Date().toISOString(),
      model: "gpt-4o",
      questions: parsed.questions,
    };

    const updateResponse = await supabase.rpc("update_session_guidance_phase1", {
      session_id_input: session_id,
      guidance_json: guidancePayload,
    });

    if (!updateResponse || updateResponse.error) throw updateResponse?.error || new Error("Update RPC failed");

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
