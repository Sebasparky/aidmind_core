/**
 * Security Module - Centralized security utilities
 * 
 * This module exports all security-related utilities for:
 * - Input validation and sanitization (XSS prevention)
 * - Safe text/markdown rendering
 * - Security checks and CI utilities
 * 
 * USAGE:
 * import { validatePlainText, renderSafeText } from "@/security";
 */

// Input validation utilities
export {
  sanitizePlainText,
  validatePlainText,
  validateEmail,
  validateUuid,
  validateEnum,
  validateOptional,
  collectErrors,
  FIELD_CONFIGS,
  type ValidationErrorCode,
  type ValidationResult,
  type ValidationErrors,
  type PlainTextOptions,
  type SanitizeOptions,
} from "./inputValidation";

// Safe rendering utilities
export {
  renderSafeText,
  renderSafeMultilineText,
  renderSafeMarkdown,
  stripHtml,
  generateCssVariables,
} from "./safeRender";
