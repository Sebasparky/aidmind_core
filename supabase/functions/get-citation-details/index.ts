import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { session_id, citation_ids } = await req.json();

    if (!session_id || !Array.isArray(citation_ids) || citation_ids.length === 0) {
      return new Response(
        JSON.stringify({ error: "session_id and citation_ids[] required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Get session's policy_pack_id
    const { data: session, error: sessErr } = await supabase
      .from("sessions")
      .select("policy_pack_id")
      .eq("id", session_id)
      .maybeSingle();

    if (sessErr) throw sessErr;
    if (!session?.policy_pack_id) {
      return new Response(
        JSON.stringify({ snippets: [], unresolved: citation_ids }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2. Fetch compiled pack chunks
    const { data: packChunks, error: pcErr } = await supabase
      .from("compiled_policy_pack_chunks")
      .select("chunk_id, chunk_index, document_id, similarity, rank")
      .eq("compiled_policy_pack_id", session.policy_pack_id)
      .in("chunk_id", citation_ids);

    if (pcErr) throw pcErr;

    const foundChunkIds = (packChunks ?? []).map((c: any) => c.chunk_id);

    // 3. Fetch document_chunks content
    const { data: docChunks, error: dcErr } = foundChunkIds.length > 0
      ? await supabase
          .from("document_chunks")
          .select("id, content, chunk_index")
          .in("id", foundChunkIds)
      : { data: [], error: null };

    if (dcErr) throw dcErr;

    // 4. Fetch kb_documents titles
    const docIds = [...new Set((packChunks ?? []).map((c: any) => c.document_id))];
    const { data: docs, error: dErr } = docIds.length > 0
      ? await supabase
          .from("kb_documents")
          .select("id, title")
          .in("id", docIds)
      : { data: [], error: null };

    if (dErr) throw dErr;

    const chunkMap = new Map((docChunks ?? []).map((c: any) => [c.id, c]));
    const docMap = new Map((docs ?? []).map((d: any) => [d.id, d.title]));

    const snippets = (packChunks ?? [])
      .sort((a: any, b: any) => (a.rank ?? 999) - (b.rank ?? 999))
      .map((pc: any) => {
        const chunk = chunkMap.get(pc.chunk_id);
        return {
          snippetId: pc.chunk_id,
          chunkText: chunk?.content ?? "",
          chunkIndex: chunk?.chunk_index ?? pc.chunk_index,
          documentId: pc.document_id,
          documentTitle: docMap.get(pc.document_id) ?? "Unknown document",
          similarity: pc.similarity,
          rank: pc.rank,
        };
      });

    const resolvedSet = new Set(foundChunkIds);
    const unresolved = citation_ids.filter((id: string) => !resolvedSet.has(id));

    return new Response(
      JSON.stringify({ snippets, unresolved }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[get-citation-details] error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error resolving citations" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
