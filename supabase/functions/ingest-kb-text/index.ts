import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { logEyeEvent } from "../_shared/eye.ts";

// ============================================================
// CONFIGURATION — tune these to match worker compute limits
// ============================================================

/**
 * CHUNKS_PER_BATCH: How many chunks to embed + insert per invocation.
 *
 * Each chunk requires one OpenAI embedding call (~0.5–1s) plus a DB insert.
 * 20 chunks ≈ 10–20s of embedding work, well within typical edge function
 * time limits (usually 60–150s). This is the core lever that prevents
 * WORKER_LIMIT failures on large documents.
 *
 * Increase if worker limits are generous; decrease if timeouts recur.
 */
const CHUNKS_PER_BATCH = 20;

/**
 * DB_INSERT_BATCH_SIZE: How many rows to insert in a single DB call.
 * Kept smaller than CHUNKS_PER_BATCH to avoid large single inserts.
 */
const DB_INSERT_BATCH_SIZE = 50;

/**
 * MIN_CHUNK_CHARS: Chunks shorter than this are filtered out as noise.
 */
const MIN_CHUNK_CHARS = 50;

// ============================================================
// TYPES
// ============================================================

interface IngestTextRequest {
  document_id?: string;
  /** Full extracted text — required on first invocation, optional on resume */
  extracted_text?: string;
  overwrite?: boolean;
}

/** Durable checkpoint state stored in kb_documents.metadata.ingestion */
interface IngestionCheckpoint {
  status: "chunking" | "embedding_in_progress" | "ready" | "failed";
  chunk_count: number;
  indexed_chunk_count: number;
  /** Next chunk index to embed. 0-based. */
  next_chunk_index: number;
  chunking_started_at?: string;
  embedding_started_at?: string;
  last_batch_completed_at?: string;
  indexing_completed_at?: string;
  failed_at?: string;
  error?: string | null;
  attempt_count: number;
}

interface IngestResponse {
  success: boolean;
  document_id: string;
  tenant_id: string;
  chunk_count: number;
  indexed_chunk_count: number;
  next_chunk_index: number;
  status: string;
  /** True when more batches remain — caller should re-invoke */
  more_work: boolean;
  error?: string;
  warning?: string;
}

// ============================================================
// UTILITIES
// ============================================================

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/* ── Simple paragraph-aware chunker ──
 * Preserved from the original implementation.
 * Deterministic — same text always produces the same chunks.
 */
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

/* ── Temporary hosted embedding bridge ──
 * TODO [LOCAL-FIRST]: Replace with local embedding provider.
 * This is the only place a hosted model call happens during ingestion.
 * To swap: implement an embedQuery(text) function returning number[]
 * and replace this call site.
 */
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

/** Safe eye-event logger — never throws */
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

// ============================================================
// INGESTION METADATA HELPERS
// ============================================================

/**
 * Read the current ingestion checkpoint from kb_documents.metadata.ingestion.
 * Returns null if no checkpoint exists.
 */
async function loadCheckpoint(
  supabase: any,
  docId: string
): Promise<IngestionCheckpoint | null> {
  const { data } = await supabase
    .from("kb_documents")
    .select("metadata")
    .eq("id", docId)
    .single();
  const meta = (data?.metadata as Record<string, unknown>) ?? {};
  const ing = meta.ingestion as IngestionCheckpoint | undefined;
  return ing ?? null;
}

/**
 * Merge fields into kb_documents.metadata.ingestion.
 * This is the durable checkpoint write — called after every batch.
 */
async function updateIngestionMeta(
  supabase: any,
  docId: string,
  fields: Record<string, unknown>
): Promise<void> {
  try {
    const { data: cur } = await supabase
      .from("kb_documents")
      .select("metadata")
      .eq("id", docId)
      .single();
    const meta = (cur?.metadata as Record<string, unknown>) ?? {};
    const ingestion = (meta.ingestion as Record<string, unknown>) ?? {};
    meta.ingestion = { ...ingestion, ...fields };
    await supabase.from("kb_documents").update({ metadata: meta }).eq("id", docId);
    // Verification log
    const f = fields as Record<string, unknown>;
    console.log(
      `[ingest-kb-text] checkpoint wrote doc=${docId}` +
      (f.status ? ` status=${f.status}` : "") +
      (f.next_chunk_index !== undefined ? ` next_chunk_index=${f.next_chunk_index}` : "") +
      (f.indexed_chunk_count !== undefined ? ` indexed_chunk_count=${f.indexed_chunk_count}` : "")
    );
  } catch (err) {
    console.error("[ingest-kb-text] updateIngestionMeta failed:", err);
  }
}

// ============================================================
// MAIN HANDLER
// ============================================================

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { success: false, error: "Method not allowed" });

  // ── Auth: shared secret header ──
  const expectedSecret = Deno.env.get("KB_INGEST_SECRET");
  if (!expectedSecret) return json(500, { success: false, error: "KB_INGEST_SECRET not configured" });

  const providedSecret = req.headers.get("X-AIDMIND-INGEST-SECRET");
  if (!providedSecret || providedSecret !== expectedSecret) {
    return json(401, { success: false, error: "Unauthorized" });
  }

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

  // ============================================================
  // 1. FETCH DOCUMENT
  // ============================================================

  let doc: any;
  try {
    const { data, error: docErr } = await supabase
      .from("kb_documents")
      .select("id, tenant_id, title, metadata, source, content")
      .eq("id", document_id)
      .maybeSingle();
    if (docErr) throw new Error(`Failed to fetch document: ${docErr.message}`);
    if (!data) return json(404, { success: false, error: "Document not found" });
    doc = data;
  } catch (e) {
    return json(500, { success: false, error: (e as Error).message });
  }

  // ============================================================
  // 2. DETERMINE RESUME vs FRESH INGEST
  // ============================================================

  const checkpoint = await loadCheckpoint(supabase, document_id);

  // Determine the text source:
  // - On first call, extracted_text is provided in the request body.
  // - On resume calls, the text was already stored in kb_documents.content
  //   during the first invocation's chunking phase.
  const textSource = extracted_text || (doc.content as string) || "";

  if (!textSource || textSource.trim().length === 0) {
    return json(400, {
      success: false,
      error: "No text available — extracted_text required on first call, or document must have content for resume",
    });
  }

  const isOverwrite = overwrite === true;
  const isResume =
    !isOverwrite &&
    checkpoint !== null &&
    checkpoint.status === "embedding_in_progress" &&
    checkpoint.next_chunk_index > 0;

  console.log(
    `[ingest-kb-text] doc=${document_id} ` +
    `path=${isResume ? "RESUME" : isOverwrite ? "OVERWRITE" : "FRESH"} ` +
    `checkpoint_next=${checkpoint?.next_chunk_index ?? "none"} ` +
    `text_chars=${textSource.length}`
  );

  try {
    // ============================================================
    // 3. OVERWRITE / CONFLICT HANDLING
    // ============================================================

    if (isOverwrite) {
      // Diagnostic: count rows BEFORE cleanup (by document_id only — matches unique constraint)
      const { count: preCount } = await supabase
        .from("document_chunks")
        .select("*", { count: "exact", head: true })
        .eq("document_id", document_id);
      console.log(`[ingest-kb-text] doc=${document_id} overwrite: ${preCount ?? 0} chunks exist before cleanup`);

      // Delete by document_id ONLY — the unique constraint is (document_id, chunk_index),
      // so filtering by tenant_id can miss rows and cause collisions on insert.
      const { error: delErr } = await supabase
        .from("document_chunks")
        .delete()
        .eq("document_id", document_id);
      if (delErr) throw new Error(`Failed to delete existing chunks: ${delErr.message}`);

      // Diagnostic: verify cleanup
      const { count: postCount } = await supabase
        .from("document_chunks")
        .select("*", { count: "exact", head: true })
        .eq("document_id", document_id);
      console.log(`[ingest-kb-text] doc=${document_id} overwrite: ${postCount ?? 0} chunks remain after cleanup`);
    } else if (!isResume) {
      // Fresh ingest — check for already-completed ingestion
      if (checkpoint?.status === "ready") {
        return json(409, {
          success: false,
          error: "ALREADY_INGESTED — document is already ready (set overwrite=true to re-ingest)",
        });
      }
      // Check for leftover chunks from a non-resumable state
      if (checkpoint?.status === "failed") {
        // Failed previously — clear stale chunks and restart
        const { count: staleCount } = await supabase
          .from("document_chunks")
          .select("*", { count: "exact", head: true })
          .eq("document_id", document_id);
        console.log(`[ingest-kb-text] doc=${document_id} failed-cleanup: ${staleCount ?? 0} stale chunks before delete`);

        const { error: staleDelErr } = await supabase
          .from("document_chunks")
          .delete()
          .eq("document_id", document_id);
        if (staleDelErr) console.error(`[ingest-kb-text] doc=${document_id} stale cleanup error: ${staleDelErr.message}`);

        const { count: stalePostCount } = await supabase
          .from("document_chunks")
          .select("*", { count: "exact", head: true })
          .eq("document_id", document_id);
        console.log(`[ingest-kb-text] doc=${document_id} failed-cleanup: ${stalePostCount ?? 0} chunks remain after delete`);
      } else {
        const { count, error: countErr } = await supabase
          .from("document_chunks")
          .select("*", { count: "exact", head: true })
          .eq("document_id", document_id);
        if (countErr) throw new Error(`Failed to check existing chunks: ${countErr.message}`);
        if (count && count > 0 && !checkpoint) {
          return json(409, {
            success: false,
            error: "CHUNKS_ALREADY_EXIST (set overwrite=true)",
          });
        }
      }
    }

    // ============================================================
    // 4. CHUNKING PHASE (only on fresh / overwrite, skipped on resume)
    // ============================================================

    let chunks: string[];
    let totalChunks: number;
    let nextChunkIndex: number;

    if (isResume) {
      // ── Resume path: re-derive chunks deterministically ──
      // The chunker is deterministic (same text → same chunks), so we
      // re-chunk the stored text and skip to next_chunk_index.
      // This avoids needing to store a chunk manifest separately.
      chunks = chunkText(textSource).filter((c) => c.trim().length >= MIN_CHUNK_CHARS);
      totalChunks = chunks.length;
      nextChunkIndex = checkpoint!.next_chunk_index;

      // Safety: if checkpoint says more chunks than we actually have, cap it
      if (nextChunkIndex >= totalChunks) {
        console.log(`[ingest-kb-text] doc=${document_id} resume index ${nextChunkIndex} >= total ${totalChunks}, marking ready`);
        await updateIngestionMeta(supabase, document_id, {
          status: "ready",
          indexed_chunk_count: totalChunks,
          next_chunk_index: totalChunks,
          indexing_completed_at: new Date().toISOString(),
          error: null,
          failed_at: null,
        });
        return json(200, {
          success: true,
          document_id: doc.id,
          tenant_id: doc.tenant_id,
          chunk_count: totalChunks,
          indexed_chunk_count: totalChunks,
          next_chunk_index: totalChunks,
          status: "ready",
          more_work: false,
        } satisfies IngestResponse);
      }

      console.log(
        `[ingest-kb-text] doc=${document_id} RESUME from chunk ${nextChunkIndex}/${totalChunks}`
      );
    } else {
      // ── Fresh / overwrite path: chunk + initialize ──
      await safeLogEye(supabase, "KB_DOCUMENT_INGEST_STARTED", { tenant_id: doc.tenant_id });

      await updateIngestionMeta(supabase, document_id, {
        status: "chunking",
        chunking_started_at: new Date().toISOString(),
        attempt_count: (checkpoint?.attempt_count ?? 0) + 1,
      });

      chunks = chunkText(textSource).filter((c) => c.trim().length >= MIN_CHUNK_CHARS);
      totalChunks = chunks.length;
      nextChunkIndex = 0;

      console.log(`[ingest-kb-text] doc=${document_id} chunked into ${totalChunks} chunks`);
      await safeLogEye(supabase, "KB_DOCUMENT_CHUNKED", { chunk_count: totalChunks });

      if (totalChunks === 0) {
        const reason = "Chunking produced 0 usable chunks (all < 50 chars)";
        console.warn(`[ingest-kb-text] doc=${document_id} ${reason}`);
        await updateIngestionMeta(supabase, document_id, {
          status: "failed",
          error: reason,
          failed_at: new Date().toISOString(),
          chunk_count: 0,
          indexed_chunk_count: 0,
          next_chunk_index: 0,
        });
        return json(200, {
          success: true,
          document_id: doc.id,
          tenant_id: doc.tenant_id,
          chunk_count: 0,
          indexed_chunk_count: 0,
          next_chunk_index: 0,
          status: "failed",
          more_work: false,
          warning: reason,
        } satisfies IngestResponse);
      }

      // Store text in kb_documents.content so resume invocations can access it
      // without needing extracted_text in the request body again.
      if (extracted_text) {
        const { error: updateErr } = await supabase
          .from("kb_documents")
          .update({ content: extracted_text })
          .eq("id", document_id);
        if (updateErr) throw new Error(`Failed to store document content: ${updateErr.message}`);
      }

      // Initialize checkpoint
      await updateIngestionMeta(supabase, document_id, {
        status: "embedding_in_progress",
        chunk_count: totalChunks,
        indexed_chunk_count: 0,
        next_chunk_index: 0,
        embedding_started_at: new Date().toISOString(),
        error: null,
        failed_at: null,
      });
    }

    // ============================================================
    // 5. BOUNDED EMBEDDING BATCH
    //
    // This is the core change from the old architecture:
    // Instead of embedding ALL chunks in one loop, we process only
    // CHUNKS_PER_BATCH chunks per invocation. Each batch is persisted
    // immediately, so progress is never lost.
    // ============================================================

    const batchEnd = Math.min(nextChunkIndex + CHUNKS_PER_BATCH, totalChunks);
    const batchChunks = chunks.slice(nextChunkIndex, batchEnd);

    console.log(
      `[ingest-kb-text] doc=${document_id} batch: chunks ${nextChunkIndex}–${batchEnd - 1} ` +
      `(${batchChunks.length} of ${totalChunks} total)`
    );

    // Embed this batch only — bounded work
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < batchChunks.length; i++) {
      const absoluteIndex = nextChunkIndex + i;
      // TODO [LOCAL-FIRST]: Replace embed() with local embedding provider
      const vec = await embed(batchChunks[i], OPENAI_API_KEY, EMBEDDING_MODEL);
      rows.push({
        tenant_id: doc.tenant_id,
        document_id: doc.id,
        chunk_index: absoluteIndex,
        content: batchChunks[i],
        token_count: Math.ceil(batchChunks[i].length / 4),
        metadata: {
          ...(doc.metadata ?? {}),
          source: doc.source ?? null,
          title: doc.title,
        },
        embedding: "[" + vec.join(",") + "]",
      });
    }

    // ============================================================
    // 6. PERSIST BATCH — insert immediately, do not accumulate
    // ============================================================

    for (let i = 0; i < rows.length; i += DB_INSERT_BATCH_SIZE) {
      const batch = rows.slice(i, i + DB_INSERT_BATCH_SIZE);
      const batchStartIdx = nextChunkIndex + i;
      const batchEndIdx = batchStartIdx + batch.length - 1;
      console.log(
        `[ingest-kb-text] doc=${document_id} upserting batch: chunk_index ${batchStartIdx}–${batchEndIdx} ` +
        `(${batch.length} rows, onConflict=document_id,chunk_index)`
      );
      const { error: upsertErr } = await supabase
        .from("document_chunks")
        .upsert(batch, { onConflict: "document_id,chunk_index" });
      if (upsertErr) {
        throw new Error(
          `Failed to upsert chunk batch at absolute index ${batchStartIdx}: ${upsertErr.message}`
        );
      }
      console.log(`[ingest-kb-text] doc=${document_id} upsert OK for chunk_index ${batchStartIdx}–${batchEndIdx}`);
    }

    console.log(
      `[ingest-kb-text] doc=${document_id} upserted ${rows.length} chunks ` +
      `(indices ${nextChunkIndex}–${batchEnd - 1})`
    );

    // ============================================================
    // 7. UPDATE CHECKPOINT — durable progress marker
    // ============================================================

    const newNextIndex = batchEnd;
    const isComplete = newNextIndex >= totalChunks;

    if (isComplete) {
      // ── All chunks processed: verify and mark ready ──
      const { count: verifyCount, error: verifyErr } = await supabase
        .from("document_chunks")
        .select("*", { count: "exact", head: true })
        .eq("document_id", document_id);

      const actualChunkCount = verifyErr ? totalChunks : (verifyCount ?? 0);
      console.log(`[ingest-kb-text] doc=${document_id} COMPLETE — verified ${actualChunkCount} chunks in DB`);

      if (actualChunkCount === 0) {
        const reason = "All batches inserted but verification found 0 rows — possible RLS or constraint issue";
        console.error(`[ingest-kb-text] doc=${document_id} INVARIANT VIOLATION: ${reason}`);
        await updateIngestionMeta(supabase, document_id, {
          status: "failed",
          error: reason,
          failed_at: new Date().toISOString(),
          indexed_chunk_count: 0,
          next_chunk_index: newNextIndex,
        });
        return json(500, { success: false, error: reason });
      }

      await updateIngestionMeta(supabase, document_id, {
        status: "ready",
        indexed_chunk_count: actualChunkCount,
        next_chunk_index: totalChunks,
        indexing_completed_at: new Date().toISOString(),
        last_batch_completed_at: new Date().toISOString(),
        error: null,
        failed_at: null,
      });

      await safeLogEye(supabase, "KB_DOCUMENT_INGEST_COMPLETED", {
        chunk_count: actualChunkCount,
      });

      console.log(`[ingest-kb-text] doc=${document_id} READY with ${actualChunkCount} chunks`);

      return json(200, {
        success: true,
        document_id: doc.id,
        tenant_id: doc.tenant_id,
        chunk_count: totalChunks,
        indexed_chunk_count: actualChunkCount,
        next_chunk_index: totalChunks,
        status: "ready",
        more_work: false,
      } satisfies IngestResponse);
    } else {
      // ── More batches remain: update checkpoint and signal caller ──
      const indexedSoFar = (checkpoint?.indexed_chunk_count ?? 0) + rows.length;

      await updateIngestionMeta(supabase, document_id, {
        status: "embedding_in_progress",
        indexed_chunk_count: indexedSoFar,
        next_chunk_index: newNextIndex,
        last_batch_completed_at: new Date().toISOString(),
      });

      await safeLogEye(supabase, "KB_DOCUMENT_BATCH_COMPLETED", {
        batch_start: nextChunkIndex,
        batch_end: batchEnd - 1,
        indexed_so_far: indexedSoFar,
        total_chunks: totalChunks,
      });

      console.log(
        `[ingest-kb-text] doc=${document_id} batch done. ` +
        `Progress: ${indexedSoFar}/${totalChunks}. Next: ${newNextIndex}. ` +
        `MORE_WORK=true — caller should re-invoke.`
      );

      return json(200, {
        success: true,
        document_id: doc.id,
        tenant_id: doc.tenant_id,
        chunk_count: totalChunks,
        indexed_chunk_count: indexedSoFar,
        next_chunk_index: newNextIndex,
        status: "embedding_in_progress",
        more_work: true,
      } satisfies IngestResponse);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error(`[ingest-kb-text] doc=${document_id} FAILED:`, message);

    // Persist failure — but preserve progress so resume is possible after fix
    try {
      await updateIngestionMeta(document_id, {
        status: "failed",
        error: message,
        failed_at: new Date().toISOString(),
        // NOTE: next_chunk_index and indexed_chunk_count are intentionally
        // NOT reset here. This allows manual resume after the failure cause
        // is fixed, by re-calling with the same document_id.
      });
    } catch (_) { /* best effort */ }

    try {
      await safeLogEye(supabase, "KB_DOCUMENT_INGEST_FAILED", { reason_code: message });
    } catch (_) { /* never fail due to logging */ }

    return json(500, { success: false, error: message });
  }
});
