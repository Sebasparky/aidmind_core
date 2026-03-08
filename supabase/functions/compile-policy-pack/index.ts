import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsSecurityHeaders } from "../_shared/security-headers.ts";
import { logEyeEvent } from "../_shared/eye.ts";

/* ── Types ── */

interface CompileRequest {
  session_id?: string;
  template_id?: string;
  guardrails?: { jurisdiction?: string; program?: string };
  per_query_limit?: number;
  min_similarity?: number;
  max_total_chunks?: number;
}

interface MergedChunk {
  chunk_id: string;
  document_id: string;
  chunk_index: number;
  similarity: number;
  content: string;
  metadata: Record<string, unknown>;
  query_indices: number[];
}

const HARD_MAX_TOTAL_CHUNKS = 100;

/* ── Diversity-aware selection constants ── */
const NEARBY_CHUNK_WINDOW = 1;
const JACCARD_DUPLICATE_THRESHOLD = 0.75;
const CONTAINMENT_THRESHOLD = 0.80;
const MAX_CHUNKS_PER_DOCUMENT = 4;
/* ── Helpers ── */

// Dynamic CORS headers — set per-request
let _corsHeaders: Record<string, string> = {};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ..._corsHeaders, "Content-Type": "application/json" },
  });
}

function chunkTemplate(
  content: string,
  targetSize = 1500,
  overlap = 200,
): string[] {
  if (content.length <= targetSize) return [content];

  const paragraphs = content.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > targetSize && current.length > 0) {
      chunks.push(current.trim());
      const overlapText = current.slice(-overlap);
      current = overlapText + "\n\n" + para;
    } else {
      current += (current ? "\n\n" : "") + para;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  const final: string[] = [];
  for (const c of chunks) {
    if (c.length <= targetSize) {
      final.push(c);
    } else {
      let i = 0;
      while (i < c.length) {
        final.push(c.slice(i, i + targetSize));
        i += targetSize - overlap;
      }
    }
  }
  return final;
}

const MAX_QUERY_CHARS = 12000; // ~3000 tokens safe limit for embedding models

function truncateForEmbedding(text: string, maxChars = MAX_QUERY_CHARS): string {
  return text.length <= maxChars ? text : text.slice(0, maxChars);
}

function buildRetrievalQuery(
  section: string,
  guardrails: { jurisdiction?: string; program?: string },
): string {
  const parts: string[] = [];
  if (guardrails.jurisdiction) parts.push(`Jurisdiction: ${guardrails.jurisdiction}`);
  if (guardrails.program) parts.push(`Program: ${guardrails.program}`);
  parts.push("Find policy text relevant to completing this section of the template.");
  parts.push(section);
  return truncateForEmbedding(parts.join("\n"));
}

/* ── Diversity-aware selection helpers ── */

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenize(text: string): Set<string> {
  return new Set(normalizeText(text).split(" ").filter(Boolean));
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const t of a) {
    if (b.has(t)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

function containmentRatio(candidate: Set<string>, existing: Set<string>): number {
  if (candidate.size === 0) return 1;
  let contained = 0;
  for (const t of candidate) {
    if (existing.has(t)) contained++;
  }
  return contained / candidate.size;
}

interface SelectionDiagnostics {
  total_raw: number;
  unique_before_filter: number;
  final_selected: number;
  skipped_adjacent: number;
  skipped_near_duplicate: number;
  skipped_containment: number;
  skipped_doc_cap: number;
}

function selectDiverseChunks(
  candidates: MergedChunk[],
  maxTotal: number,
): MergedChunk[] {
  const sorted = [...candidates].sort((a, b) => b.similarity - a.similarity);

  const selected: MergedChunk[] = [];
  const selectedTokenSets: Set<string>[] = [];
  const docSelectedIndices = new Map<string, number[]>();
  const docCount = new Map<string, number>();

  const diag: SelectionDiagnostics = {
    total_raw: sorted.length,
    unique_before_filter: sorted.length,
    final_selected: 0,
    skipped_adjacent: 0,
    skipped_near_duplicate: 0,
    skipped_containment: 0,
    skipped_doc_cap: 0,
  };

  for (const chunk of sorted) {
    if (selected.length >= maxTotal) break;

    // Rule E: per-document cap
    const currentDocCount = docCount.get(chunk.document_id) ?? 0;
    if (currentDocCount >= MAX_CHUNKS_PER_DOCUMENT) {
      diag.skipped_doc_cap++;
      continue;
    }

    // Rule B: adjacent chunk suppression
    const docIndices = docSelectedIndices.get(chunk.document_id) ?? [];
    const isAdjacent = docIndices.some(
      (idx) => Math.abs(idx - chunk.chunk_index) <= NEARBY_CHUNK_WINDOW,
    );
    if (isAdjacent) {
      diag.skipped_adjacent++;
      continue;
    }

    // Rule C & D: text-based dedup
    const candidateTokens = tokenize(chunk.content);
    let skipDueToText = false;

    for (const existingTokens of selectedTokenSets) {
      if (jaccardSimilarity(candidateTokens, existingTokens) >= JACCARD_DUPLICATE_THRESHOLD) {
        diag.skipped_near_duplicate++;
        skipDueToText = true;
        break;
      }
      if (containmentRatio(candidateTokens, existingTokens) >= CONTAINMENT_THRESHOLD) {
        diag.skipped_containment++;
        skipDueToText = true;
        break;
      }
    }
    if (skipDueToText) continue;

    selected.push(chunk);
    selectedTokenSets.push(candidateTokens);
    docSelectedIndices.set(chunk.document_id, [...docIndices, chunk.chunk_index]);
    docCount.set(chunk.document_id, currentDocCount + 1);
  }

  diag.final_selected = selected.length;
  console.log("[compile-policy-pack] Selection diagnostics:", JSON.stringify(diag));

  return selected;
}

async function embed(
  text: string,
  apiKey: string,
  model: string,
): Promise<number[]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, input: text }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI embeddings error ${res.status}: ${t}`);
  }

  const j = await res.json();
  const vec: number[] = j.data?.[0]?.embedding;
  if (!vec || vec.length !== 1536) {
    throw new Error(`Expected 1536-dim embedding, got ${vec?.length ?? "null"}`);
  }
  return vec;
}

/* ── Main handler ── */

Deno.serve(async (req) => {
  _corsHeaders = buildCorsSecurityHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: _corsHeaders });
  if (req.method !== "POST") return json(405, { success: false, error: "Method not allowed" });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) return json(500, { success: false, error: "OPENAI_API_KEY not configured" });
  const EMBEDDING_MODEL = Deno.env.get("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small";

  let payload: CompileRequest;
  try {
    payload = await req.json();
  } catch {
    return json(400, { success: false, error: "Invalid JSON body" });
  }

  const {
    session_id,
    template_id,
    guardrails = {},
    per_query_limit = 30,
    min_similarity = 0.28,
    max_total_chunks: requested_max_total_chunks = 250,
  } = payload;

  const max_total_chunks = Math.min(
    Math.max(1, requested_max_total_chunks),
    HARD_MAX_TOTAL_CHUNKS,
  );

  if (!session_id) return json(400, { success: false, error: "session_id is required" });
  if (!template_id) return json(400, { success: false, error: "template_id is required" });

  let retrieval_run_id: string | null = null;

  try {
    // 1. Load session
    const { data: session, error: sessErr } = await supabase
      .from("sessions")
      .select("id, tenant_id, status")
      .eq("id", session_id)
      .maybeSingle();

    if (sessErr) throw new Error(`Failed to fetch session: ${sessErr.message}`);
    if (!session) return json(404, { success: false, error: "Session not found" });

    const { tenant_id } = session;

    // 2. Load template (tenant-scoped with global fallback)
    const { data: tenantTemplate, error: tmplErr1 } = await supabase
      .from("kb_templates")
      .select("id, content")
      .eq("id", template_id)
      .eq("tenant_id", tenant_id)
      .maybeSingle();

    if (tmplErr1) throw new Error(`Failed to fetch template: ${tmplErr1.message}`);

    let template = tenantTemplate;
    if (!template) {
      const { data: globalTemplate, error: tmplErr2 } = await supabase
        .from("kb_templates")
        .select("id, content")
        .eq("id", template_id)
        .is("tenant_id", null)
        .maybeSingle();

      if (tmplErr2) throw new Error(`Failed to fetch global template: ${tmplErr2.message}`);
      template = globalTemplate;
    }

    if (!template) return json(404, { success: false, error: "Template not found" });
    if (!template.content || template.content.trim().length === 0) {
      return json(409, { success: false, error: "Template content is empty" });
    }

    // 3. Update session status to guidance_generating
    const { error: statusErr } = await supabase
      .from("sessions")
      .update({ status: "guidance_generating" })
      .eq("id", session_id);

    if (statusErr) throw new Error(`Failed to update session status: ${statusErr.message}`);

    try {
      await logEyeEvent(supabase, {
        session_id,
        event_type: "POLICY_PACK_COMPILATION_STARTED",
        serviceName: "compile-policy-pack",
        payload: { tenant_id, template_id, guardrails },
      });
    } catch (err) {
      console.error("Eye event failed:", err);
    }

    // 4. Insert retrieval_runs row with status='started'
    const { data: runRow, error: runInsertErr } = await supabase
      .from("retrieval_runs")
      .insert({
        tenant_id,
        session_id,
        template_id,
        guardrails,
        params: { per_query_limit, min_similarity, max_total_chunks },
        status: "started",
      })
      .select("id")
      .single();

    if (runInsertErr) throw new Error(`Failed to insert retrieval_run: ${runInsertErr.message}`);
    retrieval_run_id = runRow.id;

    // 5. Generate retrieval queries from template sections
    const sections = chunkTemplate(template.content);
    const queries = sections.map((s) => buildRetrievalQuery(s, guardrails));

    // 6. Embed + retrieve per query, merge results
    const chunkMap = new Map<string, MergedChunk>();

    for (let qi = 0; qi < queries.length; qi++) {
      const vec = await embed(queries[qi], OPENAI_API_KEY, EMBEDDING_MODEL);

      const { data: matches, error: rpcErr } = await supabase.rpc(
        "match_document_chunks",
        {
          p_tenant_id: tenant_id,
          p_query_embedding: vec,
          p_match_count: per_query_limit,
          p_min_similarity: min_similarity,
        },
      );

      if (rpcErr) throw new Error(`RPC match_document_chunks failed (query ${qi}): ${rpcErr.message}`);

      for (const m of matches ?? []) {
        if (
          m.id == null ||
          m.document_id == null ||
          m.chunk_index == null ||
          m.similarity == null
        ) {
          throw new Error(
            "RPC match_document_chunks returned unexpected shape. Expected fields: id, document_id, chunk_index, similarity",
          );
        }

        const existing = chunkMap.get(m.id);
        if (existing) {
          if (m.similarity > existing.similarity) {
            existing.similarity = m.similarity;
          }
          existing.query_indices.push(qi);
        } else {
          chunkMap.set(m.id, {
            chunk_id: m.id,
            document_id: m.document_id,
            chunk_index: m.chunk_index,
            similarity: m.similarity,
            content: m.content ?? "",
            metadata: m.metadata ?? {},
            query_indices: [qi],
          });
        }
      }
    }

    // Smart diversity-aware chunk selection
    const merged = selectDiverseChunks(
      [...chunkMap.values()],
      max_total_chunks,
    );

    // 7. Update retrieval_runs with results
    const { error: runUpdateErr } = await supabase
      .from("retrieval_runs")
      .update({
        query_count: queries.length,
        selected_chunk_count: merged.length,
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", retrieval_run_id);

    if (runUpdateErr) throw new Error(`Failed to update retrieval_run: ${runUpdateErr.message}`);

    // 8. Insert compiled_policy_pack
    const { data: packRow, error: packErr } = await supabase
      .from("compiled_policy_packs")
      .insert({
        tenant_id,
        session_id,
        template_id,
        retrieval_run_id,
        status: "compiled",
        metadata: {
          total_queries: queries.length,
          selected_chunk_count: merged.length,
        },
      })
      .select("id")
      .single();

    if (packErr) throw new Error(`Failed to insert compiled_policy_pack: ${packErr.message}`);
    const compiled_policy_pack_id = packRow.id;

    // 8b. Update session with policy_pack_id
    const { error: sessionUpdateErr } = await supabase
      .from("sessions")
      .update({ policy_pack_id: compiled_policy_pack_id })
      .eq("id", session_id);

    if (sessionUpdateErr) {
      throw new Error(
        `Failed to update session with policy_pack_id: ${sessionUpdateErr.message}`
      );
    }

    // 9. Insert compiled_policy_pack_chunks in batches
    const chunkRows = merged.map((c, idx) => ({
      compiled_policy_pack_id,
      tenant_id,
      document_id: c.document_id,
      chunk_id: c.chunk_id,
      chunk_index: c.chunk_index,
      similarity: c.similarity,
      rank: idx + 1,
      metadata: { query_indices: c.query_indices },
    }));

    const BATCH_SIZE = 50;
    for (let i = 0; i < chunkRows.length; i += BATCH_SIZE) {
      const batch = chunkRows.slice(i, i + BATCH_SIZE);
      const { error: insertErr } = await supabase
        .from("compiled_policy_pack_chunks")
        .insert(batch);
      if (insertErr) {
        throw new Error(`Failed to insert pack chunks at index ${i}: ${insertErr.message}`);
      }
    }

    // 10. Log completion
    try {
      await logEyeEvent(supabase, {
        session_id,
        event_type: "POLICY_PACK_COMPILATION_COMPLETED",
        serviceName: "compile-policy-pack",
        payload: { compiled_policy_pack_id, retrieval_run_id, query_count: queries.length, selected_chunk_count: merged.length },
      });
    } catch (err) {
      console.error("Eye event failed:", err);
    }

    // 11. Build preview (max 240 chars, never full content)
    const top_chunks_preview = merged.slice(0, 5).map((c) => ({
      document_id: c.document_id,
      chunk_index: c.chunk_index,
      similarity: c.similarity,
      content_preview: c.content.slice(0, 240),
    }));

    return json(200, {
      success: true,
      compiled_policy_pack_id,
      retrieval_run_id,
      query_count: queries.length,
      selected_chunk_count: merged.length,
      top_chunks_preview,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[compile-policy-pack] error:", message);

    // Mark retrieval_run as failed if it was created
    if (retrieval_run_id) {
      try {
        await supabase
          .from("retrieval_runs")
          .update({ status: "failed", error: message, completed_at: new Date().toISOString() })
          .eq("id", retrieval_run_id);
      } catch (_) {
        // best-effort
      }
    }

    try {
      await logEyeEvent(supabase, {
        session_id: session_id!,
        event_type: "POLICY_PACK_COMPILATION_FAILED",
        serviceName: "compile-policy-pack",
        payload: { reason_code: message },
      });
    } catch (_) {
      // never fail due to logging
    }
    return json(500, { success: false, error: message });
  }
});
