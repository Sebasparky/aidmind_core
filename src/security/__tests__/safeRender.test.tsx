/**
 * XSS Prevention Tests - Safe Render Module
 * 
 * These tests verify that XSS payloads are never rendered as executable HTML.
 * All rendering goes through React's built-in escaping.
 * 
 * NO REAL SECRETS REQUIRED - all tests use mock data.
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import {
  renderSafeText,
  renderSafeMultilineText,
  renderSafeMarkdown,
  stripHtml,
  generateCssVariables,
} from "../safeRender";

// =============================================================================
// XSS PAYLOAD TEST CASES (Same as input validation tests)
// =============================================================================

const XSS_PAYLOADS = {
  scriptBasic: '<script>alert(1)</script>',
  scriptUppercase: '<SCRIPT>alert(1)</SCRIPT>',
  imgOnerror: '<img src=x onerror=alert(1)>',
  svgOnload: '<svg onload=alert(1)>',
  jsUrl: 'javascript:alert(1)',
  divOnclick: '<div onclick="alert(1)">click me</div>',
  iframeJs: '<iframe src="javascript:alert(1)"></iframe>',
  dataUri: 'data:text/html,<script>alert(1)</script>',
  eventHandler: 'onmouseover="alert(1)"',
  htmlEntities: '&#60;script&#62;alert(1)&#60;/script&#62;',
} as const;

// =============================================================================
// renderSafeText TESTS
// =============================================================================

describe("renderSafeText", () => {
  describe("XSS prevention", () => {
    it.each(Object.entries(XSS_PAYLOADS))(
      "should escape XSS payload as plain text: %s",
      (name, payload) => {
        const { container } = render(renderSafeText(payload));
        
        // The payload should appear as escaped text, not executable HTML
        expect(container.querySelector("script")).toBeNull();
        expect(container.querySelector("img")).toBeNull();
        expect(container.querySelector("svg")).toBeNull();
        expect(container.querySelector("iframe")).toBeNull();
        
        // The text should be visible as escaped
        expect(container.textContent).toContain(payload);
      }
    );
    
    it("should never execute script tags", () => {
      const { container } = render(renderSafeText('<script>document.body.innerHTML = "HACKED"</script>'));
      
      // Script should not execute
      expect(document.body.innerHTML).not.toBe("HACKED");
      // Script tag should not exist in DOM
      expect(container.querySelector("script")).toBeNull();
      // Text should be visible
      expect(container.textContent).toContain("<script>");
    });
    
    it("should display XSS payload as visible text", () => {
      render(renderSafeText('<img src=x onerror=alert(1)>'));
      
      // The literal text should be visible
      expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    });
  });
  
  describe("normal rendering", () => {
    it("should render plain text correctly", () => {
      render(renderSafeText("Hello, World!"));
      expect(screen.getByText("Hello, World!")).toBeInTheDocument();
    });
    
    it("should handle null gracefully", () => {
      const { container } = render(renderSafeText(null));
      expect(container.textContent).toBe("");
    });
    
    it("should handle undefined gracefully", () => {
      const { container } = render(renderSafeText(undefined));
      expect(container.textContent).toBe("");
    });
    
    it("should apply className", () => {
      const { container } = render(renderSafeText("test", "custom-class"));
      expect(container.querySelector(".custom-class")).toBeInTheDocument();
    });
  });
});

// =============================================================================
// renderSafeMultilineText TESTS
// =============================================================================

describe("renderSafeMultilineText", () => {
  describe("XSS prevention", () => {
    it("should escape XSS in multiline text", () => {
      const maliciousMultiline = 'Line 1\n<script>alert(1)</script>\nLine 3';
      const { container } = render(renderSafeMultilineText(maliciousMultiline));
      
      expect(container.querySelector("script")).toBeNull();
      expect(container.textContent).toContain("<script>alert(1)</script>");
    });
    
    it("should handle XSS attempts across lines", () => {
      const splitXss = '<scr\nipt>alert(1)</scr\nipt>';
      const { container } = render(renderSafeMultilineText(splitXss));
      
      expect(container.querySelector("script")).toBeNull();
    });
  });
  
  describe("normal rendering", () => {
    it("should preserve line breaks", () => {
      const { container } = render(renderSafeMultilineText("Line 1\nLine 2\nLine 3"));
      
      // Should have br elements
      expect(container.querySelectorAll("br")).toHaveLength(2);
    });
    
    it("should handle empty text", () => {
      const { container } = render(renderSafeMultilineText(""));
      expect(container.textContent).toBe("");
    });
  });
});

// =============================================================================
// renderSafeMarkdown TESTS
// =============================================================================

describe("renderSafeMarkdown", () => {
  describe("XSS prevention in markdown", () => {
    it("should not render script tags from markdown", () => {
      const { container } = render(renderSafeMarkdown('<script>alert(1)</script>'));
      
      expect(container.querySelector("script")).toBeNull();
      // Should show as text or be stripped
      expect(container.innerHTML).not.toContain("<script>");
    });
    
    it("should not render img tags with event handlers", () => {
      const { container } = render(renderSafeMarkdown('![alt](x" onerror="alert(1))'));
      
      expect(container.querySelector("img")).toBeNull();
      // Check no onerror attribute exists anywhere
      expect(container.innerHTML).not.toContain("onerror");
    });
    
    it("should sanitize javascript: URLs in links", () => {
      const { container } = render(renderSafeMarkdown('[click me](javascript:alert(1))'));
      
      // Link should either not exist or not have javascript: href
      const link = container.querySelector("a");
      if (link) {
        expect(link.getAttribute("href")).not.toContain("javascript:");
      }
    });
    
    it("should sanitize data: URLs in links", () => {
      const { container } = render(renderSafeMarkdown('[click](data:text/html,<script>alert(1)</script>)'));
      
      const link = container.querySelector("a");
      if (link) {
        expect(link.getAttribute("href")).not.toContain("data:");
      }
    });
    
    it("should not render inline event handlers", () => {
      const { container } = render(renderSafeMarkdown('**bold** <div onclick="alert(1)">text</div>'));
      
      // Check no onclick attribute exists
      expect(container.innerHTML).not.toMatch(/onclick/i);
    });
    
    it("should not render svg tags", () => {
      const { container } = render(renderSafeMarkdown('<svg onload="alert(1)"><circle r="50"/></svg>'));
      
      expect(container.querySelector("svg")).toBeNull();
    });
    
    it("should not render iframe tags", () => {
      const { container } = render(renderSafeMarkdown('<iframe src="javascript:alert(1)"></iframe>'));
      
      expect(container.querySelector("iframe")).toBeNull();
    });
  });
  
  describe("safe markdown rendering", () => {
    it("should render headers", () => {
      const { container } = render(renderSafeMarkdown("# Heading 1\n## Heading 2"));
      
      expect(container.querySelector("h1")).toBeInTheDocument();
      expect(container.querySelector("h2")).toBeInTheDocument();
    });
    
    it("should render bold text", () => {
      const { container } = render(renderSafeMarkdown("**bold text**"));
      
      expect(container.querySelector("strong")).toBeInTheDocument();
      expect(container.textContent).toContain("bold text");
    });
    
    it("should render italic text", () => {
      const { container } = render(renderSafeMarkdown("*italic text*"));
      
      expect(container.querySelector("em")).toBeInTheDocument();
    });
    
    it("should render safe links", () => {
      const { container } = render(renderSafeMarkdown("[Example](https://example.com)"));
      
      const link = container.querySelector("a");
      expect(link).toBeInTheDocument();
      expect(link?.getAttribute("href")).toBe("https://example.com");
      expect(link?.getAttribute("target")).toBe("_blank");
      expect(link?.getAttribute("rel")).toContain("noopener");
    });
    
    it("should render unordered lists", () => {
      const { container } = render(renderSafeMarkdown("- Item 1\n- Item 2\n- Item 3"));
      
      expect(container.querySelector("ul")).toBeInTheDocument();
      expect(container.querySelectorAll("li")).toHaveLength(3);
    });
    
    it("should render ordered lists", () => {
      const { container } = render(renderSafeMarkdown("1. First\n2. Second\n3. Third"));
      
      expect(container.querySelector("ol")).toBeInTheDocument();
      expect(container.querySelectorAll("li")).toHaveLength(3);
    });
    
    it("should render code blocks", () => {
      const { container } = render(renderSafeMarkdown("```\ncode here\n```"));
      
      expect(container.querySelector("pre")).toBeInTheDocument();
      expect(container.querySelector("code")).toBeInTheDocument();
    });
    
    it("should render inline code", () => {
      const { container } = render(renderSafeMarkdown("Use `const x = 1` in your code"));
      
      expect(container.querySelector("code")).toBeInTheDocument();
      expect(container.textContent).toContain("const x = 1");
    });
    
    it("should render blockquotes", () => {
      const { container } = render(renderSafeMarkdown("> This is a quote"));
      
      expect(container.querySelector("blockquote")).toBeInTheDocument();
    });
    
    it("should handle null/undefined", () => {
      const { container: c1 } = render(renderSafeMarkdown(null));
      const { container: c2 } = render(renderSafeMarkdown(undefined));
      
      expect(c1.textContent).toBe("");
      expect(c2.textContent).toBe("");
    });
  });
});

// =============================================================================
// stripHtml TESTS
// =============================================================================

describe("stripHtml", () => {
  it("should strip all HTML tags", () => {
    const result = stripHtml("<p>Hello <strong>World</strong></p>");
    // Note: stripHtml uses textContent which escapes HTML
    expect(result).not.toContain("<");
    expect(result).not.toContain(">");
  });
  
  it("should handle XSS payloads safely", () => {
    const result = stripHtml('<script>alert(1)</script>');
    expect(result).not.toContain("<script>");
  });
  
  it("should return empty string for empty input", () => {
    const result = stripHtml("");
    expect(result).toBe("");
  });
});

// =============================================================================
// generateCssVariables TESTS
// =============================================================================

describe("generateCssVariables", () => {
  it("should generate valid CSS variables", () => {
    const result = generateCssVariables({
      "primary-color": "#ff0000",
      "font-size": "16px",
    });
    
    expect(result["--primary-color"]).toBe("#ff0000");
    expect(result["--font-size"]).toBe("16px");
  });
  
  it("should reject invalid variable names", () => {
    const result = generateCssVariables({
      "valid-name": "value",
      "123-invalid": "value", // Starts with number
      "<script>": "value", // XSS attempt
    });
    
    expect(result["--valid-name"]).toBe("value");
    expect(result["--123-invalid"]).toBeUndefined();
    expect(result["--<script>"]).toBeUndefined();
  });
  
  it("should block dangerous CSS values", () => {
    const result = generateCssVariables({
      "safe": "normal value",
      "unsafe-url": "url(javascript:alert(1))",
      "unsafe-js": "javascript:alert(1)",
      "unsafe-expression": "expression(alert(1))",
      "unsafe-moz": "-moz-binding:url(evil.xml)",
    });
    
    expect(result["--safe"]).toBe("normal value");
    expect(result["--unsafe-url"]).toBeUndefined();
    expect(result["--unsafe-js"]).toBeUndefined();
    expect(result["--unsafe-expression"]).toBeUndefined();
    expect(result["--unsafe-moz"]).toBeUndefined();
  });
});

// =============================================================================
// INTEGRATION: Verify React escaping behavior
// =============================================================================

describe("React escaping integration", () => {
  it("React should escape special characters in JSX text", () => {
    const xss = '<script>alert("XSS")</script>';
    const { container } = render(<span>{xss}</span>);
    
    // Script tag should not be in the DOM
    expect(container.querySelector("script")).toBeNull();
    // Text should be visible
    expect(container.textContent).toBe(xss);
  });
  
  it("React should escape angle brackets", () => {
    const { container } = render(<span>{"<div>test</div>"}</span>);
    
    // No div element should be created
    expect(container.querySelectorAll("div")).toHaveLength(0);
    // The span should contain the literal text
    expect(container.querySelector("span")?.textContent).toBe("<div>test</div>");
  });
  
  it("XSS payloads remain as text, never execute", () => {
    // Store initial body content
    const initialBody = document.body.innerHTML;
    
    // Try to render malicious content
    render(renderSafeText('"><script>document.body.innerHTML="PWNED"</script>'));
    
    // Body should not have been modified by the "script"
    expect(document.body.innerHTML).not.toBe("PWNED");
  });
});
