// deno-lint-ignore-file no-explicit-any
/**
 * runtime-verify-local.ts — runtime authorization verification against the
 * LOCAL Supabase stack only (supabase start). Synthetic fixtures, real
 * PostgREST / Storage / GoTrue / edge-runtime requests under real user JWTs.
 *
 * Credential separation:
 *   SETUP  (service role)  — creates/tears down fixtures, inserts labelled
 *                            legacy/attribution eye_events rows, and drives the
 *                            server-side approval consumer (checkLLMAuthorization),
 *                            which runs with the service role in production too.
 *                            The service role is NEVER used to show that a user
 *                            policy passes or fails.
 *   USERS  (anon apikey + user access token from password sign-in)
 *   ANON   (anon apikey only) and NO-KEY (no apikey, no Authorization)
 *
 * Keys come from `supabase status -o env` and are never printed. The script
 * refuses to run unless the API URL is 127.0.0.1/localhost:54321, or — when
 * SUPABASE_WORKDIR is set (`supabase --workdir <dir> status`) — the loopback
 * port that workdir's stack reports.
 *
 * Outcome classification (every rejection check states which one it saw):
 *   allowed   2xx with data
 *   filtered  2xx with no rows (RLS USING hid the rows; an UPDATE/DELETE no-op)
 *   denied    authorization denial: 401/403, PostgREST code 42501, storage
 *             "row-level security"/statusCode 403, function "permission denied"
 *   rejected  input rejected before authorization (storage key validation,
 *             handler 400) — reported separately from denied
 *   error     SQL error / 5xx / unexpected code (e.g. 2201B, 42883, PGRST202).
 *             An error never counts as a successful denial.
 * Checks whose positive prerequisite failed are BLOCKED, not PASS.
 *
 * Run from the repo root:
 *   deno run --no-lock --node-modules-dir=none --allow-run=supabase --allow-env \
 *     --allow-net=127.0.0.1:54321,localhost:54321 --allow-read=. \
 *     scripts/runtime-verify-local.ts
 *
 * Against the isolated demo stack (scripts/demo-stack, API port 55421):
 *   SUPABASE_WORKDIR=.cache/demo-stack deno run --no-lock --node-modules-dir=none \
 *     --allow-run=supabase --allow-env --allow-net=127.0.0.1:55421,localhost:55421 \
 *     --allow-read=. scripts/runtime-verify-local.ts
 *
 * Env: SUPABASE_WORKDIR=<dir> passes `--workdir <dir>` to the supabase CLI.
 * KEEP_FIXTURES=1 skips teardown. VERBOSE=1 prints redacted response
 * snippets for every check.
 * Exit code: 0 only when there is no FAIL, FINDING or BLOCKED; 1 otherwise;
 * 2 on setup/guard errors.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { checkLLMAuthorization } from "../supabase/functions/_shared/llm-authorization.ts";
import { isServerVerifiedEvent } from "../src/lib/eye/clientEventContract.ts";

// ───────────────────────── result recording ─────────────────────────

type Status = "PASS" | "FAIL" | "FINDING" | "BLOCKED" | "OBSERVE" | "SKIP";
interface Result { section: string; name: string; status: Status; detail: string }
const results: Result[] = [];
let section = "";
const VERBOSE = Deno.env.get("VERBOSE") === "1";
const NON_GREEN: Status[] = ["FAIL", "FINDING", "BLOCKED"];

function redact(s: string): string {
  return s
    .replace(/eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, "[REDACTED_JWT]")
    .replace(/sb_(secret|publishable)_[A-Za-z0-9_-]+/g, "[REDACTED_KEY]");
}
function snip(r: Res | null | undefined, n = 160): string {
  if (!r) return "";
  return `HTTP ${r.status} ${redact(r.text).replace(/\s+/g, " ").slice(0, n)}`;
}
function record(name: string, status: Status, detail = "") {
  results.push({ section, name, status, detail: redact(detail) });
  console.log(`  [${status.padEnd(7)}] ${name}${detail && (VERBOSE || status !== "PASS") ? `  — ${redact(detail)}` : ""}`);
}
function check(name: string, ok: boolean, detail = "") {
  record(name, ok ? "PASS" : "FAIL", detail);
}
/** Record BLOCKED when a prerequisite is missing; returns true when the check may run. */
function need(name: string, prereqs: Record<string, unknown>): boolean {
  const missing = Object.entries(prereqs).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    record(name, "BLOCKED", `prerequisite missing: ${missing.join(", ")}`);
    return false;
  }
  return true;
}
function begin(title: string) {
  section = title;
  console.log(`\n== ${title}`);
}

// ───────────────────────── HTTP ─────────────────────────

interface Res { status: number; text: string; body: any; headers: Headers }

let API = "";
let ANON = "";
let SERVICE = "";

/**
 * Only the headers listed here are sent. Deno's fetch adds no credentials,
 * cookies or Authorization of its own, so a call with neither apikey nor
 * bearer is genuinely unauthenticated.
 */
async function http(
  method: string,
  path: string,
  opts: { apikey?: string | null; bearer?: string | null; body?: unknown; raw?: BodyInit; headers?: Record<string, string> } = {},
): Promise<Res> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.apikey) headers["apikey"] = opts.apikey;
  if (opts.bearer) headers["Authorization"] = `Bearer ${opts.bearer}`;
  let body: BodyInit | undefined;
  if (opts.raw !== undefined) body = opts.raw;
  else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers["Content-Type"] ??= "application/json";
  }
  let resp: Response;
  try {
    resp = await fetch(`${API}${path}`, { method, headers, body, credentials: "omit" });
  } catch (e) {
    return { status: 0, text: `fetch failed: ${(e as Error).message}`, body: null, headers: new Headers() };
  }
  const text = await resp.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  return { status: resp.status, text, body: parsed, headers: resp.headers };
}

const ok2xx = (r: Res) => r.status >= 200 && r.status < 300;
const rows = (r: Res): any[] => (ok2xx(r) && Array.isArray(r.body) ? r.body : []);

type Outcome = "allowed" | "filtered" | "denied" | "rejected" | "error";

/** PostgREST (tables and RPC). */
function pg(r: Res): Outcome {
  if (r.status === 0 || r.status >= 500) return "error";
  if (ok2xx(r)) return Array.isArray(r.body) && r.body.length === 0 ? "filtered" : "allowed";
  const code = r.body && typeof r.body === "object" ? r.body.code : undefined;
  if (code === "42501" || /permission denied/i.test(r.text)) return "denied";
  if ((r.status === 401 || r.status === 403) && (code === undefined || /^PGRST3/.test(String(code)))) return "denied";
  return "error";
}
/** Storage API. */
function st(r: Res): Outcome | "not-found" {
  if (r.status === 0 || r.status >= 500) return "error";
  if (ok2xx(r)) return Array.isArray(r.body) && r.body.length === 0 ? "filtered" : "allowed";
  const b = r.body && typeof r.body === "object" ? r.body : {};
  const msg = String(b.message ?? r.text);
  const sc = String(b.statusCode ?? r.status);
  if (/regular expression|invalid repetition|does not exist|syntax error|DatabaseError|internal/i.test(msg) || sc.startsWith("5")) return "error";
  if (/row-level security|required property 'authorization'|invalid jwt|jwt (malformed|expired)/i.test(msg) ||
      sc === "401" || sc === "403" || /unauthorized/i.test(String(b.error ?? ""))) return "denied";
  if (/invalid key|InvalidKey/i.test(msg + String(b.error ?? ""))) return "rejected";
  if (sc === "404" || /not_found|not found/i.test(String(b.error ?? "") + msg)) return "not-found";
  return "error";
}
/** Expect an authorization denial (RLS / grants). SQL errors and 5xx fail. */
function expectDenied(name: string, r: Res, kind: "pg" | "storage" = "pg") {
  const o = kind === "pg" ? pg(r) : st(r);
  record(name, o === "denied" ? "PASS" : "FAIL", `${o}: ${snip(r, 120)}`);
}
/** Expect a storage rejection: RLS denial or pre-policy key validation (labelled). */
function expectStorageRejected(name: string, r: Res) {
  const o = st(r);
  record(name, o === "denied" || o === "rejected" ? "PASS" : "FAIL",
    `${o === "rejected" ? "rejected by storage key validation (before policy)" : o}: ${snip(r, 120)}`);
}
/** Expect RLS to hide rows / make a write a no-op (2xx, zero rows). */
function expectFiltered(name: string, r: Res) {
  const o = pg(r);
  record(name, o === "filtered" ? "PASS" : "FAIL", `${o}: ${snip(r, 120)}`);
}
/** Expect a specific RAISE from an RPC (SQL errors such as 42883 fail). */
function expectRaise(name: string, r: Res, code: string) {
  record(name, r.status >= 400 && r.status < 500 && r.text.includes(code) ? "PASS" : "FAIL", snip(r, 140));
}

function b64url(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function jwtPayload(token: string): any {
  try {
    const p = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(p + "=".repeat((4 - (p.length % 4)) % 4)));
  } catch { return null; }
}
function jwtAlg(token: string): string {
  try { return JSON.parse(atob(token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/"))).alg ?? "?"; }
  catch { return "?"; }
}

// ───────────────────────── stack discovery + guard ─────────────────────────

async function loadStack() {
  // SUPABASE_WORKDIR selects an alternate project-local stack (e.g. .cache/demo-stack);
  // the CLI then reads <workdir>/supabase/config.toml instead of the repo's.
  const WORKDIR = Deno.env.get("SUPABASE_WORKDIR");
  const args = [...(WORKDIR ? ["--workdir", WORKDIR] : []), "status", "-o", "env"];
  const out = await new Deno.Command("supabase", { args, stdout: "piped", stderr: "piped" }).output();
  if (!out.success) {
    throw new Error(`supabase status failed: ${redact(new TextDecoder().decode(out.stderr)).slice(0, 300)}`);
  }
  const env: Record<string, string> = {};
  for (const line of new TextDecoder().decode(out.stdout).split("\n")) {
    const m = /^([A-Z_]+)=(?:"(.*)"|(.*))$/.exec(line.trim());
    if (m) env[m[1]] = m[2] ?? m[3] ?? "";
  }
  API = (env.API_URL ?? "").replace(/\/+$/, "");
  ANON = env.ANON_KEY ?? "";
  SERVICE = env.SERVICE_ROLE_KEY ?? "";
  let u: URL;
  try { u = new URL(API); } catch { throw new Error("API_URL missing from supabase status"); }
  // Loopback host is always required. Without SUPABASE_WORKDIR the port must be the
  // default local stack (54321); with it, the port reported by that workdir's status is accepted.
  if (!["127.0.0.1", "localhost"].includes(u.hostname) || (!WORKDIR && u.port !== "54321")) {
    throw new Error(`Refusing to run: API_URL is not the local stack (got host=${u.hostname} port=${u.port})`);
  }
  if (env.DB_URL && !(WORKDIR ? /(127\.0\.0\.1|localhost):\d+\// : /(127\.0\.0\.1|localhost):54322\//).test(env.DB_URL)) {
    throw new Error(`Refusing to run: DB_URL is not a loopback local stack${WORKDIR ? "" : " on 54322"}`);
  }
  if (!ANON || !SERVICE) throw new Error("ANON_KEY / SERVICE_ROLE_KEY missing from supabase status");
  if (jwtPayload(SERVICE)?.role !== "service_role" && !SERVICE.startsWith("sb_secret_")) {
    throw new Error("SERVICE_ROLE_KEY does not look like a service-role key");
  }
}

// ───────────────────────── fixtures (SETUP credentials only) ─────────────────────────

const setup = {
  get: (p: string) => http("GET", p, { apikey: SERVICE, bearer: SERVICE }),
  post: (p: string, body: unknown, prefer = "return=representation") =>
    http("POST", p, { apikey: SERVICE, bearer: SERVICE, body, headers: { Prefer: prefer } }),
  patch: (p: string, body: unknown) =>
    http("PATCH", p, { apikey: SERVICE, bearer: SERVICE, body, headers: { Prefer: "return=representation" } }),
  del: (p: string, body?: unknown) => http("DELETE", p, { apikey: SERVICE, bearer: SERVICE, body }),
};

interface User { key: string; id: string; email: string; token: string }
const RUN = `rv${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = `Rv!${crypto.randomUUID()}`; // per-run, in memory only
const created = { tenants: [] as string[], users: [] as string[], objects: [] as string[] };

function mustOk(label: string, r: Res): Res {
  if (!ok2xx(r)) throw new Error(`setup step failed: ${label}: ${snip(r, 300)}`);
  return r;
}

async function createTenant(tag: string): Promise<string> {
  const r = mustOk(`tenant ${tag}`, await setup.post("/rest/v1/tenants", {
    name: `runtime-verify ${RUN} ${tag}`, slug: `${RUN}-${tag.toLowerCase()}`,
  }));
  const id = r.body[0].id as string;
  created.tenants.push(id);
  return id;
}

async function createUser(key: string): Promise<{ id: string; email: string }> {
  const email = `${RUN}-${key.toLowerCase()}@example.com`;
  const r = mustOk(`user ${key}`, await http("POST", "/auth/v1/admin/users", {
    apikey: SERVICE, bearer: SERVICE,
    body: { email, password: PASSWORD, email_confirm: true, user_metadata: { display_name: `rv ${key}` } },
  }));
  const id = (r.body?.id ?? r.body?.user?.id) as string;
  created.users.push(id);
  return { id, email };
}

async function signIn(key: string, id: string, email: string): Promise<User> {
  const r = mustOk(`sign-in ${key}`, await http("POST", "/auth/v1/token?grant_type=password", {
    apikey: ANON, body: { email, password: PASSWORD },
  }));
  return { key, id, email, token: r.body.access_token as string };
}

async function fixtureEvent(sessionId: string | null, eventData: Record<string, unknown>): Promise<string | null> {
  const r = await setup.post("/rest/v1/eye_events?select=id", {
    session_id: sessionId, event_type: "RV_ATTRIBUTION_FIXTURE", event_data: { ...eventData, rv_fixture: RUN },
  });
  return ok2xx(r) ? (rows(r)[0]?.id ?? null) : null;
}

async function teardown() {
  if (Deno.env.get("KEEP_FIXTURES") === "1") {
    console.log(`\nKEEP_FIXTURES=1 — fixtures for run ${RUN} left in the local database.`);
    return;
  }
  console.log(`\n== Teardown (setup credentials, run ${RUN})`);
  const t = created.tenants;
  try {
    if (created.objects.length) {
      await setup.del("/storage/v1/object/kb-documents", { prefixes: created.objects });
    }
    await setup.del(`/rest/v1/eye_events?event_data->>rv_fixture=eq.${RUN}`);
    if (t.length) {
      const inList = `in.(${t.join(",")})`;
      const sess = rows(await setup.get(`/rest/v1/sessions?tenant_id=${inList}&select=id,session_id`));
      const keys = sess.flatMap((s) => [s.id, s.session_id]).filter(Boolean);
      if (keys.length) await setup.del(`/rest/v1/eye_events?session_id=in.(${keys.map((k) => `"${k}"`).join(",")})`);
      await setup.del(`/rest/v1/eye_events?event_data->>tenant_id=${inList}`);
      await setup.del(`/rest/v1/sessions?tenant_id=${inList}`);
    }
    for (const id of created.users) {
      await http("DELETE", `/auth/v1/admin/users/${id}`, { apikey: SERVICE, bearer: SERVICE });
    }
    if (t.length) await setup.del(`/rest/v1/tenants?id=in.(${t.join(",")})`);
    console.log("  fixtures removed");
  } catch (e) {
    console.log(`  teardown incomplete: ${redact((e as Error).message)}`);
  }
}

// ───────────────────────── user-scoped request helpers ─────────────────────────

function as(u: User | "anon" | "nokey") {
  const o = u === "nokey" ? {} : { apikey: ANON, bearer: u === "anon" ? ANON : u.token };
  const enc = (key: string) => key.split("/").map(encodeURIComponent).join("/");
  return {
    get: (p: string) => http("GET", p, o),
    post: (p: string, body: unknown) =>
      http("POST", p, { ...o, body, headers: { Prefer: "return=representation" } }),
    patch: (p: string, body: unknown) =>
      http("PATCH", p, { ...o, body, headers: { Prefer: "return=representation" } }),
    del: (p: string) => http("DELETE", p, { ...o, headers: { Prefer: "return=representation" } }),
    rpc: (fn: string, args: Record<string, unknown>) => http("POST", `/rest/v1/rpc/${fn}`, { ...o, body: args }),
    upload: (bucket: string, key: string, upsert = false, contentType = "application/pdf") =>
      http("POST", `/storage/v1/object/${bucket}/${enc(key)}`, {
        ...o,
        raw: new TextEncoder().encode("%PDF-1.4\n% runtime-verify synthetic\n%%EOF\n"),
        headers: { "Content-Type": contentType, "x-upsert": upsert ? "true" : "false" },
      }),
    download: (bucket: string, key: string) => http("GET", `/storage/v1/object/authenticated/${bucket}/${enc(key)}`, o),
    list: (bucket: string, prefix: string) =>
      http("POST", `/storage/v1/object/list/${bucket}`, { ...o, body: { prefix, limit: 100, offset: 0 } }),
    removeObj: (bucket: string, key: string) =>
      http("DELETE", `/storage/v1/object/${bucket}`, { ...o, body: { prefixes: [key] } }),
    fn: (name: string, body: unknown) => http("POST", `/functions/v1/${name}`, { ...o, body }),
  };
}

/** Survival is checked with SETUP credentials: it observes state, it does not demonstrate a user policy. */
async function sessionSurvives(id: string): Promise<boolean> {
  return rows(await setup.get(`/rest/v1/sessions?id=eq.${id}&select=id`)).length === 1;
}
async function eventSurvives(id: string): Promise<any | null> {
  return rows(await setup.get(`/rest/v1/eye_events?id=eq.${id}&select=id,event_data`))[0] ?? null;
}
async function objectSurvives(key: string): Promise<boolean> {
  return ok2xx(await http("GET", `/storage/v1/object/authenticated/kb-documents/${key.split("/").map(encodeURIComponent).join("/")}`,
    { apikey: SERVICE, bearer: SERVICE }));
}

// ───────────────────────── main ─────────────────────────

async function main() {
  try {
    await loadStack();
  } catch (e) {
    console.error(redact((e as Error).message));
    Deno.exit(2);
  }
  console.log(`Local stack: ${API}  run=${RUN}`);
  console.log(`Legacy anon key is a JWT: ${jwtPayload(ANON)?.role === "anon" ? "yes (role=anon)" : "no"}`);

  // ── Fixtures ──
  let A = "", B = "";
  const U: Record<string, User> = {};
  try {
    begin("Fixtures (setup credentials)");
    A = await createTenant("A");
    B = await createTenant("B");
    const specs: Array<[string, string, "active" | "pending", "caseworker" | "supervisor" | "auditor"]> = [
      ["a1", A, "active", "caseworker"],    // owner
      ["a2", A, "active", "caseworker"],    // same-tenant non-owner
      ["sup", A, "active", "supervisor"],   // tenant A supervisor
      ["audA", A, "active", "auditor"],     // tenant A auditor
      ["b1", B, "active", "caseworker"],    // other tenant
      ["supB", B, "active", "supervisor"],  // tenant B supervisor
      ["audB", B, "active", "auditor"],     // tenant B auditor
      ["pend", A, "pending", "caseworker"], // pending profile
    ];
    for (const [key, tenant, status, role] of specs) {
      const { id, email } = await createUser(key);
      // handle_new_user creates profile(pending) + role(caseworker); fall back if the trigger is absent.
      let prof = await setup.get(`/rest/v1/profiles?user_id=eq.${id}&select=user_id`);
      if (rows(prof).length === 0) {
        mustOk(`profile ${key}`, await setup.post("/rest/v1/profiles", { user_id: id, display_name: key, status }));
      } else {
        mustOk(`profile ${key}`, await setup.patch(`/rest/v1/profiles?user_id=eq.${id}`, { status }));
      }
      const roleRow = await setup.get(`/rest/v1/user_roles?user_id=eq.${id}&select=role`);
      if (rows(roleRow).length === 0) {
        mustOk(`role ${key}`, await setup.post("/rest/v1/user_roles", { user_id: id, role }));
      } else if (rows(roleRow)[0].role !== role) {
        mustOk(`role ${key}`, await setup.patch(`/rest/v1/user_roles?user_id=eq.${id}`, { role }));
      }
      mustOk(`membership ${key}`, await setup.post("/rest/v1/tenant_users", { tenant_id: tenant, user_id: id }));
      prof = await setup.get(`/rest/v1/profiles?user_id=eq.${id}&select=status`);
      U[key] = await signIn(key, id, email);
      console.log(`  ${key.padEnd(4)} tenant=${tenant === A ? "A" : "B"} role=${role} profile=${rows(prof)[0]?.status}`);
    }
    console.log(`  user token alg: ${jwtAlg(U.a1.token)}`);
  } catch (e) {
    console.error(`\nSetup failed: ${redact((e as Error).message)}`);
    await teardown();
    Deno.exit(2);
  }

  const { a1, a2, sup, audA, b1, supB, audB, pend } = U;

  try {
    // ═════════ Sessions RLS ═════════
    begin("Sessions RLS (20261005230000)");
    const s1 = await as(a1).post("/rest/v1/sessions?select=id,session_id,tenant_id,user_id", {
      tenant_id: A, user_id: a1.id, case_label: "rv synthetic A1",
    });
    check("A1 creates own session in tenant A", s1.status === 201 && rows(s1)[0]?.user_id === a1.id, snip(s1));
    const S1 = rows(s1)[0] ?? {};
    const s2 = await as(a2).post("/rest/v1/sessions?select=id,session_id", { tenant_id: A, user_id: a2.id, case_label: "rv A2" });
    check("A2 creates own session in tenant A", s2.status === 201, snip(s2));
    const S2 = rows(s2)[0] ?? {};
    const sb = await as(b1).post("/rest/v1/sessions?select=id,session_id", { tenant_id: B, user_id: b1.id, case_label: "rv B1" });
    check("B1 creates own session in tenant B", sb.status === 201, snip(sb));
    const SB = rows(sb)[0] ?? {};
    if (!S1.id) throw new Error("cannot continue without the A1 fixture session");

    expectDenied("A1 cannot insert a session owned by A2",
      await as(a1).post("/rest/v1/sessions", { tenant_id: A, user_id: a2.id, case_label: "spoof owner" }));
    expectDenied("A1 cannot insert into tenant B",
      await as(a1).post("/rest/v1/sessions", { tenant_id: B, user_id: a1.id, case_label: "foreign tenant" }));
    expectDenied("A1 cannot insert with NULL tenant",
      await as(a1).post("/rest/v1/sessions", { tenant_id: null, user_id: a1.id, case_label: "null tenant" }));
    expectDenied("Pending user cannot insert a session",
      await as(pend).post("/rest/v1/sessions", { tenant_id: A, user_id: pend.id, case_label: "pending" }));

    let r = await as(a1).get(`/rest/v1/sessions?select=id,user_id`);
    const a1rows = rows(r);
    if (need("A1 lists only own sessions", { S2: S2.id, SB: SB.id })) {
      check("A1 lists only own sessions", pg(r) === "allowed" && a1rows.every((x) => x.user_id === a1.id) &&
        a1rows.some((x) => x.id === S1.id) && !a1rows.some((x) => x.id === S2.id || x.id === SB.id), `${a1rows.length} rows`);
    }
    expectFiltered("A2 (same tenant, non-owner) cannot read A1 session", await as(a2).get(`/rest/v1/sessions?id=eq.${S1.id}&select=id`));
    expectFiltered("B1 (other tenant) cannot read A1 session", await as(b1).get(`/rest/v1/sessions?id=eq.${S1.id}&select=id`));
    expectFiltered("Supervisor cannot read A1 session via PostgREST (owner-only RLS by design)",
      await as(sup).get(`/rest/v1/sessions?id=eq.${S1.id}&select=id`));
    expectFiltered("Pending user reads no sessions", await as(pend).get(`/rest/v1/sessions?select=id`));

    r = await as(a1).patch(`/rest/v1/sessions?id=eq.${S1.id}`, { case_label: "rv renamed" });
    check("A1 updates own session", pg(r) === "allowed" && rows(r).length === 1, snip(r));
    expectDenied("A1 cannot re-home own session to tenant B", await as(a1).patch(`/rest/v1/sessions?id=eq.${S1.id}`, { tenant_id: B }));
    expectDenied("A1 cannot transfer ownership to A2", await as(a1).patch(`/rest/v1/sessions?id=eq.${S1.id}`, { user_id: a2.id }));
    expectFiltered("A2 update of A1 session is a no-op", await as(a2).patch(`/rest/v1/sessions?id=eq.${S1.id}`, { case_label: "hijack" }));
    expectFiltered("B1 update of A1 session is a no-op", await as(b1).patch(`/rest/v1/sessions?id=eq.${S1.id}`, { case_label: "hijack" }));
    for (const [who, u] of [["A1 (owner)", a1], ["A2", a2], ["B1", b1], ["Supervisor", sup]] as Array<[string, User]>) {
      r = await as(u).del(`/rest/v1/sessions?id=eq.${S1.id}`);
      const o = pg(r);
      const survived = await sessionSurvives(S1.id);
      check(`${who} DELETE of A1 session: no-op/denied and session survives`, (o === "filtered" || o === "denied") && survived,
        `${o}, survived=${survived}: ${snip(r, 80)}`);
    }
    r = await as(a1).get(`/rest/v1/sessions?id=eq.${S1.id}&select=tenant_id,user_id,case_label`);
    const after = rows(r)[0];
    check("A1 session intact after denied writes", after?.tenant_id === A && after?.user_id === a1.id && after?.case_label === "rv renamed",
      JSON.stringify(after ?? null));

    // ═════════ Anonymous / no key ═════════
    begin("Anonymous access");
    // No apikey and no Authorization header at all (see http(): nothing is added implicitly).
    r = await http("GET", "/rest/v1/sessions?select=id&limit=5", {});
    const nokeyRows = rows(r).length;
    const nokeyAuthUser = await http("GET", "/auth/v1/user", {});
    const nokeyRole = await as("nokey").rpc("report_client_event", { p_event_type: "tool.run.started", p_metadata: {} });
    const executesAsAnon = /permission denied/i.test(nokeyRole.text);
    if (r.status === 401) {
      record("No apikey → gateway rejects PostgREST", "PASS", snip(r, 80));
    } else if (ok2xx(r) && nokeyRows === 0) {
      record("No apikey → request reaches PostgREST", "OBSERVE",
        `HTTP ${r.status}, 0 rows. No credentials were sent; /auth/v1/user → ${nokeyAuthUser.status}; ` +
        `report_client_event → ${executesAsAnon ? "permission denied (request ran as role anon)" : snip(nokeyRole, 80)}. ` +
        "The local gateway does not require an apikey; access is constrained by anon grants and RLS (checks below).");
    } else {
      record("No apikey request", ok2xx(r) ? "FAIL" : "FAIL", `${pg(r)} ${nokeyRows} rows: ${snip(r, 100)}`);
    }
    check("No-apikey request is not treated as an authenticated or service caller",
      nokeyRole.status === 401 || executesAsAnon, snip(nokeyRole, 100));
    for (const who of ["nokey", "anon"] as const) {
      for (const table of ["sessions", "tenants", "tenant_users", "eye_events", "profiles", "user_roles", "review_documents", "kb_documents"]) {
        r = await as(who).get(`/rest/v1/${table}?select=*&limit=5`);
        const o = pg(r);
        check(`${who} reads no ${table} rows`, o === "filtered" || o === "denied", `${o}: ${snip(r, 80)}`);
      }
      expectDenied(`${who} cannot insert sessions`, await as(who).post("/rest/v1/sessions", { tenant_id: A, user_id: a1.id, case_label: "anon" }));
      r = await as(who).patch(`/rest/v1/sessions?id=eq.${S1.id}`, { case_label: "anon" });
      check(`${who} cannot update sessions`, ["filtered", "denied"].includes(pg(r)) && (await sessionSurvives(S1.id)), `${pg(r)}: ${snip(r, 80)}`);
      expectDenied(`${who} cannot insert eye_events`,
        await as(who).post("/rest/v1/eye_events", { event_type: "AI_USAGE_APPROVED_BY_SUPERVISOR", event_data: { tenant_id: A } }));
      expectDenied(`${who} cannot call report_client_event`, await as(who).rpc("report_client_event", { p_event_type: "tool.run.started", p_metadata: {} }));
      expectDenied(`${who} cannot call record_governance_event`, await as(who).rpc("record_governance_event", { p_event_type: "AI_USAGE_APPROVED_BY_SUPERVISOR" }));
      expectStorageRejected(`${who} cannot upload to kb-documents`,
        await as(who).upload("kb-documents", `tenants/${A}/kb_documents/${crypto.randomUUID()}/anon.pdf`));
      for (const bucket of ["kb-documents", "audio-uploads", "templates", "review-documents"]) {
        r = await as(who).list(bucket, "");
        const o = st(r);
        check(`${who} lists nothing in ${bucket}`, o === "filtered" || o === "denied" || o === "not-found", `${o}: ${snip(r, 80)}`);
      }
    }
    r = await as("anon").rpc("is_tenant_member", { p_tenant: A });
    record("anon EXECUTE on is_tenant_member", pg(r) === "denied" ? "PASS" : (ok2xx(r) && r.body === false ? "OBSERVE" : "FAIL"),
      pg(r) === "denied" ? "" : `${snip(r, 60)}; REVOKE ... FROM PUBLIC does not remove Supabase's explicit anon default grant. Returns false for anon.`);

    // ═════════ Tenant membership ═════════
    begin("Tenant membership SELECT (20261005210000)");
    r = await as(a1).get("/rest/v1/tenant_users?select=tenant_id,user_id");
    check("A1 sees exactly own membership", rows(r).length === 1 && rows(r)[0].tenant_id === A && rows(r)[0].user_id === a1.id, snip(r));
    r = await as(a1).get("/rest/v1/tenants?select=id");
    check("A1 sees exactly tenant A", rows(r).length === 1 && rows(r)[0].id === A, snip(r));
    expectFiltered("A1 cannot read tenant B", await as(a1).get(`/rest/v1/tenants?id=eq.${B}&select=id`));
    r = await as(a1).get("/rest/v1/tenant_users?select=tenant_id,tenants(id,name)");
    check("tenant_users → tenants embed resolves (useTenant)", rows(r).length === 1 && rows(r)[0].tenants?.id === A, snip(r));
    r = await as(b1).get("/rest/v1/tenants?select=id");
    check("B1 sees exactly tenant B", rows(r).length === 1 && rows(r)[0].id === B, snip(r));
    r = await as(pend).get("/rest/v1/tenants?select=id");
    record("Pending member can read own tenant row", rows(r).length === 1 ? "OBSERVE" : "PASS",
      `${rows(r).length} rows; policy checks membership only, not profile status`);
    r = await as(a1).rpc("is_tenant_member", { p_tenant: A });
    check("is_tenant_member(A) as A1 = true", ok2xx(r) && r.body === true, snip(r));
    r = await as(a1).rpc("is_tenant_member", { p_tenant: B });
    check("is_tenant_member(B) as A1 = false", ok2xx(r) && r.body === false, snip(r));

    // ═════════ Storage ═════════
    begin("Storage policies (20261005220000 + corrective 20261006120000)");
    const docA = crypto.randomUUID();
    const docB = crypto.randomUUID();
    const keyA = `tenants/${A}/kb_documents/${docA}/Intake_Policy-2026.pdf`;
    const keyB = `tenants/${B}/kb_documents/${docB}/policy.pdf`;
    r = await as(a1).upload("kb-documents", keyA);
    const haveA = ok2xx(r);
    check("A1 uploads canonical KB path in tenant A", haveA, `${st(r)}: ${snip(r)}`);
    if (haveA) created.objects.push(keyA);
    r = await as(b1).upload("kb-documents", keyB);
    const haveB = ok2xx(r);
    check("B1 uploads canonical KB path in tenant B", haveB, `${st(r)}: ${snip(r)}`);
    if (haveB) created.objects.push(keyB);
    for (const name of ["document.pdf", "a.pdf", "_draft.pdf", "-v2.pdf", "report.final.pdf", "notes..pdf", `${"a".repeat(204)}.pdf`]) {
      const k = `tenants/${A}/kb_documents/${crypto.randomUUID()}/${name}`;
      r = await as(a1).upload("kb-documents", k);
      check(`A1 uploads ordinary name ${name.length > 24 ? name.slice(0, 12) + "…(204)" : name}`, ok2xx(r), `${st(r)}: ${snip(r)}`);
      if (ok2xx(r)) created.objects.push(k);
    }
    const policyGate = haveA; // without one accepted upload, a rejection cannot be attributed to the policy
    const badKeys: Array<[string, string]> = [
      ["dot-only .pdf", `tenants/${A}/kb_documents/${crypto.randomUUID()}/.pdf`],
      ["dot-prefixed ..pdf", `tenants/${A}/kb_documents/${crypto.randomUUID()}/..pdf`],
      ["hidden .hidden.pdf", `tenants/${A}/kb_documents/${crypto.randomUUID()}/.hidden.pdf`],
      ["205-char stem", `tenants/${A}/kb_documents/${crypto.randomUUID()}/${"a".repeat(205)}.pdf`],
      ["other tenant (B) prefix", `tenants/${B}/kb_documents/${crypto.randomUUID()}/x.pdf`],
      ["upper-case tenant uuid", `tenants/${A.toUpperCase()}/kb_documents/${crypto.randomUUID()}/x.pdf`],
      ["wrong folder", `tenants/${A}/evil/${crypto.randomUUID()}/x.pdf`],
      ["extra depth", `tenants/${A}/kb_documents/${crypto.randomUUID()}/sub/x.pdf`],
      ["shallow depth", `tenants/${A}/kb_documents/x.pdf`],
      ["non-uuid document segment", `tenants/${A}/kb_documents/not-a-uuid/x.pdf`],
      [".exe extension", `tenants/${A}/kb_documents/${crypto.randomUUID()}/x.exe`],
      ["double extension .pdf.txt", `tenants/${A}/kb_documents/${crypto.randomUUID()}/x.pdf.txt`],
      ["space in name", `tenants/${A}/kb_documents/${crypto.randomUUID()}/my file.pdf`],
    ];
    for (const [label, key] of badKeys) {
      r = await as(a1).upload("kb-documents", key);
      if (ok2xx(r)) created.objects.push(key);
      if (!policyGate && !ok2xx(r)) {
        record(`A1 upload rejected: ${label}`, "BLOCKED", `canonical upload failed, so this rejection (${st(r)}) is not attributable to the policy: ${snip(r, 80)}`);
      } else {
        expectStorageRejected(`A1 upload rejected: ${label}`, r);
      }
    }
    const keyPend = `tenants/${A}/kb_documents/${crypto.randomUUID()}/pending.pdf`;
    r = await as(pend).upload("kb-documents", keyPend);
    record("Pending member upload to own tenant", ok2xx(r) ? "OBSERVE" : (st(r) === "denied" ? "PASS" : "FAIL"),
      ok2xx(r) ? "accepted — is_tenant_member() does not check profile status" : `${st(r)}: ${snip(r, 100)}`);
    if (ok2xx(r)) created.objects.push(keyPend);

    if (need("A2 (same tenant) can download tenant A KB object", { canonicalUploadA: haveA })) {
      r = await as(a2).download("kb-documents", keyA);
      check("A2 (same tenant) can download tenant A KB object", ok2xx(r), `${st(r)}: ${snip(r, 80)}`);
    }
    if (need("B1 cannot download tenant A KB object", { canonicalUploadA: haveA })) {
      r = await as(b1).download("kb-documents", keyA);
      check("B1 cannot download tenant A KB object", ["denied", "not-found"].includes(st(r)), `${st(r)}: ${snip(r)}`);
    }
    if (need("A1 cannot download tenant B KB object", { canonicalUploadB: haveB })) {
      r = await as(a1).download("kb-documents", keyB);
      check("A1 cannot download tenant B KB object", ["denied", "not-found"].includes(st(r)), `${st(r)}: ${snip(r)}`);
    }
    if (need("A1 lists own tenant KB object", { canonicalUploadA: haveA })) {
      r = await as(a1).list("kb-documents", `tenants/${A}/kb_documents/${docA}`);
      check("A1 lists own tenant KB object", rows(r).some((o) => o.name === "Intake_Policy-2026.pdf"), `${st(r)}: ${snip(r)}`);
    }
    if (need("A1 lists nothing under tenant B", { canonicalUploadB: haveB })) {
      r = await as(a1).list("kb-documents", `tenants/${B}/kb_documents/${docB}`);
      check("A1 lists nothing under tenant B", st(r) === "filtered", `${st(r)}: ${snip(r)}`);
    }
    if (need("A1 cannot overwrite (upsert) KB object", { canonicalUploadA: haveA })) {
      r = await as(a1).upload("kb-documents", keyA, true);
      check("A1 cannot overwrite (upsert) KB object", st(r) === "denied", `${st(r)}: ${snip(r)}`);
    }
    for (const [who, u] of [["A1", a1], ["A2", a2], ["B1", b1]] as Array<[string, User]>) {
      const nm = `${who} cannot delete tenant A KB object (object survives)`;
      if (!need(nm, { canonicalUploadA: haveA })) continue;
      r = await as(u).removeObj("kb-documents", keyA);
      const survived = await objectSurvives(keyA);
      check(nm, survived && !(ok2xx(r) && rows(r).length > 0), `${st(r)}, survived=${survived}: ${snip(r, 80)}`);
    }
    for (const bucket of ["audio-uploads", "templates", "review-documents"]) {
      r = await as(a1).list(bucket, "");
      check(`A1 lists nothing in ${bucket}`, ["filtered", "denied", "not-found"].includes(st(r)), `${st(r)}: ${snip(r)}`);
    }
    expectStorageRejected("A1 cannot upload to templates", await as(a1).upload("templates", `${A}/${crypto.randomUUID()}.pdf`));
    expectStorageRejected("A1 cannot upload to review-documents (service-role only)",
      await as(a1).upload("review-documents", `${A}/${S1.id}/${crypto.randomUUID()}.pdf`));
    // audio-uploads only accepts audio MIME types; send one so the bucket's MIME check
    // does not reject the request before the storage policy is evaluated.
    expectStorageRejected("A1 cannot upload to audio-uploads",
      await as(a1).upload("audio-uploads", `${A}/${crypto.randomUUID()}.webm`, false, "audio/webm"));

    // ═════════ Audit events (client-reported) ═════════
    begin("Audit events: direct writes + report_client_event");
    expectDenied("A1 direct INSERT into eye_events denied", await as(a1).post("/rest/v1/eye_events", {
      event_type: "AI_USAGE_APPROVED_BY_SUPERVISOR",
      event_data: { tenant_id: A, scope: "organization", source: "server_observed", verified: true, actor_role: "supervisor" },
    }));
    expectDenied("Supervisor direct INSERT into eye_events denied",
      await as(sup).post("/rest/v1/eye_events", { event_type: "SESSION_HEARTBEAT", event_data: { tenant_id: A } }));
    expectFiltered("Caseworker reads no eye_events", await as(a1).get("/rest/v1/eye_events?select=id&limit=5"));

    const reqId = `req_${RUN}_1`;
    r = await as(a1).rpc("report_client_event", {
      p_event_type: "tool.run.started", p_session_id: S1.session_id, p_request_id: reqId, p_metadata: { tool_name: "x" },
    });
    const evId: string | null = ok2xx(r) && typeof r.body === "string" ? r.body : null;
    check("A1 report_client_event on own session succeeds", !!evId, snip(r));
    if (need("Same request_id is idempotent (same row id)", { evId })) {
      r = await as(a1).rpc("report_client_event", {
        p_event_type: "tool.run.started", p_session_id: S1.session_id, p_request_id: reqId, p_metadata: { tool_name: "x" },
      });
      check("Same request_id is idempotent (same row id)", ok2xx(r) && r.body === evId, snip(r));
    }
    if (need("Stored client event is stamped client_reported / verified=false / actor=A1 / tenant=A (read as supervisor)", { evId })) {
      r = await as(sup).get(`/rest/v1/eye_events?id=eq.${evId}&select=event_type,event_data`);
      const ev = rows(r)[0]?.event_data ?? {};
      check("Stored client event is stamped client_reported / verified=false / actor=A1 / tenant=A (read as supervisor)",
        ev.source === "client_reported" && ev.verified === false && ev.actor_id === a1.id && ev.tenant_id === A && ev.actor_role === "caseworker",
        `${pg(r)} ${JSON.stringify({ source: ev.source, verified: ev.verified, actor: ev.actor_id === a1.id, tenant: ev.tenant_id === A })}`);
    }
    for (const [who, u] of [["A1", a1], ["Supervisor", sup]] as Array<[string, User]>) {
      const nmU = `${who} cannot UPDATE eye_events (row unchanged)`;
      if (need(nmU, { evId })) {
        r = await as(u).patch(`/rest/v1/eye_events?id=eq.${evId}`, { event_data: { verified: true, source: "server_observed" } });
        const row = await eventSurvives(evId!);
        check(nmU, ["filtered", "denied"].includes(pg(r)) && row?.event_data?.verified === false, `${pg(r)}: ${snip(r, 80)}`);
      }
      const nmD = `${who} cannot DELETE eye_events (row survives)`;
      if (need(nmD, { evId })) {
        r = await as(u).del(`/rest/v1/eye_events?id=eq.${evId}`);
        const row = await eventSurvives(evId!);
        check(nmD, ["filtered", "denied"].includes(pg(r)) && !!row, `${pg(r)}, survived=${!!row}: ${snip(r, 80)}`);
      }
    }

    const rce = (u: User, type: string, sid: string | null, meta: Record<string, unknown>) =>
      as(u).rpc("report_client_event", { p_event_type: type, p_session_id: sid, p_request_id: null, p_metadata: meta });
    expectRaise("A2 on A1 session → EYE_SESSION_NOT_OWNED", await rce(a2, "tool.run.started", S1.session_id, { tool_name: "x" }), "EYE_SESSION_NOT_OWNED");
    expectRaise("B1 on A1 session → EYE_SESSION_NOT_FOUND", await rce(b1, "tool.run.started", S1.session_id, { tool_name: "x" }), "EYE_SESSION_NOT_FOUND");
    expectRaise("Pending user → EYE_PROFILE_NOT_ACTIVE", await rce(pend, "tool.run.started", null, { tool_name: "x" }), "EYE_PROFILE_NOT_ACTIVE");
    expectRaise("PHI key 'transcript' → EYE_METADATA_KEY_DENIED", await rce(a1, "tool.run.started", S1.session_id, { transcript: "phi" }), "EYE_METADATA_KEY_DENIED");
    expectRaise("Nested metadata → EYE_METADATA_VALUE_NOT_PRIMITIVE", await rce(a1, "tool.run.started", S1.session_id, { tool_name: { nested: 1 } }), "EYE_METADATA_VALUE_NOT_PRIMITIVE");
    for (const sid of [S1.session_id, null]) {
      for (const k of ["source", "verified", "actor_id", "actor_role", "tenant_id", "scope"]) {
        const v = k === "verified" ? true : k === "tenant_id" ? B : k === "source" ? "server_observed" : k === "actor_role" ? "supervisor" : "x";
        expectRaise(`Spoofed metadata '${k}' (${sid ? "session" : "sessionless"}) → EYE_METADATA_KEY_NOT_ALLOWED`,
          await rce(a1, "tool.run.started", sid, { [k]: v }), "EYE_METADATA_KEY_NOT_ALLOWED");
      }
    }
    for (const t of ["AI_USAGE_APPROVED_BY_SUPERVISOR", "AUDITOR_ACCESS_GRANTED", "COMPLIANCE_EXPORT_GENERATED", "SESSION_CLOSED"]) {
      expectRaise(`Governance/server type ${t} via report_client_event → EYE_EVENT_TYPE_NOT_ALLOWED`, await rce(a1, t, S1.session_id, {}), "EYE_EVENT_TYPE_NOT_ALLOWED");
    }
    r = await rce(a1, "SESSION_HEARTBEAT", null, {});
    const sessionlessId: string | null = ok2xx(r) && typeof r.body === "string" ? r.body : null;
    check("A1 sessionless allowed event (single tenant) succeeds", !!sessionlessId, snip(r));
    let bEvId: string | null = null;
    if (need("B1 report_client_event on own tenant-B session succeeds", { SB: SB.session_id })) {
      r = await rce(b1, "tool.run.completed", SB.session_id, { tool_name: "x", result: "success" });
      bEvId = ok2xx(r) && typeof r.body === "string" ? r.body : null;
      check("B1 report_client_event on own tenant-B session succeeds", !!bEvId, snip(r));
    }
    r = await rce(sup, "tool.run.started", S1.session_id, { tool_name: "x" });
    record("Supervisor may report client events on a caseworker's session (role != caseworker)",
      ok2xx(r) ? "OBSERVE" : "PASS", ok2xx(r) ? "accepted by design of report_client_event" : snip(r));

    // ═════════ Governance events ═════════
    begin("Governance events: record_governance_event + approval consumers");
    const rge = (u: User, type: string, args: Record<string, unknown> = {}) =>
      as(u).rpc("record_governance_event", { p_event_type: type, ...args });
    expectRaise("Caseworker approval → EYE_SUPERVISOR_REQUIRED", await rge(a1, "AI_USAGE_APPROVED_BY_SUPERVISOR", { p_subject_id: "default", p_scope: "organization" }), "EYE_SUPERVISOR_REQUIRED");
    expectRaise("Other-tenant caseworker approval → EYE_SUPERVISOR_REQUIRED", await rge(b1, "AI_USAGE_APPROVED_BY_SUPERVISOR", { p_scope: "organization" }), "EYE_SUPERVISOR_REQUIRED");
    expectRaise("Auditor approval → EYE_SUPERVISOR_REQUIRED", await rge(audA, "AI_USAGE_APPROVED_BY_SUPERVISOR", { p_scope: "organization" }), "EYE_SUPERVISOR_REQUIRED");
    expectRaise("Caseworker export event → EYE_SUPERVISOR_OR_AUDITOR_REQUIRED", await rge(a1, "COMPLIANCE_EXPORT_GENERATED", {}), "EYE_SUPERVISOR_OR_AUDITOR_REQUIRED");
    expectRaise("Pending user → EYE_PROFILE_NOT_ACTIVE", await rge(pend, "AI_USAGE_APPROVED_BY_SUPERVISOR", {}), "EYE_PROFILE_NOT_ACTIVE");
    expectRaise("Supervisor non-governance type → EYE_EVENT_TYPE_NOT_ALLOWED", await rge(sup, "tool.run.started", {}), "EYE_EVENT_TYPE_NOT_ALLOWED");
    expectRaise("Auditor grant to a non-auditor → EYE_SUBJECT_NOT_AUDITOR", await rge(sup, "AUDITOR_ACCESS_GRANTED", { p_subject_id: a2.id }), "EYE_SUBJECT_NOT_AUDITOR");
    expectRaise("Supervisor cannot inject 'source' metadata → EYE_METADATA_KEY_NOT_ALLOWED",
      await rge(sup, "AI_USAGE_APPROVED_BY_SUPERVISOR", { p_scope: "organization", p_metadata: { source: "client_reported" } }), "EYE_METADATA_KEY_NOT_ALLOWED");
    expectRaise("Invalid scope → EYE_SCOPE_INVALID", await rge(sup, "AI_USAGE_APPROVED_BY_SUPERVISOR", { p_scope: "global" }), "EYE_SCOPE_INVALID");

    r = await rge(sup, "AI_USAGE_APPROVED_BY_SUPERVISOR", {
      p_subject_id: "default", p_scope: "organization", p_metadata: { approval_policy_id: "default" },
    });
    const approvalId: string | null = ok2xx(r) && typeof r.body === "string" ? r.body : null;
    check("Supervisor approval succeeds", !!approvalId, snip(r));
    if (need("Approval stamped server_observed / verified / supervisor / tenant A / actor=sup", { approvalId })) {
      r = await as(sup).get(`/rest/v1/eye_events?id=eq.${approvalId}&select=event_type,event_data`);
      const ap = rows(r)[0]?.event_data ?? {};
      check("Approval stamped server_observed / verified / supervisor / tenant A / actor=sup",
        ap.source === "server_observed" && ap.verified === true && ap.actor_role === "supervisor" &&
        ap.tenant_id === A && ap.actor_id === sup.id && ap.scope === "organization",
        `${pg(r)} ${JSON.stringify({ source: ap.source, verified: ap.verified, role: ap.actor_role, tenantA: ap.tenant_id === A })}`);
    }

    const browserView = async (u: User, tenantId: string) => {
      const q = await as(u).get(
        "/rest/v1/eye_events?select=id,event_type,event_data,created_at" +
        "&event_type=in.(AI_USAGE_APPROVED_BY_SUPERVISOR,AI_USAGE_APPROVAL_REVOKED)&order=created_at.desc&limit=10",
      );
      const scoped = rows(q).filter((e) => {
        const d = e.event_data ?? {};
        return d.tenant_id === tenantId && d.scope === "organization" && isServerVerifiedEvent(d) && d.actor_role === "supervisor";
      });
      return { q, latest: scoped[0] ?? null, ok: ok2xx(q) };
    };
    const consumer = createClient(API, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
    const llm = (tenantId: string) => checkLLMAuthorization(consumer, {
      tenantId, scope: "organization", sessionId: null, serviceName: "runtime-verify-local", requestId: `rv_${RUN}`,
    });

    let bv = await browserView(sup, A);
    if (need("Browser consumer (as supervisor) recognises approval for tenant A", { approvalId })) {
      check("Browser consumer (as supervisor) recognises approval for tenant A",
        bv.latest?.id === approvalId && bv.latest?.event_type === "AI_USAGE_APPROVED_BY_SUPERVISOR", snip(bv.q, 80));
    }
    bv = await browserView(supB, A);
    if (need("Tenant B supervisor's browser consumer cannot see tenant A approval", { approvalId })) {
      check("Tenant B supervisor's browser consumer cannot see tenant A approval", bv.ok && bv.latest === null, snip(bv.q, 80));
    }
    bv = await browserView(sup, B);
    check("Browser consumer finds no approval for tenant B", bv.ok && bv.latest === null, snip(bv.q, 80));
    bv = await browserView(a1, A);
    record("Caseworker cannot read approval status (eye_events SELECT is supervisor/auditor only)",
      bv.ok && bv.latest === null ? "OBSERVE" : "FAIL", "server-side gate uses the service role and is unaffected");

    let auth: any;
    if (need("checkLLMAuthorization(tenant A) authorised by the verified approval", { approvalId })) {
      auth = await llm(A);
      check("checkLLMAuthorization(tenant A) authorised by the verified approval",
        auth.authorized === true && auth.approvalEventId === approvalId, JSON.stringify(auth));
    }
    auth = await llm(B);
    check("checkLLMAuthorization(tenant B) not authorised", auth.authorized === false && auth.reason === "no_approval_exists", JSON.stringify(auth));
    // Fixture (SETUP credentials): a legacy unverified approval row such as the former direct-browser path wrote.
    const legacyApproval = ok2xx(await setup.post("/rest/v1/eye_events", {
      session_id: null, event_type: "AI_USAGE_APPROVED_BY_SUPERVISOR",
      event_data: { tenant_id: B, scope: "organization", actor_role: "supervisor", source: "client_reported", verified: false, rv_fixture: RUN },
    }, "return=minimal"));
    if (need("Legacy unverified approval row is ignored by checkLLMAuthorization", { legacyApproval })) {
      auth = await llm(B);
      check("Legacy unverified approval row is ignored by checkLLMAuthorization", auth.authorized === false, JSON.stringify(auth));
      bv = await browserView(supB, B);
      check("Legacy unverified approval row is ignored by the browser consumer (tenant B supervisor)", bv.ok && bv.latest === null, snip(bv.q, 80));
    }

    r = await rge(sup, "AI_USAGE_APPROVAL_REVOKED", { p_subject_id: "default", p_scope: "organization" });
    const revoked = ok2xx(r) && typeof r.body === "string";
    check("Supervisor revocation succeeds", revoked, snip(r));
    if (need("checkLLMAuthorization(tenant A) blocked after revocation", { approvalId, revoked })) {
      auth = await llm(A);
      check("checkLLMAuthorization(tenant A) blocked after revocation", auth.authorized === false && auth.reason === "approval_revoked", JSON.stringify(auth));
      bv = await browserView(sup, A);
      check("Browser consumer sees revocation as latest", bv.latest?.event_type === "AI_USAGE_APPROVAL_REVOKED", snip(bv.q, 80));
    }
    r = await rge(sup, "COMPLIANCE_EXPORT_GENERATED", { p_metadata: { export_id: `exp_${RUN}`, event_count: 3 } });
    check("Supervisor COMPLIANCE_EXPORT_GENERATED succeeds", ok2xx(r) && typeof r.body === "string", snip(r));
    r = await rge(audA, "COMPLIANCE_EXPORT_GENERATED", { p_metadata: { export_id: `expa_${RUN}` } });
    const audExportId: string | null = ok2xx(r) && typeof r.body === "string" ? r.body : null;
    check("Auditor COMPLIANCE_EXPORT_GENERATED succeeds", !!audExportId, snip(r));

    // ═════════ eye_events tenant-scoped SELECT ═════════
    begin("eye_events tenant-scoped SELECT (corrective 20261006120000)");
    const viewersA: Array<[string, User]> = [["supervisor A", sup], ["auditor A", audA]];
    const viewersB: Array<[string, User]> = [["supervisor B", supB], ["auditor B", audB]];
    const visible = async (u: User, id: string) => {
      const q = await as(u).get(`/rest/v1/eye_events?id=eq.${id}&select=id`);
      return { o: pg(q), n: rows(q).length, q };
    };
    const expectVisibility = async (label: string, id: string | null, seenBy: "A" | "B" | "none") => {
      for (const [who, u] of [...viewersA, ...viewersB]) {
        const tenant = viewersA.some(([, x]) => x === u) ? "A" : "B";
        const should = seenBy === tenant;
        const nm = `${who} ${should ? "can" : "cannot"} read: ${label}`;
        if (!need(nm, { [label]: id })) continue;
        const v = await visible(u, id!);
        check(nm, should ? (v.o === "allowed" && v.n === 1) : v.o === "filtered", `${v.o}: ${snip(v.q, 80)}`);
      }
    };
    await expectVisibility("A1 client event (session in A)", evId, "A");
    await expectVisibility("A1 sessionless client event", sessionlessId, "A");
    await expectVisibility("tenant A approval (governance)", approvalId, "A");
    await expectVisibility("tenant A auditor export", audExportId, "A");
    await expectVisibility("B1 client event (session in B)", bEvId, "B");
    // Attribution fixtures inserted with SETUP credentials (they model rows written by
    // server code / the former browser path); visibility is then read with user JWTs.
    await expectVisibility("server-style row: session S1 + tenant_id 'default'", await fixtureEvent(S1.session_id, { tenant_id: "default" }), "A");
    await expectVisibility("edge-style row: sessions.id of SB, no tenant_id", SB.id ? await fixtureEvent(SB.id, {}) : null, "B");
    await expectVisibility("legacy row: no session, no tenant_id", await fixtureEvent(null, { actor_id: "legacy" }), "none");
    await expectVisibility("legacy row: malformed tenant_id 'default'", await fixtureEvent(null, { tenant_id: "default" }), "none");
    await expectVisibility("legacy row: non-string tenant_id", await fixtureEvent(null, { tenant_id: { id: A } }), "none");
    await expectVisibility("conflicting row: session S1 (A) with tenant_id B", await fixtureEvent(S1.session_id, { tenant_id: B }), "none");
    await expectVisibility("unknown session id, no tenant_id", await fixtureEvent(`ghost-${RUN}`, {}), "none");
    r = await as(sup).get(`/rest/v1/eye_events?select=id&event_data->>tenant_id=eq.${B}`);
    check("Supervisor A reads zero tenant-B attributed rows", pg(r) === "filtered", `${pg(r)}: ${rows(r).length} rows`);
    r = await as(audA).get(`/rest/v1/eye_events?select=id&event_data->>tenant_id=eq.${B}`);
    check("Auditor A reads zero tenant-B attributed rows", pg(r) === "filtered", `${pg(r)}: ${rows(r).length} rows`);
    r = await as(supB).get(`/rest/v1/eye_events?select=id&event_data->>tenant_id=eq.${A}`);
    check("Supervisor B reads zero tenant-A attributed rows", pg(r) === "filtered", `${pg(r)}: ${rows(r).length} rows`);
    for (const [who, u] of [["caseworker A1", a1], ["caseworker B1", b1], ["pending user", pend]] as Array<[string, User]>) {
      expectFiltered(`${who} reads no eye_events`, await as(u).get("/rest/v1/eye_events?select=id&limit=5"));
    }

    // ═════════ Restricted RPCs ═════════
    begin("Restricted SECURITY DEFINER RPCs (20261005210000 / 230000 / 20261013120000)");
    const restricted: Array<[string, Record<string, unknown>]> = [
      ["update_session_guidance_phase1", { session_id_input: S1.id, guidance_json: { rv: RUN } }],
      ["get_policy_snippets_for_session", { session_id_input: S1.id }],
      ["claim_next_kb_job", { p_worker_id: `rv_${RUN}` }],
      ["append_kb_document_content", { p_doc_id: crypto.randomUUID(), p_chunk: "rv" }],
      ["kb_has_queued_jobs", {}],
      // Nonexistent job id: a wrongly granted call would succeed without touching a row.
      ["complete_kb_job", { p_job_id: -1, p_status: "failed", p_error: `rv_${RUN}` }],
    ];
    for (const [fn, args] of restricted) {
      for (const who of [a1, sup]) expectDenied(`${who.key} cannot execute ${fn}`, await as(who).rpc(fn, args));
      expectDenied(`anon cannot execute ${fn}`, await as("anon").rpc(fn, args));
    }

    // ═════════ Edge functions ═════════
    begin("Edge functions: gateway (verify_jwt) vs handler (requireUser)");
    const probe = await http("POST", "/functions/v1/session-manager", { body: {} });
    const edgeUp = probe.status !== 0 && probe.status !== 502 && probe.status !== 503 &&
      !(probe.status === 404 && /not found/i.test(probe.text));
    if (!edgeUp) {
      record("Edge runtime reachable", "SKIP", `edge functions not served by this stack: ${snip(probe)}`);
    } else {
      // Gateway (Kong / edge-runtime verify_jwt) bodies carry `msg` or `message`; handlers return `error`.
      const layer = (x: Res) => (x.body && typeof x.body === "object" && ("msg" in x.body || "message" in x.body) && !("error" in x.body)) ? "gateway"
        : (x.body && typeof x.body === "object" && "error" in x.body) ? "handler" : "unknown";
      const forged = `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify({
        sub: a1.id, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600,
      }))}.${b64url("not-a-real-signature-0123456789")}`;

      const gatewayFns = [
        "session-manager", "start-session", "get-citation-details", "upload-interview-notes-text",
        "extract-case-note-text", "kb-kick", "records-room", "run-reviewer", "select-template",
        "generate-guidance-phase1", "generate-guidance-phase2", "llm-gateway", "compile-policy-pack",
        "generate-parser-artifacts", "upload-review-document", "cleanup-orphan-sessions-dev",
      ];
      for (const fn of gatewayFns) {
        r = await http("POST", `/functions/v1/${fn}`, { body: {} });
        check(`${fn}: no Authorization → 401 at gateway`, r.status === 401 && layer(r) === "gateway", `${layer(r)} ${snip(r, 100)}`);
        r = await http("POST", `/functions/v1/${fn}`, { bearer: forged, body: {} });
        check(`${fn}: forged-signature JWT → 401 at gateway`, r.status === 401 && layer(r) === "gateway", `${layer(r)} ${snip(r, 100)}`);
      }

      const notes = "Synthetic interview notes for runtime verification only.";
      const cases: Array<{ fn: string; body: any }> = [
        { fn: "session-manager", body: { action: "get", session_id: S1.id } },
        { fn: "get-citation-details", body: { session_id: S1.id, citation_ids: ["TEMPLATE"] } },
        { fn: "upload-interview-notes-text", body: { session_id: S1.id, notes_text: notes } },
        { fn: "extract-case-note-text", body: { storage_path: `${A}/${S1.id}/${crypto.randomUUID()}.txt`, session_id: S1.id } },
        { fn: "start-session", body: {} },
        { fn: "kb-kick", body: {} },
      ];
      for (const c of cases) {
        r = await http("POST", `/functions/v1/${c.fn}`, { apikey: ANON, bearer: ANON, body: c.body });
        check(`${c.fn}: legacy anon JWT passes gateway, rejected by handler (401)`,
          r.status === 401 && layer(r) === "handler", `${layer(r)} ${snip(r, 100)}`);
        r = await as(pend).fn(c.fn, c.body);
        check(`${c.fn}: pending user → 403 (handler)`, r.status === 403 && layer(r) === "handler", `${layer(r)} ${snip(r, 100)}`);
      }

      r = await as(a1).fn("session-manager", { action: "get", session_id: S1.id });
      check("session-manager get: owner → 200", r.status === 200 && r.body?.session?.id === S1.id, snip(r, 100));
      r = await as(a1).fn("get-citation-details", { session_id: S1.id, citation_ids: ["TEMPLATE"] });
      record("get-citation-details: owner passes authorization", ok2xx(r) ? "PASS" : ![401, 403, 404].includes(r.status) ? "OBSERVE" : "FAIL",
        `${snip(r, 100)}${!ok2xx(r) && ![401, 403, 404].includes(r.status) ? " (past auth; downstream error)" : ""}`);
      r = await as(a1).fn("start-session", {});
      check("start-session: active member creates session in own tenant", r.status === 200 && r.body?.session?.tenant_id === A && r.body?.session?.user_id === a1.id, snip(r, 100));
      r = await as(a1).fn("kb-kick", {});
      record("kb-kick: active member passes authorization", ![401, 403].includes(r.status) ? (ok2xx(r) ? "PASS" : "OBSERVE") : "FAIL",
        `${snip(r, 100)}${!ok2xx(r) && ![401, 403].includes(r.status) ? " (past auth; downstream config/service not available locally)" : ""}`);

      r = await as(a2).fn("session-manager", { action: "get", session_id: S1.id });
      check("session-manager get: same-tenant non-owner → 403", r.status === 403 && layer(r) === "handler", snip(r, 100));
      r = await as(b1).fn("session-manager", { action: "get", session_id: S1.id });
      check("session-manager get: cross-tenant session id → 404", r.status === 404 && layer(r) === "handler", snip(r, 100));
      r = await as(b1).fn("session-manager", { action: "get", session_id: crypto.randomUUID() });
      check("session-manager get: nonexistent id → 404 (same as cross-tenant)", r.status === 404, snip(r, 100));
      r = await as(sup).fn("session-manager", { action: "get", session_id: S1.id });
      record("session-manager get: tenant A supervisor on A1 session", r.status === 200 ? "OBSERVE" : "FAIL",
        `${snip(r, 80)} — allowSupervisor=true in handler while PostgREST RLS is owner-only`);
      if (need("session-manager get: tenant A supervisor on tenant B session → 404", { SB: SB.id })) {
        r = await as(sup).fn("session-manager", { action: "get", session_id: SB.id });
        check("session-manager get: tenant A supervisor on tenant B session → 404", r.status === 404, snip(r, 100));
      }
      r = await as(b1).fn("get-citation-details", { session_id: S1.id, citation_ids: ["TEMPLATE"] });
      check("get-citation-details: cross-tenant session id → 404", r.status === 404, snip(r, 100));
      r = await as(a2).fn("upload-interview-notes-text", { session_id: S1.id, notes_text: notes });
      check("upload-interview-notes-text: same-tenant non-owner → 403", r.status === 403, snip(r, 100));
      r = await as(b1).fn("upload-interview-notes-text", { session_id: S1.id, notes_text: notes });
      check("upload-interview-notes-text: cross-tenant session id → 404", r.status === 404, snip(r, 100));
      r = await as(b1).fn("extract-case-note-text", { storage_path: `${A}/${S1.id}/${crypto.randomUUID()}.txt`, session_id: S1.id });
      check("extract-case-note-text: cross-tenant storage path → 404", r.status === 404, snip(r, 100));
      r = await as(a1).fn("extract-case-note-text", { storage_path: `${A}/${S1.id}/../x.txt`, session_id: S1.id });
      check("extract-case-note-text: traversal path → 400 (input rejected after auth)", r.status === 400, snip(r, 100));
      r = await as(a1).fn("start-session", { tenant_id: B });
      check("start-session: foreign tenant_id → 403", r.status === 403, snip(r, 100));
      r = await as(a1).fn("cleanup-orphan-sessions-dev", {});
      check("cleanup-orphan-sessions-dev: caseworker → 403", r.status === 403, snip(r, 100));

      const s2sBody = { session_id: S1.id, template_id: crypto.randomUUID() };
      r = await as(a1).fn("ensure-phase2-schema", s2sBody);
      check("ensure-phase2-schema: user JWT → 401 (handler, service caller required)", r.status === 401 && layer(r) === "handler", snip(r, 100));
      r = await http("POST", "/functions/v1/ensure-phase2-schema", { apikey: ANON, bearer: ANON, body: s2sBody });
      check("ensure-phase2-schema: legacy anon JWT → 401 (handler)", r.status === 401 && layer(r) === "handler", snip(r, 100));
      r = await http("POST", "/functions/v1/ingest-kb-text", { body: {} });
      record("ingest-kb-text: no shared secret → rejected", r.status === 401 ? "PASS" : r.status === 500 ? "OBSERVE" : "FAIL",
        r.status === 500 ? `${snip(r, 100)} (KB_INGEST_SECRET not configured locally; request still refused)` : snip(r, 100));
    }
  } catch (e) {
    record("Unexpected script error", "FAIL", (e as Error).stack ?? String(e));
  } finally {
    await teardown();
  }

  // ── Summary ──
  const count = (s: Status) => results.filter((x) => x.status === s).length;
  const green = NON_GREEN.every((s) => count(s) === 0);
  console.log(`\n== Summary (run ${RUN}): ${green ? "GREEN" : "NOT GREEN"}`);
  console.log(`  PASS ${count("PASS")}  FAIL ${count("FAIL")}  FINDING ${count("FINDING")}  BLOCKED ${count("BLOCKED")}  OBSERVE ${count("OBSERVE")}  SKIP ${count("SKIP")}`);
  for (const s of ["FAIL", "FINDING", "BLOCKED", "OBSERVE", "SKIP"] as Status[]) {
    for (const x of results.filter((y) => y.status === s)) console.log(`  ${s.padEnd(7)} [${x.section}] ${x.name}${x.detail ? ` — ${x.detail}` : ""}`);
  }
  Deno.exit(green ? 0 : 1);
}

await main();
