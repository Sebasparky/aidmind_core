/**
 * kb-kick — Kicks the Cloud Run kb-extractor-service to start processing queued jobs.
 *
 * Reads secrets from environment:
 *   KB_EXTRACTOR_SERVICE_URL  — base URL of the Cloud Run service
 *   KB_EXTRACTOR_KICK_SECRET  — shared secret for X-AIDMIND-KICK-SECRET header
 *
 * Always returns JSON { ok, status, cloudRunStatus?, body?, error? }. Never throws uncaught.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { requireUser } from "../_shared/require-user.ts";

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Only POST allowed
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, status: "method_not_allowed", error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── Authenticate caller: only active tenant members may trigger extraction runs ──
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const auth = await requireUser(req, supabase);
  if (!auth.ok) {
    return new Response(
      JSON.stringify({ ok: false, status: "unauthorized", error: auth.error }),
      { status: auth.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const serviceUrl = Deno.env.get("KB_EXTRACTOR_SERVICE_URL");
    const kickSecret = Deno.env.get("KB_EXTRACTOR_KICK_SECRET");

    if (!serviceUrl || !kickSecret) {
      return new Response(
        JSON.stringify({ ok: false, status: "config_error", error: "Missing Edge secrets (KB_EXTRACTOR_SERVICE_URL or KB_EXTRACTOR_KICK_SECRET)" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Build URL safely — strip trailing slash from base, ensure /run
    const runUrl = serviceUrl.replace(/\/+$/, "") + "/run";

    // 5-second hard timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    let resp: Response;
    try {
      resp = await fetch(runUrl, {
        method: "POST",
        headers: {
          "X-AIDMIND-KICK-SECRET": kickSecret,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      });
    } catch (fetchErr: unknown) {
      clearTimeout(timeout);
      const err = fetchErr as { name?: string; message?: string };
      const msg = err?.name === "AbortError"
        ? "Kick timed out after 5s"
        : `Fetch error: ${err?.message ?? "unknown"}`;
      return new Response(
        JSON.stringify({ ok: false, status: "kick_failed", error: msg }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    clearTimeout(timeout);

    const bodyText = await resp.text();
    const truncated = bodyText.length > 500 ? bodyText.slice(0, 500) : bodyText;

    // Try to parse JSON body for structured forwarding
    let bodyJson: unknown = truncated;
    try {
      bodyJson = JSON.parse(bodyText);
    } catch {
      // keep as string
    }

    if (resp.ok) {
      return new Response(
        JSON.stringify({
          ok: true,
          status: "kick_sent",
          cloudRunStatus: resp.status,
          body: bodyJson,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    } else {
      return new Response(
        JSON.stringify({
          ok: false,
          status: "kick_failed",
          cloudRunStatus: resp.status,
          body: bodyJson,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  } catch (err: unknown) {
    const error = err as { message?: string };
    return new Response(
      JSON.stringify({ ok: false, status: "kick_failed", error: error?.message ?? "Unknown error" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
