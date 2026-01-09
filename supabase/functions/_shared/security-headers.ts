/**
 * Security Headers Module
 * 
 * HTTPS-Only Security Policy:
 * - All traffic MUST be HTTPS
 * - HSTS enforced with preload
 * - Secure cookie settings
 * - CSP to prevent mixed content
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
// HTTPS ENFORCEMENT
// ============================================================

/**
 * Check if request is over HTTPS
 * In production, the load balancer terminates TLS, but we can check headers
 */
export function isSecureRequest(req: Request): boolean {
  // Check X-Forwarded-Proto header (set by load balancer)
  const proto = req.headers.get("x-forwarded-proto");
  if (proto) {
    return proto.toLowerCase() === "https";
  }
  
  // Check URL scheme
  const url = new URL(req.url);
  return url.protocol === "https:";
}

/**
 * Create a 403 Forbidden response for insecure API requests
 */
export function createInsecureRequestResponse(): Response {
  return new Response(
    JSON.stringify({
      error: "HTTPS Required",
      message: "This API endpoint only accepts HTTPS connections",
      code: "INSECURE_TRANSPORT",
    }),
    {
      status: 403,
      headers: {
        "Content-Type": "application/json",
        ...securityHeaders,
      },
    }
  );
}

/**
 * Create a 301 redirect to HTTPS for web requests
 */
export function createHttpsRedirectResponse(req: Request): Response {
  const url = new URL(req.url);
  url.protocol = "https:";
  
  return new Response(null, {
    status: 301,
    headers: {
      Location: url.toString(),
      ...securityHeaders,
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
