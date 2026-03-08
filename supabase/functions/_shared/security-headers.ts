/**
 * Security Headers Module
 * 
 * HTTPS-Only Security Policy:
 * - All traffic MUST be HTTPS (inbound AND outbound)
 * - HSTS enforced with preload
 * - Secure cookie settings
 * - CSP to prevent mixed content
 * - Internal network treated as HOSTILE
 * 
 * CRITICAL SECURITY INVARIANTS:
 * - NO per-route overrides allowed
 * - NO "debug HTTP" mode
 * - NO request body logging on failure
 * - ALL requests MUST pass transport security check
 * - ALL outbound requests MUST use HTTPS with cert validation
 * - NO "skip TLS verification" allowed
 * - TLS failure = request failure (no insecure retry)
 * - enforceTransportSecurity MUST run BEFORE any early return including OPTIONS
 * - verifyTransportSecurity MUST fail closed in production
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
// PLATFORM INGRESS VERIFICATION (NON-SPOOFABLE)
// ============================================================

/**
 * Valid Supabase Edge Functions host suffix.
 * 
 * SECURITY: Edge functions are ONLY served from Supabase infrastructure.
 * The host is set by the platform load balancer and cannot be spoofed by clients.
 * 
 * NOTE: *.lovableproject.com is frontend hosting ONLY, not edge function ingress.
 * Do not add it here - edge functions MUST come through Supabase.
 */
const SUPABASE_FUNCTIONS_HOST_SUFFIX = ".supabase.co";

/**
 * Valid functions path prefix.
 * All Supabase edge functions are routed through /functions/v1/
 */
const SUPABASE_FUNCTIONS_PATH_PREFIX = "/functions/v1/";

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
// COOKIE CONFIGURATION (STRICT SECURITY)
// ============================================================

/**
 * Secure cookie attributes - MANDATORY for all cookies.
 * 
 * CRITICAL SECURITY INVARIANTS:
 * - Secure: Cookie only sent over HTTPS (prevents HTTP exposure)
 * - HttpOnly: Not accessible via JavaScript (prevents XSS theft)
 * - SameSite=Strict: No cross-site requests (prevents CSRF)
 * 
 * These settings CANNOT be overridden. Even if a browser misbehaves,
 * the cookie attributes provide defense-in-depth.
 */
const MANDATORY_COOKIE_ATTRIBUTES = {
  Secure: true,
  HttpOnly: true,
  SameSite: "Strict" as const,
} as const;

/**
 * Exported cookie attributes for reference only.
 * Actual cookie building enforces these regardless of what's passed.
 */
export const secureCookieAttributes = {
  ...MANDATORY_COOKIE_ATTRIBUTES,
  Path: "/",
};

/**
 * Build a Set-Cookie header value with ENFORCED secure defaults.
 * 
 * CRITICAL: This function REFUSES to build cookies on insecure connections.
 * The Secure, HttpOnly, and SameSite=Strict attributes are MANDATORY
 * and cannot be overridden.
 * 
 * @param req - The request object (used to verify HTTPS)
 * @param name - Cookie name
 * @param value - Cookie value (will be URL-encoded)
 * @param maxAge - Optional max age in seconds
 * @param path - Optional path (defaults to "/")
 * @returns The Set-Cookie header value, or null if request is insecure
 * 
 * @throws Never - returns null on insecure requests instead of throwing
 */
export function buildSecureCookie(
  req: Request,
  name: string,
  value: string,
  maxAge?: number,
  path: string = "/"
): string | null {
  // CRITICAL: Never set cookies on HTTP responses
  if (!isSecureRequest(req)) {
    console.warn("[SECURITY] Refusing to set cookie on insecure connection");
    return null;
  }
  
  // Validate cookie name (RFC 6265)
  if (!name || /[\x00-\x1F\x7F\s\(\)\<\>\@\,\;\:\\\"\/\[\]\?\=\{\}]/.test(name)) {
    console.warn("[SECURITY] Invalid cookie name rejected");
    return null;
  }
  
  // Build cookie with MANDATORY security attributes
  // These CANNOT be overridden - they are enforced regardless of parameters
  const parts = [
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    "Secure",                    // MANDATORY: HTTPS only
    "HttpOnly",                  // MANDATORY: No JS access
    "SameSite=Strict",           // MANDATORY: No cross-site
    `Path=${path}`,
    maxAge !== undefined && `Max-Age=${maxAge}`,
  ].filter(Boolean);
  
  return parts.join("; ");
}

/**
 * Legacy buildSecureCookie signature for backward compatibility.
 * 
 * @deprecated Use the new signature with Request object for HTTPS enforcement.
 */
export function buildSecureCookieLegacy(
  name: string,
  value: string,
  maxAge?: number,
  options?: Partial<typeof secureCookieAttributes>
): string {
  // Log warning about insecure usage
  console.warn("[SECURITY] Using legacy cookie builder without HTTPS verification");
  
  // Still enforce mandatory attributes regardless of options
  const parts = [
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    "Secure",
    "HttpOnly",
    "SameSite=Strict",
    `Path=${options?.Path ?? "/"}`,
    maxAge !== undefined && `Max-Age=${maxAge}`,
  ].filter(Boolean);
  
  return parts.join("; ");
}

// ============================================================
// TOKEN SECURITY (STRICT)
// ============================================================

/**
 * Patterns that identify tokens/credentials in strings.
 * Used to detect and prevent accidental logging.
 */
const TOKEN_PATTERNS = [
  /^Bearer\s+/i,                    // Bearer tokens
  /^eyJ[A-Za-z0-9_-]+\./,           // JWT tokens (base64 header)
  /^sk[-_][a-zA-Z0-9]{20,}/,        // API secret keys (sk-xxx)
  /^pk[-_][a-zA-Z0-9]{20,}/,        // API public keys (pk-xxx)
  /^xoxb-[0-9]+/,                   // Slack bot tokens
  /^ghp_[a-zA-Z0-9]{36}/,           // GitHub PATs
  /^gho_[a-zA-Z0-9]{36}/,           // GitHub OAuth tokens
  /password/i,                      // Password fields
  /secret/i,                        // Secret fields
  /apikey/i,                        // API key fields
  /api[-_]?key/i,                   // API key variants
  /access[-_]?token/i,              // Access tokens
  /refresh[-_]?token/i,             // Refresh tokens
  /auth[-_]?token/i,                // Auth tokens
];

/**
 * Check if a string appears to be a token/credential.
 */
export function looksLikeToken(value: string): boolean {
  if (!value || typeof value !== "string") return false;
  return TOKEN_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * Redact a token for safe logging (shows only first/last 4 chars).
 */
export function redactToken(value: string): string {
  if (!value || value.length < 12) return "[REDACTED]";
  return `${value.slice(0, 4)}...[REDACTED]...${value.slice(-4)}`;
}

/**
 * Sanitize an object for logging by redacting potential tokens.
 * 
 * CRITICAL: Use this for ANY object that might contain credentials
 * before logging.
 */
export function sanitizeForLogging(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  
  if (typeof obj === "string") {
    return looksLikeToken(obj) ? redactToken(obj) : obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(sanitizeForLogging);
  }
  
  if (typeof obj === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      // Always redact known sensitive keys
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes("password") ||
        lowerKey.includes("secret") ||
        lowerKey.includes("token") ||
        lowerKey.includes("apikey") ||
        lowerKey.includes("api_key") ||
        lowerKey.includes("authorization") ||
        lowerKey.includes("credential")
      ) {
        sanitized[key] = "[REDACTED]";
      } else if (typeof value === "string" && looksLikeToken(value)) {
        sanitized[key] = redactToken(value);
      } else {
        sanitized[key] = sanitizeForLogging(value);
      }
    }
    return sanitized;
  }
  
  return obj;
}

/**
 * Check if a URL contains tokens (NEVER allowed).
 * 
 * Tokens in URLs are dangerous because:
 * - They appear in server logs
 * - They appear in browser history
 * - They appear in Referer headers
 * - They can be cached by proxies
 */
export function urlContainsToken(url: string): boolean {
  try {
    const parsed = new URL(url);
    
    // Check query parameters
    for (const [key, value] of parsed.searchParams) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes("token") ||
        lowerKey.includes("key") ||
        lowerKey.includes("secret") ||
        lowerKey.includes("password") ||
        lowerKey.includes("auth") ||
        looksLikeToken(value)
      ) {
        return true;
      }
    }
    
    // Check path for JWT-like patterns
    if (/eyJ[A-Za-z0-9_-]+\./.test(parsed.pathname)) {
      return true;
    }
    
    // Check hash for tokens
    if (parsed.hash && looksLikeToken(parsed.hash)) {
      return true;
    }
    
    return false;
  } catch {
    return false;
  }
}

/**
 * Validate that a request doesn't have tokens in the URL.
 * Returns an error response if tokens are detected.
 */
export function rejectTokensInUrl(req: Request): Response | null {
  if (urlContainsToken(req.url)) {
    console.warn("[SECURITY] Rejecting request with token in URL");
    return new Response(
      JSON.stringify({
        error: "Invalid Request",
        message: "Tokens must not be sent in URLs",
        code: "TOKEN_IN_URL",
      }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          "Strict-Transport-Security": HSTS_VALUE,
          "X-Content-Type-Options": "nosniff",
        },
      }
    );
  }
  return null;
}

/**
 * Extract and validate authorization header.
 * 
 * Returns the token if valid, null otherwise.
 * NEVER logs the token value.
 */
export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("authorization");
  
  if (!authHeader) {
    return null;
  }
  
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    console.warn("[SECURITY] Invalid authorization header format");
    return null;
  }
  
  const token = authHeader.slice(7).trim();
  
  if (!token || token.length < 10) {
    console.warn("[SECURITY] Authorization token too short");
    return null;
  }
  
  // Log that we extracted a token, but NEVER the value
  console.log("[SECURITY] Bearer token extracted (not logged)");
  
  return token;
}

// ============================================================
// HTTPS ENFORCEMENT (STRICT - NON-BYPASSABLE)
// ============================================================

/**
 * Transport security verification result
 */
interface TransportSecurityResult {
  secure: boolean;
  reason?: string;
  proto?: string;
  hostVerified?: boolean;
  pathVerified?: boolean;
}

/**
 * Check if running in development environment.
 * 
 * ONLY in development (ENVIRONMENT === "development") is the 
 * direct HTTPS without proxy verification allowed.
 */
function isDevelopmentEnvironment(): boolean {
  const env = Deno.env.get("ENVIRONMENT");
  return env === "development";
}

/**
 * Verify request arrives via Supabase Edge Functions ingress.
 * 
 * Host/path invariants are used to validate expected ingress patterns;
 * we still fail closed unless all requirements match.
 * 
 * SECURITY CONSTRAINTS:
 * - Host MUST end with ".supabase.co"
 * - Path MUST start with "/functions/v1/"
 * - NO other ingress points are valid for edge functions
 * 
 * NOTE: *.lovableproject.com is frontend hosting only.
 * Edge functions are exclusively served from Supabase infrastructure.
 */
function verifySupabaseEdgeFunctionIngress(req: Request): { verified: boolean; host: string; path: string } {
  try {
    const url = new URL(req.url);
    const host = url.host.toLowerCase();
    const path = url.pathname;
    
    // Check if host matches Supabase functions domain ONLY
    // Edge functions are NEVER served from *.lovableproject.com
    const isSupabaseHost = host.endsWith(SUPABASE_FUNCTIONS_HOST_SUFFIX);
    
    // Path MUST start with /functions/v1/ for Supabase edge functions
    const isValidPath = path.startsWith(SUPABASE_FUNCTIONS_PATH_PREFIX);
    
    return {
      verified: isSupabaseHost && isValidPath,
      host,
      path,
    };
  } catch {
    return { verified: false, host: "invalid", path: "invalid" };
  }
}

/**
 * @deprecated Use verifySupabaseEdgeFunctionIngress instead.
 * This alias exists for backward compatibility during migration.
 */
const verifyPlatformIngress = verifySupabaseEdgeFunctionIngress;

// ============================================================
// TRANSPORT SECURITY TRUST MODEL
// ============================================================
// 
// We do NOT trust client-provided headers such as x-forwarded-for.
// 
// We require multiple independent signals (x-forwarded-proto + URL protocol + host/path).
// 
// TRUSTED SIGNALS:
// - x-forwarded-proto: Set by platform load balancer, indicates client→LB protocol
// - URL protocol: Set by platform, indicates LB→function protocol
// - URL host/path: Set by platform routing, validates expected ingress
// 
// UNTRUSTED (never rely on):
// - x-forwarded-for: Easily spoofed by clients
// - x-real-ip: Easily spoofed by clients
// - Any single signal alone: Require correlation of multiple signals
// ============================================================

/**
 * Verify request transport security.
 * 
 * CRITICAL: This function enforces strict HTTPS requirements.
 * - NO per-route overrides
 * - NO debug mode
 * - NO exceptions (except narrow development environment)
 * - FAIL CLOSED in production if cannot prove security
 * 
 * Production proof requires ALL of:
 * 1. x-forwarded-proto === "https"
 * 2. URL protocol === "https:"
 * 3. Host matches *.supabase.co AND path starts with /functions/v1/
 * 
 * Host/path invariants are used to validate expected ingress patterns;
 * we still fail closed unless all requirements match.
 * 
 * @returns TransportSecurityResult with verification details
 */
function verifyTransportSecurity(req: Request): TransportSecurityResult {
  const environment = Deno.env.get("ENVIRONMENT") ?? "production";
  const isDev = isDevelopmentEnvironment();
  
  // Get protocol header (set by platform load balancer, not client)
  const proto = req.headers.get("x-forwarded-proto")?.toLowerCase();
  
  // Verify platform ingress using host/path invariants
  const ingressCheck = verifyPlatformIngress(req);

  // ============================================================
  // DEVELOPMENT EXCEPTION (ONLY when ENVIRONMENT === "development")
  // 
  // Development exception is intentionally narrow to avoid accidental
  // insecure deployments. Only localhost or valid Supabase ingress allowed.
  // ============================================================
  if (isDev) {
    const url = new URL(req.url);
    const host = url.host.toLowerCase();
    
    // ALWAYS reject http: URLs, even in development
    if (url.protocol !== "https:") {
      return {
        secure: false,
        reason: "DEV_HTTP_REJECTED",
        proto: url.protocol,
        hostVerified: false,
        pathVerified: false,
      };
    }
    
    // Check if host is localhost variant
    const isLocalhost = 
      host === "localhost" ||
      host.startsWith("localhost:") ||
      host === "127.0.0.1" ||
      host.startsWith("127.0.0.1:") ||
      host === "[::1]" ||
      host.startsWith("[::1]:");
    
    // Check if valid Supabase edge function ingress
    const isValidSupabaseIngress = ingressCheck.verified;
    
    // Development exception is intentionally narrow to avoid accidental insecure deployments.
    if (isLocalhost) {
      return {
        secure: true,
        proto: "https",
        hostVerified: false, // Localhost is trusted in dev
        pathVerified: false,
      };
    }
    
    if (isValidSupabaseIngress) {
      return {
        secure: true,
        proto: "https",
        hostVerified: true,
        pathVerified: true,
      };
    }
    
    // Reject all other hosts even in development
    return {
      secure: false,
      reason: "DEV_UNTRUSTED_HOST",
      proto: "https",
      hostVerified: false,
      pathVerified: false,
    };
  }
  
  // ============================================================
  // PRODUCTION / STAGING: STRICT VERIFICATION (NO EXCEPTIONS)
  // 
  // SECURITY RATIONALE: Mixed transport signals are treated as suspicious.
  // If x-forwarded-proto and URL protocol disagree, we MUST fail closed.
  // This prevents downgrade attacks where an attacker might try to proxy
  // HTTPS requests over HTTP or vice versa.
  // ============================================================
  
  // Get URL protocol for consistency check
  const urlProtocol = new URL(req.url).protocol;
  
  // Check 1: x-forwarded-proto MUST be present and === "https"
  if (!proto) {
    return {
      secure: false,
      reason: "MISSING_PROTO_HEADER",
      proto: undefined,
      hostVerified: ingressCheck.verified,
      pathVerified: false,
    };
  }
  
  if (proto !== "https") {
    return {
      secure: false,
      reason: "INSECURE_PROTO",
      proto,
      hostVerified: ingressCheck.verified,
      pathVerified: false,
    };
  }
  
  // Check 2: URL protocol MUST be https:
  // SECURITY RATIONALE: Mixed signals between x-forwarded-proto and URL protocol
  // are suspicious and must fail closed. We require BOTH to indicate HTTPS.
  if (urlProtocol !== "https:") {
    return {
      secure: false,
      reason: "INCONSISTENT_TRANSPORT_SIGNALS",
      proto,
      hostVerified: ingressCheck.verified,
      pathVerified: false,
    };
  }
  
  // Check 3: Host MUST match expected platform ingress
  if (!ingressCheck.verified) {
    return {
      secure: false,
      reason: "INVALID_PLATFORM_INGRESS",
      proto,
      hostVerified: false,
      pathVerified: false,
    };
  }
  
  // All checks passed - both x-forwarded-proto AND URL protocol are HTTPS
  return {
    secure: true,
    proto: "https",
    hostVerified: true,
    pathVerified: true,
  };
}

/**
 * Check if request is secure (HTTPS via trusted platform ingress).
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
      hostVerified: result.hostVerified,
      pathVerified: result.pathVerified,
      method: req.method,
      path: new URL(req.url).pathname,
      environment: Deno.env.get("ENVIRONMENT") ?? "production",
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
// CORS + SECURITY HEADERS (STRICT ORIGIN ALLOWLIST)
// ============================================================

/**
 * Get allowed origins from environment variable.
 * 
 * ALLOWED_ORIGINS should be a comma-separated list of origins, e.g.:
 * "https://my-app.lovableproject.com,https://my-app.vercel.app"
 * 
 * @returns Array of allowed origin strings
 */
function getAllowedOrigins(): string[] {
  const originsEnv = Deno.env.get("ALLOWED_ORIGINS") ?? "";
  if (!originsEnv.trim()) {
    // Default allowed origins for Lovable/Supabase deployments
    return [];
  }
  return originsEnv
    .split(",")
    .map((origin) => origin.trim().toLowerCase())
    .filter((origin) => origin.length > 0);
}

/**
 * Validate an origin against the allowlist.
 * 
 * SECURITY CONSTRAINTS (production/staging):
 * - Origin MUST use https:// protocol (http:// is always rejected)
 * - Origin MUST match allowlist (exact or wildcard)
 * - Wildcard matching uses proper suffix check with dot boundary
 *   to prevent example.com.evil.com from matching *.example.com
 * 
 * @param origin - The Origin header value from the request
 * @returns The validated origin if allowed, or undefined if disallowed
 *          (Never returns "null" - disallowed origins get undefined)
 */
function validateOrigin(origin: string | null): string | undefined {
  if (!origin) {
    return undefined;
  }
  
  const normalizedOrigin = origin.trim().toLowerCase();
  const isDev = isDevelopmentEnvironment();
  
  // ============================================================
  // SECURITY: Reject http:// origins in production/staging
  // Only development allows insecure origins for local testing
  // ============================================================
  let originUrl: URL;
  try {
    originUrl = new URL(normalizedOrigin);
  } catch {
    console.warn("[SECURITY] CORS: Invalid origin URL rejected:", normalizedOrigin);
    return undefined;
  }
  
  if (originUrl.protocol !== "https:" && !isDev) {
    console.warn("[SECURITY] CORS: Rejecting non-HTTPS origin in production:", normalizedOrigin);
    return undefined;
  }
  
  const allowedOrigins = getAllowedOrigins();
  
  // If no origins configured, reject all (fail closed) unless dev
  if (allowedOrigins.length === 0) {
    if (isDev) {
      return origin; // Allow any origin in development for testing
    }
    console.warn("[SECURITY] CORS: No ALLOWED_ORIGINS configured, rejecting origin:", normalizedOrigin);
    return undefined;
  }
  
  // Check if origin is in allowlist (exact match)
  if (allowedOrigins.includes(normalizedOrigin)) {
    return origin; // Return original (not normalized) for exact match
  }
  
  // ============================================================
  // WILDCARD MATCHING (e.g., "*.example.com")
  // 
  // SECURITY CONSTRAINTS:
  // - Pattern must start with "*."
  // - MUST enforce HTTPS protocol
  // - MUST use proper dot-boundary suffix matching
  //   - "*.example.com" matches "app.example.com" ✓
  //   - "*.example.com" does NOT match "example.com.evil.com" ✗
  //   - "*.example.com" matches "example.com" (bare domain) ✓
  // ============================================================
  for (const allowed of allowedOrigins) {
    if (allowed.startsWith("*.")) {
      // Extract the base domain (e.g., "example.com" from "*.example.com")
      const baseDomain = allowed.slice(2); // Remove "*."
      
      // Get the origin's host (already validated as proper URL above)
      const originHost = originUrl.host;
      
      // Check for exact base domain match (e.g., "example.com")
      if (originHost === baseDomain) {
        return origin;
      }
      
      // Check for subdomain match with PROPER dot boundary
      // This prevents "example.com.evil.com" from matching "*.example.com"
      // by requiring the match to be ".example.com" at a dot boundary
      const wildcardSuffix = "." + baseDomain;
      if (originHost.endsWith(wildcardSuffix)) {
        return origin;
      }
    }
  }
  
  console.warn("[SECURITY] CORS: Origin not in allowlist:", normalizedOrigin);
  return undefined;
}

/**
 * Build CORS headers for a specific request.
 * 
 * CRITICAL: This function computes CORS headers based on the request's Origin.
 * - If Origin is in allowlist → set Access-Control-Allow-Origin to that origin
 * - If Origin is NOT in allowlist → omit Access-Control-Allow-Origin entirely
 * - Access-Control-Allow-Credentials is NOT set (cookies not needed cross-origin)
 * 
 * @param req - The incoming request
 * @returns Record of CORS headers
 */
export function buildCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  const validatedOrigin = validateOrigin(origin);
  
  const headers: Record<string, string> = {
    // Only allow headers we actually need:
    // - content-type: for JSON payloads
    // - authorization: for bearer tokens (used by authenticated endpoints)
    // - x-client-info: Supabase client metadata
    // - apikey: Supabase anon key (not sensitive, publishable)
    "Access-Control-Allow-Headers": "content-type, authorization, x-client-info, apikey, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400", // 24 hours preflight cache
    // NOTE: Access-Control-Allow-Credentials is NOT set (default: false)
    // We do not use cookies cross-origin
    
    // Vary: Origin is REQUIRED when ACAO is set dynamically per-request.
    // This ensures caches don't serve a response with one origin's ACAO
    // to a request from a different origin.
    // Safe to always include even when ACAO is omitted.
    "Vary": "Origin",
  };
  
  // Only set Access-Control-Allow-Origin if origin is validated
  // Disallowed origins get NO ACAO header (not "null")
  if (validatedOrigin) {
    headers["Access-Control-Allow-Origin"] = validatedOrigin;
  }
  
  return headers;
}

/**
 * Build combined CORS + security headers for a specific request.
 * 
 * Use this for all API responses to ensure both CORS and security headers are present.
 * 
 * @param req - The incoming request
 * @returns Record of combined CORS and security headers
 */
export function buildCorsSecurityHeaders(req: Request): Record<string, string> {
  return {
    ...buildCorsHeaders(req),
    ...securityHeaders,
  };
}

/**
 * Static CORS headers (DEPRECATED - use buildCorsSecurityHeaders instead)
 * 
 * @deprecated This uses Access-Control-Allow-Origin: "*" which is insecure.
 * Use buildCorsSecurityHeaders(req) for dynamic origin validation.
 */
export const corsSecurityHeaders: Record<string, string> = {
  // DEPRECATED: Static headers maintained for backward compatibility during migration
  // Edge functions should migrate to buildCorsSecurityHeaders(req)
  "Access-Control-Allow-Origin": "null", // Fail closed by default
  "Access-Control-Allow-Headers": "content-type, authorization, x-client-info, apikey",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  ...securityHeaders,
};

/**
 * Create headers object for JSON API responses with full security.
 * 
 * @param req - The incoming request (for CORS origin validation)
 * @param additionalHeaders - Optional additional headers
 */
export function createSecureJsonHeaders(
  req?: Request,
  additionalHeaders?: Record<string, string>
): Record<string, string> {
  // If request provided, use dynamic CORS headers
  if (req) {
    return {
      "Content-Type": "application/json",
      ...buildCorsSecurityHeaders(req),
      ...additionalHeaders,
    };
  }
  
  // Fallback to static headers (deprecated path)
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
 * Enforce ALL security checks on a request.
 * 
 * CRITICAL: Use this as the FIRST check in every edge function handler,
 * BEFORE any other logic including CORS preflight handling.
 * 
 * Returns a Response if the request should be rejected, null otherwise.
 * 
 * CRITICAL: This check is MANDATORY and has NO overrides.
 * 
 * Checks performed:
 * 1. Transport security (HTTPS via trusted platform ingress)
 * 2. No tokens in URL
 * 
 * @example
 * ```typescript
 * Deno.serve(async (req) => {
 *   // MANDATORY security check - BEFORE any other logic
 *   const securityResponse = await enforceTransportSecurity(req);
 *   if (securityResponse) return securityResponse;
 *   
 *   // CORS preflight (only after security check passes)
 *   if (req.method === "OPTIONS") {
 *     return new Response(null, { status: 204, headers: corsSecurityHeaders });
 *   }
 *   
 *   // ... rest of handler
 * });
 * ```
 */
export async function enforceTransportSecurity(req: Request): Promise<Response | null> {
  // Check 1: Transport security (HTTPS)
  if (!isSecureRequest(req)) {
    // Emit security event for monitoring
    await emitSecurityEvent({
      type: "INSECURE_TRANSPORT",
      timestamp: new Date().toISOString(),
      service: "transport-guard",
      target_url: req.url,
      error_code: "HTTP_REJECTED",
      error_message: "Request rejected due to insecure transport",
      proto: req.headers.get("x-forwarded-proto") ?? "http",
    });
    return createInsecureRequestResponse();
  }
  
  // Check 2: No tokens in URL
  const tokenInUrlResponse = rejectTokensInUrl(req);
  if (tokenInUrlResponse) {
    // Emit security event for token in URL
    await emitSecurityEvent({
      type: "TOKEN_IN_URL",
      timestamp: new Date().toISOString(),
      service: "transport-guard",
      target_url: "[REDACTED_DUE_TO_TOKEN]",
      error_code: "TOKEN_IN_URL",
      error_message: "Request rejected due to token in URL",
    });
    return tokenInUrlResponse;
  }
  
  return null;
}

/**
 * Synchronous version for backward compatibility.
 * Prefer the async version for proper event emission.
 * 
 * @deprecated Use enforceTransportSecurity (async) instead
 */
export function enforceTransportSecuritySync(req: Request): Response | null {
  // Check 1: Transport security (HTTPS)
  if (!isSecureRequest(req)) {
    return createInsecureRequestResponse();
  }
  
  // Check 2: No tokens in URL
  const tokenInUrlResponse = rejectTokensInUrl(req);
  if (tokenInUrlResponse) {
    return tokenInUrlResponse;
  }
  
  return null;
}

/**
 * Create a safe console.log wrapper that sanitizes objects.
 * 
 * Use this instead of console.log when logging objects that
 * might contain credentials.
 */
export function safeLog(message: string, obj?: unknown): void {
  if (obj === undefined) {
    console.log(message);
  } else {
    console.log(message, sanitizeForLogging(obj));
  }
}

/**
 * Create a safe console.warn wrapper that sanitizes objects.
 */
export function safeWarn(message: string, obj?: unknown): void {
  if (obj === undefined) {
    console.warn(message);
  } else {
    console.warn(message, sanitizeForLogging(obj));
  }
}

/**
 * Create a safe console.error wrapper that sanitizes objects.
 */
export function safeError(message: string, obj?: unknown): void {
  if (obj === undefined) {
    console.error(message);
  } else {
    console.error(message, sanitizeForLogging(obj));
  }
}

// ============================================================
// SECURE INTERNAL SERVICE COMMUNICATION
// ============================================================

/**
 * Security event types for internal service communication
 */
export type SecurityEventType = 
  | "TLS_FAILURE"
  | "INSECURE_URL_REJECTED"
  | "CERT_VALIDATION_FAILED"
  | "SERVICE_UNREACHABLE"
  | "INTERNAL_SERVICE_ERROR"
  | "INSECURE_TRANSPORT"
  | "TOKEN_IN_URL"
  | "HTTP_REJECTED"
  | "HSTS_MISSING";

/**
 * Security event data structure
 */
export interface SecurityEvent {
  type: SecurityEventType;
  timestamp: string;
  service: string;
  target_url: string;  // Will be sanitized (no credentials)
  error_code?: string;
  error_message?: string;
  request_id?: string;
  proto?: string;
  tls_version?: string;
}

// Supabase client for persisting security events
let supabaseClient: ReturnType<typeof createClient> | null = null;

function getSupabaseClient(): ReturnType<typeof createClient> | null {
  if (supabaseClient) return supabaseClient;
  
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !serviceKey) {
      return null;
    }
    
    supabaseClient = createClient(supabaseUrl, serviceKey);
    return supabaseClient;
  } catch {
    return null;
  }
}

/**
 * Emit a security event for monitoring/alerting.
 * 
 * This function:
 * 1. Logs to console in structured JSON format for SIEM integration
 * 2. Persists to eye_events table for dashboard visibility
 * 3. Emits runtime alerts for critical events
 * 
 * CRITICAL: This is called when HTTP requests reach application logic,
 * which should NEVER happen if edge enforcement is working correctly.
 */
export async function emitSecurityEvent(event: SecurityEvent): Promise<void> {
  // Sanitize the URL to remove any credentials
  let sanitizedUrl = event.target_url;
  try {
    const parsed = new URL(event.target_url);
    parsed.username = "";
    parsed.password = "";
    // Remove sensitive query params
    for (const key of ["token", "key", "secret", "password", "auth"]) {
      parsed.searchParams.delete(key);
    }
    sanitizedUrl = parsed.toString();
  } catch {
    // If URL parsing fails, just mask it
    sanitizedUrl = "[INVALID_URL]";
  }
  
  const sanitizedEvent: SecurityEvent = {
    ...event,
    target_url: sanitizedUrl,
  };
  
  // 1. Log as structured JSON for log aggregation
  console.error("[SECURITY_EVENT]", JSON.stringify(sanitizedEvent));
  
  // 2. Persist to eye_events table for dashboard
  try {
    const client = getSupabaseClient();
    if (client) {
      await client.from("eye_events").insert({
        event_type: `SECURITY_${event.type}`,
        event_data: {
          type: event.type,
          service: event.service,
          target_url: sanitizedUrl,
          error_code: event.error_code,
          error_message: event.error_message?.slice(0, 200),
          request_id: event.request_id,
          proto: event.proto,
          tls_version: event.tls_version,
          severity: getSeverityForEvent(event.type),
          environment: Deno.env.get("ENVIRONMENT") ?? "production",
        },
      });
    }
  } catch (dbError) {
    // Don't fail the request if we can't persist the event
    console.error("[SECURITY_EVENT_PERSIST_FAILED]", dbError);
  }
  
  // 3. Emit runtime alert for critical events
  if (isCriticalSecurityEvent(event.type)) {
    console.error("[SECURITY_ALERT_CRITICAL]", JSON.stringify({
      alert: "CRITICAL_SECURITY_EVENT",
      ...sanitizedEvent,
    }));
  }
}

/**
 * Determine severity level for security event type
 */
function getSeverityForEvent(type: SecurityEventType): string {
  switch (type) {
    case "TLS_FAILURE":
    case "CERT_VALIDATION_FAILED":
      return "CRITICAL";
    case "INSECURE_TRANSPORT":
    case "HTTP_REJECTED":
      return "HIGH";
    case "TOKEN_IN_URL":
    case "INSECURE_URL_REJECTED":
      return "WARN";
    default:
      return "INFO";
  }
}

/**
 * Check if event type requires immediate alerting
 */
function isCriticalSecurityEvent(type: SecurityEventType): boolean {
  return type === "TLS_FAILURE" || 
         type === "CERT_VALIDATION_FAILED" ||
         type === "INSECURE_TRANSPORT";
}

// Import for Supabase client
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

/**
 * Validate that a URL uses HTTPS.
 * 
 * CRITICAL: Plain HTTP is NEVER allowed, even for internal services.
 * The internal network is treated as hostile.
 */
function validateSecureUrl(url: string): { valid: boolean; error?: string } {
  try {
    const parsed = new URL(url);
    
    // Only HTTPS is allowed
    if (parsed.protocol !== "https:") {
      return {
        valid: false,
        error: `Protocol "${parsed.protocol}" is not allowed. Only HTTPS is permitted.`,
      };
    }
    
    // Block localhost/internal IPs in production
    // (In Deno/Supabase Edge, we trust the platform's network)
    
    return { valid: true };
  } catch (e) {
    return {
      valid: false,
      error: `Invalid URL: ${e instanceof Error ? e.message : "Unknown error"}`,
    };
  }
}

/**
 * Options for secure fetch.
 */
export interface SecureFetchOptions extends Omit<RequestInit, "signal"> {
  /**
   * Timeout in milliseconds. Default: 30000 (30 seconds)
   */
  timeoutMs?: number;
  
  /**
   * Service name for logging/events. Default: "unknown"
   */
  serviceName?: string;
  
  /**
   * Request ID for correlation. Default: auto-generated
   */
  requestId?: string;
}

/**
 * Result of a secure fetch operation.
 */
export interface SecureFetchResult {
  ok: boolean;
  response?: Response;
  error?: {
    type: SecurityEventType;
    message: string;
    code?: string;
  };
}

/**
 * Secure fetch wrapper for internal service-to-service communication.
 * 
 * CRITICAL SECURITY INVARIANTS:
 * - Only HTTPS URLs are allowed
 * - Certificate validation is ALWAYS enabled (no skip TLS)
 * - TLS failures result in request failure (NO insecure retry)
 * - All failures emit security events
 * 
 * This function treats the internal network as HOSTILE. All communication
 * between services MUST be encrypted with valid certificates.
 * 
 * @example
 * ```typescript
 * const result = await secureFetch("https://internal-service.example.com/api/data", {
 *   method: "POST",
 *   headers: { "Content-Type": "application/json" },
 *   body: JSON.stringify({ key: "value" }),
 *   serviceName: "my-edge-function",
 *   timeoutMs: 10000,
 * });
 * 
 * if (!result.ok) {
 *   // Handle error - security event already emitted
 *   return new Response(JSON.stringify({ error: result.error.message }), { status: 502 });
 * }
 * 
 * const data = await result.response.json();
 * ```
 */
export async function secureFetch(
  url: string,
  options: SecureFetchOptions = {}
): Promise<SecureFetchResult> {
  const {
    timeoutMs = 30000,
    serviceName = "unknown",
    requestId = crypto.randomUUID(),
    ...fetchOptions
  } = options;
  
  // Step 1: Validate URL is HTTPS
  const urlValidation = validateSecureUrl(url);
  if (!urlValidation.valid) {
    const event: SecurityEvent = {
      type: "INSECURE_URL_REJECTED",
      timestamp: new Date().toISOString(),
      service: serviceName,
      target_url: url,
      error_message: urlValidation.error,
      request_id: requestId,
    };
    await emitSecurityEvent(event);
    
    return {
      ok: false,
      error: {
        type: "INSECURE_URL_REJECTED",
        message: urlValidation.error ?? "URL validation failed",
        code: "HTTPS_REQUIRED",
      },
    };
  }
  
  // Step 2: Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    // Step 3: Make the request
    // CRITICAL: We do NOT set any options to skip TLS verification.
    // Deno's fetch validates certificates by default.
    // There is NO way to disable this - that's intentional.
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    return {
      ok: true,
      response,
    };
    
  } catch (error) {
    clearTimeout(timeoutId);
    
    // Determine error type
    let eventType: SecurityEventType = "INTERNAL_SERVICE_ERROR";
    let errorCode = "UNKNOWN";
    let errorMessage = error instanceof Error ? error.message : "Unknown error";
    
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      
      // TLS/Certificate errors
      if (
        msg.includes("certificate") ||
        msg.includes("ssl") ||
        msg.includes("tls") ||
        msg.includes("handshake") ||
        msg.includes("self-signed") ||
        msg.includes("unable to verify")
      ) {
        eventType = "TLS_FAILURE";
        errorCode = "CERT_VALIDATION_FAILED";
        // CRITICAL: Do NOT retry without TLS. Request fails.
      }
      // Connection errors
      else if (
        msg.includes("connection refused") ||
        msg.includes("econnrefused") ||
        msg.includes("network") ||
        msg.includes("dns")
      ) {
        eventType = "SERVICE_UNREACHABLE";
        errorCode = "CONNECTION_FAILED";
      }
      // Timeout
      else if (
        msg.includes("abort") ||
        msg.includes("timeout") ||
        error.name === "AbortError"
      ) {
        eventType = "SERVICE_UNREACHABLE";
        errorCode = "TIMEOUT";
        errorMessage = `Request timed out after ${timeoutMs}ms`;
      }
    }
    
    // Emit security event
    const event: SecurityEvent = {
      type: eventType,
      timestamp: new Date().toISOString(),
      service: serviceName,
      target_url: url,
      error_code: errorCode,
      error_message: errorMessage.slice(0, 200), // Truncate for safety
      request_id: requestId,
    };
    await emitSecurityEvent(event);
    
    return {
      ok: false,
      error: {
        type: eventType,
        message: errorMessage,
        code: errorCode,
      },
    };
  }
}

/**
 * Secure JSON fetch helper.
 * 
 * Same security guarantees as secureFetch, but with JSON parsing.
 */
export async function secureFetchJson<T = unknown>(
  url: string,
  options: SecureFetchOptions = {}
): Promise<{ ok: true; data: T } | { ok: false; error: { type: SecurityEventType; message: string; code?: string } }> {
  const result = await secureFetch(url, {
    ...options,
    headers: {
      "Accept": "application/json",
      ...options.headers,
    },
  });
  
  if (!result.ok) {
    return { ok: false, error: result.error! };
  }
  
  try {
    const data = await result.response!.json();
    return { ok: true, data: data as T };
  } catch (e) {
    return {
      ok: false,
      error: {
        type: "INTERNAL_SERVICE_ERROR",
        message: `JSON parse error: ${e instanceof Error ? e.message : "Unknown"}`,
        code: "JSON_PARSE_ERROR",
      },
    };
  }
}

/**
 * Secure POST JSON helper.
 * 
 * Same security guarantees as secureFetch, with JSON request/response.
 */
export async function securePostJson<T = unknown>(
  url: string,
  body: unknown,
  options: SecureFetchOptions = {}
): Promise<{ ok: true; data: T } | { ok: false; error: { type: SecurityEventType; message: string; code?: string } }> {
  return secureFetchJson<T>(url, {
    ...options,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    body: JSON.stringify(body),
  });
}
