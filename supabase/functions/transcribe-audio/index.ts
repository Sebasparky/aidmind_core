/**
 * V1 PIVOT: Transcribe Audio - DISABLED
 * 
 * This edge function is disabled in v1. All requests return 410 Gone.
 * 
 * Original implementation: supabase/functions/_future/transcribe-audio/index.ts
 * Frontend gate: src/config/features.ts (V1_ENABLE_TRANSCRIPTION)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { buildCorsSecurityHeaders, enforceTransportSecurity } from "../_shared/security-headers.ts";

serve(async (req) => {
  // Enforce transport security first
  const securityResponse = await enforceTransportSecurity(req);
  if (securityResponse) return securityResponse;

  const corsHeaders = buildCorsSecurityHeaders(req);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // V1 pivot: transcription disabled
  console.warn("[V1 Pivot] transcribe-audio called but feature is disabled");
  
  return new Response(
    JSON.stringify({
      success: false,
      error: "Disabled in v1 pivot",
      message: "Transcription is not available in this version. See src/config/features.ts to re-enable.",
      code: "FEATURE_DISABLED",
    }),
    { 
      status: 410,  // 410 Gone - resource no longer available
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    }
  );
});
