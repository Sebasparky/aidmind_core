/**
 * kb-kick — Kicks the Cloud Run kb-extractor-service to start processing queued jobs.
 *
 * Reads secrets from environment:
 *   KB_EXTRACTOR_SERVICE_URL  — base URL of the Cloud Run service
 *   KB_EXTRACTOR_KICK_SECRET  — shared secret for X-AIDMIND-KICK-SECRET header
 *
 * Always returns JSON { ok, status?, body?, error? }. Never throws uncaught.
 */

import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Only POST allowed
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const serviceUrl = Deno.env.get("KB_EXTRACTOR_SERVICE_URL");
    const kickSecret = Deno.env.get("KB_EXTRACTOR_KICK_SECRET");

    if (!serviceUrl || !kickSecret) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing Edge secrets" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 5-second hard timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    let resp: Response;
    try {
      resp = await fetch(`${serviceUrl}/run`, {
        method: "POST",
        headers: {
          "X-AIDMIND-KICK-SECRET": kickSecret,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      });
    } catch (fetchErr: any) {
      clearTimeout(timeout);
      const msg = fetchErr?.name === "AbortError"
        ? "Kick timed out after 5s"
        : `Fetch error: ${fetchErr?.message ?? "unknown"}`;
      return new Response(
        JSON.stringify({ ok: false, error: msg }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    clearTimeout(timeout);

    const bodyText = await resp.text();
    const truncated = bodyText.length > 500 ? bodyText.slice(0, 500) : bodyText;

    return new Response(
      JSON.stringify({ ok: resp.ok, status: resp.status, body: truncated }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: err?.message ?? "Unknown error" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
