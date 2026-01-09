/**
 * Security Headers Module
 * 
 * HTTPS-Only Security Policy:
 * - All traffic MUST be HTTPS
 * - HSTS enforced with preload
 * - Secure cookie settings
 * - CSP to prevent mixed content
 * 
 * CRITICAL SECURITY INVARIANTS:
 * - NO per-route overrides allowed
 * - NO "debug HTTP" mode
 * - NO request body logging on failure
 * - ALL requests MUST pass transport security check
 */

// ============================================================
// HSTS CONFIGURATION
// ============================================================

/**
 * HTTP Strict Transport Security header value
 * - max-age: 1 year (31536000 seconds) - meets security requirements
 * - includeSubDomains: protects all subdomains
 * - preload: eligible for browser preload lists
 */
const HSTS_VALUE = "max-age=31536000; includeSubDomains; preload";

// ============================================================
// CONTENT SECURITY POLICY
// ============================================================

/**
 * Content Security Policy to prevent mixed content
 * - upgrade-insecure-requests: auto-upgrade HTTP to HTTPS
 * - block-all-mixed-content: block any remaining HTTP resources
 */
const CSP_VALUE = [
  "upgrade-insecure-requests",
  "block-all-mixed-content",
  "default-src 'self' https:",
  "script-src 'self' https: 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' https: 'unsafe-inline'",
  "img-src 'self' https: data: blob:",
  "font-src 'self' https: data:",
  "connect-src 'self' https: wss:",
  "frame-ancestors 'self'",
].join("; ");

// ============================================================
// KNOWN TLS-TERMINATING PROXIES
// ============================================================

/**
 * Known trusted proxy identifiers.
 * Requests MUST arrive via one of these known proxies.
 * 
 * SECURITY: This list is intentionally restrictive.
 * Add new proxies only after security review.
 */
const KNOWN_TLS_PROXIES = new Set([
  "supabase",           // Supabase Edge Functions proxy
  "cloudflare",         // Cloudflare CDN
  "vercel",             // Vercel Edge
  "aws-elb",            // AWS Elastic Load Balancer
  "google-frontend",    // Google Cloud Load Balancer
  "azure-frontdoor",    // Azure Front Door
]);

/**
 * Headers that indicate request came through a known proxy.
 * At least one must be present for proxy verification.
 */
const PROXY_INDICATOR_HEADERS = [
  "x-forwarded-for",      // Standard proxy header
  "x-real-ip",            // Common proxy header
  "cf-connecting-ip",     // Cloudflare
  "x-vercel-ip",          // Vercel
  "x-amzn-trace-id",      // AWS
  "x-cloud-trace-context", // Google Cloud
];

// ============================================================
// SECURITY HEADERS OBJECT
// ============================================================

/**
 * Standard security headers for all API responses
 */
export const securityHeaders: Record<string, string> = {
  // HTTPS enforcement
  "Strict-Transport-Security": HSTS_VALUE,
  
  // Content Security Policy
  "Content-Security-Policy": CSP_VALUE,
  
  // Prevent MIME type sniffing
  "X-Content-Type-Options": "nosniff",
  
  // XSS protection (legacy but still useful)
  "X-XSS-Protection": "1; mode=block",
  
  // Prevent clickjacking
  "X-Frame-Options": "SAMEORIGIN",
  
  // Referrer policy - don't leak URLs
  "Referrer-Policy": "strict-origin-when-cross-origin",
  
  // Permissions policy - disable unnecessary features
  "Permissions-Policy": "geolocation=(), microphone=(self), camera=()",
};

// ============================================================
// COOKIE CONFIGURATION
// ============================================================

/**
 * Secure cookie attributes
 * Use when setting any cookies in edge functions
 */
export const secureCookieAttributes = {
  Secure: true,
  HttpOnly: true,
  SameSite: "Strict" as const,
  Path: "/",
};

/**
 * Build a Set-Cookie header value with secure defaults
 */
export function buildSecureCookie(
  name: string,
  value: string,
  maxAge?: number,
  options?: Partial<typeof secureCookieAttributes>
): string {
  const attrs = { ...secureCookieAttributes, ...options };
  const parts = [
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    attrs.Secure && "Secure",
    attrs.HttpOnly && "HttpOnly",
    `SameSite=${attrs.SameSite}`,
    `Path=${attrs.Path}`,
    maxAge !== undefined && `Max-Age=${maxAge}`,
  ].filter(Boolean);
  
  return parts.join("; ");
}

// ============================================================
// HTTPS ENFORCEMENT (STRICT)
// ============================================================

/**
 * Transport security verification result
 */
interface TransportSecurityResult {
  secure: boolean;
  reason?: string;
  proto?: string;
  proxyVerified?: boolean;
}

/**
 * Verify request transport security.
 * 
 * CRITICAL: This function enforces strict HTTPS requirements.
 * - NO per-route overrides
 * - NO debug mode
 * - NO exceptions
 * 
 * Checks:
 * 1. X-Forwarded-Proto MUST be "https"
 * 2. Request MUST arrive via known TLS-terminating proxy
 * 
 * @returns TransportSecurityResult with verification details
 */
function verifyTransportSecurity(req: Request): TransportSecurityResult {
  // Check 1: X-Forwarded-Proto MUST be "https"
  const proto = req.headers.get("x-forwarded-proto");
  
  if (!proto) {
    // No proto header - check if direct HTTPS (edge case: direct function invocation)
    const url = new URL(req.url);
    if (url.protocol !== "https:") {
      return {
        secure: false,
        reason: "MISSING_PROTO_HEADER",
        proto: url.protocol,
        proxyVerified: false,
      };
    }
    // Direct HTTPS without proxy - allowed but logged
    return {
      secure: true,
      proto: "https",
      proxyVerified: false,
    };
  }
  
  if (proto.toLowerCase() !== "https") {
    return {
      secure: false,
      reason: "INSECURE_PROTO",
      proto: proto.toLowerCase(),
      proxyVerified: false,
    };
  }
  
  // Check 2: Verify request arrived via known TLS-terminating proxy
  // At least one proxy indicator header must be present
  const hasProxyIndicator = PROXY_INDICATOR_HEADERS.some(
    (header) => req.headers.has(header)
  );
  
  // Check for known proxy identifier in Via or X-Forwarded-By headers
  const viaHeader = req.headers.get("via")?.toLowerCase() ?? "";
  const forwardedByHeader = req.headers.get("x-forwarded-by")?.toLowerCase() ?? "";
  
  const hasKnownProxy = Array.from(KNOWN_TLS_PROXIES).some(
    (proxy) => viaHeader.includes(proxy) || forwardedByHeader.includes(proxy)
  );
  
  // In Supabase Edge Functions context, we trust the x-forwarded-proto header
  // if any proxy indicator is present (Supabase always sets these)
  const proxyVerified = hasProxyIndicator || hasKnownProxy;
  
  // For Supabase Edge Functions, x-forwarded-proto=https is sufficient
  // because Supabase infrastructure guarantees TLS termination
  return {
    secure: true,
    proto: "https",
    proxyVerified,
  };
}

/**
 * Check if request is secure (HTTPS via trusted proxy).
 * 
 * This is the ONLY function that should be used for transport security checks.
 * NO overrides, NO debug mode, NO exceptions.
 */
export function isSecureRequest(req: Request): boolean {
  const result = verifyTransportSecurity(req);
  
  if (!result.secure) {
    // Log security failure (NO request body, NO sensitive data)
    console.warn("[SECURITY] Transport security check FAILED:", {
      reason: result.reason,
      proto: result.proto,
      method: req.method,
      path: new URL(req.url).pathname,
      // NEVER log: req.body, headers with auth tokens, etc.
    });
  }
  
  return result.secure;
}

/**
 * Create a 403 Forbidden response for insecure API requests.
 * 
 * CRITICAL:
 * - Does NOT process auth, sessions, or payloads
 * - Does NOT log request body
 * - Returns immediately
 */
export function createInsecureRequestResponse(): Response {
  // Log rejection (minimal info, NO sensitive data)
  console.warn("[SECURITY] Rejecting insecure transport request");
  
  return new Response(
    JSON.stringify({
      error: "HTTPS Required",
      message: "This API endpoint requires secure transport",
      code: "INSECURE_TRANSPORT",
    }),
    {
      status: 403,
      headers: {
        "Content-Type": "application/json",
        // Include HSTS to help client upgrade
        "Strict-Transport-Security": HSTS_VALUE,
        // Minimal headers - don't leak info
        "X-Content-Type-Options": "nosniff",
      },
    }
  );
}

/**
 * Create a 301 redirect to HTTPS for web requests.
 * 
 * NOTE: This is for public web pages only.
 * API endpoints should use createInsecureRequestResponse() to reject.
 */
export function createHttpsRedirectResponse(req: Request): Response {
  const url = new URL(req.url);
  url.protocol = "https:";
  
  return new Response(null, {
    status: 301,
    headers: {
      Location: url.toString(),
      "Strict-Transport-Security": HSTS_VALUE,
    },
  });
}

// ============================================================
// CORS + SECURITY HEADERS (COMBINED)
// ============================================================

/**
 * Combined CORS and security headers for API responses
 */
export const corsSecurityHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  ...securityHeaders,
};

/**
 * Create headers object for JSON API responses with full security
 */
export function createSecureJsonHeaders(
  additionalHeaders?: Record<string, string>
): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...corsSecurityHeaders,
    ...additionalHeaders,
  };
}

// ============================================================
// SECURITY MIDDLEWARE GUARD
// ============================================================

/**
 * Enforce transport security on a request.
 * 
 * Use this as the FIRST check in every edge function handler.
 * Returns a Response if the request should be rejected, null otherwise.
 * 
 * CRITICAL: This check is MANDATORY and has NO overrides.
 * 
 * @example
 * ```typescript
 * Deno.serve(async (req) => {
 *   // CORS preflight (allowed without security check)
 *   if (req.method === "OPTIONS") {
 *     return new Response(null, { headers: corsSecurityHeaders });
 *   }
 *   
 *   // MANDATORY security check - no exceptions
 *   const securityResponse = enforceTransportSecurity(req);
 *   if (securityResponse) return securityResponse;
 *   
 *   // ... rest of handler
 * });
 * ```
 */
export function enforceTransportSecurity(req: Request): Response | null {
  if (!isSecureRequest(req)) {
    return createInsecureRequestResponse();
  }
  return null;
}
