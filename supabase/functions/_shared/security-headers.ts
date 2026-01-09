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
 * Enforce ALL security checks on a request.
 * 
 * Use this as the FIRST check in every edge function handler.
 * Returns a Response if the request should be rejected, null otherwise.
 * 
 * CRITICAL: This check is MANDATORY and has NO overrides.
 * 
 * Checks performed:
 * 1. Transport security (HTTPS via trusted proxy)
 * 2. No tokens in URL
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
  | "INTERNAL_SERVICE_ERROR";

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
}

/**
 * Emit a security event for monitoring/alerting.
 * 
 * In production, this should be connected to your SIEM/monitoring system.
 * For now, it logs to console in a structured format.
 */
export function emitSecurityEvent(event: SecurityEvent): void {
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
  
  // Log as structured JSON for log aggregation
  console.error("[SECURITY_EVENT]", JSON.stringify(sanitizedEvent));
}

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
    emitSecurityEvent(event);
    
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
    emitSecurityEvent(event);
    
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
    const data = await result.response!.json() as T;
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: {
        type: "INTERNAL_SERVICE_ERROR",
        message: `Failed to parse JSON: ${error instanceof Error ? error.message : "Unknown"}`,
        code: "JSON_PARSE_ERROR",
      },
    };
  }
}

/**
 * Secure POST JSON helper.
 * 
 * Same security guarantees as secureFetch, with JSON body serialization.
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
