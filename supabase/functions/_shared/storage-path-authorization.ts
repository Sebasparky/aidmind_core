/**
 * Storage Path Authorization — canonical object-key parsing
 *
 * Pure helpers (no Deno / network access) so they can be unit tested.
 *
 * Canonical layouts (mirrored by the SQL policies in
 * supabase/migrations/20261005220000_harden_storage_policies.sql):
 *
 *   review-documents : `${tenant_id}/${session_id}/${review_document_id}.<ext>`
 *                      (written by upload-review-document)
 *   kb-documents     : `tenants/${tenant_id}/kb_documents/${kb_document_id}/${name}.pdf`
 *                      (written by src/lib/kb/kbUploadService.ts)
 *   templates        : `${tenant_id}/${file_id}.pdf`
 *                      (written by select-template)
 *
 * A caller may only touch an object when the path parses to the exact shape
 * AND the tenant segment matches a tenant the caller belongs to (or, for
 * service-role readers, the tenant recorded on the owning DB row). Parsing is
 * exact-segment, never prefix matching, so a legitimate tenant id followed by
 * arbitrary depth, a uuid-like prefix, encoded separators or case tricks do
 * not pass.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// `<uuid>.<ext>` — the extension list mirrors what extract-case-note-text handles.
const OBJECT_NAME_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(pdf|txt|md|docx)$/i;

export interface ReviewDocumentPath {
  /** Lower-cased tenant UUID (first path segment). */
  tenantId: string;
  /** Lower-cased session UUID (second path segment). */
  sessionId: string;
  /** Lower-cased review_document UUID (file stem of the third segment). */
  reviewDocumentId: string;
  /** Lower-cased file extension without the dot. */
  extension: string;
  /** Normalised path safe to hand to storage. */
  normalizedPath: string;
}

/**
 * Parse and validate a `review-documents` object key.
 * Returns null for anything that is not exactly `<uuid>/<uuid>/<uuid>.<ext>`.
 * Rejects leading/trailing slashes, backslashes, `.` / `..` segments, URL
 * encoding tricks and any extra depth.
 */
export function parseReviewDocumentPath(input: unknown): ReviewDocumentPath | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (raw.length === 0 || raw.length > 512) return null;
  if (raw.includes("\\") || raw.includes("%") || raw.includes("\0")) return null;
  if (raw.startsWith("/") || raw.endsWith("/")) return null;

  const segments = raw.split("/");
  if (segments.length !== 3) return null;

  const [tenantSeg, sessionSeg, objectSeg] = segments;
  if (!UUID_RE.test(tenantSeg) || !UUID_RE.test(sessionSeg)) return null;

  const objectMatch = OBJECT_NAME_RE.exec(objectSeg);
  if (!objectMatch) return null;

  const tenantId = tenantSeg.toLowerCase();
  const sessionId = sessionSeg.toLowerCase();
  const reviewDocumentId = objectMatch[1].toLowerCase();
  const extension = objectMatch[2].toLowerCase();

  return {
    tenantId,
    sessionId,
    reviewDocumentId,
    extension,
    normalizedPath: `${tenantId}/${sessionId}/${reviewDocumentId}.${extension}`,
  };
}

/**
 * True when the caller's tenant memberships include the tenant that owns
 * the object. Comparison is case-insensitive; an empty membership list
 * always denies.
 */
export function isPathWithinMemberTenants(
  path: ReviewDocumentPath,
  memberTenantIds: ReadonlyArray<string>,
): boolean {
  if (!memberTenantIds || memberTenantIds.length === 0) return false;
  return memberTenantIds.some(
    (id) => typeof id === "string" && id.toLowerCase() === path.tenantId,
  );
}

/**
 * When a request body also names a session, it must agree with the path.
 * A missing/null body session is allowed (the path is authoritative).
 */
export function sessionIdMatchesPath(
  path: ReviewDocumentPath,
  bodySessionId: unknown,
): boolean {
  if (bodySessionId === undefined || bodySessionId === null || bodySessionId === "") {
    return true;
  }
  if (typeof bodySessionId !== "string") return false;
  return bodySessionId.trim().toLowerCase() === path.sessionId;
}

// ------------------------------------------------------------
// Generic key hygiene shared by the bucket-specific parsers
// ------------------------------------------------------------

function cleanSegments(input: unknown): string[] | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (raw.length === 0 || raw.length > 512) return null;
  if (raw.includes("\\") || raw.includes("%") || raw.includes("\0")) return null;
  if (raw.startsWith("/") || raw.endsWith("/")) return null;
  const segments = raw.split("/");
  if (segments.some((s) => s.length === 0 || s === "." || s === "..")) return null;
  return segments;
}

// KB file names: 1–204 char stem + `.pdf`. The first character must not be a
// dot, so `.pdf`, `..pdf` and hidden-style names (`.hidden.pdf`) are rejected.
// Mirrored by the kb-documents INSERT policy in
// supabase/migrations/20261005220000_harden_storage_policies.sql and produced
// by sanitizeForStorageKey in src/lib/kb/kbUploadService.ts.
const PDF_NAME_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,203}\.pdf$/;
const UUID_PDF_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.pdf$/i;

export interface KbDocumentPath {
  tenantId: string;
  kbDocumentId: string;
  fileName: string;
  normalizedPath: string;
}

/**
 * Parse a `kb-documents` key: exactly `tenants/<uuid>/kb_documents/<uuid>/<name>.pdf`.
 * Returns null for anything else.
 */
export function parseKbDocumentPath(input: unknown): KbDocumentPath | null {
  const segments = cleanSegments(input);
  if (!segments || segments.length !== 5) return null;
  const [root, tenantSeg, folder, docSeg, fileName] = segments;
  if (root !== "tenants" || folder !== "kb_documents") return null;
  if (!UUID_RE.test(tenantSeg) || !UUID_RE.test(docSeg)) return null;
  if (!PDF_NAME_RE.test(fileName)) return null;
  const tenantId = tenantSeg.toLowerCase();
  const kbDocumentId = docSeg.toLowerCase();
  return {
    tenantId,
    kbDocumentId,
    fileName,
    normalizedPath: `tenants/${tenantId}/kb_documents/${kbDocumentId}/${fileName}`,
  };
}

/**
 * True when a kb-documents key belongs to the given DB row (tenant AND
 * document id must both match). Use before any service-role download or
 * signed-URL generation that is driven by a client-writable `file_path`.
 */
export function kbPathMatchesRow(
  path: KbDocumentPath,
  row: { tenant_id?: unknown; id?: unknown },
): boolean {
  return (
    typeof row.tenant_id === "string" &&
    typeof row.id === "string" &&
    row.tenant_id.toLowerCase() === path.tenantId &&
    row.id.toLowerCase() === path.kbDocumentId
  );
}

export interface TemplatePath {
  tenantId: string;
  fileId: string;
  normalizedPath: string;
}

/** Parse a `templates` key: exactly `<uuid>/<uuid>.pdf`. */
export function parseTemplatePath(input: unknown): TemplatePath | null {
  const segments = cleanSegments(input);
  if (!segments || segments.length !== 2) return null;
  const [tenantSeg, fileSeg] = segments;
  if (!UUID_RE.test(tenantSeg)) return null;
  const m = UUID_PDF_RE.exec(fileSeg);
  if (!m) return null;
  const tenantId = tenantSeg.toLowerCase();
  const fileId = m[1].toLowerCase();
  return { tenantId, fileId, normalizedPath: `${tenantId}/${fileId}.pdf` };
}
