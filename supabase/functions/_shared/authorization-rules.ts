/**
 * Authorization Rules — pure, side-effect-free decision helpers
 *
 * These functions contain no I/O so they can be unit tested with `deno test`
 * and reasoned about statically. `require-user.ts` wraps them with the
 * network calls (GoTrue token check, tenant_users / user_roles lookups).
 *
 * Principles:
 *   - Identity comes from a verified user JWT, never from the request body.
 *   - Tenant comes from tenant_users membership, never from body or headers.
 *   - Object-level access (a session, a document) is decided per function by
 *     comparing the object's recorded tenant/owner to the caller.
 *   - "Not found" and "not yours" return the same outcome so callers cannot
 *     probe for existence.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CallerIdentity {
  /** auth.users.id of the verified caller. */
  userId: string;
  /** Lower-cased tenant ids from tenant_users. */
  tenantIds: readonly string[];
  /** Roles from user_roles (global, not per-tenant). */
  roles: readonly string[];
  /** profiles.status, when loaded. */
  profileStatus?: string | null;
}

export interface SessionOwnership {
  id?: unknown;
  tenant_id?: unknown;
  user_id?: unknown;
}

export type AccessDecision =
  | { allowed: true; tenantId: string }
  | { allowed: false; reason: "not_found" | "forbidden" };

/** Extract a bearer token from an Authorization header value; null if absent/malformed. */
export function parseBearerToken(headerValue: string | null | undefined): string | null {
  if (!headerValue) return null;
  const m = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  if (!m) return null;
  const token = m[1].trim();
  // A JWT is three dot-separated base64url segments; reject anything that is not shaped like one.
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  return token;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function callerIsSupervisor(caller: CallerIdentity): boolean {
  return caller.roles.includes("supervisor");
}

export function callerIsActive(caller: CallerIdentity): boolean {
  return caller.profileStatus === "active";
}

/** True when the caller belongs to the given tenant (case-insensitive uuid compare). */
export function callerInTenant(caller: CallerIdentity, tenantId: unknown): boolean {
  if (!isUuid(tenantId)) return false;
  const t = tenantId.toLowerCase();
  return caller.tenantIds.some((id) => id.toLowerCase() === t);
}

/**
 * Decide whether `caller` may act on `session`.
 *
 * Rules (mirror the owner-scoped RLS in 20261005230000_sessions_owner_scoped_rls.sql):
 *   - session must exist and carry a tenant_id the caller belongs to;
 *   - caller must own it (session.user_id = caller.userId), OR
 *     opts.allowSupervisor is true and the caller holds the supervisor role.
 * A missing session and a foreign-tenant session both yield "not_found".
 */
export function decideSessionAccess(
  caller: CallerIdentity,
  session: SessionOwnership | null | undefined,
  opts: { allowSupervisor?: boolean } = {},
): AccessDecision {
  if (!session) return { allowed: false, reason: "not_found" };
  if (!callerInTenant(caller, session.tenant_id)) return { allowed: false, reason: "not_found" };
  const tenantId = (session.tenant_id as string).toLowerCase();
  const owner = typeof session.user_id === "string" && session.user_id === caller.userId;
  if (owner) return { allowed: true, tenantId };
  if (opts.allowSupervisor && callerIsSupervisor(caller)) return { allowed: true, tenantId };
  return { allowed: false, reason: "forbidden" };
}

/**
 * Resolve the tenant a tenant-keyed request should operate on.
 *   - If the body names a tenant, it must be one the caller belongs to.
 *   - If the body names none and the caller has exactly one tenant, use it.
 *   - Otherwise reject (ambiguous or foreign).
 */
export function resolveRequestTenant(
  caller: CallerIdentity,
  requestedTenantId: unknown,
): { ok: true; tenantId: string } | { ok: false; reason: "forbidden" | "ambiguous" | "none" } {
  if (caller.tenantIds.length === 0) return { ok: false, reason: "none" };
  if (requestedTenantId !== undefined && requestedTenantId !== null && requestedTenantId !== "") {
    return callerInTenant(caller, requestedTenantId)
      ? { ok: true, tenantId: (requestedTenantId as string).toLowerCase() }
      : { ok: false, reason: "forbidden" };
  }
  if (caller.tenantIds.length === 1) return { ok: true, tenantId: caller.tenantIds[0].toLowerCase() };
  return { ok: false, reason: "ambiguous" };
}
