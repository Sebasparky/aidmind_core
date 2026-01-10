/**
 * XSS Prevention Tests - Input Validation Module
 * 
 * These tests verify that XSS payloads are properly rejected
 * and never rendered as HTML.
 * 
 * NO REAL SECRETS REQUIRED - all tests use mock data.
 */

import { describe, it, expect } from "vitest";
import {
  validatePlainText,
  validateEmail,
  validateUuid,
  validateEnum,
  validateOptional,
  sanitizePlainText,
  collectErrors,
  FIELD_CONFIGS,
  type ValidationResult,
} from "../inputValidation";

// =============================================================================
// XSS PAYLOAD TEST CASES
// =============================================================================

const XSS_PAYLOADS = {
  // Script injection
  scriptBasic: '<script>alert(1)</script>',
  scriptUppercase: '<SCRIPT>alert(1)</SCRIPT>',
  scriptMixed: '<ScRiPt>alert(1)</ScRiPt>',
  scriptNewlines: '<script\n>alert(1)</script\n>',
  scriptSrc: '<script src="evil.js"></script>',
  
  // Event handlers
  imgOnerror: '<img src=x onerror=alert(1)>',
  imgOnload: '<img src="valid.jpg" onload="alert(1)">',
  svgOnload: '<svg onload=alert(1)>',
  divOnclick: '<div onclick="alert(1)">click me</div>',
  inputOnfocus: '<input onfocus="alert(1)" autofocus>',
  bodyOnload: '<body onload="alert(1)">',
  
  // JavaScript URLs
  jsUrl: 'javascript:alert(1)',
  jsUrlEncoded: 'javascript:alert(document.cookie)',
  vbscript: 'vbscript:msgbox(1)',
  livescript: 'livescript:alert(1)',
  
  // Data URIs
  dataHtml: 'data:text/html,<script>alert(1)</script>',
  dataJs: 'data:application/javascript,alert(1)',
  dataBase64: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  
  // SVG attacks
  svgScript: '<svg><script>alert(1)</script></svg>',
  svgAnimate: '<svg><animate onbegin="alert(1)"></animate></svg>',
  svgForeignObject: '<svg><foreignObject><body onload="alert(1)"></body></foreignObject></svg>',
  
  // HTML injection
  iframe: '<iframe src="javascript:alert(1)"></iframe>',
  object: '<object data="javascript:alert(1)"></object>',
  embed: '<embed src="javascript:alert(1)">',
  link: '<link rel="stylesheet" href="javascript:alert(1)">',
  style: '<style>@import "javascript:alert(1)"</style>',
  meta: '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
  base: '<base href="javascript:alert(1)">',
  form: '<form action="javascript:alert(1)"><input type="submit"></form>',
  
  // Encoded variants
  htmlEntities: '&#60;script&#62;alert(1)&#60;/script&#62;',
  urlEncoded: '%3Cscript%3Ealert(1)%3C/script%3E',
  unicodeEscaped: '\\u003cscript\\u003ealert(1)\\u003c/script\\u003e',
  hexEscaped: '\\x3cscript\\x3ealert(1)\\x3c/script\\x3e',
  
  // Template injection
  templateLiteral: '${alert(1)}',
  mustache: '{{constructor.constructor("alert(1)")()}}',
  angularExpression: '{{$on.constructor("alert(1)")()}}',
  
  // CSS-based attacks
  cssExpression: 'expression(alert(1))',
  mozBinding: '-moz-binding:url("evil.xml")',
  cssUrl: 'background:url("javascript:alert(1)")',
  
  // Mixed case and obfuscation
  mixedCase: '<ScRiPt SrC="evil.js"></sCrIpT>',
  withSpaces: '<script    >alert(1)</   script>',
  nullBytes: '<scr\0ipt>alert(1)</scr\0ipt>',
} as const;

// Safe inputs that should PASS validation
const SAFE_INPUTS = {
  plainText: 'Hello, World!',
  numbers: '12345',
  sentence: 'This is a normal sentence.',
  withPunctuation: "Hello! How are you? I'm fine, thanks.",
  withNewlines: 'Line 1\nLine 2\nLine 3',
  unicode: 'Café résumé naïve',
  emoji: 'Hello 👋 World 🌍',
  email: 'user@example.com',
  path: '/users/profile/settings',
  query: 'search query with multiple words',
} as const;

// =============================================================================
// validatePlainText TESTS
// =============================================================================

describe("validatePlainText", () => {
  describe("XSS payload rejection", () => {
    const options = { maxLength: 1000 };
    
    it.each(Object.entries(XSS_PAYLOADS))(
      "should reject XSS payload: %s",
      (name, payload) => {
        const result = validatePlainText("testField", payload, options);
        
        expect(result.ok).toBe(false);
        if (result.ok === false) {
          // Should be either DISALLOWED_CHARS (for < >) or POSSIBLE_XSS
          expect(["DISALLOWED_CHARS", "POSSIBLE_XSS"]).toContain(result.errorCode);
          expect(result.field).toBe("testField");
        }
      }
    );
    
    it("should reject script tags with proper error code", () => {
      const result = validatePlainText("content", "<script>alert(1)</script>", options);
      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.errorCode).toBe("DISALLOWED_CHARS");
      }
    });
    
    it("should reject img onerror with proper error code", () => {
      const result = validatePlainText("content", "<img src=x onerror=alert(1)>", options);
      expect(result.ok).toBe(false);
    });
    
    it("should reject javascript: URLs", () => {
      const result = validatePlainText("url", "javascript:alert(1)", options);
      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.errorCode).toBe("POSSIBLE_XSS");
      }
    });
    
    it("should reject data: URIs with HTML", () => {
      const result = validatePlainText("content", "data:text/html,<script>alert(1)</script>", options);
      expect(result.ok).toBe(false);
    });
    
    it("should reject event handlers", () => {
      const result = validatePlainText("content", 'onmouseover="alert(1)"', options);
      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.errorCode).toBe("POSSIBLE_XSS");
      }
    });
    
    it("should reject HTML entities that encode XSS", () => {
      const result = validatePlainText("content", "&#60;script&#62;alert(1)", options);
      expect(result.ok).toBe(false);
    });
    
    it("should reject URL-encoded XSS", () => {
      const result = validatePlainText("content", "%3Cscript%3Ealert(1)", options);
      expect(result.ok).toBe(false);
    });
  });
  
  describe("safe input acceptance", () => {
    const options = { maxLength: 1000, preserveNewlines: true };
    
    it.each(Object.entries(SAFE_INPUTS))(
      "should accept safe input: %s",
      (name, input) => {
        const result = validatePlainText("testField", input, options);
        
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(typeof result.value).toBe("string");
        }
      }
    );
    
    it("should accept normal text", () => {
      const result = validatePlainText("title", "My Note Title", { maxLength: 120 });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe("My Note Title");
      }
    });
    
    it("should accept text with special but safe characters", () => {
      const result = validatePlainText("content", "Hello! How are you? (Fine)", { maxLength: 100 });
      expect(result.ok).toBe(true);
    });
  });
  
  describe("length validation", () => {
    it("should reject content exceeding maxLength", () => {
      const result = validatePlainText("title", "a".repeat(121), { maxLength: 120 });
      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.errorCode).toBe("TOO_LONG");
      }
    });
    
    it("should accept content at exactly maxLength", () => {
      const result = validatePlainText("title", "a".repeat(120), { maxLength: 120 });
      expect(result.ok).toBe(true);
    });
    
    it("should reject content below minLength", () => {
      const result = validatePlainText("title", "ab", { maxLength: 100, minLength: 3 });
      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.errorCode).toBe("TOO_SHORT");
      }
    });
    
    it("should reject empty content when allowEmpty is false", () => {
      const result = validatePlainText("title", "", { maxLength: 100 });
      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.errorCode).toBe("REQUIRED");
      }
    });
    
    it("should accept empty content when allowEmpty is true", () => {
      const result = validatePlainText("title", "", { maxLength: 100, allowEmpty: true });
      expect(result.ok).toBe(true);
    });
  });
  
  describe("type validation", () => {
    it("should reject non-string input", () => {
      const result = validatePlainText("field", 12345, { maxLength: 100 });
      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.errorCode).toBe("INVALID_INPUT");
      }
    });
    
    it("should reject null", () => {
      const result = validatePlainText("field", null, { maxLength: 100 });
      expect(result.ok).toBe(false);
    });
    
    it("should reject undefined", () => {
      const result = validatePlainText("field", undefined, { maxLength: 100 });
      expect(result.ok).toBe(false);
    });
    
    it("should reject objects", () => {
      const result = validatePlainText("field", { text: "hello" }, { maxLength: 100 });
      expect(result.ok).toBe(false);
    });
    
    it("should reject arrays", () => {
      const result = validatePlainText("field", ["hello"], { maxLength: 100 });
      expect(result.ok).toBe(false);
    });
  });
  
  describe("disallowed characters", () => {
    it("should reject < character", () => {
      const result = validatePlainText("field", "a < b", { maxLength: 100 });
      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.errorCode).toBe("DISALLOWED_CHARS");
      }
    });
    
    it("should reject > character", () => {
      const result = validatePlainText("field", "a > b", { maxLength: 100 });
      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.errorCode).toBe("DISALLOWED_CHARS");
      }
    });
    
    it("should accept similar-looking but safe characters", () => {
      // These are mathematical symbols, not angle brackets
      const result = validatePlainText("field", "a ≤ b and b ≥ c", { maxLength: 100 });
      expect(result.ok).toBe(true);
    });
  });
  
  describe("allowlist pattern", () => {
    it("should reject values not matching allowlist pattern", () => {
      const result = validatePlainText("username", "admin@123", {
        maxLength: 50,
        allowlistPattern: /^[a-zA-Z0-9_]+$/,
      });
      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.errorCode).toBe("INVALID_INPUT");
      }
    });
    
    it("should accept values matching allowlist pattern", () => {
      const result = validatePlainText("username", "admin_123", {
        maxLength: 50,
        allowlistPattern: /^[a-zA-Z0-9_]+$/,
      });
      expect(result.ok).toBe(true);
    });
  });
});

// =============================================================================
// sanitizePlainText TESTS
// =============================================================================

describe("sanitizePlainText", () => {
  it("should normalize unicode (NFKC)", () => {
    // Full-width characters should normalize
    const result = sanitizePlainText("ＨｅｌｌO"); // Full-width + regular
    expect(result).toBe("HellO");
  });
  
  it("should trim whitespace", () => {
    const result = sanitizePlainText("  hello world  ");
    expect(result).toBe("hello world");
  });
  
  it("should collapse multiple spaces", () => {
    const result = sanitizePlainText("hello    world");
    expect(result).toBe("hello world");
  });
  
  it("should remove null bytes", () => {
    const result = sanitizePlainText("hello\x00world");
    expect(result).toBe("helloworld");
  });
  
  it("should remove control characters", () => {
    const result = sanitizePlainText("hello\x01\x02\x03world");
    expect(result).toBe("helloworld");
  });
  
  it("should preserve single newlines when option enabled", () => {
    const result = sanitizePlainText("line1\nline2", { preserveNewlines: true });
    expect(result).toBe("line1\nline2");
  });
  
  it("should collapse multiple newlines to double when option enabled", () => {
    const result = sanitizePlainText("line1\n\n\n\nline2", { preserveNewlines: true });
    expect(result).toBe("line1\n\nline2");
  });
  
  it("should handle non-string input gracefully", () => {
    // @ts-expect-error Testing runtime behavior
    const result = sanitizePlainText(12345);
    expect(result).toBe("");
  });
});

// =============================================================================
// validateEmail TESTS
// =============================================================================

describe("validateEmail", () => {
  it("should accept valid email", () => {
    const result = validateEmail("email", "user@example.com");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("user@example.com");
    }
  });
  
  it("should reject email with XSS payload", () => {
    const result = validateEmail("email", "user@<script>alert(1)</script>.com");
    expect(result.ok).toBe(false);
  });
  
  it("should reject invalid email format", () => {
    const result = validateEmail("email", "not-an-email");
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.errorCode).toBe("INVALID_EMAIL");
    }
  });
  
  it("should normalize email to lowercase", () => {
    const result = validateEmail("email", "User@Example.COM");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("user@example.com");
    }
  });
  
  it("should reject email exceeding max length", () => {
    const longEmail = "a".repeat(250) + "@example.com";
    const result = validateEmail("email", longEmail);
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.errorCode).toBe("TOO_LONG");
    }
  });
});

// =============================================================================
// validateUuid TESTS
// =============================================================================

describe("validateUuid", () => {
  it("should accept valid UUID v4", () => {
    const result = validateUuid("id", "550e8400-e29b-41d4-a716-446655440000");
    expect(result.ok).toBe(true);
  });
  
  it("should reject UUID with XSS payload", () => {
    const result = validateUuid("id", "<script>alert(1)</script>");
    expect(result.ok).toBe(false);
  });
  
  it("should reject invalid UUID format", () => {
    const result = validateUuid("id", "not-a-uuid");
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.errorCode).toBe("INVALID_UUID");
    }
  });
  
  it("should normalize UUID to lowercase", () => {
    const result = validateUuid("id", "550E8400-E29B-41D4-A716-446655440000");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("550e8400-e29b-41d4-a716-446655440000");
    }
  });
});

// =============================================================================
// validateEnum TESTS
// =============================================================================

describe("validateEnum", () => {
  const ALLOWED = ["start", "stop", "pause"] as const;
  
  it("should accept valid enum value", () => {
    const result = validateEnum("action", "start", ALLOWED);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("start");
    }
  });
  
  it("should reject invalid enum value", () => {
    const result = validateEnum("action", "invalid", ALLOWED);
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.errorCode).toBe("INVALID_ENUM");
    }
  });
  
  it("should reject XSS payload as enum value", () => {
    const result = validateEnum("action", "<script>alert(1)</script>", ALLOWED);
    expect(result.ok).toBe(false);
  });
  
  it("should reject non-string input", () => {
    const result = validateEnum("action", 123, ALLOWED);
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.errorCode).toBe("INVALID_INPUT");
    }
  });
});

// =============================================================================
// validateOptional TESTS
// =============================================================================

describe("validateOptional", () => {
  const validateId = (field: string, value: unknown) => validateUuid(field, value);
  
  it("should return undefined for null", () => {
    const result = validateOptional(validateId, "id", null);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeUndefined();
    }
  });
  
  it("should return undefined for undefined", () => {
    const result = validateOptional(validateId, "id", undefined);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeUndefined();
    }
  });
  
  it("should return undefined for empty string", () => {
    const result = validateOptional(validateId, "id", "");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeUndefined();
    }
  });
  
  it("should validate non-empty values", () => {
    const result = validateOptional(validateId, "id", "550e8400-e29b-41d4-a716-446655440000");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("550e8400-e29b-41d4-a716-446655440000");
    }
  });
  
  it("should reject invalid non-empty values", () => {
    const result = validateOptional(validateId, "id", "not-a-uuid");
    expect(result.ok).toBe(false);
  });
});

// =============================================================================
// collectErrors TESTS
// =============================================================================

describe("collectErrors", () => {
  it("should return null when all validations pass", () => {
    const result1: ValidationResult<string> = { ok: true, value: "test" };
    const result2: ValidationResult<string> = { ok: true, value: "test2" };
    
    const errors = collectErrors(result1, result2);
    expect(errors).toBeNull();
  });
  
  it("should collect all errors", () => {
    const result1: ValidationResult<string> = { ok: false, errorCode: "TOO_LONG", field: "title" };
    const result2: ValidationResult<string> = { ok: false, errorCode: "POSSIBLE_XSS", field: "content" };
    
    const errors = collectErrors(result1, result2);
    expect(errors).toEqual({
      title: "TOO_LONG",
      content: "POSSIBLE_XSS",
    });
  });
  
  it("should handle mixed results", () => {
    const result1: ValidationResult<string> = { ok: true, value: "test" };
    const result2: ValidationResult<string> = { ok: false, errorCode: "REQUIRED", field: "name" };
    
    const errors = collectErrors(result1, result2);
    expect(errors).toEqual({
      name: "REQUIRED",
    });
  });
});

// =============================================================================
// FIELD_CONFIGS TESTS
// =============================================================================

describe("FIELD_CONFIGS", () => {
  it("should have correct shortText config", () => {
    expect(FIELD_CONFIGS.shortText.maxLength).toBe(100);
    expect(FIELD_CONFIGS.shortText.minLength).toBe(1);
  });
  
  it("should have correct longText config with preserveNewlines", () => {
    expect(FIELD_CONFIGS.longText.maxLength).toBe(2000);
    expect(FIELD_CONFIGS.longText.preserveNewlines).toBe(true);
  });
  
  it("should work with validatePlainText", () => {
    const result = validatePlainText("title", "My Title", FIELD_CONFIGS.shortText);
    expect(result.ok).toBe(true);
  });
});
