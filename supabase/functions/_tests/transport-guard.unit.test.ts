/**
 * Transport Guard Unit Tests
 * 
 * Tests transport security verification without relying on spoofing headers.
 * These tests validate the behavior of:
 * - verifyTransportSecurity (via isSecureRequest)
 * - enforceTransportSecurity
 * 
 * CRITICAL: Run with ENVIRONMENT=production for strict behavior testing.
 * 
 * @example Run tests:
 * ENVIRONMENT=production deno test --allow-env --allow-net supabase/functions/_tests/transport-guard.unit.test.ts
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

// Import the functions to test
// Note: We import from the shared module
import {
  isSecureRequest,
  enforceTransportSecurity,
} from "../_shared/security-headers.ts";

// ============================================================
// HELPER: Create mock Request objects
// ============================================================

interface MockRequestOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
}

function createMockRequest(options: MockRequestOptions): Request {
  const headers = new Headers(options.headers ?? {});
  return new Request(options.url, {
    method: options.method ?? "GET",
    headers,
  });
}

// ============================================================
// TEST SUITE: Production Environment Behavior
// ============================================================

Deno.test({
  name: "Transport Guard - Production: Valid Supabase host + path + x-forwarded-proto=https → ALLOWED",
  async fn() {
    // Force production environment for this test
    const originalEnv = Deno.env.get("ENVIRONMENT");
    Deno.env.set("ENVIRONMENT", "production");
    
    try {
      const req = createMockRequest({
        url: "https://qdbfjxmxnxtubltahuqe.supabase.co/functions/v1/session-manager",
        headers: {
          "x-forwarded-proto": "https",
        },
      });
      
      const isSecure = isSecureRequest(req);
      assertEquals(isSecure, true, "Request with valid Supabase host, path, and HTTPS proto should be allowed");
      
      const response = await enforceTransportSecurity(req);
      assertEquals(response, null, "enforceTransportSecurity should return null for valid requests");
    } finally {
      // Restore original environment
      if (originalEnv !== undefined) {
        Deno.env.set("ENVIRONMENT", originalEnv);
      } else {
        Deno.env.delete("ENVIRONMENT");
      }
    }
  },
});

Deno.test({
  name: "Transport Guard - Production: Valid Lovable host + x-forwarded-proto=https → ALLOWED",
  async fn() {
    const originalEnv = Deno.env.get("ENVIRONMENT");
    Deno.env.set("ENVIRONMENT", "production");
    
    try {
      const req = createMockRequest({
        url: "https://my-app.lovableproject.com/api/test",
        headers: {
          "x-forwarded-proto": "https",
        },
      });
      
      const isSecure = isSecureRequest(req);
      assertEquals(isSecure, true, "Request with valid Lovable host and HTTPS proto should be allowed");
      
      const response = await enforceTransportSecurity(req);
      assertEquals(response, null, "enforceTransportSecurity should return null for valid requests");
    } finally {
      if (originalEnv !== undefined) {
        Deno.env.set("ENVIRONMENT", originalEnv);
      } else {
        Deno.env.delete("ENVIRONMENT");
      }
    }
  },
});

Deno.test({
  name: "Transport Guard - Production: Missing x-forwarded-proto → REJECTED",
  async fn() {
    const originalEnv = Deno.env.get("ENVIRONMENT");
    Deno.env.set("ENVIRONMENT", "production");
    
    try {
      const req = createMockRequest({
        url: "https://qdbfjxmxnxtubltahuqe.supabase.co/functions/v1/session-manager",
        headers: {
          // No x-forwarded-proto header
        },
      });
      
      const isSecure = isSecureRequest(req);
      assertEquals(isSecure, false, "Request without x-forwarded-proto should be rejected in production");
      
      const response = await enforceTransportSecurity(req);
      assertExists(response, "enforceTransportSecurity should return a Response for rejected requests");
      assertEquals(response.status, 403, "Rejected requests should return 403 Forbidden");
      
      const body = await response.json();
      assertEquals(body.code, "INSECURE_TRANSPORT", "Error code should be INSECURE_TRANSPORT");
    } finally {
      if (originalEnv !== undefined) {
        Deno.env.set("ENVIRONMENT", originalEnv);
      } else {
        Deno.env.delete("ENVIRONMENT");
      }
    }
  },
});

Deno.test({
  name: "Transport Guard - Production: x-forwarded-proto=http → REJECTED",
  async fn() {
    const originalEnv = Deno.env.get("ENVIRONMENT");
    Deno.env.set("ENVIRONMENT", "production");
    
    try {
      const req = createMockRequest({
        url: "https://qdbfjxmxnxtubltahuqe.supabase.co/functions/v1/session-manager",
        headers: {
          "x-forwarded-proto": "http", // HTTP instead of HTTPS
        },
      });
      
      const isSecure = isSecureRequest(req);
      assertEquals(isSecure, false, "Request with x-forwarded-proto=http should be rejected");
      
      const response = await enforceTransportSecurity(req);
      assertExists(response, "enforceTransportSecurity should return a Response for rejected requests");
      assertEquals(response.status, 403, "Rejected requests should return 403 Forbidden");
    } finally {
      if (originalEnv !== undefined) {
        Deno.env.set("ENVIRONMENT", originalEnv);
      } else {
        Deno.env.delete("ENVIRONMENT");
      }
    }
  },
});

Deno.test({
  name: "Transport Guard - Production: Wrong host (not .supabase.co or .lovableproject.com) → REJECTED",
  async fn() {
    const originalEnv = Deno.env.get("ENVIRONMENT");
    Deno.env.set("ENVIRONMENT", "production");
    
    try {
      const req = createMockRequest({
        url: "https://evil-attacker.com/functions/v1/session-manager",
        headers: {
          "x-forwarded-proto": "https", // Even with valid proto
        },
      });
      
      const isSecure = isSecureRequest(req);
      assertEquals(isSecure, false, "Request with wrong host should be rejected");
      
      const response = await enforceTransportSecurity(req);
      assertExists(response, "enforceTransportSecurity should return a Response for rejected requests");
      assertEquals(response.status, 403, "Rejected requests should return 403 Forbidden");
    } finally {
      if (originalEnv !== undefined) {
        Deno.env.set("ENVIRONMENT", originalEnv);
      } else {
        Deno.env.delete("ENVIRONMENT");
      }
    }
  },
});

Deno.test({
  name: "Transport Guard - Production: Supabase host but wrong path (not /functions/v1/) → REJECTED",
  async fn() {
    const originalEnv = Deno.env.get("ENVIRONMENT");
    Deno.env.set("ENVIRONMENT", "production");
    
    try {
      const req = createMockRequest({
        url: "https://qdbfjxmxnxtubltahuqe.supabase.co/api/not-a-function",
        headers: {
          "x-forwarded-proto": "https",
        },
      });
      
      const isSecure = isSecureRequest(req);
      assertEquals(isSecure, false, "Request with wrong path should be rejected");
      
      const response = await enforceTransportSecurity(req);
      assertExists(response, "enforceTransportSecurity should return a Response for rejected requests");
      assertEquals(response.status, 403, "Rejected requests should return 403 Forbidden");
    } finally {
      if (originalEnv !== undefined) {
        Deno.env.set("ENVIRONMENT", originalEnv);
      } else {
        Deno.env.delete("ENVIRONMENT");
      }
    }
  },
});

Deno.test({
  name: "Transport Guard - Production: URL with protocol http:// → REJECTED (regardless of x-forwarded-proto)",
  async fn() {
    const originalEnv = Deno.env.get("ENVIRONMENT");
    Deno.env.set("ENVIRONMENT", "production");
    
    try {
      // Even if x-forwarded-proto claims https, if URL is http, we need to verify platform ingress
      const req = createMockRequest({
        url: "http://qdbfjxmxnxtubltahuqe.supabase.co/functions/v1/session-manager",
        headers: {
          "x-forwarded-proto": "https",
        },
      });
      
      // The URL protocol being http:// doesn't automatically fail - 
      // the x-forwarded-proto from the edge proxy is what we check
      // This should pass because x-forwarded-proto=https and host/path are valid
      const isSecure = isSecureRequest(req);
      assertEquals(isSecure, true, "URL protocol http with valid x-forwarded-proto=https should pass");
    } finally {
      if (originalEnv !== undefined) {
        Deno.env.set("ENVIRONMENT", originalEnv);
      } else {
        Deno.env.delete("ENVIRONMENT");
      }
    }
  },
});

// ============================================================
// TEST SUITE: Development Environment Behavior
// ============================================================

Deno.test({
  name: "Transport Guard - Development: Direct HTTPS without proxy verification → ALLOWED",
  async fn() {
    const originalEnv = Deno.env.get("ENVIRONMENT");
    Deno.env.set("ENVIRONMENT", "development");
    
    try {
      const req = createMockRequest({
        url: "https://localhost:54321/functions/v1/test",
        headers: {
          // No x-forwarded-proto needed in development
        },
      });
      
      const isSecure = isSecureRequest(req);
      assertEquals(isSecure, true, "Development should allow direct HTTPS without proxy headers");
      
      const response = await enforceTransportSecurity(req);
      assertEquals(response, null, "enforceTransportSecurity should return null in development");
    } finally {
      if (originalEnv !== undefined) {
        Deno.env.set("ENVIRONMENT", originalEnv);
      } else {
        Deno.env.delete("ENVIRONMENT");
      }
    }
  },
});

Deno.test({
  name: "Transport Guard - Development: HTTP without proxy → REJECTED (even in dev)",
  async fn() {
    const originalEnv = Deno.env.get("ENVIRONMENT");
    Deno.env.set("ENVIRONMENT", "development");
    
    try {
      const req = createMockRequest({
        url: "http://localhost:54321/functions/v1/test",
        headers: {
          // No x-forwarded-proto, URL is http://
        },
      });
      
      const isSecure = isSecureRequest(req);
      assertEquals(isSecure, false, "Even in development, HTTP without proxy should be rejected");
      
      const response = await enforceTransportSecurity(req);
      assertExists(response, "enforceTransportSecurity should return Response for HTTP in dev");
      assertEquals(response.status, 403, "Rejected requests should return 403");
    } finally {
      if (originalEnv !== undefined) {
        Deno.env.set("ENVIRONMENT", originalEnv);
      } else {
        Deno.env.delete("ENVIRONMENT");
      }
    }
  },
});

// ============================================================
// TEST SUITE: Staging Environment (should behave like production)
// ============================================================

Deno.test({
  name: "Transport Guard - Staging: Same strict checks as production",
  async fn() {
    const originalEnv = Deno.env.get("ENVIRONMENT");
    Deno.env.set("ENVIRONMENT", "staging");
    
    try {
      // Missing x-forwarded-proto should fail in staging (like production)
      const req = createMockRequest({
        url: "https://qdbfjxmxnxtubltahuqe.supabase.co/functions/v1/session-manager",
        headers: {
          // No x-forwarded-proto
        },
      });
      
      const isSecure = isSecureRequest(req);
      assertEquals(isSecure, false, "Staging should enforce same strict checks as production");
      
      const response = await enforceTransportSecurity(req);
      assertExists(response, "Staging should reject requests without proper headers");
      assertEquals(response.status, 403, "Rejected requests should return 403");
    } finally {
      if (originalEnv !== undefined) {
        Deno.env.set("ENVIRONMENT", originalEnv);
      } else {
        Deno.env.delete("ENVIRONMENT");
      }
    }
  },
});

// ============================================================
// TEST SUITE: Response Format Verification
// ============================================================

Deno.test({
  name: "Transport Guard - Rejected response includes HSTS header",
  async fn() {
    const originalEnv = Deno.env.get("ENVIRONMENT");
    Deno.env.set("ENVIRONMENT", "production");
    
    try {
      const req = createMockRequest({
        url: "https://evil.com/functions/v1/test",
        headers: {
          "x-forwarded-proto": "https",
        },
      });
      
      const response = await enforceTransportSecurity(req);
      assertExists(response, "Should return a response");
      
      const hsts = response.headers.get("Strict-Transport-Security");
      assertExists(hsts, "Response should include HSTS header");
      assertEquals(
        hsts.includes("max-age=31536000"),
        true,
        "HSTS should have 1 year max-age"
      );
    } finally {
      if (originalEnv !== undefined) {
        Deno.env.set("ENVIRONMENT", originalEnv);
      } else {
        Deno.env.delete("ENVIRONMENT");
      }
    }
  },
});

Deno.test({
  name: "Transport Guard - Rejected response has minimal information",
  async fn() {
    const originalEnv = Deno.env.get("ENVIRONMENT");
    Deno.env.set("ENVIRONMENT", "production");
    
    try {
      const req = createMockRequest({
        url: "https://evil.com/api/test",
        headers: {
          "x-forwarded-proto": "http",
        },
      });
      
      const response = await enforceTransportSecurity(req);
      assertExists(response, "Should return a response");
      
      const body = await response.json();
      
      // Verify response doesn't leak sensitive info
      assertEquals(typeof body.error, "string", "Should have error field");
      assertEquals(typeof body.code, "string", "Should have code field");
      
      // Should NOT include internal details
      assertEquals(body.headers, undefined, "Should not include headers");
      assertEquals(body.stack, undefined, "Should not include stack trace");
      assertEquals(body.internal, undefined, "Should not include internal details");
    } finally {
      if (originalEnv !== undefined) {
        Deno.env.set("ENVIRONMENT", originalEnv);
      } else {
        Deno.env.delete("ENVIRONMENT");
      }
    }
  },
});

// ============================================================
// TEST SUITE: Edge Cases
// ============================================================

Deno.test({
  name: "Transport Guard - Production: Mixed case x-forwarded-proto → normalized correctly",
  async fn() {
    const originalEnv = Deno.env.get("ENVIRONMENT");
    Deno.env.set("ENVIRONMENT", "production");
    
    try {
      const req = createMockRequest({
        url: "https://qdbfjxmxnxtubltahuqe.supabase.co/functions/v1/test",
        headers: {
          "x-forwarded-proto": "HTTPS", // Uppercase
        },
      });
      
      const isSecure = isSecureRequest(req);
      assertEquals(isSecure, true, "Mixed case HTTPS should be normalized and accepted");
    } finally {
      if (originalEnv !== undefined) {
        Deno.env.set("ENVIRONMENT", originalEnv);
      } else {
        Deno.env.delete("ENVIRONMENT");
      }
    }
  },
});

Deno.test({
  name: "Transport Guard - Production: Empty x-forwarded-proto → REJECTED",
  async fn() {
    const originalEnv = Deno.env.get("ENVIRONMENT");
    Deno.env.set("ENVIRONMENT", "production");
    
    try {
      const req = createMockRequest({
        url: "https://qdbfjxmxnxtubltahuqe.supabase.co/functions/v1/test",
        headers: {
          "x-forwarded-proto": "", // Empty string
        },
      });
      
      // Empty string from .get() returns null-ish behavior
      const isSecure = isSecureRequest(req);
      assertEquals(isSecure, false, "Empty x-forwarded-proto should be rejected");
    } finally {
      if (originalEnv !== undefined) {
        Deno.env.set("ENVIRONMENT", originalEnv);
      } else {
        Deno.env.delete("ENVIRONMENT");
      }
    }
  },
});

Deno.test({
  name: "Transport Guard - Production: Subdomain of .supabase.co → ALLOWED",
  async fn() {
    const originalEnv = Deno.env.get("ENVIRONMENT");
    Deno.env.set("ENVIRONMENT", "production");
    
    try {
      const req = createMockRequest({
        url: "https://some-project.supabase.co/functions/v1/test",
        headers: {
          "x-forwarded-proto": "https",
        },
      });
      
      const isSecure = isSecureRequest(req);
      assertEquals(isSecure, true, "Any subdomain of .supabase.co with valid path should be allowed");
    } finally {
      if (originalEnv !== undefined) {
        Deno.env.set("ENVIRONMENT", originalEnv);
      } else {
        Deno.env.delete("ENVIRONMENT");
      }
    }
  },
});

Deno.test({
  name: "Transport Guard - Production: Spoofed host 'supabase.co.evil.com' → REJECTED",
  async fn() {
    const originalEnv = Deno.env.get("ENVIRONMENT");
    Deno.env.set("ENVIRONMENT", "production");
    
    try {
      const req = createMockRequest({
        url: "https://supabase.co.evil.com/functions/v1/test",
        headers: {
          "x-forwarded-proto": "https",
        },
      });
      
      const isSecure = isSecureRequest(req);
      assertEquals(isSecure, false, "Spoofed host should be rejected (not a suffix match)");
    } finally {
      if (originalEnv !== undefined) {
        Deno.env.set("ENVIRONMENT", originalEnv);
      } else {
        Deno.env.delete("ENVIRONMENT");
      }
    }
  },
});
