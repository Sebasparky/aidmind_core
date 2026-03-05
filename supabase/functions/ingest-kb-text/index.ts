import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { logEyeEvent } from "../_shared/eye.ts";

interface IngestTextRequest {
  document_id?: string;
  extracted_text?: string;
  overwrite?: boolean;
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/* ── Simple paragraph-aware chunker ── */
function chunkText(text: string, targetSize = 4000, overlap = 400): string[] {
  if (text.length <= targetSize) return [text];

  const paragraphs = text.split(/\n{2,}/);
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

/* ── OpenAI embedding helper ── */
async function embed(text: string, apiKey: string, model: string): Promise<number[]> {
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

const SERVICE_NAME = "ingest-kb-text";

/** Helper to safely log eye events without breaking the main flow */
async function safeLogEye(
  supabase: any,
  eventType: string,
  payload?: Record<string, unknown>
): Promise<void> {
  try {
    await logEyeEvent(supabase, {
      session_id: null,
      event_type: eventType,
      serviceName: SERVICE_NAME,
      payload,
    });
  } catch (err) {
    console.error("Eye event failed:", err);
  }
}

/* ── Main handler ── */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { success: false, error: "Method not allowed" });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) return json(500, { success: false, error: "OPENAI_API_KEY not configured" });

  const EMBEDDING_MODEL = Deno.env.get("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small";

  let payload: IngestTextRequest;
  try {
    payload = await req.json();
  } catch {
    return json(400, { success: false, error: "Invalid JSON body" });
  }

  const { document_id, extracted_text, overwrite } = payload;

  if (!document_id) return json(400, { success: false, error: "document_id is required" });
  if (!extracted_text || extracted_text.trim().length === 0) {
    return json(400, { success: false, error: "extracted_text is required and must be non-empty" });
  }

  try {
    // 1. Fetch document
    const { data: doc, error: docErr } = await supabase
      .from("kb_documents")
      .select("id, tenant_id, title, metadata, source")
      .eq("id", document_id)
      .maybeSingle();

    if (docErr) throw new Error(`Failed to fetch document: ${docErr.message}`);
    if (!doc) return json(404, { success: false, error: "Document not found" });

    await safeLogEye(supabase, "KB_DOCUMENT_INGEST_STARTED", { tenant_id: doc.tenant_id });
    await safeLogEye(supabase, "KB_DOCUMENT_TEXT_RECEIVED", { char_count: extracted_text.length });

    // 2. Overwrite or duplicate check
    if (overwrite) {
      const { error: delErr } = await supabase
        .from("document_chunks")
        .delete()
        .eq("document_id", document_id)
        .eq("tenant_id", doc.tenant_id);
      if (delErr) throw new Error(`Failed to delete existing chunks: ${delErr.message}`);
    } else {
      const { count, error: countErr } = await supabase
        .from("document_chunks")
        .select("*", { count: "exact", head: true })
        .eq("document_id", document_id)
        .eq("tenant_id", doc.tenant_id);
      if (countErr) throw new Error(`Failed to check existing chunks: ${countErr.message}`);
      if (count && count > 0) {
        return json(409, { success: false, error: "CHUNKS_ALREADY_EXIST (set overwrite=true)" });
      }
    }

    // 3. Chunk (filter out tiny fragments < 50 chars)
    const chunks = chunkText(extracted_text)
      .filter((c) => c.trim().length >= 50);

    await safeLogEye(supabase, "KB_DOCUMENT_CHUNKED", { chunk_count: chunks.length });

    // 4. Embed + build rows
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const vec = await embed(chunks[i], OPENAI_API_KEY, EMBEDDING_MODEL);
      rows.push({
        tenant_id: doc.tenant_id,
        document_id: doc.id,
        chunk_index: i,
        content: chunks[i],
        token_count: Math.ceil(chunks[i].length / 4),
        metadata: {
          ...(doc.metadata ?? {}),
          source: doc.source ?? null,
          title: doc.title,
        },
        embedding: "[" + vec.join(",") + "]",
      });
    }

    await safeLogEye(supabase, "KB_DOCUMENT_EMBEDDED", { chunk_count: rows.length });

    // 5. Insert chunks in batches of 50
    const BATCH_SIZE = 50;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const { error: insertErr } = await supabase.from("document_chunks").insert(batch);
      if (insertErr) throw new Error(`Failed to insert chunk batch at index ${i}: ${insertErr.message}`);
    }

    // 6. Update kb_documents.content
    const { error: updateErr } = await supabase
      .from("kb_documents")
      .update({ content: extracted_text })
      .eq("id", document_id);

    if (updateErr) throw new Error(`Failed to update document content: ${updateErr.message}`);

    await safeLogEye(supabase, "KB_DOCUMENT_INGEST_COMPLETED", { chunk_count: rows.length });

    return json(200, {
      success: true,
      document_id: doc.id,
      tenant_id: doc.tenant_id,
      chunk_count: rows.length,
      char_count: extracted_text.length,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[ingest-kb-text] error:", message);
    try {
      await safeLogEye(supabase, "KB_DOCUMENT_INGEST_FAILED", { reason_code: message });
    } catch (_) {
      // never fail due to logging
    }
    return json(500, { success: false, error: message });
  }
});
