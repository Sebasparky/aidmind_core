/**
 * require-user — caller authentication + tenant membership for edge functions
 *
 * Usage (inside Deno.serve handler, after creating the service-role client):
 *
 *   const auth = await requireUser(req, supabase);
 *   if (!auth.ok) return json(auth.status, { success: false, error: auth.error });
 *   const access = await assertSessionAccess(supabase, auth.caller, sessionId, { allowSupervisor: true });
 *   if (!access.ok) return json(access.status, { success: false, error: access.error });
 *   // access.session is the row, access.tenantId the verified tenant
 *
 * What this does NOT do: decide object-level access on its own. Every function
 * must still compare the object it is about to touch (session, template,
 * document, artifact) against `caller`, using the pure rules in
 * authorization-rules.ts, before any privileged read or write.
 *
 * verify_jwt=true at the gateway is not caller authentication: the public anon
 * key is itself a valid project JWT. This helper validates the token with
 * GoTrue (auth.getUser), which rejects the anon key and service-role keys.
 */

import {
  type CallerIdentity,
  decideSessionAccess,
  isUuid,
  parseBearerToken,
  resolveRequestTenant,
} from "./authorization-rules.ts";

export type { CallerIdentity } from "./authorization-rules.ts";

// deno-lint-ignore no-explicit-any
type ServiceClient = any;

export type RequireUserResult =
  | { ok: true; caller: CallerIdentity }
  | { ok: false; status: 401 | 403 | 500; error: string };

export interface RequireUserOptions {
  /** Load user_roles so caller.roles is populated (default true). */
  loadRoles?: boolean;
  /** Reject callers with no tenant membership (default true). */
  requireTenant?: boolean;
  /** Reject callers whose profile is not 'active' (default true). */
  requireActiveProfile?: boolean;
}

export async function requireUser(
  req: Request,
  supabase: ServiceClient,
  opts: RequireUserOptions = {},
): Promise<RequireUserResult> {
  const { loadRoles = true, requireTenant = true, requireActiveProfile = true } = opts;

  const token = parseBearerToken(req.headers.get("Authorization") ?? req.headers.get("authorization"));
  if (!token) return { ok: false, status: 401, error: "Authentication required" };

  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  const userId: string | undefined = userData?.user?.id;
  if (userErr || !userId) return { ok: false, status: 401, error: "Invalid or expired session" };

  const [membershipRes, rolesRes, profileRes] = await Promise.all([
    supabase.from("tenant_users").select("tenant_id").eq("user_id", userId),
    loadRoles
      ? supabase.from("user_roles").select("role").eq("user_id", userId)
      : Promise.resolve({ data: [], error: null }),
    requireActiveProfile
      ? supabase.from("profiles").select("status").eq("user_id", userId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (membershipRes.error || rolesRes.error || profileRes.error) {
    console.error("[require-user] lookup failed:",
      membershipRes.error?.message ?? rolesRes.error?.message ?? profileRes.error?.message);
    return { ok: false, status: 500, error: "Authorization check failed" };
  }

  const tenantIds = ((membershipRes.data ?? []) as Array<{ tenant_id: unknown }>)
    .map((r) => r.tenant_id)
    .filter(isUuid)
    .map((t) => t.toLowerCase());
  const roles = ((rolesRes.data ?? []) as Array<{ role: unknown }>)
    .map((r) => r.role)
    .filter((r): r is string => typeof r === "string");
  const profileStatus = requireActiveProfile
    ? ((profileRes.data as { status?: string | null } | null)?.status ?? null)
    : undefined;

  if (requireActiveProfile && profileStatus !== "active") {
    return { ok: false, status: 403, error: "Account is not active" };
  }
  if (requireTenant && tenantIds.length === 0) {
    return { ok: false, status: 403, error: "No tenant membership" };
  }

  return { ok: true, caller: { userId, tenantIds, roles, profileStatus } };
}

export type SessionAccessResult =
  | { ok: true; tenantId: string; session: Record<string, unknown> & { id: string; tenant_id: string; user_id: string | null } }
  | { ok: false; status: 400 | 403 | 404 | 500; error: string };

export interface SessionAccessOptions {
  /** Let a supervisor act on sessions they do not own (default false). */
  allowSupervisor?: boolean;
  /** Extra columns to select from sessions (id, tenant_id, user_id always included). */
  select?: string;
  /** Which column the id refers to (default "id"). */
  keyColumn?: "id" | "session_id";
}

/**
 * Load a session with the service role and apply decideSessionAccess.
 * Missing and foreign-tenant sessions both return 404 (no existence oracle).
 */
export async function assertSessionAccess(
  supabase: ServiceClient,
  caller: CallerIdentity,
  sessionId: unknown,
  opts: SessionAccessOptions = {},
): Promise<SessionAccessResult> {
  const keyColumn = opts.keyColumn ?? "id";
  if (keyColumn === "id" && !isUuid(sessionId)) {
    return { ok: false, status: 400, error: "session_id must be a UUID" };
  }
  if (keyColumn === "session_id" && (typeof sessionId !== "string" || sessionId.length === 0 || sessionId.length > 128)) {
    return { ok: false, status: 400, error: "session_id is required" };
  }

  const columns = ["id", "tenant_id", "user_id", ...(opts.select ? [opts.select] : [])].join(", ");
  const { data: session, error } = await supabase
    .from("sessions")
    .select(columns)
    .eq(keyColumn, sessionId)
    .maybeSingle();

  if (error) {
    console.error("[require-user] session lookup failed:", error.message);
    return { ok: false, status: 500, error: "Failed to load session" };
  }

  const decision = decideSessionAccess(caller, session, { allowSupervisor: opts.allowSupervisor });
  if (!decision.allowed) {
    return decision.reason === "forbidden"
      ? { ok: false, status: 403, error: "Not permitted for this session" }
      : { ok: false, status: 404, error: "Session not found" };
  }
  return { ok: true, tenantId: decision.tenantId, session };
}

/** Resolve the tenant for a tenant-keyed request; see resolveRequestTenant. */
export function requireTenantFor(
  caller: CallerIdentity,
  requestedTenantId: unknown,
): { ok: true; tenantId: string } | { ok: false; status: 400 | 403; error: string } {
  const r = resolveRequestTenant(caller, requestedTenantId);
  if (r.ok) return r;
  if (r.reason === "ambiguous") return { ok: false, status: 400, error: "tenant_id is required" };
  return { ok: false, status: 403, error: "Not permitted for this tenant" };
}

/**
 * requireServiceCaller — for functions that are only ever called server-to-server
 * (e.g. ensure-phase2-schema, invoked by generate-guidance-phase1 with the
 * service-role key as bearer). A user JWT is NOT accepted here.
 * Comparison is constant-time over equal-length buffers.
 */
export function requireServiceCaller(req: Request): { ok: true } | { ok: false; status: 401; error: string } {
  const header = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  const expected = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!m || expected.length === 0) return { ok: false, status: 401, error: "Service authentication required" };
  const a = new TextEncoder().encode(m[1].trim());
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return { ok: false, status: 401, error: "Service authentication required" };
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0 ? { ok: true } : { ok: false, status: 401, error: "Service authentication required" };
}
