#!/usr/bin/env node
/**
 * demo-browser.mjs — REAL-BROWSER demo run against the actual Vite app and the
 * isolated local Supabase stack (scripts/demo-stack). Node + playwright-core
 * driving the locally installed Google Chrome (no browser download).
 *
 * Prerequisites (in order):
 *   sh scripts/demo-stack/demo-stack.sh start && sh scripts/demo-stack/demo-stack.sh env
 *   sh scripts/demo-stack/demo-stack.sh seed
 *
 * What it does:
 *   - renders scripts/demo-stack/demo-document.html to .cache/demo-stack/demo-document.pdf
 *     with headless Chrome (text layer preserved)
 *   - serves the app on http://127.0.0.1:55480 (DEMO_APP_PORT overrides the port) and stops it on exit:
 *       DEMO_SERVER=dev     (default) `vite` dev server — DEV-only panels are visible
 *       DEMO_SERVER=preview `vite build` then `vite preview` — production bundle, no
 *                           DEV-only panels. NOTE: the bundle bakes in .env.local, i.e.
 *                           VITE_REVIEWER_MODEL_SOURCE=fixture; never ship that dist/.
 *   - caseworker login -> /dashboard; Reviewer upload + run (labelled FIXTURE REPLAY,
 *     not a live model); captures the browser's report_client_event RPC bodies
 *   - supervisor login -> /supervisor; finds the metadata-only audit event and
 *     opens its detail drawer, which must show Tool = run_reviewer_v2_fixture
 *   - REST checks under real user JWTs: event_data contains no document text and
 *     only allowlisted keys + server stamps; cross-tenant / cross-role denials
 *   - screenshots -> docs/recruiter/screenshots/*.png,
 *     summary  -> docs/recruiter/screenshots/demo-evidence.json (no secrets)
 *   Exit code is non-zero if any assertion fails.
 *
 * Reads: .env.local (VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY) and
 * .cache/demo-stack/.env.demo-credentials. Never prints passwords, keys or tokens.
 */

import { chromium } from "playwright-core";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const APP_PORT = Number(process.env.DEMO_APP_PORT || 55480);
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const WORKDIR = path.join(REPO_ROOT, ".cache/demo-stack");
const CREDENTIALS_PATH = path.join(WORKDIR, ".env.demo-credentials");
const PDF_PATH = path.join(WORKDIR, "demo-document.pdf");
const HTML_PATH = path.join(REPO_ROOT, "scripts/demo-stack/demo-document.html");
const SHOTS_DIR = path.join(REPO_ROOT, "docs/recruiter/screenshots");
const EVIDENCE_PATH = path.join(SHOTS_DIR, "demo-evidence.json");
const CHROME_FALLBACK = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FIXTURE_BADGE = "Fixture replay — no live model";
const SERVER_MODE = process.env.DEMO_SERVER || "dev"; // "dev" | "preview"
if (SERVER_MODE !== "dev" && SERVER_MODE !== "preview") throw new Error(`DEMO_SERVER must be "dev" or "preview" (got "${SERVER_MODE}")`);
const FIXTURE_TOOL_NAME = "run_reviewer_v2_fixture";
const WELCOME_ACK_KEY = "aidmind_welcome_ack_v1";

const EXPECTED_EXCERPTS = [
  "Client is clearly lying about her income.",
  "She will never follow through with the housing plan.",
  "The client was rude and difficult during the whole visit.",
];
const ATTRIBUTED_QUOTE = 'Client stated "I am worried about the rent increase."';

// Metadata keys the RPC accepts from the browser + keys the server stamps itself.
const CLIENT_ALLOWLIST = [
  "tool_name", "result", "step", "error_code", "recovered_from", "question_count",
  "file_size_bytes", "page_count", "text_length", "structured_answers_count",
  "review_worthy_count", "unanswered_count", "human_review_count", "review_tier",
  "notes_source", "issue_count", "high_severity_count", "overall_risk", "reconciliation_filtered",
];
const SERVER_STAMPS = [
  "event_version", "tenant_id", "actor_type", "actor_id", "actor_role", "source",
  "verified", "result", "severity", "resource_type", "resource_id", "request_id",
];

// ───────────────────────── helpers ─────────────────────────

function readEnvFile(file) {
  if (!existsSync(file)) throw new Error(`missing ${path.relative(REPO_ROOT, file)}`);
  const out = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return out;
}

function htmlToText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every sentence of the document (>= 20 chars) — none may appear in any audit payload. */
function documentSentences(text) {
  return text.split(/(?<=[.!?]")\s+|(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length >= 20);
}

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass: !!pass, detail: String(detail) });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

async function waitFor(fn, { timeoutMs = 30000, intervalMs = 500, label = "condition" } = {}) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${label}`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// REST under a real user JWT (never the service role)
async function signIn(supabaseUrl, anonKey, email, password) {
  const r = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`sign-in failed for ${email}: HTTP ${r.status}`);
  const j = await r.json();
  return j.access_token;
}

async function restGet(supabaseUrl, anonKey, token, pathAndQuery) {
  const r = await fetch(`${supabaseUrl}${pathAndQuery}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  });
  const body = await r.json().catch(() => null);
  return { status: r.status, body };
}

async function startAppServer() {
  const bin = path.join(REPO_ROOT, "node_modules/.bin/vite");
  const serveArgs = ["--port", String(APP_PORT), "--strictPort", "--host", "127.0.0.1"];
  let args;
  if (SERVER_MODE === "preview") {
    // Production bundle: `vite build` reads .env.local, so the fixture flag is baked into dist/.
    console.log("vite build (production bundle for preview mode) ...");
    const build = spawnSync(bin, ["build"], { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
    if (build.status !== 0) throw new Error(`vite build failed: ${(build.stderr || build.stdout || "").slice(-400)}`);
    console.log("vite build finished");
    args = ["preview", ...serveArgs];
  } else {
    args = serveArgs;
  }
  const child = spawn(bin, args, {
    cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"], detached: true,
  });
  let log = "";
  child.stdout.on("data", (d) => { log += d.toString(); });
  child.stderr.on("data", (d) => { log += d.toString(); });
  await waitFor(async () => {
    if (child.exitCode !== null) throw new Error(`vite exited early: ${log.slice(-400)}`);
    try { const r = await fetch(APP_URL + "/"); return r.ok; } catch { return false; }
  }, { timeoutMs: 60000, label: `vite ${SERVER_MODE} server` });
  return child;
}

function stopVite(child) {
  if (!child || child.exitCode !== null) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch { try { child.kill("SIGTERM"); } catch { /* ignore */ } }
}

async function launchChrome() {
  try {
    return { browser: await chromium.launch({ channel: "chrome", headless: true }), launchedVia: "channel:chrome" };
  } catch (e) {
    console.log(`channel:"chrome" launch failed (${String(e.message).split("\n")[0]}); falling back to executablePath`);
    return { browser: await chromium.launch({ executablePath: CHROME_FALLBACK, headless: true }), launchedVia: "executablePath" };
  }
}

async function newContext(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((key) => { window.localStorage.setItem(key, "dismissed"); }, WELCOME_ACK_KEY);
  return ctx;
}

async function login(page, email, password) {
  await page.goto(`${APP_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.locator('button[type="submit"]').click();
}

async function signOut(page) {
  await page.locator('button[aria-label="User menu"]').click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL(/\/login$/, { timeout: 20000 });
}

// ───────────────────────── main ─────────────────────────

const startedAt = new Date().toISOString();
const appEnv = readEnvFile(path.join(REPO_ROOT, ".env.local"));
const creds = readEnvFile(CREDENTIALS_PATH);
const SUPABASE_URL = (appEnv.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const ANON_KEY = appEnv.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const SESSION_ID = creds.DEMO_SESSION_ID;

if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(SUPABASE_URL)) throw new Error("VITE_SUPABASE_URL in .env.local is not a loopback local stack; refusing");
if (!ANON_KEY) throw new Error("VITE_SUPABASE_PUBLISHABLE_KEY missing from .env.local");
if (appEnv.VITE_REVIEWER_MODEL_SOURCE !== "fixture") throw new Error("VITE_REVIEWER_MODEL_SOURCE=fixture expected in .env.local (run demo-stack.sh env)");
if (!SESSION_ID) throw new Error("DEMO_SESSION_ID missing from .cache/demo-stack/.env.demo-credentials (run the seed)");
if (creds.DEMO_SUPABASE_URL && creds.DEMO_SUPABASE_URL.replace(/\/+$/, "") !== SUPABASE_URL) throw new Error(".env.local and .env.demo-credentials point at different stacks");

mkdirSync(SHOTS_DIR, { recursive: true });
const html = readFileSync(HTML_PATH, "utf8");
const docText = htmlToText(html);
const sentences = documentSentences(docText);
const rpcBodies = [];   // { event_type, metadata_keys, status }
const evidence = {
  started_at: startedAt, app_url: APP_URL, supabase_url: SUPABASE_URL,
  reviewer_mode: "fixture_replay", live_model_run: false,
  fixture_tool_name: FIXTURE_TOOL_NAME, session_id: SESSION_ID,
  server_mode: SERVER_MODE,
  warnings: [
    "Synthetic data only: invented tenants, users (@example.test), template, schema, session and document.",
    "Reviewer output is a labelled FIXTURE REPLAY (src/services/reviewerFixtureReplay.ts); no local or hosted model was called.",
    SERVER_MODE === "preview"
      ? "server_mode=preview: dist/ was produced by `vite build` with .env.local present, so VITE_REVIEWER_MODEL_SOURCE=fixture is baked into that bundle. Do not deploy or ship dist/ from a demo run."
      : "server_mode=dev: screenshots come from the Vite dev server; DEV-only panels (import.meta.env.DEV) may be visible.",
    "The 'DEV: Cleanup Orphans' button on the supervisor header is pre-existing and not gated by import.meta.env.DEV; it may appear in either server mode.",
  ],
  chrome: null, screenshots: {}, rpc_requests: [], eye_events: [], results: [],
};

let browser = null, vite = null;
try {
  const launched = await launchChrome();
  browser = launched.browser;
  evidence.chrome = { launched_via: launched.launchedVia, version: browser.version() };
  console.log(`chrome ${browser.version()} via ${launched.launchedVia}`);

  // ── 0. Render the synthetic PDF (text layer preserved) ──
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.pdf({ path: PDF_PATH, format: "Letter", printBackground: true, margin: { top: "0.5in", bottom: "0.5in", left: "0.5in", right: "0.5in" } });
    await ctx.close();
    check("0 synthetic PDF rendered", existsSync(PDF_PATH), path.relative(REPO_ROOT, PDF_PATH));
  }

  vite = await startAppServer();
  console.log(`vite ${SERVER_MODE} server pid=${vite.pid} on ${APP_URL}`);

  // ── 1. Caseworker login → /dashboard ──
  const cwCtx = await newContext(browser);
  const cw = await cwCtx.newPage();
  cw.on("request", (req) => {
    if (req.url().includes("/rest/v1/rpc/report_client_event") && req.method() === "POST") {
      let body = null;
      try { body = JSON.parse(req.postData() || "null"); } catch { body = null; }
      const entry = { raw: req.postData() || "", body, status: undefined };
      rpcBodies.push(entry);
      req.response().then((res) => { entry.status = res ? res.status() : -1; }).catch(() => { entry.status = -1; });
    }
  });
  await login(cw, creds.DEMO_CASEWORKER_EMAIL, creds.DEMO_CASEWORKER_PASSWORD);
  await cw.waitForURL(/\/dashboard$/, { timeout: 30000 });
  await cw.waitForLoadState("networkidle").catch(() => {});
  check("1 caseworker lands on /dashboard", cw.url().endsWith("/dashboard"), cw.url());
  const shot1 = path.join(SHOTS_DIR, "01-caseworker-dashboard.png");
  await cw.screenshot({ path: shot1, fullPage: true });
  evidence.screenshots["01-caseworker-dashboard"] = path.relative(REPO_ROOT, shot1);

  // ── 2. Reviewer: upload PDF, wait for parser artifact, run fixture replay ──
  await cw.goto(`${APP_URL}/reviewer/${SESSION_ID}`, { waitUntil: "domcontentloaded" });
  await cw.getByText("Review authored language").waitFor({ timeout: 30000 });
  await cw.locator('input[type="file"]').first().setInputFiles(PDF_PATH);
  const artifactStatus = await waitFor(async () => {
    const t = await cw.evaluate(() => document.body.innerText);
    const i = t.indexOf("Parser artifacts");
    if (i < 0) return null;
    const after = t.slice(i, i + 60);
    if (/Generating|Loading/.test(after)) return null;
    return /\d+ sections/.test(after) ? "ready" : "missing";
  }, { timeoutMs: 90000, label: "parser artifact status" });
  check("2a parser artifact status settled", artifactStatus === "ready" || artifactStatus === "missing", artifactStatus);
  evidence.parser_artifact_status = artifactStatus;
  const runBtn = cw.getByRole("button", { name: "Run Reviewer" });
  await waitFor(async () => await runBtn.isEnabled().catch(() => false), { timeoutMs: 60000, label: "Run Reviewer enabled" });
  await runBtn.click();
  await cw.getByText("Primary Language Findings").waitFor({ timeout: 90000 });
  const badgeCount = await cw.getByText(FIXTURE_BADGE).count();
  check("2b fixture badge visible in header and findings", badgeCount >= 2, `badge count=${badgeCount}`);
  for (const ex of EXPECTED_EXCERPTS) {
    const n = await cw.getByText(ex).count();
    check(`2c finding shown: "${ex}"`, n >= 1, `matches=${n}`);
  }
  const quoteFlagged = await cw.locator("blockquote", { hasText: "I am worried about the rent increase" }).count();
  check("2d attributed quote not flagged", quoteFlagged === 0, `flagged blockquotes=${quoteFlagged}`);
  const shot2 = path.join(SHOTS_DIR, "02-reviewer-findings.png");
  await cw.screenshot({ path: shot2, fullPage: true });
  evidence.screenshots["02-reviewer-findings"] = path.relative(REPO_ROOT, shot2);

  // ── 3. Browser-side audit RPC bodies ──
  await waitFor(() => rpcBodies.some((r) => r.body?.p_event_type === "tool.run.completed" && r.status !== undefined), { timeoutMs: 20000, label: "tool.run.completed RPC" });
  const types = rpcBodies.map((r) => r.body?.p_event_type);
  check("3a tool.run.started sent", types.includes("tool.run.started"));
  check("3b tool.run.completed sent", types.includes("tool.run.completed"));
  check("3c no tool.run.failed sent", !types.includes("tool.run.failed"));
  const leaked = [];
  for (const r of rpcBodies) for (const s of sentences) if (r.raw.includes(s)) leaked.push(s.slice(0, 40));
  check("3d no document sentence in any RPC body", leaked.length === 0, leaked.length ? `leaked: ${leaked.join(" | ")}` : `${sentences.length} sentences checked against ${rpcBodies.length} bodies`);
  const badKeys = [];
  for (const r of rpcBodies) {
    const keys = Object.keys(r.body?.p_metadata ?? {});
    for (const k of keys) if (!CLIENT_ALLOWLIST.includes(k)) badKeys.push(k);
    evidence.rpc_requests.push({ event_type: r.body?.p_event_type, session_id: r.body?.p_session_id, metadata_keys: keys, tool_name: r.body?.p_metadata?.tool_name, http_status: r.status });
  }
  check("3e RPC metadata keys all allowlisted", badKeys.length === 0, badKeys.join(","));
  check("3f RPC tool_name discloses fixture mode", rpcBodies.every((r) => r.body?.p_metadata?.tool_name === FIXTURE_TOOL_NAME), rpcBodies.map((r) => r.body?.p_metadata?.tool_name).join(","));
  check("3g RPC calls accepted by the server", rpcBodies.every((r) => r.status >= 200 && r.status < 300), rpcBodies.map((r) => r.status).join(","));

  // ── 4. Caseworker signs out (from the dashboard header); supervisor logs in → /supervisor ──
  await cw.goto(`${APP_URL}/dashboard`, { waitUntil: "domcontentloaded" });
  await cw.locator('button[aria-label="User menu"]').waitFor({ timeout: 30000 });
  await signOut(cw);
  check("4a caseworker signed out (at /login)", cw.url().endsWith("/login"));
  await cwCtx.close();

  const supCtx = await newContext(browser);
  const sup = await supCtx.newPage();
  await login(sup, creds.DEMO_SUPERVISOR_EMAIL, creds.DEMO_SUPERVISOR_PASSWORD);
  await sup.waitForURL(/\/supervisor$/, { timeout: 30000 });
  check("4b supervisor lands on /supervisor", sup.url().endsWith("/supervisor"), sup.url());
  await sup.getByRole("tab", { name: "Sessions" }).click();
  await waitFor(async () => {
    const n = await sup.getByText(SESSION_ID, { exact: true }).count();
    if (n > 0) return true;
    await sup.getByRole("button", { name: "Refresh" }).click().catch(() => {});
    return false;
  }, { timeoutMs: 60000, intervalMs: 2000, label: "session in supervisor feed" });
  await sup.getByText(SESSION_ID, { exact: true }).first().click();
  const completedRow = sup.getByText(/tool\.run\.completed/i).first();
  await completedRow.waitFor({ timeout: 20000 });
  check("4c supervisor feed shows the session's tool.run.completed event", true);
  const shot3 = path.join(SHOTS_DIR, "03-supervisor-feed.png");
  await sup.screenshot({ path: shot3, fullPage: true });
  evidence.screenshots["03-supervisor-feed"] = path.relative(REPO_ROOT, shot3);
  await completedRow.click();
  const drawer = sup.locator("[role=dialog]");
  await drawer.waitFor({ state: "visible", timeout: 20000 });
  await drawer.getByText("Session ID").waitFor({ timeout: 20000 });
  await sup.waitForTimeout(800); // let the Sheet slide-in animation settle before capturing
  const drawerBox = await drawer.boundingBox();
  check("4d event detail drawer opened and settled in the viewport", !!drawerBox && drawerBox.x >= 0 && drawerBox.x + drawerBox.width <= 1441, drawerBox ? `x=${Math.round(drawerBox.x)} w=${Math.round(drawerBox.width)}` : "no bounding box");
  const drawerText = await sup.evaluate(() => document.body.innerText);
  const drawerLeak = sentences.filter((s) => drawerText.includes(s));
  check("4e supervisor page renders no document sentence", drawerLeak.length === 0, drawerLeak.map((s) => s.slice(0, 40)).join(" | "));
  const toolRowCount = await drawer.getByText(FIXTURE_TOOL_NAME, { exact: true }).count();
  check("4f drawer 'Tool' row discloses run_reviewer_v2_fixture", toolRowCount >= 1, `matches=${toolRowCount}`);
  const shot4 = path.join(SHOTS_DIR, "04-supervisor-event-detail.png");
  await sup.screenshot({ path: shot4, fullPage: false });
  evidence.screenshots["04-supervisor-event-detail"] = path.relative(REPO_ROOT, shot4);

  // ── 5. REST: supervisor A reads the eye_events rows; metadata-only ──
  const supToken = await signIn(SUPABASE_URL, ANON_KEY, creds.DEMO_SUPERVISOR_EMAIL, creds.DEMO_SUPERVISOR_PASSWORD);
  const supEvents = await restGet(SUPABASE_URL, ANON_KEY, supToken, `/rest/v1/eye_events?session_id=eq.${SESSION_ID}&select=id,event_type,event_data,created_at&order=created_at.desc`);
  const supRows = Array.isArray(supEvents.body) ? supEvents.body : [];
  const fixtureRows = supRows.filter((r) => r.event_data?.tool_name === FIXTURE_TOOL_NAME);
  check("5a supervisor A can read eye_events for the session", supEvents.status === 200 && supRows.length > 0, `HTTP ${supEvents.status}, rows=${supRows.length}`);
  check("5b run_reviewer_v2_fixture started+completed rows present", fixtureRows.some((r) => r.event_type === "tool.run.started") && fixtureRows.some((r) => r.event_type === "tool.run.completed"), `fixture rows=${fixtureRows.length}`);
  const eventLeak = [], eventBadKeys = [];
  for (const r of supRows) {
    const json = JSON.stringify(r.event_data ?? {});
    for (const s of sentences) if (json.includes(s)) eventLeak.push(s.slice(0, 40));
    const keys = Object.keys(r.event_data ?? {});
    for (const k of keys) if (!CLIENT_ALLOWLIST.includes(k) && !SERVER_STAMPS.includes(k)) eventBadKeys.push(k);
    evidence.eye_events.push({ id: r.id, event_type: r.event_type, created_at: r.created_at, event_data_keys: keys, tool_name: r.event_data?.tool_name, source: r.event_data?.source, verified: r.event_data?.verified, actor_role: r.event_data?.actor_role });
  }
  check("5c no document sentence in any eye_events.event_data", eventLeak.length === 0, eventLeak.join(" | "));
  check("5d event_data keys ⊆ allowlist ∪ server stamps", eventBadKeys.length === 0, eventBadKeys.join(","));
  check("5e events stamped source=client_reported, verified=false", supRows.every((r) => r.event_data?.source === "client_reported" && r.event_data?.verified === false));

  // ── 6. Denials ──
  const supBToken = await signIn(SUPABASE_URL, ANON_KEY, creds.DEMO_SUPERVISOR_OTHER_EMAIL, creds.DEMO_SUPERVISOR_OTHER_PASSWORD);
  const supBEvents = await restGet(SUPABASE_URL, ANON_KEY, supBToken, `/rest/v1/eye_events?session_id=eq.${SESSION_ID}&select=id`);
  check("6a supervisor of tenant B sees 0 eye_events for the session (filtered)", supBEvents.status === 200 && Array.isArray(supBEvents.body) && supBEvents.body.length === 0, `HTTP ${supBEvents.status}, rows=${Array.isArray(supBEvents.body) ? supBEvents.body.length : "n/a"}`);

  const cw2Token = await signIn(SUPABASE_URL, ANON_KEY, creds.DEMO_CASEWORKER2_EMAIL, creds.DEMO_CASEWORKER2_PASSWORD);
  const cw2Sessions = await restGet(SUPABASE_URL, ANON_KEY, cw2Token, `/rest/v1/sessions?session_id=eq.${SESSION_ID}&select=id`);
  check("6b same-tenant non-owner caseworker sees 0 sessions rows (owner-scoped)", cw2Sessions.status === 200 && Array.isArray(cw2Sessions.body) && cw2Sessions.body.length === 0, `HTTP ${cw2Sessions.status}, rows=${Array.isArray(cw2Sessions.body) ? cw2Sessions.body.length : "n/a"}`);
  const cw2Ctx = await newContext(browser);
  const cw2 = await cw2Ctx.newPage();
  await login(cw2, creds.DEMO_CASEWORKER2_EMAIL, creds.DEMO_CASEWORKER2_PASSWORD);
  await cw2.waitForURL(/\/dashboard$/, { timeout: 30000 });
  await cw2.goto(`${APP_URL}/reviewer/${SESSION_ID}`, { waitUntil: "domcontentloaded" });
  await cw2.getByText("Session not found").waitFor({ timeout: 30000 });
  check("6c non-owner caseworker UI shows 'Session not found'", true);
  const shot5 = path.join(SHOTS_DIR, "05-crosstenant-denied.png");
  await cw2.screenshot({ path: shot5, fullPage: true });
  evidence.screenshots["05-crosstenant-denied"] = path.relative(REPO_ROOT, shot5);
  await cw2Ctx.close();

  const cwToken = await signIn(SUPABASE_URL, ANON_KEY, creds.DEMO_CASEWORKER_EMAIL, creds.DEMO_CASEWORKER_PASSWORD);
  const cwEvents = await restGet(SUPABASE_URL, ANON_KEY, cwToken, `/rest/v1/eye_events?session_id=eq.${SESSION_ID}&select=id`);
  check("6d owning caseworker sees 0 eye_events rows (no caseworker read policy)", cwEvents.status === 200 && Array.isArray(cwEvents.body) && cwEvents.body.length === 0, `HTTP ${cwEvents.status}, rows=${Array.isArray(cwEvents.body) ? cwEvents.body.length : "n/a"}`);

  await sup.goto(`${APP_URL}/dashboard`, { waitUntil: "domcontentloaded" });
  await sup.waitForURL(/\/supervisor$/, { timeout: 30000 });
  check("6e supervisor navigating to /dashboard is redirected to /supervisor", sup.url().endsWith("/supervisor"), sup.url());
  await supCtx.close();
} catch (e) {
  check("run completed without exception", false, String(e?.message ?? e).split("\n")[0]);
} finally {
  stopVite(vite);
  if (browser) await browser.close().catch(() => {});
}

evidence.results = results;
evidence.finished_at = new Date().toISOString();
evidence.pass_count = results.filter((r) => r.pass).length;
evidence.fail_count = results.filter((r) => !r.pass).length;
writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + "\n");

console.log("\nRESULT  CHECK");
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}    ${r.name}`);
console.log(`\n${evidence.pass_count} passed, ${evidence.fail_count} failed — evidence: ${path.relative(REPO_ROOT, EVIDENCE_PATH)} (reviewer mode: fixture replay, no live model; server mode: ${SERVER_MODE})`);
process.exit(evidence.fail_count === 0 ? 0 : 1);
