#!/usr/bin/env npx ts-node
/**
 * CI Security Check Script
 * 
 * Fails the build if:
 * - Any route is exposed over HTTP
 * - HSTS header missing on HTTPS responses
 * - Static check for http:// literals in config
 * 
 * Run: npx ts-node scripts/security-check.ts
 * 
 * Exit codes:
 * - 0: All checks passed
 * - 1: Security violations found
 */

import * as fs from "fs";
import * as path from "path";

// ============================================================
// CONFIGURATION
// ============================================================

interface ViolationResult {
  file: string;
  line: number;
  column: number;
  violation: string;
  severity: "error" | "warning";
}

const CONFIG_FILES = [
  "vite.config.ts",
  "supabase/config.toml",
  ".env",
  ".env.local",
  ".env.production",
  "package.json",
];

const EDGE_FUNCTION_DIRS = ["supabase/functions"];

const SHARED_SECURITY_FILE = "supabase/functions/_shared/security-headers.ts";

// Patterns that indicate insecure HTTP usage
const HTTP_LITERAL_PATTERNS = [
  // Direct http:// URLs (except localhost for development)
  /(?<!\/\/.*)(?<!\w)http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)/gi,
  // fetch with http:// (except localhost)
  /fetch\s*\(\s*['"`]http:\/\/(?!localhost|127\.0\.0\.1)/gi,
  // axios.get/post with http://
  /axios\.(get|post|put|delete|patch)\s*\(\s*['"`]http:\/\/(?!localhost)/gi,
];

// Patterns that indicate missing HSTS
const MISSING_HSTS_PATTERNS = [
  // Response without HSTS header
  /new\s+Response\s*\([^)]*\{\s*headers\s*:\s*\{[^}]*(?!Strict-Transport-Security)[^}]*\}/g,
];

// Files to scan for security issues
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs"];

// Directories to skip
const SKIP_DIRS = ["node_modules", ".git", "dist", "build", ".next"];

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function walkDir(dir: string, callback: (filePath: string) => void): void {
  if (!fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!SKIP_DIRS.includes(entry.name)) {
        walkDir(fullPath, callback);
      }
    } else if (entry.isFile()) {
      callback(fullPath);
    }
  }
}

function getLineAndColumn(
  content: string,
  index: number
): { line: number; column: number } {
  const lines = content.substring(0, index).split("\n");
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

// ============================================================
// CHECK: HTTP Literals in Config
// ============================================================

function checkHttpLiterals(): ViolationResult[] {
  const violations: ViolationResult[] = [];

  // Check config files
  for (const configFile of CONFIG_FILES) {
    if (!fs.existsSync(configFile)) continue;

    const content = fs.readFileSync(configFile, "utf-8");

    for (const pattern of HTTP_LITERAL_PATTERNS) {
      let match;
      // Reset lastIndex for global patterns
      pattern.lastIndex = 0;

      while ((match = pattern.exec(content)) !== null) {
        const { line, column } = getLineAndColumn(content, match.index);
        violations.push({
          file: configFile,
          line,
          column,
          violation: `Insecure HTTP URL found: "${match[0].slice(0, 50)}..."`,
          severity: "error",
        });
      }
    }
  }

  // Check source files
  walkDir("src", (filePath) => {
    if (!SOURCE_EXTENSIONS.some((ext) => filePath.endsWith(ext))) return;

    const content = fs.readFileSync(filePath, "utf-8");

    for (const pattern of HTTP_LITERAL_PATTERNS) {
      let match;
      pattern.lastIndex = 0;

      while ((match = pattern.exec(content)) !== null) {
        const { line, column } = getLineAndColumn(content, match.index);
        violations.push({
          file: filePath,
          line,
          column,
          violation: `Insecure HTTP URL found: "${match[0].slice(0, 50)}..."`,
          severity: "error",
        });
      }
    }
  });

  return violations;
}

// ============================================================
// CHECK: HSTS in Edge Functions
// ============================================================

function checkHSTSEnforcement(): ViolationResult[] {
  const violations: ViolationResult[] = [];

  // Check that shared security headers file exists and has HSTS
  if (fs.existsSync(SHARED_SECURITY_FILE)) {
    const content = fs.readFileSync(SHARED_SECURITY_FILE, "utf-8");

    // Check for HSTS configuration
    if (!content.includes("Strict-Transport-Security")) {
      violations.push({
        file: SHARED_SECURITY_FILE,
        line: 1,
        column: 1,
        violation: "HSTS header configuration not found in security headers module",
        severity: "error",
      });
    }

    // Check for proper HSTS value (1 year minimum)
    const hstsMatch = content.match(/max-age=(\d+)/);
    if (hstsMatch) {
      const maxAge = parseInt(hstsMatch[1], 10);
      if (maxAge < 31536000) {
        violations.push({
          file: SHARED_SECURITY_FILE,
          line: 1,
          column: 1,
          violation: `HSTS max-age too short: ${maxAge} seconds (minimum: 31536000)`,
          severity: "warning",
        });
      }
    }
  } else {
    violations.push({
      file: SHARED_SECURITY_FILE,
      line: 1,
      column: 1,
      violation: "Security headers module not found",
      severity: "error",
    });
  }

  // Check each edge function uses security enforcement
  for (const funcDir of EDGE_FUNCTION_DIRS) {
    if (!fs.existsSync(funcDir)) continue;

    const functions = fs.readdirSync(funcDir, { withFileTypes: true });

    for (const func of functions) {
      if (!func.isDirectory()) continue;
      if (func.name.startsWith("_")) continue; // Skip shared modules

      const indexPath = path.join(funcDir, func.name, "index.ts");
      if (!fs.existsSync(indexPath)) continue;

      const content = fs.readFileSync(indexPath, "utf-8");

      // Check for security enforcement import
      if (!content.includes("enforceTransportSecurity")) {
        violations.push({
          file: indexPath,
          line: 1,
          column: 1,
          violation: "Edge function missing enforceTransportSecurity guard",
          severity: "error",
        });
      }

      // Check that security guard is actually used
      if (
        content.includes("enforceTransportSecurity") &&
        !content.includes("enforceTransportSecurity(req)")
      ) {
        violations.push({
          file: indexPath,
          line: 1,
          column: 1,
          violation: "enforceTransportSecurity imported but not invoked",
          severity: "warning",
        });
      }
    }
  }

  return violations;
}

// ============================================================
// CHECK: No HTTP Route Exposure
// ============================================================

function checkNoHttpRoutes(): ViolationResult[] {
  const violations: ViolationResult[] = [];

  // Check for any Express/Fastify/Hono routes without HTTPS redirect
  walkDir("supabase/functions", (filePath) => {
    if (!filePath.endsWith(".ts")) return;
    if (filePath.includes("_shared")) return;

    const content = fs.readFileSync(filePath, "utf-8");

    // Check for proper security guard usage in Deno.serve handlers
    if (content.includes("Deno.serve")) {
      // Must have security enforcement
      if (!content.includes("enforceTransportSecurity")) {
        violations.push({
          file: filePath,
          line: 1,
          column: 1,
          violation: "Deno.serve handler missing HTTPS enforcement",
          severity: "error",
        });
      }
    }
  });

  return violations;
}

// ============================================================
// CHECK: No Skip TLS Verification
// ============================================================

function checkNoTLSSkip(): ViolationResult[] {
  const violations: ViolationResult[] = [];

  const dangerousPatterns = [
    /rejectUnauthorized\s*:\s*false/gi,
    /NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/gi,
    /DENO_TLS_CA_STORE\s*=\s*['"]?system/gi,
    /--unsafely-ignore-certificate-errors/gi,
    /skipTlsVerify\s*:\s*true/gi,
    /insecure\s*:\s*true/gi,
    /verify\s*:\s*false/gi,
    /sslmode\s*=\s*disable/gi,
  ];

  walkDir(".", (filePath) => {
    if (SKIP_DIRS.some((d) => filePath.includes(d))) return;
    if (!SOURCE_EXTENSIONS.some((ext) => filePath.endsWith(ext))) return;

    const content = fs.readFileSync(filePath, "utf-8");

    for (const pattern of dangerousPatterns) {
      let match;
      pattern.lastIndex = 0;

      while ((match = pattern.exec(content)) !== null) {
        const { line, column } = getLineAndColumn(content, match.index);
        violations.push({
          file: filePath,
          line,
          column,
          violation: `TLS verification disabled: "${match[0]}"`,
          severity: "error",
        });
      }
    }
  });

  return violations;
}

// ============================================================
// MAIN
// ============================================================

function main(): void {
  console.log("🔒 Security Check Starting...\n");

  let allViolations: ViolationResult[] = [];

  // Run all checks
  console.log("Checking for HTTP literals in config...");
  allViolations = allViolations.concat(checkHttpLiterals());

  console.log("Checking HSTS enforcement...");
  allViolations = allViolations.concat(checkHSTSEnforcement());

  console.log("Checking for exposed HTTP routes...");
  allViolations = allViolations.concat(checkNoHttpRoutes());

  console.log("Checking for TLS verification bypass...");
  allViolations = allViolations.concat(checkNoTLSSkip());

  // Report results
  console.log("\n" + "=".repeat(60) + "\n");

  if (allViolations.length === 0) {
    console.log("✅ All security checks passed!\n");
    process.exit(0);
  }

  const errors = allViolations.filter((v) => v.severity === "error");
  const warnings = allViolations.filter((v) => v.severity === "warning");

  if (errors.length > 0) {
    console.log(`❌ ${errors.length} security error(s) found:\n`);
    for (const error of errors) {
      console.log(`  ${error.file}:${error.line}:${error.column}`);
      console.log(`    ERROR: ${error.violation}\n`);
    }
  }

  if (warnings.length > 0) {
    console.log(`⚠️  ${warnings.length} security warning(s) found:\n`);
    for (const warning of warnings) {
      console.log(`  ${warning.file}:${warning.line}:${warning.column}`);
      console.log(`    WARNING: ${warning.violation}\n`);
    }
  }

  // Fail build only on errors
  if (errors.length > 0) {
    console.log("\n❌ Build failed due to security violations.");
    process.exit(1);
  } else {
    console.log("\n⚠️  Build passed with warnings. Please review.");
    process.exit(0);
  }
}

main();
