/**
 * Input Validation & Sanitization Module (Edge Functions)
 * 
 * Production-grade XSS prevention with allowlist-based validation.
 * All user input is treated as plain text by default - NO HTML is ever accepted.
 * 
 * SECURITY PRINCIPLES:
 * - Allowlist-based validation (reject by default)
 * - Deterministic, pure functions
 * - Mirrors frontend validation for defense-in-depth
 * - Server-side validation is the AUTHORITATIVE check
 * 
 * CRITICAL: Never trust client-side validation. Always validate server-side.
 */

// =============================================================================
// ERROR CODES
// =============================================================================

export type ValidationErrorCode =
  | "INVALID_INPUT"
  | "TOO_LONG"
  | "TOO_SHORT"
  | "DISALLOWED_CHARS"
  | "POSSIBLE_XSS"
  | "INVALID_EMAIL"
  | "INVALID_UUID"
  | "INVALID_ENUM"
  | "REQUIRED";

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errorCode: ValidationErrorCode; field: string };

// =============================================================================
// XSS DETECTION PATTERNS (ALLOWLIST INVERSE - THESE ARE BLOCKED)
// =============================================================================

/**
 * Patterns that indicate XSS injection attempts.
 * Case-insensitive matching applied.
 */
const XSS_PATTERNS: readonly RegExp[] = [
  // Script-related
  /<script/i,
  /<\/script/i,
  /javascript:/i,
  /vbscript:/i,
  /livescript:/i,
  
  // Data URIs that can execute code
  /data:text\/html/i,
  /data:application\/javascript/i,
  /data:application\/x-javascript/i,
  /data:application\/ecmascript/i,
  
  // SVG with potential script execution
  /<svg/i,
  /<\/svg/i,
  
  // Event handlers (comprehensive list)
  /\bon\w+\s*=/i, // Matches onload=, onerror=, onclick=, etc.
  
  // HTML elements that can be exploited
  /<img/i,
  /<iframe/i,
  /<object/i,
  /<embed/i,
  /<link/i,
  /<style/i,
  /<meta/i,
  /<base/i,
  /<form/i,
  /<input/i,
  /<button/i,
  /<textarea/i,
  /<select/i,
  /<video/i,
  /<audio/i,
  /<source/i,
  /<track/i,
  /<math/i,
  /<body/i,
  /<html/i,
  /<head/i,
  /<title/i,
  /<table/i,
  /<div/i,
  /<span/i,
  /<a\s/i,
  /<a>/i,
  
  // Expression-based attacks
  /expression\s*\(/i,
  /url\s*\(/i,
  /-moz-binding/i,
  
  // Encoded variants
  /&#/i, // HTML entities
  /%3c/i, // URL-encoded <
  /%3e/i, // URL-encoded >
  /\\u003c/i, // Unicode escaped <
  /\\u003e/i, // Unicode escaped >
  /\\x3c/i, // Hex escaped <
  /\\x3e/i, // Hex escaped >
  
  // Template injection
  /\$\{/i, // Template literals
  /\{\{/i, // Mustache/Handlebars
  /\}\}/i,
] as const;

/**
 * Characters that are NEVER allowed in plain text input.
 * These are structural HTML characters.
 */
const DISALLOWED_CHARS_PATTERN = /[<>]/;

/**
 * Control characters and null bytes (except common whitespace)
 */
const CONTROL_CHARS_PATTERN = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/**
 * Multiple consecutive whitespace characters
 */
const MULTIPLE_WHITESPACE_PATTERN = /\s{2,}/g;

// =============================================================================
// SANITIZATION
// =============================================================================

export interface SanitizeOptions {
  /** Preserve newlines (useful for multiline text areas) */
  preserveNewlines?: boolean;
}

/**
 * Sanitizes plain text input for safe storage and display.
 * 
 * Operations performed:
 * 1. Unicode NFKC normalization (prevents homograph attacks)
 * 2. Trim leading/trailing whitespace
 * 3. Remove null bytes and control characters
 * 4. Collapse repeated whitespace to single space
 * 
 * NOTE: This does NOT validate - always validate after sanitizing.
 */
export function sanitizePlainText(value: string, options: SanitizeOptions = {}): string {
  if (typeof value !== "string") {
    return "";
  }
  
  // 1. Unicode NFKC normalization
  // This normalizes different unicode representations to a canonical form
  // Prevents homograph attacks (е vs e, etc.)
  let sanitized = value.normalize("NFKC");
  
  // 2. Remove null bytes and control characters
  sanitized = sanitized.replace(CONTROL_CHARS_PATTERN, "");
  
  // 3. Collapse whitespace
  if (options.preserveNewlines) {
    // Preserve single newlines, collapse multiple to double
    sanitized = sanitized
      .split(/\n/)
      .map(line => line.replace(MULTIPLE_WHITESPACE_PATTERN, " "))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n");
  } else {
    sanitized = sanitized.replace(MULTIPLE_WHITESPACE_PATTERN, " ");
  }
  
  // 4. Trim
  sanitized = sanitized.trim();
  
  return sanitized;
}

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

export interface PlainTextOptions {
  /** Maximum allowed length (REQUIRED) */
  maxLength: number;
  /** Minimum allowed length (default: 0) */
  minLength?: number;
  /** Allow empty string (default: false) */
  allowEmpty?: boolean;
  /** Preserve newlines during sanitization (default: false) */
  preserveNewlines?: boolean;
  /** Custom allowlist pattern - value must match this regex */
  allowlistPattern?: RegExp;
}

/**
 * Validates plain text input.
 * 
 * Security checks performed:
 * 1. Type check
 * 2. Sanitization (unicode normalization, trim, etc.)
 * 3. Length validation
 * 4. Disallowed characters (< >)
 * 5. XSS pattern detection
 * 6. Optional allowlist pattern matching
 */
export function validatePlainText(
  fieldName: string,
  value: unknown,
  options: PlainTextOptions
): ValidationResult<string> {
  // Type check
  if (typeof value !== "string") {
    return { ok: false, errorCode: "INVALID_INPUT", field: fieldName };
  }
  
  // Sanitize first
  const sanitized = sanitizePlainText(value, {
    preserveNewlines: options.preserveNewlines,
  });
  
  // Check if empty
  if (sanitized.length === 0) {
    if (options.allowEmpty) {
      return { ok: true, value: sanitized };
    }
    return { ok: false, errorCode: "REQUIRED", field: fieldName };
  }
  
  // Length validation
  const minLength = options.minLength ?? 0;
  if (sanitized.length < minLength) {
    return { ok: false, errorCode: "TOO_SHORT", field: fieldName };
  }
  if (sanitized.length > options.maxLength) {
    return { ok: false, errorCode: "TOO_LONG", field: fieldName };
  }
  
  // Check for disallowed characters (< >)
  if (DISALLOWED_CHARS_PATTERN.test(sanitized)) {
    return { ok: false, errorCode: "DISALLOWED_CHARS", field: fieldName };
  }
  
  // XSS pattern detection
  for (const pattern of XSS_PATTERNS) {
    if (pattern.test(sanitized)) {
      return { ok: false, errorCode: "POSSIBLE_XSS", field: fieldName };
    }
  }
  
  // Custom allowlist pattern
  if (options.allowlistPattern && !options.allowlistPattern.test(sanitized)) {
    return { ok: false, errorCode: "INVALID_INPUT", field: fieldName };
  }
  
  return { ok: true, value: sanitized };
}

/**
 * Email validation with strict RFC 5322 subset.
 * Rejects emails with potentially dangerous characters.
 */
export function validateEmail(
  fieldName: string,
  value: unknown
): ValidationResult<string> {
  if (typeof value !== "string") {
    return { ok: false, errorCode: "INVALID_INPUT", field: fieldName };
  }
  
  const sanitized = sanitizePlainText(value);
  
  if (sanitized.length === 0) {
    return { ok: false, errorCode: "REQUIRED", field: fieldName };
  }
  
  // Max email length per RFC 5321
  if (sanitized.length > 254) {
    return { ok: false, errorCode: "TOO_LONG", field: fieldName };
  }
  
  // Strict email pattern - allowlist approach
  // Only allows: alphanumeric, dots, hyphens, underscores, plus in local part
  // Domain must be alphanumeric with dots and hyphens
  const EMAIL_PATTERN = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  
  if (!EMAIL_PATTERN.test(sanitized)) {
    return { ok: false, errorCode: "INVALID_EMAIL", field: fieldName };
  }
  
  // Additional XSS check on email (belt and suspenders)
  if (DISALLOWED_CHARS_PATTERN.test(sanitized)) {
    return { ok: false, errorCode: "DISALLOWED_CHARS", field: fieldName };
  }
  
  return { ok: true, value: sanitized.toLowerCase() };
}

/**
 * UUID v4 validation with strict pattern matching.
 */
export function validateUuid(
  fieldName: string,
  value: unknown
): ValidationResult<string> {
  if (typeof value !== "string") {
    return { ok: false, errorCode: "INVALID_INPUT", field: fieldName };
  }
  
  const sanitized = sanitizePlainText(value);
  
  if (sanitized.length === 0) {
    return { ok: false, errorCode: "REQUIRED", field: fieldName };
  }
  
  // Strict UUID v4 pattern
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  
  if (!UUID_PATTERN.test(sanitized)) {
    return { ok: false, errorCode: "INVALID_UUID", field: fieldName };
  }
  
  return { ok: true, value: sanitized.toLowerCase() };
}

/**
 * Enum validation - value must exactly match one of the allowed values.
 */
export function validateEnum<T extends string>(
  fieldName: string,
  value: unknown,
  allowedValues: readonly T[]
): ValidationResult<T> {
  if (typeof value !== "string") {
    return { ok: false, errorCode: "INVALID_INPUT", field: fieldName };
  }
  
  const sanitized = sanitizePlainText(value);
  
  if (!allowedValues.includes(sanitized as T)) {
    return { ok: false, errorCode: "INVALID_ENUM", field: fieldName };
  }
  
  return { ok: true, value: sanitized as T };
}

/**
 * Wraps any validator to make the field optional.
 * Returns ok: true with undefined if value is null, undefined, or empty string.
 */
export function validateOptional<T>(
  validator: (fieldName: string, value: unknown) => ValidationResult<T>,
  fieldName: string,
  value: unknown
): ValidationResult<T | undefined> {
  // Treat null, undefined, and empty string as "not provided"
  if (value === null || value === undefined || value === "") {
    return { ok: true, value: undefined };
  }
  
  return validator(fieldName, value);
}

// =============================================================================
// BATCH VALIDATION HELPER
// =============================================================================

export interface ValidationErrors {
  [field: string]: ValidationErrorCode;
}

/**
 * Collects validation errors from multiple validation results.
 * Returns null if all validations passed, or an object mapping field names to error codes.
 */
export function collectErrors(
  ...results: ValidationResult<unknown>[]
): ValidationErrors | null {
  const errors: ValidationErrors = {};
  
  for (const result of results) {
    if (!result.ok) {
      errors[result.field] = result.errorCode;
    }
  }
  
  return Object.keys(errors).length > 0 ? errors : null;
}

// =============================================================================
// HTTP RESPONSE HELPERS (Edge Function Specific)
// =============================================================================

/**
 * Creates a 400 Bad Request response for validation errors.
 * Use this in edge functions when validation fails.
 */
export function validationErrorResponse(
  errors: ValidationErrors,
  corsHeaders: Record<string, string> = {}
): Response {
  return new Response(
    JSON.stringify({
      error: "Validation failed",
      code: "VALIDATION_ERROR",
      details: errors,
    }),
    {
      status: 400,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    }
  );
}

/**
 * Validates request body JSON and returns parsed result or error response.
 * Returns [null, errorResponse] if validation fails, [data, null] if successful.
 */
export async function validateRequestBody<T>(
  req: Request,
  validator: (body: unknown) => ValidationErrors | null,
  corsHeaders: Record<string, string> = {}
): Promise<[T | null, Response | null]> {
  let body: unknown;
  
  try {
    body = await req.json();
  } catch {
    return [
      null,
      new Response(
        JSON.stringify({
          error: "Invalid JSON body",
          code: "INVALID_JSON",
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        }
      ),
    ];
  }
  
  const errors = validator(body);
  if (errors) {
    return [null, validationErrorResponse(errors, corsHeaders)];
  }
  
  return [body as T, null];
}

// =============================================================================
// CONVENIENCE: FIELD CONFIGS FOR COMMON USE CASES
// =============================================================================

/**
 * Pre-defined configurations for common field types.
 * Extend or override as needed for your application.
 */
export const FIELD_CONFIGS = {
  /** Short text like names, titles (1-100 chars) */
  shortText: { maxLength: 100, minLength: 1 } as const,
  
  /** Medium text like descriptions (1-500 chars) */
  mediumText: { maxLength: 500, minLength: 1 } as const,
  
  /** Long text like notes, comments (1-2000 chars) */
  longText: { maxLength: 2000, minLength: 1, preserveNewlines: true } as const,
  
  /** Very long text like articles (1-10000 chars) */
  extendedText: { maxLength: 10000, minLength: 1, preserveNewlines: true } as const,
  
  /** Case/session identifiers */
  identifier: { maxLength: 50, minLength: 1 } as const,
  
  /** Labels and tags */
  label: { maxLength: 100, minLength: 1 } as const,
} as const;
