import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireUser, assertSessionAccess, requireTenantFor } from "../_shared/require-user.ts";

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

    // ── Authenticate caller and authorize the session before any privileged access ──
    const auth = await requireUser(req, supabase);
    if (!auth.ok) {
      return new Response(JSON.stringify({ error: auth.error }),
        { status: auth.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const access = await assertSessionAccess(supabase, auth.caller, session_id, { allowSupervisor: true });
    if (!access.ok) {
      return new Response(JSON.stringify({ error: access.error }),
        { status: access.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Separate real UUIDs from virtual citations (e.g. "TEMPLATE")
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const realCitationIds = citation_ids.filter((id: string) => UUID_RE.test(id));
    const virtualCitations = citation_ids.filter((id: string) => !UUID_RE.test(id));

    // If no real citation IDs, return early with virtual-only info
    if (realCitationIds.length === 0) {
      return new Response(
        JSON.stringify({
          snippets: [],
          unresolved: [],
          virtual_citations: virtualCitations,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 1. Get session's policy_pack_id
    const { data: session, error: sessErr } = await supabase
      .from("sessions")
      .select("policy_pack_id")
      .eq("id", session_id)
      .maybeSingle();

    if (sessErr) throw sessErr;
    if (!session?.policy_pack_id) {
      return new Response(
        JSON.stringify({
          snippets: [],
          unresolved: realCitationIds,
          virtual_citations: virtualCitations,
          resolution_note: "no_policy_pack",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2. Fetch compiled pack chunks
    const { data: packChunks, error: pcErr } = await supabase
      .from("compiled_policy_pack_chunks")
      .select("chunk_id, chunk_index, document_id, similarity, rank")
      .eq("compiled_policy_pack_id", session.policy_pack_id)
      .in("chunk_id", realCitationIds);

    if (pcErr) throw pcErr;

    const foundChunkIds = (packChunks ?? []).map((c: any) => c.chunk_id);

    // 3. Fetch document_chunks content + heading_path
    const { data: docChunks, error: dcErr } = foundChunkIds.length > 0
      ? await supabase
          .from("document_chunks")
          .select("id, content, chunk_index, heading_path")
          .in("id", foundChunkIds)
      : { data: [], error: null };

    if (dcErr) throw dcErr;

    // 4. Fetch kb_documents titles
    const docIds = [...new Set((packChunks ?? []).map((c: any) => c.document_id))];
    const { data: docs, error: dErr } = docIds.length > 0
      ? await supabase
          .from("kb_documents")
          .select("id, title, source")
          .in("id", docIds)
      : { data: [], error: null };

    if (dErr) throw dErr;

    const chunkMap = new Map((docChunks ?? []).map((c: any) => [c.id, c]));
    const docMap = new Map((docs ?? []).map((d: any) => [d.id, { title: d.title, source: d.source }]));

    const snippets = (packChunks ?? [])
      .sort((a: any, b: any) => (a.rank ?? 999) - (b.rank ?? 999))
      .map((pc: any) => {
        const chunk = chunkMap.get(pc.chunk_id);
        const doc = docMap.get(pc.document_id);
        return {
          snippetId: pc.chunk_id,
          chunkText: chunk?.content ?? "",
          chunkIndex: chunk?.chunk_index ?? pc.chunk_index,
          headingPath: chunk?.heading_path ?? null,
          documentId: pc.document_id,
          documentTitle: doc?.title ?? "Unknown document",
          documentSource: doc?.source ?? null,
          similarity: pc.similarity,
          rank: pc.rank,
        };
      });

    const resolvedSet = new Set(foundChunkIds);
    const unresolved = realCitationIds.filter((id: string) => !resolvedSet.has(id));

    return new Response(
      JSON.stringify({
        snippets,
        unresolved,
        virtual_citations: virtualCitations,
      }),
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
