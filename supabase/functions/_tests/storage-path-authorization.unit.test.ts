/**
 * Storage Path Authorization Unit Tests
 *
 * Covers the pure helpers used by `extract-case-note-text` to decide whether
 * a caller may read an object from the `review-documents` bucket.
 *
 * @example Run tests:
 * deno test supabase/functions/_tests/storage-path-authorization.unit.test.ts
 */

import {
  assert,
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

import {
  isPathWithinMemberTenants,
  parseReviewDocumentPath,
  sessionIdMatchesPath,
} from "../_shared/storage-path-authorization.ts";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const SESSION = "33333333-3333-4333-8333-333333333333";
const DOC = "44444444-4444-4444-8444-444444444444";
const GOOD = `${TENANT_A}/${SESSION}/${DOC}.pdf`;

// ============================================================
// parseReviewDocumentPath
// ============================================================

Deno.test("parse: canonical <tenant>/<session>/<doc>.pdf is accepted", () => {
  const parsed = parseReviewDocumentPath(GOOD);
  assert(parsed, "expected a parsed path");
  assertEquals(parsed.tenantId, TENANT_A);
  assertEquals(parsed.sessionId, SESSION);
  assertEquals(parsed.reviewDocumentId, DOC);
  assertEquals(parsed.extension, "pdf");
  assertEquals(parsed.normalizedPath, GOOD);
});

Deno.test("parse: surrounding whitespace is trimmed and case is normalised", () => {
  const parsed = parseReviewDocumentPath(`  ${GOOD.toUpperCase()}  `);
  assert(parsed);
  assertEquals(parsed.normalizedPath, GOOD);
});

Deno.test("parse: every supported extension is accepted", () => {
  for (const ext of ["pdf", "txt", "md", "docx"]) {
    const parsed = parseReviewDocumentPath(`${TENANT_A}/${SESSION}/${DOC}.${ext}`);
    assert(parsed, `expected .${ext} to parse`);
    assertEquals(parsed.extension, ext);
  }
});

Deno.test("parse: rejects non-string, empty and oversized input", () => {
  assertStrictEquals(parseReviewDocumentPath(undefined), null);
  assertStrictEquals(parseReviewDocumentPath(null), null);
  assertStrictEquals(parseReviewDocumentPath(42), null);
  assertStrictEquals(parseReviewDocumentPath(""), null);
  assertStrictEquals(parseReviewDocumentPath("   "), null);
  assertStrictEquals(parseReviewDocumentPath("a".repeat(600)), null);
});

Deno.test("parse: rejects traversal, encoding and separator tricks", () => {
  const bad = [
    `../${SESSION}/${DOC}.pdf`,
    `${TENANT_A}/../${SESSION}/${DOC}.pdf`,
    `${TENANT_A}/${SESSION}/../${DOC}.pdf`,
    `/${GOOD}`,
    `${GOOD}/`,
    `${TENANT_A}\\${SESSION}\\${DOC}.pdf`,
    `${TENANT_A}%2F${SESSION}/${DOC}.pdf`,
    `${TENANT_A}/${SESSION}/${DOC}.pdf\0`,
    `${TENANT_A}//${DOC}.pdf`,
  ];
  for (const candidate of bad) {
    assertStrictEquals(parseReviewDocumentPath(candidate), null, `should reject: ${candidate}`);
  }
});

Deno.test("parse: rejects wrong depth, non-UUID segments and unknown extensions", () => {
  const bad = [
    `${DOC}.pdf`,
    `${TENANT_A}/${DOC}.pdf`,
    `${TENANT_A}/${SESSION}/extra/${DOC}.pdf`,
    `not-a-uuid/${SESSION}/${DOC}.pdf`,
    `${TENANT_A}/not-a-uuid/${DOC}.pdf`,
    `${TENANT_A}/${SESSION}/notes.pdf`,
    `${TENANT_A}/${SESSION}/${DOC}`,
    `${TENANT_A}/${SESSION}/${DOC}.exe`,
    `${TENANT_A}/${SESSION}/${DOC}.pdf.txt`,
  ];
  for (const candidate of bad) {
    assertStrictEquals(parseReviewDocumentPath(candidate), null, `should reject: ${candidate}`);
  }
});

// ============================================================
// isPathWithinMemberTenants
// ============================================================

Deno.test("membership: allowed when caller belongs to the path's tenant", () => {
  const parsed = parseReviewDocumentPath(GOOD)!;
  assertEquals(isPathWithinMemberTenants(parsed, [TENANT_B, TENANT_A]), true);
  assertEquals(isPathWithinMemberTenants(parsed, [TENANT_A.toUpperCase()]), true);
});

Deno.test("membership: denied for other tenants, empty lists and junk", () => {
  const parsed = parseReviewDocumentPath(GOOD)!;
  assertEquals(isPathWithinMemberTenants(parsed, [TENANT_B]), false);
  assertEquals(isPathWithinMemberTenants(parsed, []), false);
  // deno-lint-ignore no-explicit-any
  assertEquals(isPathWithinMemberTenants(parsed, [null as any, 7 as any]), false);
});

// ============================================================
// sessionIdMatchesPath
// ============================================================

Deno.test("session: absent body session defers to the path", () => {
  const parsed = parseReviewDocumentPath(GOOD)!;
  assertEquals(sessionIdMatchesPath(parsed, undefined), true);
  assertEquals(sessionIdMatchesPath(parsed, null), true);
  assertEquals(sessionIdMatchesPath(parsed, ""), true);
});

Deno.test("session: body session must agree with the path when present", () => {
  const parsed = parseReviewDocumentPath(GOOD)!;
  assertEquals(sessionIdMatchesPath(parsed, SESSION), true);
  assertEquals(sessionIdMatchesPath(parsed, ` ${SESSION.toUpperCase()} `), true);
  assertEquals(sessionIdMatchesPath(parsed, DOC), false);
  assertEquals(sessionIdMatchesPath(parsed, 123), false);
});

// ============================================================
// parseKbDocumentPath / kbPathMatchesRow / parseTemplatePath
// ============================================================

import {
  kbPathMatchesRow,
  parseKbDocumentPath,
  parseTemplatePath,
} from "../_shared/storage-path-authorization.ts";

const KB_GOOD = `tenants/${TENANT_A}/kb_documents/${DOC}/Intake_Policy-2026.pdf`;

Deno.test("kb: canonical tenants/<t>/kb_documents/<d>/<name>.pdf is accepted", () => {
  const p = parseKbDocumentPath(KB_GOOD);
  assert(p);
  assertEquals(p.tenantId, TENANT_A);
  assertEquals(p.kbDocumentId, DOC);
  assertEquals(p.fileName, "Intake_Policy-2026.pdf");
  assertEquals(p.normalizedPath, KB_GOOD);
});

Deno.test("kb: rejects prefix-only matches, wrong folders, depth and names", () => {
  const bad = [
    `tenants/${TENANT_A}/anything.pdf`,                                   // depth 3
    `tenants/${TENANT_A}/kb_documents/${DOC}/deep/file.pdf`,              // depth 6
    `tenants/${TENANT_A}/kb_docs/${DOC}/file.pdf`,                        // wrong folder
    `tenant/${TENANT_A}/kb_documents/${DOC}/file.pdf`,                    // wrong root
    `tenants/${TENANT_A}x/kb_documents/${DOC}/file.pdf`,                  // uuid-like prefix
    `tenants/${TENANT_A}/kb_documents/not-a-uuid/file.pdf`,
    `tenants/${TENANT_A}/kb_documents/${DOC}/file.exe`,
    `tenants/${TENANT_A}/kb_documents/${DOC}/file.pdf.txt`,
    `tenants/${TENANT_A}/kb_documents/${DOC}/..pdf`,
    `tenants/${TENANT_A}/kb_documents/${DOC}/`,
    `/${KB_GOOD}`,
    `tenants/${TENANT_A}/kb_documents/../${DOC}/file.pdf`,
    `tenants%2F${TENANT_A}/kb_documents/${DOC}/file.pdf`,
    `tenants\\${TENANT_A}\\kb_documents\\${DOC}\\file.pdf`,
  ];
  for (const c of bad) assertStrictEquals(parseKbDocumentPath(c), null, `should reject: ${c}`);
});

Deno.test("kb: row match requires both tenant and document id", () => {
  const p = parseKbDocumentPath(KB_GOOD)!;
  assertEquals(kbPathMatchesRow(p, { tenant_id: TENANT_A, id: DOC }), true);
  assertEquals(kbPathMatchesRow(p, { tenant_id: TENANT_A.toUpperCase(), id: DOC }), true);
  assertEquals(kbPathMatchesRow(p, { tenant_id: TENANT_B, id: DOC }), false);
  assertEquals(kbPathMatchesRow(p, { tenant_id: TENANT_A, id: SESSION }), false);
  assertEquals(kbPathMatchesRow(p, {}), false);
  assertEquals(kbPathMatchesRow(p, { tenant_id: null, id: DOC }), false);
});

Deno.test("templates: exactly <tenant>/<file>.pdf", () => {
  const good = parseTemplatePath(`${TENANT_A}/${DOC}.pdf`);
  assert(good);
  assertEquals(good.tenantId, TENANT_A);
  assertEquals(good.fileId, DOC);
  assertEquals(good.normalizedPath, `${TENANT_A}/${DOC}.pdf`);
  const bad = [
    `${DOC}.pdf`,
    `${TENANT_A}/${DOC}.txt`,
    `${TENANT_A}/${DOC}`,
    `${TENANT_A}/sub/${DOC}.pdf`,
    `${TENANT_A}/notes.pdf`,
    `${TENANT_A}-extra/${DOC}.pdf`,
    `../${DOC}.pdf`,
  ];
  for (const c of bad) assertStrictEquals(parseTemplatePath(c), null, `should reject: ${c}`);
});

Deno.test("kb: rejects dot-prefixed file names (empty stem, hidden-style)", () => {
  const prefix = `tenants/${TENANT_A}/kb_documents/${DOC}/`;
  const bad = [
    ".pdf",
    "..pdf",
    "...pdf",
    ".hidden.pdf",
    "..hidden.pdf",
    "._resource-fork.pdf",
    ".-dash.pdf",
  ];
  for (const name of bad) {
    assertStrictEquals(parseKbDocumentPath(prefix + name), null, `should reject: ${name}`);
  }
});

Deno.test("kb: ordinary PDF names (including inner and trailing dots) still parse", () => {
  const prefix = `tenants/${TENANT_A}/kb_documents/${DOC}/`;
  const good = [
    "a.pdf",
    "_draft.pdf",
    "-v2.pdf",
    "report.final.pdf",
    "notes..pdf",
    "Intake_Policy-2026.pdf",
    "document.pdf",
    `${"a".repeat(204)}.pdf`,
  ];
  for (const name of good) {
    const p = parseKbDocumentPath(prefix + name);
    assert(p, `should accept: ${name}`);
    assertEquals(p.fileName, name);
    assertEquals(p.tenantId, TENANT_A);
    assertEquals(p.kbDocumentId, DOC);
  }
  // Length bound unchanged: 205-char stem is still rejected.
  assertStrictEquals(parseKbDocumentPath(`${prefix}${"a".repeat(205)}.pdf`), null);
  // UUID checks unchanged for an otherwise valid name.
  assertStrictEquals(
    parseKbDocumentPath(`tenants/not-a-uuid/kb_documents/${DOC}/a.pdf`),
    null,
  );
  assertStrictEquals(
    parseKbDocumentPath(`tenants/${TENANT_A}/kb_documents/${DOC}x/a.pdf`),
    null,
  );
});
