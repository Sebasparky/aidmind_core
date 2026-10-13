// deno-lint-ignore-file no-explicit-any
/**
 * seed-demo.ts — synthetic, idempotent seed for the ISOLATED demo stack
 * (scripts/demo-stack, project_id "aidmind_demo", API 127.0.0.1:55421; overridable via
 * DEMO_PROJECT_ID / DEMO_API_PORT, which demo-stack.sh passes through).
 *
 * Creates/updates (upsert by natural key, so it can be rerun after `db reset`):
 *   tenants      A "Riverside Family Services", B "Northgate Community Support"
 *   auth users   caseworker.demo / caseworker2.demo / supervisor.demo / auditor.demo
 *                (tenant A), supervisor.other (tenant B) — all @example.test, invented people
 *   profiles     status 'active'; user_roles per role; tenant_users memberships
 *   kb_templates "Housing Stability Check-In" v1 (SECTION headings) for tenant A
 *   template_phase2_schemas  active schema with a top-level `fields` array
 *   sessions     one READY_FOR_INPUT session for caseworker A (fixed session_id)
 *
 * Patterns reused from scripts/runtime-verify-local.ts: GoTrue admin user
 * creation (display_name metadata -> handle_new_user trigger) and profile/role
 * activation with the service role.
 *
 * Keys come from `supabase --workdir .cache/demo-stack status -o env` and are never
 * printed. Passwords are generated with crypto and written ONLY to
 * .cache/demo-stack/.env.demo-credentials (gitignored, mode 600). Output is a
 * non-secret summary (ids, emails, counts).
 *
 * Run via: sh scripts/demo-stack/demo-stack.sh seed   (or npm run demo:seed)
 */

const WORKDIR = ".cache/demo-stack";
const PROJECT_ID = Deno.env.get("DEMO_PROJECT_ID") || "aidmind_demo";
const API_PORT = Deno.env.get("DEMO_API_PORT") || "55421";
const CREDENTIALS_PATH = `${WORKDIR}/.env.demo-credentials`;

const DEMO_SESSION_ID = "7d2f3c1e-5a4b-4c8d-9e6f-0a1b2c3d4e5f";
const DEMO_CASE_ID = "HS-24017";

let API = "";
let SERVICE = "";

function redact(s: string): string {
  return s
    .replace(/eyJ[A-Za-z0-9_.-]+/g, "[REDACTED_JWT]")
    .replace(/sb_[A-Za-z0-9_-]+/g, "[REDACTED_KEY]");
}

// ───────────────────────── stack discovery + guard ─────────────────────────

async function loadStack() {
  const cfg = await Deno.readTextFile(`${WORKDIR}/supabase/config.toml`);
  if (!new RegExp(`^project_id = "${PROJECT_ID}"$`, "m").test(cfg)) {
    throw new Error(`refusing: ${WORKDIR}/supabase/config.toml does not carry project_id "${PROJECT_ID}"`);
  }
  const out = await new Deno.Command("supabase", {
    args: ["--workdir", WORKDIR, "status", "-o", "env"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!out.success) {
    throw new Error(`supabase status failed: ${redact(new TextDecoder().decode(out.stderr)).slice(0, 300)}`);
  }
  const env: Record<string, string> = {};
  for (const line of new TextDecoder().decode(out.stdout).split("\n")) {
    const m = /^([A-Z_]+)=(?:"(.*)"|(.*))$/.exec(line.trim());
    if (m) env[m[1]] = m[2] ?? m[3] ?? "";
  }
  API = (env.API_URL ?? "").replace(/\/+$/, "");
  SERVICE = env.SERVICE_ROLE_KEY ?? "";
  let u: URL;
  try { u = new URL(API); } catch { throw new Error("API_URL missing from supabase status"); }
  if (!["127.0.0.1", "localhost"].includes(u.hostname) || u.port !== API_PORT) {
    throw new Error(`refusing: API_URL is not the demo stack on loopback:${API_PORT} (got ${u.hostname}:${u.port})`);
  }
  if (!SERVICE) throw new Error("SERVICE_ROLE_KEY missing from supabase status");
}

// ───────────────────────── HTTP (service role; setup only) ─────────────────────────

interface Res { status: number; body: any }

async function http(method: string, path: string, body?: unknown, prefer?: string): Promise<Res> {
  const headers: Record<string, string> = {
    apikey: SERVICE,
    Authorization: `Bearer ${SERVICE}`,
    "Content-Type": "application/json",
  };
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: r.status, body: parsed };
}

function mustOk(label: string, r: Res): Res {
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`${label}: HTTP ${r.status} ${redact(JSON.stringify(r.body)).slice(0, 300)}`);
  }
  return r;
}

const rest = {
  get: (p: string) => http("GET", p),
  post: (p: string, body: unknown) => http("POST", p, body, "return=representation"),
  patch: (p: string, body: unknown) => http("PATCH", p, body, "return=representation"),
};

function rows(r: Res): any[] { return Array.isArray(r.body) ? r.body : []; }

// ───────────────────────── fixtures ─────────────────────────

function generatePassword(): string {
  // 24 random bytes -> base64url; in memory only, written to the gitignored credentials file
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `Demo-${b64}`;
}

async function upsertTenant(name: string, slug: string): Promise<string> {
  const existing = rows(await rest.get(`/rest/v1/tenants?slug=eq.${encodeURIComponent(slug)}&select=id`));
  if (existing.length > 0) {
    mustOk(`tenant ${slug} update`, await rest.patch(`/rest/v1/tenants?id=eq.${existing[0].id}`, { name, is_active: true }));
    return existing[0].id as string;
  }
  const r = mustOk(`tenant ${slug}`, await rest.post("/rest/v1/tenants", { name, slug, is_active: true }));
  return r.body[0].id as string;
}

async function findUserByEmail(email: string): Promise<string | null> {
  for (let page = 1; page <= 10; page++) {
    const r = mustOk("list users", await http("GET", `/auth/v1/admin/users?page=${page}&per_page=200`));
    const users: any[] = r.body?.users ?? [];
    const hit = users.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());
    if (hit) return hit.id as string;
    if (users.length < 200) break;
  }
  return null;
}

async function upsertUser(email: string, displayName: string, password: string): Promise<string> {
  const existingId = await findUserByEmail(email);
  if (existingId) {
    mustOk(`user ${email} update`, await http("PUT", `/auth/v1/admin/users/${existingId}`, {
      password, email_confirm: true, user_metadata: { display_name: displayName },
    }));
    return existingId;
  }
  const r = mustOk(`user ${email}`, await http("POST", "/auth/v1/admin/users", {
    email, password, email_confirm: true, user_metadata: { display_name: displayName },
  }));
  return (r.body?.id ?? r.body?.user?.id) as string;
}

async function activateUser(userId: string, displayName: string, role: "caseworker" | "supervisor" | "auditor", tenantId: string) {
  // handle_new_user creates profile(pending) + role(caseworker); fall back if the trigger is absent.
  const prof = rows(await rest.get(`/rest/v1/profiles?user_id=eq.${userId}&select=user_id`));
  if (prof.length === 0) {
    mustOk("profile insert", await rest.post("/rest/v1/profiles", { user_id: userId, display_name: displayName, status: "active" }));
  } else {
    mustOk("profile activate", await rest.patch(`/rest/v1/profiles?user_id=eq.${userId}`, { display_name: displayName, status: "active" }));
  }
  const roleRow = rows(await rest.get(`/rest/v1/user_roles?user_id=eq.${userId}&select=role`));
  if (roleRow.length === 0) {
    mustOk("role insert", await rest.post("/rest/v1/user_roles", { user_id: userId, role }));
  } else if (roleRow[0].role !== role) {
    mustOk("role update", await rest.patch(`/rest/v1/user_roles?user_id=eq.${userId}`, { role }));
  }
  const member = rows(await rest.get(`/rest/v1/tenant_users?user_id=eq.${userId}&tenant_id=eq.${tenantId}&select=id`));
  if (member.length === 0) {
    mustOk("membership", await rest.post("/rest/v1/tenant_users", { tenant_id: tenantId, user_id: userId }));
  }
}

const TEMPLATE_NAME = "Housing Stability Check-In";
const TEMPLATE_CONTENT = [
  "HOUSING STABILITY CHECK-IN",
  "",
  "SECTION 1: Client Information",
  "Client Name:",
  "Visit Date:",
  "",
  "SECTION 2: Housing Status",
  "Current Housing Status: [ ] Stably housed [ ] At risk of losing housing [ ] Temporarily staying with others [ ] Unsheltered",
  "Rent Burden: [ ] Under 30% of income [ ] 30-50% of income [ ] Over 50% of income",
  "Lease In Place: [ ] Yes [ ] No",
  "",
  "SECTION 3: Housing Narrative",
  "Housing Narrative:",
  "",
  "SECTION 4: Worker Assessment",
  "Worker Assessment:",
  "",
  "SECTION 5: Next Steps",
  "Next Steps:",
].join("\n");

function field(partial: Record<string, unknown>) {
  return {
    fact_based: true,
    allowed_values: null,
    requires_direct_statement: false,
    return_null_if_missing: true,
    matching_guidance: "Take the text that follows the field label on the same line.",
    examples: [],
    requires_human_review: false,
    human_review_reason: null,
    sensitivity_level: "low",
    ambiguity_level: "low",
    extraction_priority: "medium",
    field_group: null,
    ...partial,
  };
}

const SCHEMA_JSON = {
  schema_version: 2,
  template_name: TEMPLATE_NAME,
  fields: [
    field({ field_key: "client_name", label: "Client Name", template_prompt: "Client Name", answer_type: "string", matching_mode: "extract_literal_span", section: "Client Information", content_type: "identifier", sensitivity_level: "medium", extraction_priority: "high" }),
    field({ field_key: "visit_date", label: "Visit Date", template_prompt: "Visit Date", answer_type: "date", matching_mode: "extract_date", section: "Client Information", content_type: "factual" }),
    field({ field_key: "housing_status", label: "Current Housing Status", template_prompt: "Current Housing Status", answer_type: "enum", matching_mode: "select_one", allowed_values: ["Stably housed", "At risk of losing housing", "Temporarily staying with others", "Unsheltered"], section: "Housing Status", content_type: "categorical", extraction_priority: "high" }),
    field({ field_key: "rent_burden", label: "Rent Burden", template_prompt: "Rent Burden", answer_type: "enum", matching_mode: "select_one", allowed_values: ["Under 30% of income", "30-50% of income", "Over 50% of income"], section: "Housing Status", content_type: "categorical" }),
    field({ field_key: "lease_in_place", label: "Lease In Place", template_prompt: "Lease In Place", answer_type: "boolean", matching_mode: "boolean_decision", allowed_values: ["Yes", "No"], section: "Housing Status", content_type: "checkbox" }),
    field({ field_key: "housing_narrative", label: "Housing Narrative", template_prompt: "Housing Narrative", answer_type: "string", matching_mode: "extract_short_text", fact_based: false, section: "Housing Narrative", content_type: "narrative", ambiguity_level: "medium", extraction_priority: "high", matching_guidance: "Authored narrative describing the visit and housing situation." }),
    field({ field_key: "worker_assessment", label: "Worker Assessment", template_prompt: "Worker Assessment", answer_type: "string", matching_mode: "extract_short_text", fact_based: false, section: "Worker Assessment", content_type: "narrative", ambiguity_level: "medium", extraction_priority: "high", matching_guidance: "Authored assessment of housing stability risk." }),
    field({ field_key: "next_steps", label: "Next Steps", template_prompt: "Next Steps", answer_type: "string", matching_mode: "extract_short_text", fact_based: false, section: "Next Steps", content_type: "narrative", ambiguity_level: "medium", matching_guidance: "Authored follow-up actions." }),
  ],
};

async function upsertTemplate(tenantId: string): Promise<string> {
  const existing = rows(await rest.get(`/rest/v1/kb_templates?tenant_id=eq.${tenantId}&name=eq.${encodeURIComponent(TEMPLATE_NAME)}&select=id`));
  const payload = { tenant_id: tenantId, name: TEMPLATE_NAME, version: "1", content: TEMPLATE_CONTENT, content_type: "text", extraction_status: "ready", is_active: true };
  if (existing.length > 0) {
    mustOk("template update", await rest.patch(`/rest/v1/kb_templates?id=eq.${existing[0].id}`, payload));
    return existing[0].id as string;
  }
  const r = mustOk("template insert", await rest.post("/rest/v1/kb_templates", payload));
  return r.body[0].id as string;
}

async function upsertSchema(tenantId: string, templateId: string): Promise<string> {
  const existing = rows(await rest.get(`/rest/v1/template_phase2_schemas?template_id=eq.${templateId}&is_active=eq.true&select=id`));
  const payload = { template_id: templateId, tenant_id: tenantId, schema_version: 1, status: "active", is_active: true, schema_json: SCHEMA_JSON, model: "seed-demo (hand-written, no model)", generation_notes: "Synthetic demo schema written by scripts/demo-stack/seed-demo.ts", generated_at: new Date().toISOString() };
  if (existing.length > 0) {
    mustOk("schema update", await rest.patch(`/rest/v1/template_phase2_schemas?id=eq.${existing[0].id}`, payload));
    return existing[0].id as string;
  }
  const r = mustOk("schema insert", await rest.post("/rest/v1/template_phase2_schemas", payload));
  return r.body[0].id as string;
}

async function upsertSession(tenantId: string, userId: string, templateId: string, schemaId: string): Promise<string> {
  const existing = rows(await rest.get(`/rest/v1/sessions?session_id=eq.${DEMO_SESSION_ID}&select=id`));
  const payload = {
    session_id: DEMO_SESSION_ID,
    case_id: DEMO_CASE_ID,
    case_label: "Housing stability check-in",
    interaction_type: "Home visit",
    guidance_scope: "housing_homelessness",
    state: "READY_FOR_INPUT",
    tenant_id: tenantId,
    user_id: userId,
    template_id: templateId,
    phase2_schema_id: schemaId,
    metadata: {},
    ttl_expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    closed_at: null,
    cancelled_at: null,
  };
  if (existing.length > 0) {
    mustOk("session update", await rest.patch(`/rest/v1/sessions?session_id=eq.${DEMO_SESSION_ID}`, payload));
    return existing[0].id as string;
  }
  const r = mustOk("session insert", await rest.post("/rest/v1/sessions", payload));
  return r.body[0].id as string;
}

// ───────────────────────── main ─────────────────────────

async function main() {
  await loadStack();
  console.log(`demo stack: ${API} (project_id=${PROJECT_ID})`);

  const tenantA = await upsertTenant("Riverside Family Services", "riverside-family-services");
  const tenantB = await upsertTenant("Northgate Community Support", "northgate-community-support");

  const specs: Array<{ key: string; email: string; name: string; role: "caseworker" | "supervisor" | "auditor"; tenant: string }> = [
    { key: "CASEWORKER", email: "caseworker.demo@example.test", name: "Dana Okafor", role: "caseworker", tenant: tenantA },
    { key: "CASEWORKER2", email: "caseworker2.demo@example.test", name: "Priya Natarajan", role: "caseworker", tenant: tenantA },
    { key: "SUPERVISOR", email: "supervisor.demo@example.test", name: "Morgan Reyes", role: "supervisor", tenant: tenantA },
    { key: "SUPERVISOR_OTHER", email: "supervisor.other@example.test", name: "Elliot Mbeki", role: "supervisor", tenant: tenantB },
    { key: "AUDITOR", email: "auditor.demo@example.test", name: "Harriet Lindqvist", role: "auditor", tenant: tenantA },
  ];

  const credLines: string[] = [
    "# Generated by scripts/demo-stack/seed-demo.ts — synthetic demo credentials for the ISOLATED local stack only.",
    "# Gitignored. Never commit, paste or print these values.",
    `DEMO_SUPABASE_URL=${API}`,
    `DEMO_PROJECT_ID=${PROJECT_ID}`,
    `DEMO_SESSION_ID=${DEMO_SESSION_ID}`,
    `DEMO_TENANT_A_ID=${tenantA}`,
    `DEMO_TENANT_B_ID=${tenantB}`,
  ];
  const users: Record<string, string> = {};
  for (const s of specs) {
    const password = generatePassword();
    const id = await upsertUser(s.email, s.name, password);
    await activateUser(id, s.name, s.role, s.tenant);
    users[s.key] = id;
    credLines.push(`DEMO_${s.key}_EMAIL=${s.email}`);
    credLines.push(`DEMO_${s.key}_PASSWORD=${password}`);
    console.log(`user ${s.email.padEnd(32)} id=${id} role=${s.role} tenant=${s.tenant === tenantA ? "A" : "B"} profile=active`);
  }

  const templateId = await upsertTemplate(tenantA);
  const schemaId = await upsertSchema(tenantA, templateId);
  const sessionUuid = await upsertSession(tenantA, users.CASEWORKER, templateId, schemaId);
  credLines.push(`DEMO_TEMPLATE_ID=${templateId}`);
  credLines.push(`DEMO_SCHEMA_ID=${schemaId}`);

  await Deno.writeTextFile(CREDENTIALS_PATH, credLines.join("\n") + "\n", { mode: 0o600 });
  await Deno.chmod(CREDENTIALS_PATH, 0o600);

  console.log(`tenant A ${tenantA} (riverside-family-services)`);
  console.log(`tenant B ${tenantB} (northgate-community-support)`);
  console.log(`template ${templateId} "${TEMPLATE_NAME}" v1 (${TEMPLATE_CONTENT.length} chars)`);
  console.log(`schema   ${schemaId} active, ${SCHEMA_JSON.fields.length} fields`);
  console.log(`session  session_id=${DEMO_SESSION_ID} id=${sessionUuid} case_id=${DEMO_CASE_ID} state=READY_FOR_INPUT`);
  console.log(`credentials written to ${CREDENTIALS_PATH} (mode 600; ${specs.length} users; values not shown)`);
}

try {
  await main();
} catch (e) {
  console.error(`seed failed: ${redact((e as Error).message)}`);
  Deno.exit(1);
}
