/**
 * CI Check: Detect dangerous HTML rendering patterns
 * 
 * This script scans the codebase for XSS-vulnerable patterns:
 * - dangerouslySetInnerHTML
 * - innerHTML assignments
 * - outerHTML assignments
 * 
 * USAGE:
 *   npx tsx scripts/check-dangerous-html.ts
 * 
 * EXIT CODES:
 *   0 - No violations found
 *   1 - Violations detected (CI should fail)
 * 
 * EXCEPTIONS:
 *   Files in the exceptions list are allowed to use these patterns
 *   with documented security justifications.
 */

import * as fs from "fs";
import * as path from "path";

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Directories to scan (relative to project root)
 */
const SCAN_DIRS = ["src"];

/**
 * File extensions to check
 */
const FILE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

/**
 * Patterns that indicate XSS vulnerabilities
 */
const DANGEROUS_PATTERNS = [
  {
    name: "dangerouslySetInnerHTML",
    pattern: /dangerouslySetInnerHTML/g,
    severity: "ERROR" as const,
    message: "dangerouslySetInnerHTML bypasses React's XSS protection. Use safe rendering utilities from src/security/safeRender.tsx instead.",
  },
  {
    name: "innerHTML assignment",
    pattern: /\.innerHTML\s*=/g,
    severity: "ERROR" as const,
    message: "Direct innerHTML assignment is vulnerable to XSS. Use React's state and rendering instead.",
  },
  {
    name: "outerHTML assignment",
    pattern: /\.outerHTML\s*=/g,
    severity: "ERROR" as const,
    message: "Direct outerHTML assignment is vulnerable to XSS. Use React's state and rendering instead.",
  },
  {
    name: "document.write",
    pattern: /document\.write\s*\(/g,
    severity: "ERROR" as const,
    message: "document.write can inject arbitrary HTML. Use React rendering instead.",
  },
  {
    name: "insertAdjacentHTML",
    pattern: /\.insertAdjacentHTML\s*\(/g,
    severity: "ERROR" as const,
    message: "insertAdjacentHTML can inject arbitrary HTML. Use React rendering instead.",
  },
];

/**
 * Files that are ALLOWED to use dangerous patterns with justification.
 * Each exception must have a documented security review.
 * 
 * SECURITY REVIEW REQUIRED:
 * - The pattern must only use controlled, non-user-input data
 * - The content must be validated/sanitized if any external data is used
 * - The exception must be re-reviewed on any change to the file
 */
const EXCEPTIONS: Record<string, string> = {
  // No exceptions currently - all dangerous patterns should be refactored
};

// =============================================================================
// SCANNER IMPLEMENTATION
// =============================================================================

interface Violation {
  file: string;
  line: number;
  column: number;
  pattern: string;
  severity: "ERROR" | "WARNING";
  message: string;
  context: string;
}

function getAllFiles(dir: string, extensions: string[]): string[] {
  const files: string[] = [];
  
  function walk(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      
      if (entry.isDirectory()) {
        // Skip node_modules and hidden directories
        if (entry.name === "node_modules" || entry.name.startsWith(".")) {
          continue;
        }
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (extensions.includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  }
  
  walk(dir);
  return files;
}

function scanFile(filePath: string): Violation[] {
  const violations: Violation[] = [];
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  
  // Check if file is in exceptions list
  const relativePath = path.relative(process.cwd(), filePath);
  if (EXCEPTIONS[relativePath]) {
    console.log(`  ℹ️  Skipping ${relativePath} (exception: ${EXCEPTIONS[relativePath]})`);
    return [];
  }
  
  for (const patternDef of DANGEROUS_PATTERNS) {
    // Reset regex lastIndex
    patternDef.pattern.lastIndex = 0;
    
    let match;
    while ((match = patternDef.pattern.exec(content)) !== null) {
      // Find line and column
      let lineNum = 1;
      let charCount = 0;
      
      for (let i = 0; i < lines.length; i++) {
        const lineLength = lines[i].length + 1; // +1 for newline
        if (charCount + lineLength > match.index) {
          lineNum = i + 1;
          break;
        }
        charCount += lineLength;
      }
      
      const column = match.index - charCount + 1;
      const context = lines[lineNum - 1]?.trim() || "";
      
      // Skip if the match is in a comment
      // Check for single-line comments (// or *)
      const lineContent = lines[lineNum - 1] || "";
      const beforeMatch = lineContent.slice(0, column - 1);
      
      // Skip if preceded by // (single-line comment)
      if (beforeMatch.includes("//")) {
        continue;
      }
      
      // Skip if line starts with * (block comment continuation)
      if (lineContent.trim().startsWith("*") || lineContent.trim().startsWith("/*")) {
        continue;
      }
      
      // Skip if the pattern appears in a string that's clearly documentation
      // (e.g., JSDoc @example or comment text)
      if (context.includes("* ") && (
        context.includes("@example") ||
        context.includes("Instead of:") ||
        context.includes("SECURITY NOTE:") ||
        context.includes("rather than") ||
        context.includes("alternative to")
      )) {
        continue;
      }
      
      violations.push({
        file: relativePath,
        line: lineNum,
        column,
        pattern: patternDef.name,
        severity: patternDef.severity,
        message: patternDef.message,
        context: context.length > 80 ? context.slice(0, 77) + "..." : context,
      });
    }
  }
  
  return violations;
}

function main() {
  console.log("🔍 Scanning for dangerous HTML patterns...\n");
  
  const allViolations: Violation[] = [];
  let totalFiles = 0;
  
  for (const scanDir of SCAN_DIRS) {
    const fullDir = path.join(process.cwd(), scanDir);
    
    if (!fs.existsSync(fullDir)) {
      console.warn(`⚠️  Directory not found: ${scanDir}`);
      continue;
    }
    
    const files = getAllFiles(fullDir, FILE_EXTENSIONS);
    totalFiles += files.length;
    
    for (const file of files) {
      const violations = scanFile(file);
      allViolations.push(...violations);
    }
  }
  
  console.log(`Scanned ${totalFiles} files.\n`);
  
  if (allViolations.length === 0) {
    console.log("✅ No dangerous HTML patterns found!");
    process.exit(0);
  }
  
  // Group violations by file
  const byFile = new Map<string, Violation[]>();
  for (const v of allViolations) {
    if (!byFile.has(v.file)) {
      byFile.set(v.file, []);
    }
    byFile.get(v.file)!.push(v);
  }
  
  // Print violations
  console.log(`❌ Found ${allViolations.length} violation(s) in ${byFile.size} file(s):\n`);
  
  for (const [file, violations] of byFile) {
    console.log(`📄 ${file}`);
    
    for (const v of violations) {
      const icon = v.severity === "ERROR" ? "🚨" : "⚠️";
      console.log(`   ${icon} Line ${v.line}: ${v.pattern}`);
      console.log(`      ${v.message}`);
      console.log(`      Context: ${v.context}`);
      console.log();
    }
  }
  
  // Summary
  const errors = allViolations.filter(v => v.severity === "ERROR").length;
  const warnings = allViolations.filter(v => v.severity === "WARNING").length;
  
  console.log("─".repeat(60));
  console.log(`Summary: ${errors} error(s), ${warnings} warning(s)`);
  console.log();
  console.log("To fix these issues:");
  console.log("  1. Use React's default text rendering (automatic XSS protection)");
  console.log("  2. Use renderSafeText() from src/security/safeRender.tsx");
  console.log("  3. Use renderSafeMarkdown() for markdown content");
  console.log("  4. For CSS injection, use generateCssVariables() helper");
  console.log();
  
  // Exit with error if any ERROR-level violations
  if (errors > 0) {
    process.exit(1);
  }
  
  process.exit(0);
}

main();
