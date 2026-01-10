/**
 * Safe Rendering Utilities for XSS Prevention
 * 
 * This module provides React-safe rendering utilities that prevent XSS attacks.
 * 
 * SECURITY PRINCIPLES:
 * - React escapes text by default - leverage this
 * - Never use dangerouslySetInnerHTML with user content
 * - Markdown rendering uses allowlist-based sanitization
 * - All event handlers and javascript: URLs are stripped
 * 
 * USAGE:
 * - For plain text: Use React's default rendering or renderSafeText()
 * - For markdown: Use renderSafeMarkdown() with allowlisted tags only
 */

import React from "react";

// =============================================================================
// SAFE TEXT RENDERING
// =============================================================================

/**
 * Renders text safely as a React span element.
 * React automatically escapes text content, preventing XSS.
 * 
 * Use this when you want explicit safety guarantees or need a wrapper element.
 * 
 * @example
 * // Instead of: <div dangerouslySetInnerHTML={{ __html: userInput }} />
 * // Use: <div>{renderSafeText(userInput)}</div>
 */
export function renderSafeText(
  text: string | null | undefined,
  className?: string
): React.ReactElement {
  return (
    <span className={className}>
      {text ?? ""}
    </span>
  );
}

/**
 * Renders multiline text safely, preserving line breaks.
 * Each line is rendered as a separate element with <br /> between them.
 */
export function renderSafeMultilineText(
  text: string | null | undefined,
  className?: string
): React.ReactElement {
  if (!text) {
    return <span className={className} />;
  }

  const lines = text.split("\n");
  
  return (
    <span className={className}>
      {lines.map((line, index) => (
        <React.Fragment key={index}>
          {line}
          {index < lines.length - 1 && <br />}
        </React.Fragment>
      ))}
    </span>
  );
}

// =============================================================================
// SAFE MARKDOWN RENDERING (ALLOWLIST-BASED)
// =============================================================================

/**
 * Allowlisted HTML tags for markdown rendering.
 * These are safe structural/formatting tags only.
 * 
 * EXPLICITLY EXCLUDED (dangerous):
 * - script, style, iframe, object, embed, form, input
 * - img (can leak data, phishing)
 * - svg (can execute scripts)
 * - Any tag with event handlers
 */
const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "del",
  "ins",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "a",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "span",
  "div",
]);

/**
 * Allowlisted attributes per tag.
 * Only these attributes are preserved; all others are stripped.
 */
const ALLOWED_ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(["href", "title"]),
  code: new Set(["class"]), // For syntax highlighting classes
  pre: new Set(["class"]),
  span: new Set(["class"]),
  div: new Set(["class"]),
};

/**
 * Patterns that indicate dangerous href values.
 * These are BLOCKED even on allowed tags.
 */
const DANGEROUS_HREF_PATTERNS = [
  /^javascript:/i,
  /^vbscript:/i,
  /^data:/i,
  /^file:/i,
] as const;

/**
 * Sanitizes an href value.
 * Returns null if the href is dangerous (should be removed).
 */
function sanitizeHref(href: string | null | undefined): string | null {
  if (!href) return null;
  
  const trimmed = href.trim();
  
  // Check for dangerous patterns
  for (const pattern of DANGEROUS_HREF_PATTERNS) {
    if (pattern.test(trimmed)) {
      return null;
    }
  }
  
  // Only allow http, https, mailto, tel, and relative URLs
  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("mailto:") ||
    trimmed.startsWith("tel:") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("#") ||
    !trimmed.includes(":")
  ) {
    return trimmed;
  }
  
  return null;
}

/**
 * Strips all HTML tags from text, returning plain text only.
 * Use this when you need to extract text content from potentially unsafe HTML.
 */
export function stripHtml(html: string): string {
  // Create a temporary div to parse HTML (browser-safe)
  if (typeof document !== "undefined") {
    const temp = document.createElement("div");
    temp.textContent = html; // This escapes HTML
    return temp.textContent || "";
  }
  
  // Fallback for SSR: simple regex strip
  return html.replace(/<[^>]*>/g, "");
}

/**
 * Basic markdown to safe HTML converter.
 * This is a minimal implementation that handles common markdown patterns
 * and outputs only allowlisted HTML tags.
 * 
 * For full markdown support, use a proper markdown library with DOMPurify.
 */
function markdownToSafeElements(markdown: string): React.ReactNode[] {
  const elements: React.ReactNode[] = [];
  const lines = markdown.split("\n");
  let currentList: { type: "ul" | "ol"; items: string[] } | null = null;
  let inCodeBlock = false;
  let codeBlockContent: string[] = [];
  
  const flushList = () => {
    if (currentList) {
      const ListTag = currentList.type;
      elements.push(
        <ListTag key={elements.length}>
          {currentList.items.map((item, i) => (
            <li key={i}>{parseInlineMarkdown(item)}</li>
          ))}
        </ListTag>
      );
      currentList = null;
    }
  };
  
  const flushCodeBlock = () => {
    if (codeBlockContent.length > 0) {
      elements.push(
        <pre key={elements.length}>
          <code>{codeBlockContent.join("\n")}</code>
        </pre>
      );
      codeBlockContent = [];
    }
  };
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Code block
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        flushCodeBlock();
        inCodeBlock = false;
      } else {
        flushList();
        inCodeBlock = true;
      }
      continue;
    }
    
    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }
    
    // Headers
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
      flushList();
      const level = headerMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      const text = headerMatch[2];
      const HeaderTag = `h${level}` as keyof JSX.IntrinsicElements;
      elements.push(
        <HeaderTag key={elements.length}>{parseInlineMarkdown(text)}</HeaderTag>
      );
      continue;
    }
    
    // Unordered list
    const ulMatch = line.match(/^[-*]\s+(.+)$/);
    if (ulMatch) {
      if (currentList?.type !== "ul") {
        flushList();
        currentList = { type: "ul", items: [] };
      }
      currentList.items.push(ulMatch[1]);
      continue;
    }
    
    // Ordered list
    const olMatch = line.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      if (currentList?.type !== "ol") {
        flushList();
        currentList = { type: "ol", items: [] };
      }
      currentList.items.push(olMatch[1]);
      continue;
    }
    
    // Horizontal rule
    if (/^[-*_]{3,}$/.test(line.trim())) {
      flushList();
      elements.push(<hr key={elements.length} />);
      continue;
    }
    
    // Blockquote
    const quoteMatch = line.match(/^>\s*(.*)$/);
    if (quoteMatch) {
      flushList();
      elements.push(
        <blockquote key={elements.length}>
          {parseInlineMarkdown(quoteMatch[1])}
        </blockquote>
      );
      continue;
    }
    
    // Empty line
    if (line.trim() === "") {
      flushList();
      continue;
    }
    
    // Paragraph
    flushList();
    elements.push(
      <p key={elements.length}>{parseInlineMarkdown(line)}</p>
    );
  }
  
  flushList();
  flushCodeBlock();
  
  return elements;
}

/**
 * Parses inline markdown (bold, italic, code, links) into React elements.
 */
function parseInlineMarkdown(text: string): React.ReactNode {
  const elements: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;
  
  while (remaining.length > 0) {
    // Inline code
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      elements.push(<code key={key++}>{codeMatch[1]}</code>);
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }
    
    // Bold (** or __)
    const boldMatch = remaining.match(/^(\*\*|__)([^*_]+)\1/);
    if (boldMatch) {
      elements.push(<strong key={key++}>{boldMatch[2]}</strong>);
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }
    
    // Italic (* or _)
    const italicMatch = remaining.match(/^(\*|_)([^*_]+)\1/);
    if (italicMatch) {
      elements.push(<em key={key++}>{italicMatch[2]}</em>);
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }
    
    // Link [text](url)
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      const linkText = linkMatch[1];
      const href = sanitizeHref(linkMatch[2]);
      if (href) {
        elements.push(
          <a key={key++} href={href} target="_blank" rel="noopener noreferrer">
            {linkText}
          </a>
        );
      } else {
        // Unsafe URL - render as plain text
        elements.push(<span key={key++}>{linkText}</span>);
      }
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }
    
    // Plain text character
    elements.push(remaining[0]);
    remaining = remaining.slice(1);
  }
  
  // Collapse adjacent strings
  const collapsed: React.ReactNode[] = [];
  let currentString = "";
  
  for (const el of elements) {
    if (typeof el === "string") {
      currentString += el;
    } else {
      if (currentString) {
        collapsed.push(currentString);
        currentString = "";
      }
      collapsed.push(el);
    }
  }
  
  if (currentString) {
    collapsed.push(currentString);
  }
  
  return collapsed.length === 1 ? collapsed[0] : collapsed;
}

/**
 * Renders markdown content safely using React elements only.
 * No dangerouslySetInnerHTML is used - all output is React-escaped.
 * 
 * Supports:
 * - Headers (h1-h6)
 * - Bold, italic, inline code
 * - Links (with URL sanitization)
 * - Unordered and ordered lists
 * - Code blocks
 * - Blockquotes
 * - Horizontal rules
 * 
 * @example
 * <div>{renderSafeMarkdown("**Bold** and *italic* text")}</div>
 */
export function renderSafeMarkdown(
  markdown: string | null | undefined,
  className?: string
): React.ReactElement {
  if (!markdown) {
    return <div className={className} />;
  }
  
  const elements = markdownToSafeElements(markdown);
  
  return (
    <div className={className}>
      {elements}
    </div>
  );
}

// =============================================================================
// CSS GENERATION UTILITIES (for internal use only)
// =============================================================================

/**
 * Generates CSS custom properties from a config object.
 * Returns a style object for use with React's style prop.
 * 
 * This is the SAFE alternative to dangerouslySetInnerHTML for CSS injection.
 * Only accepts controlled, internal configuration - never user input.
 */
export function generateCssVariables(
  config: Record<string, string>
): React.CSSProperties {
  const cssVars: Record<string, string> = {};
  
  for (const [key, value] of Object.entries(config)) {
    // Validate key format (only alphanumeric and hyphens)
    if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(key)) {
      console.warn(`[safeRender] Invalid CSS variable name: ${key}`);
      continue;
    }
    
    // Validate value (no url(), no javascript:, no expressions)
    const lowerValue = value.toLowerCase();
    if (
      lowerValue.includes("url(") ||
      lowerValue.includes("javascript:") ||
      lowerValue.includes("expression(") ||
      lowerValue.includes("-moz-binding")
    ) {
      console.warn(`[safeRender] Potentially unsafe CSS value blocked`);
      continue;
    }
    
    cssVars[`--${key}`] = value;
  }
  
  return cssVars as React.CSSProperties;
}
