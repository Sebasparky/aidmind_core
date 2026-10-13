#!/usr/bin/env node
/**
 * record-demo.mjs — repeatable demo recordings of the REAL app against the isolated
 * local Supabase stack (scripts/demo-stack). Node + playwright-core driving the
 * locally installed Google Chrome (no browser download, no ffmpeg download).
 *
 * Usage: node scripts/demo-stack/record-demo.mjs <flag>
 *   --prepare          start/reuse this project's stack, write .env.local, seed, vite build
 *   --verify-auditor   browser + REST checks under the auditor account (no recording)
 *   --overview         record the short overview (caseworker + supervisor segments)
 *   --walkthrough      record the longer walkthrough (caseworker + supervisor + auditor)
 *   --export [overview|walkthrough|all]   assemble single-file WebM exports (canvas + MediaRecorder)
 *   --frames [overview|walkthrough|export|all]  PNG frames from the actual video files
 *   --teardown         stop only the stack/processes this recorder started
 *   --all              prepare, verify-auditor, overview, walkthrough, export, frames all,
 *                      teardown (only if this invocation started the stack)
 *
 * Environment overrides (same names and defaults as demo-stack.sh):
 *   DEMO_PROJECT_ID (aidmind_demo), DEMO_PORT_BASE (55420) + DEMO_{SHADOW,API,DB,STUDIO,SMTP,
 *   ANALYTICS,POOLER}_PORT, DEMO_INSPECTOR_PORT (8083), DEMO_APP_PORT (55480).
 *   DEMO_RECORD_RUN optionally pins the run timestamp (raw/<run-timestamp>/).
 *
 * Output (all secret-free):
 *   docs/recruiter/recordings/raw/<run-timestamp>/*.webm   one WebM (VP8) per recorded context
 *   docs/recruiter/recordings/export/aidmind-{overview,walkthrough}.webm
 *   docs/recruiter/recordings/frames/<video-name>/NNN-t<sec>s.png
 *   docs/recruiter/recordings/manifest.json, auditor-evidence.json
 *
 * Credentials are typed only in NON-recorded contexts; the recorded context receives the
 * session through in-memory storageState (never written to disk). Never prints passwords,
 * keys or tokens.
 */

import { spawn, spawnSync } from "node:child_process";
import {
  readFileSync, writeFileSync, mkdirSync, existsSync, lstatSync, chmodSync,
  unlinkSync, rmSync, readdirSync, statSync, createReadStream, createWriteStream,
} from "node:fs";
import { fileURLToPath } from "node:url";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const STACK_SH = path.join(REPO_ROOT, "scripts/demo-stack/demo-stack.sh");
const WORKDIR = path.join(REPO_ROOT, ".cache/demo-stack");
const STATE_PATH = path.join(WORKDIR, "record-state.json");
const CREDENTIALS_PATH = path.join(WORKDIR, ".env.demo-credentials");
const PDF_PATH = path.join(WORKDIR, "demo-document.pdf");
const HTML_PATH = path.join(REPO_ROOT, "scripts/demo-stack/demo-document.html");
const REC_DIR = path.join(REPO_ROOT, "docs/recruiter/recordings");
const RAW_ROOT = path.join(REC_DIR, "raw");
const EXPORT_DIR = path.join(REC_DIR, "export");
const FRAMES_DIR = path.join(REC_DIR, "frames");
const MANIFEST_PATH = path.join(REC_DIR, "manifest.json");
const AUDITOR_EVIDENCE_PATH = path.join(REC_DIR, "auditor-evidence.json");
const CHROME_FALLBACK = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FIXTURE_BADGE = "Fixture replay — no live model";
const FIXTURE_TOOL_NAME = "run_reviewer_v2_fixture";
const WELCOME_ACK_KEY = "aidmind_welcome_ack_v1";
const VIEWPORT = { width: 1440, height: 900 };
const EXPECTED_EXCERPTS = [
  "Client is clearly lying about her income.",
  "She will never follow through with the housing plan.",
  "The client was rude and difficult during the whole visit.",
];
const QUOTE_TEXT = "I am worried about the rent increase";

// ── env overrides (defaults identical to demo-stack.sh) ──
function envInt(name, dflt) {
  const v = process.env[name];
  if (v === undefined || v === "") return dflt;
  if (!/^\d+$/.test(v)) throw new Error(`${name} must be numeric`);
  return Number(v);
}
const PROJECT_ID = process.env.DEMO_PROJECT_ID || "aidmind_demo";
if (!/^[A-Za-z0-9_-]+$/.test(PROJECT_ID)) throw new Error("DEMO_PROJECT_ID must match [A-Za-z0-9_-]+");
const PORT_BASE = envInt("DEMO_PORT_BASE", 55420);
const PORTS = {
  shadow: envInt("DEMO_SHADOW_PORT", PORT_BASE + 0),
  api: envInt("DEMO_API_PORT", PORT_BASE + 1),
  db: envInt("DEMO_DB_PORT", PORT_BASE + 2),
  studio: envInt("DEMO_STUDIO_PORT", PORT_BASE + 3),
  smtp: envInt("DEMO_SMTP_PORT", PORT_BASE + 4),
  analytics: envInt("DEMO_ANALYTICS_PORT", PORT_BASE + 7),
  pooler: envInt("DEMO_POOLER_PORT", PORT_BASE + 9),
  inspector: envInt("DEMO_INSPECTOR_PORT", 8083),
  app: envInt("DEMO_APP_PORT", 55480),
};
const APP_URL = `http://127.0.0.1:${PORTS.app}`;
const ENV_OVERRIDES = Object.fromEntries(
  ["DEMO_PROJECT_ID", "DEMO_PORT_BASE", "DEMO_SHADOW_PORT", "DEMO_API_PORT", "DEMO_DB_PORT", "DEMO_STUDIO_PORT",
    "DEMO_SMTP_PORT", "DEMO_ANALYTICS_PORT", "DEMO_POOLER_PORT", "DEMO_INSPECTOR_PORT", "DEMO_APP_PORT", "DEMO_RECORD_RUN"]
    .filter((k) => process.env[k] !== undefined && process.env[k] !== "")
    .map((k) => [k, process.env[k]]),
);

// ───────────────────────── small helpers ─────────────────────────

function redact(s) {
  return String(s)
    .replace(/eyJ[A-Za-z0-9_.-]+/g, "[REDACTED_JWT]")
    .replace(/sb_[A-Za-z0-9_-]+/g, "[REDACTED_KEY]")
    .replace(/(PASSWORD=)\S+/g, "$1[REDACTED]");
}
const log = (...a) => console.log(redact(a.join(" ")));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rel = (p) => path.relative(REPO_ROOT, p);

function readEnvFile(file) {
  if (!existsSync(file)) throw new Error(`missing ${rel(file)}`);
  const out = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return out;
}

function readJson(file, dflt) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return dflt; }
}

function loadState() { return readJson(STATE_PATH, {}); }
function saveState(patch) {
  mkdirSync(WORKDIR, { recursive: true });
  const s = { ...loadState(), ...patch, project_id: PROJECT_ID, ports: PORTS, updated_at: new Date().toISOString() };
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2) + "\n");
  return s;
}

function runTimestamp() {
  if (process.env.DEMO_RECORD_RUN) {
    if (!/^[0-9A-Za-z_-]+$/.test(process.env.DEMO_RECORD_RUN)) throw new Error("DEMO_RECORD_RUN must match [0-9A-Za-z_-]+");
    return process.env.DEMO_RECORD_RUN;
  }
  const st = loadState();
  if (st.run_timestamp) return st.run_timestamp;
  const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  saveState({ run_timestamp: ts });
  return ts;
}

function portListening(port) {
  const r = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
  return r.status === 0 && /LISTEN/.test(r.stdout || "");
}

function projectContainers() {
  const r = spawnSync("podman", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`podman ps failed: ${(r.stderr || "").slice(0, 200)}`);
  return (r.stdout || "").split("\n").map((s) => s.trim()).filter((n) => n.endsWith(`_${PROJECT_ID}`));
}

function stackEnv(extra = {}) {
  return { ...process.env, ...extra };
}

function runStack(cmd, extra = {}) {
  log(`$ sh scripts/demo-stack/demo-stack.sh ${cmd}`);
  const r = spawnSync("sh", [STACK_SH, cmd], { cwd: REPO_ROOT, env: stackEnv(extra), stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out = redact((r.stdout || "") + (r.stderr || ""));
  process.stdout.write(out.endsWith("\n") || out === "" ? out : out + "\n");
  if (r.status !== 0) throw new Error(`demo-stack.sh ${cmd} exited ${r.status}`);
  return out;
}

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass: !!pass, detail: redact(detail) });
  log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  return !!pass;
}

async function waitFor(fn, { timeoutMs = 30000, intervalMs = 500, label = "condition" } = {}) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${label}`);
    await sleep(intervalMs);
  }
}

function htmlToText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
}
function documentSentences(text) {
  return text.split(/(?<=[.!?]")\s+|(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length >= 20);
}

// ───────────────────────── owned processes + cleanup ─────────────────────────

const owned = { vite: null, browser: null, server: null };
let cleaningUp = false;

async function cleanupOwned() {
  if (owned.browser) { const b = owned.browser; owned.browser = null; await b.close().catch(() => {}); }
  if (owned.server) { const s = owned.server; owned.server = null; await new Promise((r) => s.close(() => r())); }
  if (owned.vite) { stopVite(owned.vite); owned.vite = null; }
  const st = loadState();
  if (Array.isArray(st.pids) && st.pids.length) saveState({ pids: st.pids.filter((p) => p.pid !== process.pid && isAlive(p.pid) && p.owner !== process.pid) });
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    if (cleaningUp) return;
    cleaningUp = true;
    log(`received ${sig}; stopping owned processes`);
    await cleanupOwned().catch(() => {});
    process.exit(130);
  });
}

function isAlive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }

function recordPid(pid, kind) {
  const st = loadState();
  const pids = (st.pids || []).filter((p) => isAlive(p.pid));
  pids.push({ pid, kind, owner: process.pid, started_at: new Date().toISOString() });
  saveState({ pids });
}

function stopVite(child) {
  if (!child || child.exitCode !== null) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch { try { child.kill("SIGTERM"); } catch { /* ignore */ } }
}

async function startPreview() {
  if (portListening(PORTS.app)) throw new Error(`app port ${PORTS.app} is already listening (not ours); refusing`);
  if (!existsSync(path.join(REPO_ROOT, "dist/index.html"))) throw new Error("dist/ missing: run --prepare first (vite build)");
  const bin = path.join(REPO_ROOT, "node_modules/.bin/vite");
  const child = spawn(bin, ["preview", "--port", String(PORTS.app), "--strictPort", "--host", "127.0.0.1"], {
    cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"], detached: true,
  });
  owned.vite = child;
  recordPid(child.pid, "vite-preview");
  let out = "";
  child.stdout.on("data", (d) => { out += d.toString(); });
  child.stderr.on("data", (d) => { out += d.toString(); });
  await waitFor(async () => {
    if (child.exitCode !== null) throw new Error(`vite preview exited early: ${redact(out.slice(-400))}`);
    try { const r = await fetch(APP_URL + "/"); return r.ok; } catch { return false; }
  }, { timeoutMs: 60000, label: "vite preview" });
  log(`vite preview pid=${child.pid} on ${APP_URL}`);
  return child;
}

// ───────────────────────── playwright (local ffmpeg shim, no download) ─────────────────────────

let chromium = null;
async function loadPlaywright() {
  if (chromium) return chromium;
  const browsersPath = path.join(REPO_ROOT, ".cache/ms-playwright");
  const pwPkg = readJson(path.join(REPO_ROOT, "node_modules/playwright-core/browsers.json"), { browsers: [] });
  const ff = (pwPkg.browsers || []).find((b) => b.name === "ffmpeg");
  const rev = ff?.revision || "1013";
  const ffDir = path.join(browsersPath, `ffmpeg-${rev}`);
  const target = path.join(ffDir, "ffmpeg-mac");
  const cachedRoot = path.join(os.homedir(), "Library/Caches/ms-playwright");
  let source = null;
  if (existsSync(cachedRoot)) {
    const dirs = readdirSync(cachedRoot).filter((d) => /^ffmpeg-\d+$/.test(d)).sort().reverse();
    for (const d of dirs) {
      const cand = path.join(cachedRoot, d, "ffmpeg-mac");
      if (existsSync(cand)) { source = cand; break; }
    }
  }
  mkdirSync(ffDir, { recursive: true });
  if (!source) throw new Error(`no cached ffmpeg-mac under ${cachedRoot}; recordVideo needs ffmpeg revision ${rev} (download not allowed)`);
  // Playwright 1.64 asks ffmpeg for VP9 (-c:v libvpx-vp9 -tile-columns N -row-mt 1); the cached build
  // only has the VP8 encoder (libvpx) and rejects those options. Write a /bin/sh adapter that drops
  // -tile-columns/-row-mt (with their values) and maps libvpx-vp9 -> libvpx, then execs the cached binary.
  // Always rewrite; unlink first so an old symlink is replaced, never followed into the cached binary.
  try { lstatSync(target); unlinkSync(target); } catch { /* missing */ }
  const shq = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;
  const adapter = [
    "#!/bin/sh",
    "# Generated by scripts/demo-stack/record-demo.mjs: Playwright ffmpeg adapter (VP9 request -> VP8 libvpx).",
    `REAL=${shq(source)}`,
    "n=$#; skip=0",
    'for a in "$@"; do',
    "  if [ $skip -eq 1 ]; then skip=0; continue; fi",
    '  case "$a" in',
    "    -tile-columns|-row-mt) skip=1; continue ;;",
    "    libvpx-vp9) a=libvpx ;;",
    "  esac",
    '  set -- "$@" "$a"',
    "done",
    "shift $n",
    'exec "$REAL" "$@"',
    "",
  ].join("\n");
  writeFileSync(target, adapter, { mode: 0o755 });
  chmodSync(target, 0o755);
  for (const marker of ["INSTALLATION_COMPLETE", "DEPENDENCIES_VALIDATED"]) {
    const m = path.join(ffDir, marker);
    if (!existsSync(m)) writeFileSync(m, "");
  }
  process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;
  log(`playwright ffmpeg shim: ${rel(target)} (sh adapter: drops -tile-columns/-row-mt, libvpx-vp9 -> libvpx; execs ${source.replace(os.homedir(), "~")}), PLAYWRIGHT_BROWSERS_PATH=${rel(browsersPath)}`);
  ({ chromium } = await import("playwright-core"));
  return chromium;
}

async function launchChrome() {
  await loadPlaywright();
  const args = ["--autoplay-policy=no-user-gesture-required"];
  let browser, via;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true, args });
    via = "channel:chrome";
  } catch (e) {
    log(`channel:"chrome" launch failed (${String(e.message).split("\n")[0]}); falling back to executablePath`);
    browser = await chromium.launch({ executablePath: CHROME_FALLBACK, headless: true, args });
    via = "executablePath";
  }
  owned.browser = browser;
  log(`chrome ${browser.version()} via ${via}`);
  return { browser, via, version: browser.version() };
}

// ───────────────────────── app config + auth ─────────────────────────

function appConfig() {
  const appEnv = readEnvFile(path.join(REPO_ROOT, ".env.local"));
  const creds = readEnvFile(CREDENTIALS_PATH);
  const supabaseUrl = (appEnv.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
  if (supabaseUrl !== `http://127.0.0.1:${PORTS.api}` && supabaseUrl !== `http://localhost:${PORTS.api}`) {
    throw new Error(`.env.local VITE_SUPABASE_URL is not this run's stack on loopback:${PORTS.api}; run --prepare`);
  }
  if (!appEnv.VITE_SUPABASE_PUBLISHABLE_KEY) throw new Error("VITE_SUPABASE_PUBLISHABLE_KEY missing from .env.local");
  if (appEnv.VITE_REVIEWER_MODEL_SOURCE !== "fixture") throw new Error("VITE_REVIEWER_MODEL_SOURCE=fixture expected in .env.local");
  if (creds.DEMO_PROJECT_ID && creds.DEMO_PROJECT_ID !== PROJECT_ID) throw new Error("credentials were seeded for a different project id; run --prepare");
  if (!creds.DEMO_SESSION_ID) throw new Error("DEMO_SESSION_ID missing from credentials; run --prepare");
  return { supabaseUrl, anonKey: appEnv.VITE_SUPABASE_PUBLISHABLE_KEY, creds, sessionId: creds.DEMO_SESSION_ID };
}

const ROLES = {
  caseworker: { credKey: "CASEWORKER", landing: "/dashboard", label: "Caseworker" },
  supervisor: { credKey: "SUPERVISOR", landing: "/supervisor", label: "Supervisor" },
  auditor: { credKey: "AUDITOR", landing: "/auditor", label: "Auditor" },
};

async function plainContext(browser) {
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  await ctx.addInitScript((key) => { window.localStorage.setItem(key, "dismissed"); }, WELCOME_ACK_KEY);
  return ctx;
}

/** Log in through the real /login UI in a NON-recorded context. Returns the open context + page. */
async function loginContext(browser, cfg, role) {
  const r = ROLES[role];
  const email = cfg.creds[`DEMO_${r.credKey}_EMAIL`];
  const password = cfg.creds[`DEMO_${r.credKey}_PASSWORD`];
  if (!email || !password) throw new Error(`credentials for ${role} missing; run --prepare (seed)`);
  const ctx = await plainContext(browser);
  const page = await ctx.newPage();
  await page.goto(`${APP_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(new RegExp(`${r.landing.replace("/", "\\/")}$`), { timeout: 30000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  return { ctx, page };
}

async function signIn(cfg, email, password) {
  const r = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: cfg.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`sign-in failed for ${email}: HTTP ${r.status}`);
  return (await r.json()).access_token;
}

// ───────────────────────── overlays (non-app, pointer-events:none) ─────────────────────────

function overlayInitScript({ roleLabel, ackKey }) {
  try { window.localStorage.setItem(ackKey, "dismissed"); } catch { /* ignore */ }
  const install = () => {
    if (document.getElementById("__demo_cursor")) return;
    const root = document.documentElement;
    const cursor = document.createElement("div");
    cursor.id = "__demo_cursor";
    cursor.setAttribute("aria-hidden", "true");
    cursor.innerHTML = '<svg width="22" height="26" viewBox="0 0 22 26" xmlns="http://www.w3.org/2000/svg"><path d="M2 2 L2 21 L7 16.5 L10.5 24 L14 22.5 L10.5 15 L17.5 15 Z" fill="#111827" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem("__demo_cursor_pos") || "null"); } catch { /* ignore */ }
    const start = saved || { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) };
    Object.assign(cursor.style, {
      position: "fixed", left: `${start.x}px`, top: `${start.y}px`, width: "22px", height: "26px",
      marginLeft: "-2px", marginTop: "-2px", pointerEvents: "none", zIndex: "2147483647",
      filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.35))",
    });
    const bar = document.createElement("div");
    bar.id = "__demo_caption";
    bar.setAttribute("aria-hidden", "true");
    Object.assign(bar.style, {
      position: "fixed", left: "8px", bottom: "6px", height: "22px", lineHeight: "22px", padding: "0 10px",
      borderRadius: "4px", background: "rgba(17,24,39,0.78)", color: "#f9fafb",
      font: "500 12px/22px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      pointerEvents: "none", zIndex: "2147483646", whiteSpace: "nowrap", letterSpacing: "0.01em",
    });
    const render = () => {
      bar.textContent = `${roleLabel} · synthetic data · fixture replay, no live model · local isolated stack · ${location.pathname}`;
    };
    render();
    setInterval(render, 250);
    root.appendChild(bar);
    root.appendChild(cursor);
    const ring = document.createElement("div");
    Object.assign(ring.style, {
      position: "fixed", width: "26px", height: "26px", borderRadius: "50%", border: "2px solid rgba(37,99,235,0.85)",
      pointerEvents: "none", zIndex: "2147483646", opacity: "0", transition: "opacity 300ms ease-out", marginLeft: "-13px", marginTop: "-13px",
    });
    root.appendChild(ring);
    window.addEventListener("mousemove", (e) => {
      cursor.style.left = `${e.clientX}px`;
      cursor.style.top = `${e.clientY}px`;
      try { sessionStorage.setItem("__demo_cursor_pos", JSON.stringify({ x: e.clientX, y: e.clientY })); } catch { /* ignore */ }
    }, true);
    window.addEventListener("mousedown", (e) => {
      ring.style.left = `${e.clientX}px`; ring.style.top = `${e.clientY}px`; ring.style.transition = "none"; ring.style.opacity = "1";
      requestAnimationFrame(() => { ring.style.transition = "opacity 450ms ease-out"; ring.style.opacity = "0"; });
    }, true);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
}

const OVERLAYS = [
  { id: "__demo_cursor", kind: "synthetic cursor", detail: "DOM arrow following real mousemove events (page.mouse.move with ~25 steps), pointer-events:none, max z-index; brief click ring on mousedown" },
  { id: "__demo_caption", kind: "caption bar", detail: "22 px dark pill at bottom-left: '<Role> · synthetic data · fixture replay, no live model · local isolated stack · <location.pathname>', pointer-events:none" },
];

// ───────────────────────── recorded segments ─────────────────────────

class Segment {
  constructor({ flow, role, index, page, ctx, t0, file }) {
    Object.assign(this, { flow, role, index, page, ctx, t0, file });
    this.scenes = [];
    this.cur = null;
  }
  now() { return +((Date.now() - this.t0) / 1000).toFixed(2); }
  start(id, title) {
    if (this.cur) this.end();
    this.cur = { id, title, role: this.role, start_s: this.now(), end_s: null, assertions: [] };
    log(`  [${this.flow}/${this.role}] scene ${id} @ ${this.cur.start_s}s — ${title}`);
  }
  assert(name, pass, detail = "") {
    const a = { name, pass: !!pass, detail: redact(detail) };
    if (this.cur) this.cur.assertions.push(a);
    check(`${this.flow}/${this.role}/${this.cur?.id ?? "-"}: ${name}`, pass, detail);
    return !!pass;
  }
  end() {
    if (!this.cur) return;
    this.cur.end_s = this.now();
    this.cur.pass = this.cur.assertions.every((a) => a.pass);
    this.scenes.push(this.cur);
    this.cur = null;
  }
}

// Deliberate on-screen pauses. The walkthrough lengthens them (PAUSE_SCALE) so viewers can read each panel;
// the overview keeps the base timings (scale 1).
let PAUSE_SCALE = 1;
async function pause(page, ms) { await page.waitForTimeout(Math.round(ms * PAUSE_SCALE)); }

async function moveTo(page, locator, { steps = 25 } = {}) {
  await locator.waitFor({ state: "visible", timeout: 30000 });
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  const box = await locator.boundingBox();
  if (!box) throw new Error("element has no bounding box");
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps });
  return { x, y };
}

async function moveAndClick(page, locator, { pauseMs = 600, steps = 25 } = {}) {
  await waitFor(async () => await locator.isEnabled().catch(() => false), { timeoutMs: 60000, label: "element enabled" });
  const { x, y } = await moveTo(page, locator, { steps });
  await pause(page, pauseMs);
  await page.mouse.click(x, y);
}

/** Slow wheel scroll until the locator's top is in the upper-middle of the viewport. */
async function slowScrollTo(page, locator, { targetY = 260, step = 90, waitMs = 140, maxSteps = 80 } = {}) {
  await locator.waitFor({ state: "attached", timeout: 30000 });
  // put the pointer over the element's scroll container so wheel events scroll it
  const pt = await locator.evaluate((el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const oy = getComputedStyle(p).overflowY;
      if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight + 4) {
        const r = p.getBoundingClientRect();
        const top = Math.max(r.top, 0), bottom = Math.min(r.bottom, window.innerHeight);
        return { x: r.left + r.width / 2, y: top + (bottom - top) / 2 };
      }
    }
    return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  }).catch(() => null);
  if (pt) await page.mouse.move(pt.x, pt.y, { steps: 15 });
  for (let i = 0; i < maxSteps; i++) {
    const box = await locator.boundingBox();
    if (!box) break;
    const delta = box.y - targetY;
    if (Math.abs(delta) < step) break;
    await page.mouse.wheel(0, Math.sign(delta) * Math.min(step, Math.abs(delta)));
    await page.waitForTimeout(waitMs);
    const after = await locator.boundingBox();
    if (after && Math.abs(after.y - box.y) < 1) break; // container cannot scroll further
  }
  const fin = await locator.boundingBox();
  if (fin && (fin.y < 0 || fin.y + fin.height > VIEWPORT.height)) {
    await locator.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
    await page.waitForTimeout(900);
  }
}

async function slowScrollBy(page, dy, { step = 80, waitMs = 140 } = {}) {
  const n = Math.ceil(Math.abs(dy) / step);
  for (let i = 0; i < n; i++) { await page.mouse.wheel(0, Math.sign(dy) * step); await page.waitForTimeout(waitMs); }
}

async function errorToastCount(page) {
  return await page.locator('li[data-sonner-toast][data-type="error"], [role="status"].destructive, li.destructive').count();
}

async function openRecordedSegment(browser, cfg, { flow, role, index, rawDir }) {
  const { ctx: loginCtx } = await loginContext(browser, cfg, role);
  const storageState = await loginCtx.storageState(); // in memory only — never written to disk
  await loginCtx.close();
  const ctx = await browser.newContext({
    storageState, viewport: VIEWPORT, recordVideo: { dir: rawDir, size: VIEWPORT },
  });
  await ctx.addInitScript(overlayInitScript, { roleLabel: ROLES[role].label, ackKey: WELCOME_ACK_KEY });
  const page = await ctx.newPage();
  const t0 = Date.now();
  const file = path.join(rawDir, `${String(index).padStart(2, "0")}-${flow}-${role}.webm`);
  await page.goto(`${APP_URL}${ROLES[role].landing}`, { waitUntil: "domcontentloaded" });
  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
  return new Segment({ flow, role, index, page, ctx, t0, file });
}

async function closeSegment(seg) {
  seg.end();
  const video = seg.page.video();
  await seg.ctx.close();
  const produced = await video.path().catch(() => null);
  if (!produced || !existsSync(produced)) {
    throw new Error(`ffmpeg produced no video for ${seg.flow}/${seg.role} (expected ${produced ? rel(produced) : "a recordVideo file"}; rerun with DEBUG=pw:browser)`);
  }
  if (existsSync(seg.file)) rmSync(seg.file);
  await video.saveAs(seg.file);
  await video.delete().catch(() => {});
  log(`  saved ${rel(seg.file)} (${statSync(seg.file).size} bytes)`);
  const lead = seg.scenes.length ? seg.scenes[0].start_s : 0;
  return { file: rel(seg.file), role: seg.role, index: seg.index, lead_in_s: lead, scenes: seg.scenes, t0_note: "offsets are seconds since the recorded page was created (video start)" };
}

async function ensurePdf(browser) {
  if (existsSync(PDF_PATH)) return;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.setContent(readFileSync(HTML_PATH, "utf8"), { waitUntil: "load" });
  await page.pdf({ path: PDF_PATH, format: "Letter", printBackground: true, margin: { top: "0.5in", bottom: "0.5in", left: "0.5in", right: "0.5in" } });
  await ctx.close();
  log(`rendered ${rel(PDF_PATH)}`);
}

// ── caseworker scenes ──
async function caseworkerFlow(seg, cfg, { walkthrough }) {
  const p = seg.page;
  seg.start("cw-dashboard", "Caseworker dashboard — Active Sessions");
  const active = p.getByRole("heading", { name: "Active Sessions" });
  await active.waitFor({ timeout: 30000 });
  await p.waitForLoadState("networkidle").catch(() => {});
  seg.assert("lands on /dashboard", p.url().endsWith("/dashboard"), new URL(p.url()).pathname);
  seg.assert("Active Sessions heading visible", await active.isVisible());
  const rvCount = await p.getByRole("button", { name: /^(Reviewer|View Review)$/ }).count();
  seg.assert("seeded session listed with a Reviewer action", rvCount >= 1, `reviewer buttons=${rvCount}`);
  await pause(p, 3500);

  if (walkthrough) {
    seg.start("cw-session-history", "Caseworker dashboard — Session History");
    const hist = p.getByRole("heading", { name: "Session History" });
    await hist.waitFor({ timeout: 20000 });
    await moveTo(p, active);
    await slowScrollTo(p, hist, { targetY: 200 });
    seg.assert("Session History heading visible", await hist.isVisible());
    seg.assert("no error toast", (await errorToastCount(p)) === 0);
    await pause(p, 3000);
    await slowScrollTo(p, active, { targetY: 160 });
    await pause(p, 1500);
  }

  seg.start("cw-open-reviewer", "Open the Reviewer on the seeded session");
  const reviewerBtn = p.getByRole("button", { name: /^(Reviewer|View Review)$/ }).first();
  await moveAndClick(p, reviewerBtn);
  await p.waitForURL(new RegExp(`/reviewer/${cfg.sessionId}$`), { timeout: 30000 });
  await p.getByText("Review authored language").waitFor({ timeout: 30000 });
  seg.assert("Reviewer opened for the seeded session", p.url().endsWith(`/reviewer/${cfg.sessionId}`), new URL(p.url()).pathname);
  const badge0 = await p.getByText(FIXTURE_BADGE).count();
  seg.assert("fixture badge visible before the run", badge0 >= 1, `badge count=${badge0}`);
  await moveTo(p, p.getByText(FIXTURE_BADGE).first());
  await pause(p, 3000);

  seg.start("cw-upload", "Upload the synthetic PDF");
  const dropzone = p.locator('input[type="file"] + div[role="button"]').first();
  let uploadedVia = "filechooser";
  try {
    const chooser = p.waitForEvent("filechooser", { timeout: 8000 });
    await moveAndClick(p, dropzone);
    const fc = await chooser;
    await fc.setFiles(PDF_PATH);
  } catch {
    uploadedVia = "setInputFiles";
    await p.locator('input[type="file"]').first().setInputFiles(PDF_PATH);
  }
  const artifactStatus = await waitFor(async () => {
    const t = await p.evaluate(() => document.body.innerText);
    const i = t.indexOf("Parser artifacts");
    if (i < 0) return null;
    const after = t.slice(i, i + 60);
    if (/Generating|Loading/.test(after)) return null;
    return /\d+ sections/.test(after) ? "ready" : "missing";
  }, { timeoutMs: 90000, label: "parser artifact status" });
  seg.assert("PDF uploaded and parser artifact status settled", artifactStatus === "ready" || artifactStatus === "missing", `${artifactStatus} (via ${uploadedVia})`);
  await pause(p, 3000);

  seg.start("cw-run-reviewer", "Run Reviewer (fixture replay)");
  const runBtn = p.getByRole("button", { name: "Run Reviewer" });
  await moveAndClick(p, runBtn);
  await p.getByText("Primary Language Findings").waitFor({ timeout: 90000 });
  const badge = await p.getByText(FIXTURE_BADGE).count();
  seg.assert("fixture badge visible in header and findings", badge >= 2, `badge count=${badge}`);
  seg.assert("no error toast", (await errorToastCount(p)) === 0);
  await pause(p, 3000);

  seg.start("cw-findings", "Three findings and the unflagged attributed quote");
  // Reviewer result tabs are forceMount + `hidden` when inactive: only target visible matches.
  for (const ex of EXPECTED_EXCERPTS) {
    const loc = p.getByText(ex).filter({ visible: true }).first();
    const n = await p.getByText(ex).filter({ visible: true }).count();
    if (n > 0) { await slowScrollTo(p, loc, { targetY: 300 }); await moveTo(p, loc, { steps: 20 }); }
    seg.assert(`finding shown: "${ex}"`, n >= 1, `visible matches=${n}`);
    await pause(p, 3000);
  }
  const flagged = await p.locator("blockquote", { hasText: QUOTE_TEXT }).count();
  seg.assert("attributed quote not flagged", flagged === 0, `flagged blockquotes=${flagged}`);
  await pause(p, 1000);
  // The attributed quote lives in the document text, not in any finding: show it on the Extracted Text tab.
  await moveAndClick(p, p.getByRole("tab", { name: "Extracted Text" }));
  const quote = p.getByText(QUOTE_TEXT).filter({ visible: true }).first();
  await quote.waitFor({ state: "visible", timeout: 15000 });
  await pause(p, 1000);
  await slowScrollTo(p, quote, { targetY: 320 });
  await moveTo(p, quote, { steps: 20 });
  seg.assert("attributed quote visible in Extracted Text", await quote.isVisible());
  await pause(p, 5000);
  seg.end();
}

// ── supervisor scenes ──
// Real empty states rendered by the app (src/components/supervisor/*Panel.tsx) when there is no data; these
// cards have no title, so they are accepted as an honest "rendered" state and labelled as such.
const PANEL_EMPTY_STATES = {
  "System Issues": ["No issues at this time", "No new issues."],
  "Verified Data Deletions": ["No purge proof events yet"],
};

async function panelStatus(page, title) {
  let label = title;
  let card = page.locator("div.bg-card", { has: page.getByText(title, { exact: true }) }).first();
  if (!(await card.count())) {
    for (const alt of PANEL_EMPTY_STATES[title] || []) {
      const c = page.locator("div.bg-card", { has: page.getByText(alt, { exact: true }) }).first();
      if (await c.count()) { card = c; label = alt; break; }
    }
  }
  const present = await card.count() > 0;
  if (!present) return { panel: title, label, rendered: false, error: "card not found" };
  await card.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  await waitFor(async () => !(await card.locator(".animate-spin").count()), { timeoutMs: 20000, label: `${title} loaded` }).catch(() => {});
  // SVG icons can carry .text-destructive; their innerText is undefined, so read textContent defensively.
  const errs = await card.locator(".text-destructive").evaluateAll((els) => els.map((e) => e.innerText ?? e.textContent ?? "")).catch(() => []);
  const errText = errs.map((t) => String(t ?? "").trim()).filter((t) => /error|fail|unable|denied|permission|not allowed|EYE_|invalid|could not|unauthor/i.test(t));
  return { panel: title, label, empty_state: label !== title, rendered: true, error: errText.length ? errText.join(" | ").slice(0, 200) : null };
}

async function supervisorPrecheck(page) {
  // Non-recorded: classify each extra panel; erroring panels are kept out of footage.
  const out = {};
  const headerError = async () => (await page.locator("main .text-destructive").filter({ hasText: /error|fail|unable/i }).count()) > 0;
  const visit = async (tab, titles) => {
    await page.getByRole("tab", { name: tab }).click();
    await page.waitForTimeout(1200);
    for (const t of titles) out[t] = { tab, ...(await panelStatus(page, t)) };
  };
  await visit("Daily Assurance", ["Daily Assurance"]);
  await visit("System Issues", ["System Issues"]);
  await visit("Data Deletion Proof", ["Verified Data Deletions"]);
  await visit("Governance", ["Generative AI Authorization", "Compliance Export", "Security Dashboard"]);
  const hdr = await headerError();
  for (const k of Object.keys(out)) {
    out[k].toast_errors = await errorToastCount(page);
    out[k].page_error = hdr;
    out[k].working = out[k].rendered && !out[k].error && !hdr;
  }
  return out;
}

async function supervisorFlow(seg, cfg, { walkthrough, panels }) {
  const p = seg.page;
  const sentences = documentSentences(htmlToText(readFileSync(HTML_PATH, "utf8")));
  seg.start("sup-landing", "Supervisor landing — Daily Assurance");
  await p.getByRole("tab", { name: "Sessions" }).waitFor({ timeout: 30000 });
  await p.waitForLoadState("networkidle").catch(() => {});
  seg.assert("lands on /supervisor", p.url().endsWith("/supervisor"), new URL(p.url()).pathname);
  if (walkthrough && panels?.["Daily Assurance"]?.working) {
    const da = p.getByText("Daily Assurance", { exact: true }).last();
    seg.assert("Daily Assurance panel rendered without error", (await panelStatus(p, "Daily Assurance")).error === null);
    await moveTo(p, da);
    await pause(p, 2000);
    await slowScrollBy(p, 400);
    await pause(p, 2500);
    await slowScrollBy(p, -400);
  }
  await pause(p, 3500);

  seg.start("sup-sessions", "Sessions tab — metadata-only event feed");
  await moveAndClick(p, p.getByRole("tab", { name: "Sessions" }));
  await waitFor(async () => {
    const n = await p.getByText(cfg.sessionId, { exact: true }).count();
    if (n > 0) return true;
    await p.getByRole("button", { name: "Refresh" }).click().catch(() => {});
    return false;
  }, { timeoutMs: 60000, intervalMs: 2000, label: "session in supervisor feed" });
  seg.assert("seeded session visible in feed", (await p.getByText(cfg.sessionId, { exact: true }).count()) >= 1);
  await pause(p, 2500);

  seg.start("sup-select-session", "Select the session");
  await moveAndClick(p, p.getByText(cfg.sessionId, { exact: true }).first());
  const completedRow = p.getByText(/tool\.run\.completed/i).first();
  await completedRow.waitFor({ timeout: 20000 });
  seg.assert("session's tool.run.completed event listed", await completedRow.isVisible());
  await pause(p, 3000);

  seg.start("sup-event-drawer", "Event detail drawer — Tool: run_reviewer_v2_fixture (metadata-only record)");
  await moveAndClick(p, completedRow);
  const drawer = p.locator("[role=dialog]");
  await drawer.waitFor({ state: "visible", timeout: 20000 });
  await drawer.getByText("Session ID").waitFor({ timeout: 20000 });
  await p.waitForTimeout(800);
  const toolRow = await drawer.getByText(FIXTURE_TOOL_NAME, { exact: true }).count();
  seg.assert("drawer 'Tool' row discloses run_reviewer_v2_fixture", toolRow >= 1, `matches=${toolRow}`);
  const txt = await p.evaluate(() => document.body.innerText);
  const leak = sentences.filter((s) => txt.includes(s));
  seg.assert("supervisor page renders no document sentence", leak.length === 0, leak.map((s) => s.slice(0, 30)).join(" | "));
  await moveTo(p, drawer.getByText(FIXTURE_TOOL_NAME, { exact: true }).first());
  await pause(p, 5000);
  const box = await drawer.boundingBox();
  if (box) { await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 20 }); await slowScrollBy(p, 320); }
  await pause(p, 4500);

  if (walkthrough) {
    await p.keyboard.press("Escape");
    await drawer.waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
    await pause(p, 1200);
    const tabs = [
      { tab: "System Issues", titles: ["System Issues"], id: "sup-system-issues" },
      { tab: "Data Deletion Proof", titles: ["Verified Data Deletions"], id: "sup-deletion-proof" },
      { tab: "Governance", titles: ["Generative AI Authorization", "Compliance Export", "Security Dashboard"], id: "sup-governance" },
    ];
    for (const t of tabs) {
      const ok = t.titles.every((x) => panels?.[x]?.working);
      if (!ok) { log(`  skipping ${t.tab} in footage (precheck: not working)`); continue; }
      seg.start(t.id, `${t.tab} (view only)`);
      await moveAndClick(p, p.getByRole("tab", { name: t.tab }));
      await pause(p, 1500);
      for (const title of t.titles) {
        const st = await panelStatus(p, title);
        seg.assert(`${title} rendered without error`, st.rendered && !st.error, st.error || (st.empty_state ? `app empty state: "${st.label}"` : ""));
        const head = p.getByText(st.label || title, { exact: true }).last();
        await moveTo(p, head, { steps: 20 }).catch(() => {});
        await pause(p, 2200);
      }
      seg.assert("no error toast", (await errorToastCount(p)) === 0);
      if (t.tab === "Governance") { await slowScrollBy(p, 300); await pause(p, 2000); await slowScrollBy(p, -300); }
      await pause(p, 1500);
    }
  }
  seg.end();
}

// ── auditor scenes ──
async function auditorFlow(seg) {
  const p = seg.page;
  seg.start("aud-cards", "Auditor landing — compliance cards");
  const h1 = p.getByRole("heading", { name: "Compliance Audit View" });
  await h1.waitFor({ timeout: 30000 });
  await p.waitForLoadState("networkidle").catch(() => {});
  seg.assert("lands on /auditor", p.url().endsWith("/auditor"), new URL(p.url()).pathname);
  for (const t of ["AI Authorization", "LLM Compliance", "Deletion Proof"]) {
    const n = await p.locator('[data-tour^="aud-card-"]').filter({ hasText: t }).count();
    seg.assert(`card "${t}" visible`, n >= 1, `matches=${n}`);
  }
  const errDiv = await p.locator("main > div.text-destructive").count();
  seg.assert("no page-level load error", errDiv === 0, `error blocks=${errDiv}`);
  for (const sel of ['[data-tour="aud-card-ai-auth"]', '[data-tour="aud-card-llm-compliance"]', '[data-tour="aud-card-deletion-proof"]']) {
    await moveTo(p, p.locator(sel), { steps: 20 });
    await pause(p, 1600);
  }

  seg.start("aud-timeline", "Event Timeline tab (read-only)");
  await moveAndClick(p, p.getByRole("tab", { name: "Event Timeline" }));
  const tl = p.getByText("Eye Event Timeline", { exact: true });
  await tl.waitFor({ timeout: 15000 });
  seg.assert("Eye Event Timeline visible", await tl.isVisible());
  await moveTo(p, tl);
  await slowScrollBy(p, 360);
  await pause(p, 2500);
  await slowScrollBy(p, -360);
  await pause(p, 1000);

  seg.start("aud-deletion-proof", "Deletion Proof tab");
  await moveAndClick(p, p.getByRole("tab", { name: "Deletion Proof" }));
  // PurgeProofPanel renders "Verified Data Deletions" when purge events exist, else its own empty state.
  const vd = p.getByText("Verified Data Deletions", { exact: true }).or(p.getByText("No purge proof events yet", { exact: true })).first();
  await vd.waitFor({ state: "visible", timeout: 15000 });
  const vdText = (await vd.textContent().catch(() => null)) ?? "";
  seg.assert("Deletion Proof panel visible (verified deletions or app empty state)", await vd.isVisible(), String(vdText).trim());
  await moveTo(p, vd);
  await pause(p, 2500);

  seg.start("aud-access-notice", "Auditor Access Notice");
  const notice = p.getByText("Auditor Access Notice", { exact: true });
  await slowScrollTo(p, notice, { targetY: 520 });
  await moveTo(p, notice, { steps: 20 });
  seg.assert("Auditor Access Notice visible", await notice.isVisible());
  await pause(p, 3500);

  seg.start("aud-denial-supervisor", "Auditor requests /supervisor and lands on /auditor");
  await p.goto(`${APP_URL}/supervisor`, { waitUntil: "domcontentloaded" });
  await p.waitForURL(/\/auditor$/, { timeout: 30000 });
  await h1.waitFor({ timeout: 30000 });
  seg.assert("/supervisor redirected to /auditor", p.url().endsWith("/auditor"), new URL(p.url()).pathname);
  await pause(p, 3500);
  seg.end();
}

async function measureDurations(browser, files) {
  const srv = await startFileServer();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${srv.origin}/blank`);
  const out = {};
  for (const f of files) {
    out[f] = await page.evaluate(measureInPage, `${srv.origin}/file/${encodeURIComponent(f)}`);
  }
  await ctx.close();
  await new Promise((r) => srv.server.close(() => r()));
  owned.server = null;
  return out;
}

async function recordFlow(flow) {
  const cfg = appConfig();
  const ts = runTimestamp();
  const rawDir = path.join(RAW_ROOT, ts);
  mkdirSync(rawDir, { recursive: true });
  // replace only this flow's previous raw files for this run timestamp
  for (const f of readdirSync(rawDir)) if (new RegExp(`^\\d\\d-${flow}-`).test(f) || /^[0-9a-f]{32}\.webm$/.test(f)) rmSync(path.join(rawDir, f));
  const walkthrough = flow === "walkthrough";
  PAUSE_SCALE = walkthrough ? 1.8 : 1;
  const { browser, version } = await launchChrome();
  await startPreview();
  await ensurePdf(browser);
  const segments = [];
  let panels = null;
  let failed = null;
  try {
    let seg = await openRecordedSegment(browser, cfg, { flow, role: "caseworker", index: 1, rawDir });
    try { await caseworkerFlow(seg, cfg, { walkthrough }); } catch (e) { failed = e; seg.assert("segment completed", false, String(e.message).split("\n")[0]); }
    segments.push(await closeSegment(seg));
    if (failed) throw failed;

    if (walkthrough) {
      const { ctx, page } = await loginContext(browser, cfg, "supervisor");
      try { panels = await supervisorPrecheck(page); } finally { await ctx.close().catch(() => {}); }
      for (const [k, v] of Object.entries(panels)) log(`  precheck ${k}: ${v.working ? "WORKING (rendered, no error)" : `NOT FILMED (${v.error || "not rendered"})`}`);
    }
    seg = await openRecordedSegment(browser, cfg, { flow, role: "supervisor", index: 2, rawDir });
    try { await supervisorFlow(seg, cfg, { walkthrough, panels }); } catch (e) { failed = e; seg.assert("segment completed", false, String(e.message).split("\n")[0]); }
    segments.push(await closeSegment(seg));
    if (failed) throw failed;

    if (walkthrough) {
      seg = await openRecordedSegment(browser, cfg, { flow, role: "auditor", index: 3, rawDir });
      try { await auditorFlow(seg); } catch (e) { failed = e; seg.assert("segment completed", false, String(e.message).split("\n")[0]); }
      segments.push(await closeSegment(seg));
      if (failed) throw failed;
    }
  } catch (e) {
    check(`${flow} recording completed without exception`, false, String(e?.message ?? e).split("\n")[0]);
    if (e?.stack) log(`stack (redacted):\n${String(e.stack).split("\n").slice(0, 12).join("\n")}`);
  } finally {
    if (owned.vite) { stopVite(owned.vite); owned.vite = null; }
  }
  const durations = await measureDurations(browser, segments.map((s) => s.file)).catch((e) => { log(`duration measurement failed: ${e.message}`); return {}; });
  for (const s of segments) {
    s.measured_duration_s = durations[s.file]?.duration ?? null;
    s.duration_method = durations[s.file]?.method ?? null;
  }
  const total = segments.reduce((a, s) => a + (s.measured_duration_s || 0), 0);
  const trimmed = segments.reduce((a, s) => a + Math.max(0, (s.measured_duration_s || 0) - s.lead_in_s), 0);
  updateManifest((m) => {
    m.chrome_version = version;
    m.videos[flow] = {
      format: "WebM (VP8) written by Playwright recordVideo via the cached Playwright ffmpeg build (n7.0.1, VP8-only) through a generated /bin/sh adapter (.cache/ms-playwright/ffmpeg-<rev>/ffmpeg-mac) that maps the requested libvpx-vp9 to libvpx and drops -tile-columns/-row-mt; no other encoder installed",
      raw_dir: rel(rawDir), segments, intended_order: segments.map((s) => s.file),
      measured_total_s: +total.toFixed(2), measured_total_after_lead_in_trim_s: +trimmed.toFixed(2),
      panel_status: panels,
      pause_scale: PAUSE_SCALE,
      recorded_at: new Date().toISOString(),
      overlays: OVERLAYS,
    };
  });
  for (const s of segments) log(`  ${s.file}: ${s.measured_duration_s}s (${s.duration_method}); lead-in ${s.lead_in_s}s; ${s.scenes.length} scenes`);
  log(`${flow}: measured total ${total.toFixed(1)}s, after lead-in trim ${trimmed.toFixed(1)}s`);
  await cleanupOwned();
}

// ───────────────────────── manifest ─────────────────────────

function updateManifest(fn) {
  mkdirSync(REC_DIR, { recursive: true });
  const ts = runTimestamp();
  let m = readJson(MANIFEST_PATH, null);
  if (!m || m.run_timestamp !== ts) {
    m = { run_timestamp: ts, videos: {}, exports: {}, frames: {} };
  }
  m.generated_at = new Date().toISOString();
  m.project_id = PROJECT_ID;
  m.ports = PORTS;
  m.env_overrides = ENV_OVERRIDES;
  m.app_url = APP_URL;
  m.disclosures = [
    "Synthetic data only: invented tenants, @example.test users, template, session and document.",
    "Reviewer output is a labelled FIXTURE REPLAY (VITE_REVIEWER_MODEL_SOURCE=fixture); no local or hosted model was called.",
    "Local isolated Supabase stack (supabase CLI, podman); not production.",
    "Credentials were typed only in non-recorded browser contexts; recorded contexts received an in-memory storageState.",
  ];
  m.overlays = OVERLAYS;
  m.videos ||= {}; m.exports ||= {}; m.frames ||= {};
  fn(m);
  const json = JSON.stringify(m, null, 2) + "\n";
  if (/eyJ|sb_|PASSWORD=/.test(json)) throw new Error("manifest would contain a secret-like string (eyJ/sb_/PASSWORD=); not written");
  writeFileSync(MANIFEST_PATH, json);
  const back = readFileSync(MANIFEST_PATH, "utf8");
  if (/eyJ|sb_|PASSWORD=/.test(back)) throw new Error("manifest grep found eyJ/sb_/PASSWORD=");
  log(`manifest updated: ${rel(MANIFEST_PATH)} (secret grep: clean)`);
}

// ───────────────────────── loopback file server (range + upload) ─────────────────────────

const PLAYER_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>player</title>
<style>html,body{margin:0;background:#000}canvas,video{display:block}</style></head><body></body></html>`;

function startFileServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const u = new URL(req.url, "http://127.0.0.1");
        if (u.pathname === "/blank") { res.writeHead(200, { "Content-Type": "text/html" }); res.end(PLAYER_HTML); return; }
        if (u.pathname.startsWith("/file/") && req.method === "GET") {
          const relPath = decodeURIComponent(u.pathname.slice(6));
          const abs = path.resolve(REPO_ROOT, relPath);
          if (!abs.startsWith(REC_DIR + path.sep) || !abs.endsWith(".webm") || !existsSync(abs)) { res.writeHead(404); res.end(); return; }
          const size = statSync(abs).size;
          const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
          if (range) {
            const start = range[1] ? Number(range[1]) : 0;
            const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
            res.writeHead(206, { "Content-Type": "video/webm", "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
            createReadStream(abs, { start, end }).pipe(res);
          } else {
            res.writeHead(200, { "Content-Type": "video/webm", "Accept-Ranges": "bytes", "Content-Length": size });
            createReadStream(abs).pipe(res);
          }
          return;
        }
        if (u.pathname.startsWith("/upload/") && req.method === "POST") {
          const name = u.pathname.slice(8);
          if (!/^[a-z0-9-]+\.webm$/.test(name)) { res.writeHead(400); res.end(); return; }
          mkdirSync(EXPORT_DIR, { recursive: true });
          const out = createWriteStream(path.join(EXPORT_DIR, name));
          req.pipe(out);
          out.on("finish", () => { res.writeHead(200); res.end("ok"); });
          out.on("error", () => { res.writeHead(500); res.end(); });
          return;
        }
        if (u.pathname.startsWith("/frame/") && req.method === "POST") {
          const relPath = decodeURIComponent(u.pathname.slice(7));
          const abs = path.resolve(REPO_ROOT, relPath);
          if (!abs.startsWith(FRAMES_DIR + path.sep) || !abs.endsWith(".png")) { res.writeHead(400); res.end(); return; }
          mkdirSync(path.dirname(abs), { recursive: true });
          const out = createWriteStream(abs);
          req.pipe(out);
          out.on("finish", () => { res.writeHead(200); res.end("ok"); });
          return;
        }
        res.writeHead(404); res.end();
      } catch {
        res.writeHead(500); res.end();
      }
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      owned.server = server;
      resolve({ server, origin: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

/** Runs in the page: load a video and measure its duration (seek-to-1e9 trick for Infinity). */
async function measureInPage(src) {
  const v = document.createElement("video");
  v.muted = true; v.preload = "auto"; v.src = src;
  document.body.appendChild(v);
  await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error("video load error")); });
  let duration = v.duration, method = "video.duration";
  if (!Number.isFinite(duration)) {
    await new Promise((res) => {
      const done = () => { v.removeEventListener("seeked", done); v.removeEventListener("durationchange", done); res(); };
      v.addEventListener("seeked", done); v.addEventListener("durationchange", done);
      setTimeout(done, 8000);
      v.currentTime = 1e9;
    });
    await new Promise((r) => setTimeout(r, 200));
    duration = v.duration;
    method = "seek-to-1e9 then video.duration";
    if (!Number.isFinite(duration)) { duration = v.currentTime; method = "seek-to-1e9 currentTime"; }
  }
  v.remove();
  return { duration: Math.round(duration * 100) / 100, method };
}

// ───────────────────────── export (canvas + MediaRecorder) ─────────────────────────

async function exportInPage({ segments, uploadUrl, fps }) {
  const canvas = document.createElement("canvas");
  canvas.width = 1440; canvas.height = 900;
  document.body.appendChild(canvas);
  const g = canvas.getContext("2d");
  g.fillStyle = "#000"; g.fillRect(0, 0, 1440, 900);
  const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t));
  const chunks = [];
  // The capture stream and recorder are created only after the first segment's first frame is painted,
  // so the export does not open on the canvas's initial black fill.
  let stream = null, rec = { state: "inactive" };
  const ensureRecorder = async () => {
    if (stream) return;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    stream = canvas.captureStream(fps);
    rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 3_000_000 });
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  };
  const joins = [];
  let recordedMs = 0, segStartWall = 0;
  const load = async (s) => {
    const v = document.createElement("video");
    v.muted = true; v.preload = "auto"; v.src = s.src; v.playsInline = true;
    await new Promise((res, rej) => { v.oncanplay = res; v.onerror = () => rej(new Error(`load error ${s.src}`)); });
    v.oncanplay = null;
    if (s.start > 0) await new Promise((res) => { v.onseeked = res; v.currentTime = s.start; });
    return v;
  };
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (rec.state === "recording") rec.pause();
    const v = await load(s);
    g.drawImage(v, 0, 0, 1440, 900);
    await ensureRecorder();
    const startedAtOut = recordedMs / 1000;
    if (rec.state === "inactive") rec.start(1000); else rec.resume();
    segStartWall = performance.now();
    await v.play();
    await new Promise((res) => {
      const draw = () => {
        g.drawImage(v, 0, 0, 1440, 900);
        if (v.ended) { res(); return; }
        if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(draw); else setTimeout(draw, 1000 / fps);
      };
      draw();
      v.onended = () => { g.drawImage(v, 0, 0, 1440, 900); res(); };
    });
    recordedMs += performance.now() - segStartWall;
    joins.push({ file: s.file, source_in_s: s.start, output_start_s: Math.round(startedAtOut * 100) / 100, output_end_s: Math.round(recordedMs / 10) / 100 });
    v.remove();
  }
  await new Promise((res) => { rec.onstop = res; rec.stop(); });
  const blob = new Blob(chunks, { type: mime });
  const r = await fetch(uploadUrl, { method: "POST", body: blob });
  if (!r.ok) throw new Error(`upload failed HTTP ${r.status}`);
  return { mime, bytes: blob.size, joins, wall_s: Math.round(recordedMs / 10) / 100 };
}

async function cmdExport(which) {
  const m = readJson(MANIFEST_PATH, null);
  if (!m) throw new Error("manifest missing: record first");
  const flows = which === "all" ? ["overview", "walkthrough"] : [which];
  const { browser } = await launchChrome();
  const srv = await startFileServer();
  try {
    for (const flow of flows) {
      const v = m.videos?.[flow];
      if (!v || !v.segments?.length) { check(`export ${flow}: raw segments present`, false, "not recorded"); continue; }
      const name = `aidmind-${flow}.webm`;
      const segs = v.segments.map((s) => ({ file: s.file, start: s.lead_in_s || 0, src: `${srv.origin}/file/${encodeURIComponent(s.file)}` }));
      log(`export ${flow}: ${segs.length} segments, real-time playback ...`);
      const ctx = await browser.newContext({ viewport: VIEWPORT });
      const page = await ctx.newPage();
      await page.goto(`${srv.origin}/blank`);
      const res = await page.evaluate(exportInPage, { segments: segs, uploadUrl: `${srv.origin}/upload/${name}`, fps: 30 });
      await ctx.close();
      const outFile = path.join(EXPORT_DIR, name);
      const dur = (await measureFileWith(browser, srv, rel(outFile)));
      check(`export ${flow}: file written`, existsSync(outFile) && statSync(outFile).size > 0, `${rel(outFile)} ${res.bytes} bytes ${res.mime}`);
      const cuts = v.segments.map((s) => ({ file: s.file, cut: `0.00s-${(s.lead_in_s || 0).toFixed(2)}s removed (pre-landing lead-in before first scene)` }));
      // map scenes to export time
      const scenes = [];
      v.segments.forEach((s, i) => {
        const j = res.joins[i];
        if (!j) return;
        for (const sc of s.scenes) scenes.push({ ...sc, source_file: s.file, start_s: +(j.output_start_s + sc.start_s - (s.lead_in_s || 0)).toFixed(2), end_s: +(j.output_start_s + sc.end_s - (s.lead_in_s || 0)).toFixed(2) });
      });
      updateManifest((mm) => {
        mm.exports[flow] = {
          file: rel(outFile), format: `${res.mime} via MediaRecorder from a 1440x900 canvas (headless Chrome, real-time replay of the raw segments)`,
          bytes: res.bytes, measured_duration_s: dur.duration, duration_method: dur.method, playback_wall_s: res.wall_s,
          cuts, joins: res.joins.map((j, i) => ({ ...j, note: i === 0 ? "first segment" : "hard cut join to next role segment (recorder paused while the next segment loaded)" })),
          overlays: "none added at export; overlays are those burned into the raw recordings (see top-level overlays)",
          scenes,
          exported_at: new Date().toISOString(),
        };
      });
      log(`export ${flow}: ${rel(outFile)} measured ${dur.duration}s (${dur.method})`);
    }
  } finally {
    await cleanupOwned();
  }
}

async function measureFileWith(browser, srv, relFile) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${srv.origin}/blank`);
  const d = await page.evaluate(measureInPage, `${srv.origin}/file/${encodeURIComponent(relFile)}`);
  await ctx.close();
  return d;
}

// ───────────────────────── frames ─────────────────────────

async function framesInPage({ src, boundaries, outBase, uploadPrefix }) {
  const v = document.createElement("video");
  v.muted = true; v.preload = "auto"; v.src = src;
  document.body.appendChild(v);
  await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error("video load error")); });
  let duration = v.duration, method = "video.duration";
  if (!Number.isFinite(duration)) {
    await new Promise((res) => {
      const done = () => { v.removeEventListener("seeked", done); v.removeEventListener("durationchange", done); res(); };
      v.addEventListener("seeked", done); v.addEventListener("durationchange", done);
      setTimeout(done, 8000);
      v.currentTime = 1e9;
    });
    await new Promise((r) => setTimeout(r, 200));
    duration = Number.isFinite(v.duration) ? v.duration : v.currentTime;
    method = Number.isFinite(v.duration) ? "seek-to-1e9 then video.duration" : "seek-to-1e9 currentTime";
  }
  const canvas = document.createElement("canvas");
  canvas.width = v.videoWidth || 1440; canvas.height = v.videoHeight || 900;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  const want = [];
  for (let t = 0; t < duration; t += 5) want.push({ t, reason: "interval 5s" });
  for (const b of boundaries) if (b.t < duration) want.push(b);
  want.sort((a, c) => a.t - c.t);
  const out = [];
  for (let i = 0; i < want.length; i++) {
    const t = Math.min(Math.max(0, want[i].t), Math.max(0, duration - 0.05));
    await new Promise((res) => { const to = setTimeout(res, 10000); v.onseeked = () => { clearTimeout(to); res(); }; v.currentTime = t; });
    await new Promise((r) => (v.requestVideoFrameCallback ? v.requestVideoFrameCallback(() => r()) : r(), setTimeout(r, 300)));
    g.drawImage(v, 0, 0, canvas.width, canvas.height);
    const img = g.getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0, sum2 = 0, n = 0;
    for (let p = 0; p < img.length; p += 4 * 16) {
      const y = 0.2126 * img[p] + 0.7152 * img[p + 1] + 0.0722 * img[p + 2];
      sum += y; sum2 += y * y; n++;
    }
    const mean = sum / n, sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
    const name = `${String(i + 1).padStart(3, "0")}-t${t.toFixed(1)}s.png`;
    const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
    const r = await fetch(`${uploadPrefix}${encodeURIComponent(`${outBase}/${name}`)}`, { method: "POST", body: blob });
    if (!r.ok) throw new Error(`frame upload failed HTTP ${r.status}`);
    out.push({ file: `${outBase}/${name}`, t: Math.round(t * 100) / 100, reason: want[i].reason, mean_luma: Math.round(mean * 10) / 10, luma_sd: Math.round(sd * 10) / 10,
      // Near-uniform frame (any brightness). Mostly-white app pages have mean luma ~250 but sd ~20, so mean alone is not used.
      blank: sd < 4 });
  }
  return { duration: Math.round(duration * 100) / 100, method, frames: out };
}

async function cmdFrames(which) {
  const m = readJson(MANIFEST_PATH, null);
  if (!m) throw new Error("manifest missing: record first");
  const targets = [];
  const addRaw = (flow) => { for (const s of m.videos?.[flow]?.segments || []) targets.push({ file: s.file, scenes: s.scenes, lead_in_s: s.lead_in_s || 0 }); };
  const addExport = (flow) => { const e = m.exports?.[flow]; if (e?.file && existsSync(path.join(REPO_ROOT, e.file))) targets.push({ file: e.file, scenes: e.scenes || [] }); };
  if (which === "overview" || which === "all") { addRaw("overview"); addExport("overview"); }
  if (which === "walkthrough" || which === "all") { addRaw("walkthrough"); addExport("walkthrough"); }
  if (which === "export") { addExport("overview"); addExport("walkthrough"); }
  if (!targets.length) throw new Error(`no videos found for --frames ${which}`);
  const { browser } = await launchChrome();
  const srv = await startFileServer();
  const results2 = {};
  try {
    for (const tg of targets) {
      const videoName = path.basename(tg.file, ".webm");
      const outDir = path.join(FRAMES_DIR, videoName);
      rmSync(outDir, { recursive: true, force: true });
      mkdirSync(outDir, { recursive: true });
      const boundaries = [];
      for (const sc of tg.scenes) {
        boundaries.push({ t: sc.start_s + 0.3, reason: `scene start ${sc.id}` });
        if (sc.end_s != null) boundaries.push({ t: Math.max(sc.start_s, sc.end_s - 0.3), reason: `scene end ${sc.id}` });
      }
      const ctx = await browser.newContext({ viewport: VIEWPORT });
      const page = await ctx.newPage();
      await page.goto(`${srv.origin}/blank`);
      const res = await page.evaluate(framesInPage, {
        src: `${srv.origin}/file/${encodeURIComponent(tg.file)}`, boundaries, outBase: rel(outDir), uploadPrefix: `${srv.origin}/frame/`,
      });
      await ctx.close();
      // Raw segments start with a short lead-in (page not yet painted) that the export cuts; blank frames inside
      // it are flagged in the manifest but do not fail the check. Everything after the lead-in must be non-blank.
      const leadIn = tg.lead_in_s || 0;
      for (const f of res.frames) f.in_trimmed_lead_in = leadIn > 0 && f.t <= leadIn;
      const blanks = res.frames.filter((f) => f.blank);
      const blanksAfterLeadIn = blanks.filter((f) => !f.in_trimmed_lead_in);
      results2[videoName] = { video: tg.file, measured_duration_s: res.duration, duration_method: res.method, frame_dir: rel(outDir), frames: res.frames, blank_frames: blanks.map((f) => f.file), blank_frames_after_lead_in: blanksAfterLeadIn.map((f) => f.file), blank_rule: "luma_sd < 4 (near-uniform)" };
      check(`frames ${videoName}: ${res.frames.length} PNGs written`, res.frames.length > 0, `${rel(outDir)}; duration ${res.duration}s (${res.method})`);
      const leadNote = blanks.length > blanksAfterLeadIn.length ? ` [in trimmed lead-in: ${blanks.filter((f) => f.in_trimmed_lead_in).map((f) => path.basename(f.file)).join(", ")}]` : "";
      check(`frames ${videoName}: no blank/near-uniform frames after lead-in`, blanksAfterLeadIn.length === 0, blanksAfterLeadIn.map((f) => path.basename(f.file)).join(", ") + leadNote);
    }
    updateManifest((mm) => {
      for (const [k, v] of Object.entries(results2)) {
        mm.frames[k] = v;
        for (const flow of Object.keys(mm.videos || {})) for (const s of mm.videos[flow].segments || []) if (s.file === v.video) { s.measured_duration_s = v.measured_duration_s; s.duration_method = v.duration_method; }
        for (const flow of Object.keys(mm.exports || {})) if (mm.exports[flow].file === v.video) { mm.exports[flow].measured_duration_s = v.measured_duration_s; mm.exports[flow].duration_method = v.duration_method; }
      }
    });
  } finally {
    await cleanupOwned();
  }
}

// ───────────────────────── verify-auditor ─────────────────────────

async function cmdVerifyAuditor() {
  const cfg = appConfig();
  const ev = { checked_at: new Date().toISOString(), project_id: PROJECT_ID, app_url: APP_URL, session_id: cfg.sessionId, auditor_email: cfg.creds.DEMO_AUDITOR_EMAIL || null, checks: [] };
  const start = results.length;
  const { browser } = await launchChrome();
  await startPreview();
  try {
    const { ctx, page } = await loginContext(browser, cfg, "auditor");
    check("auditor login lands on /auditor", page.url().endsWith("/auditor"), new URL(page.url()).pathname);
    await page.getByRole("heading", { name: "Compliance Audit View" }).waitFor({ timeout: 30000 });
    check("auditor page heading 'Compliance Audit View' visible", true);
    for (const target of ["/dashboard", "/supervisor", `/reviewer/${cfg.sessionId}`]) {
      await page.goto(`${APP_URL}${target}`, { waitUntil: "domcontentloaded" });
      let landed = "";
      try { await page.waitForURL(/\/auditor$/, { timeout: 30000 }); } catch { /* fallthrough */ }
      landed = new URL(page.url()).pathname;
      check(`auditor requesting ${target.replace(cfg.sessionId, "<session>")} ends on /auditor`, landed === "/auditor", landed);
    }
    await ctx.close();
  } catch (e) {
    check("auditor browser checks completed", false, String(e.message).split("\n")[0]);
  } finally {
    if (owned.vite) { stopVite(owned.vite); owned.vite = null; }
  }
  try {
    const token = await signIn(cfg, cfg.creds.DEMO_AUDITOR_EMAIL, cfg.creds.DEMO_AUDITOR_PASSWORD);
    const H = { apikey: cfg.anonKey, Authorization: `Bearer ${token}` };
    const ee = await fetch(`${cfg.supabaseUrl}/rest/v1/eye_events?session_id=eq.${cfg.sessionId}&select=id,event_type`, { headers: H });
    const eeBody = await ee.json().catch(() => null);
    const eeRows = Array.isArray(eeBody) ? eeBody.length : -1;
    check("REST auditor reads tenant-A eye_events for the demo session (rows > 0)", ee.status === 200 && eeRows > 0,
      `HTTP ${ee.status}, rows=${eeRows}${eeRows === 0 ? " (no Reviewer run recorded yet: run demo:browser:preview or --overview first)" : ""}`);
    const ss = await fetch(`${cfg.supabaseUrl}/rest/v1/sessions?session_id=eq.${cfg.sessionId}&select=id`, { headers: H });
    const ssBody = await ss.json().catch(() => null);
    check("REST auditor sees 0 sessions rows (owner-scoped, no auditor policy)", ss.status === 200 && Array.isArray(ssBody) && ssBody.length === 0, `HTTP ${ss.status}, rows=${Array.isArray(ssBody) ? ssBody.length : "n/a"}`);
    const rpc = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/record_governance_event`, {
      method: "POST", headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ p_event_type: "AUDITOR_ACCESS_GRANTED", p_subject_id: null, p_scope: "organization", p_expires_at: null, p_metadata: {} }),
    });
    const rpcBody = await rpc.json().catch(() => null);
    const msg = rpcBody?.message || "";
    check("RPC record_governance_event(AUDITOR_ACCESS_GRANTED) as auditor refused with EYE_SUPERVISOR_REQUIRED", rpc.status >= 400 && /EYE_SUPERVISOR_REQUIRED/.test(msg), `HTTP ${rpc.status}, code=${rpcBody?.code ?? "n/a"}, message=${msg.slice(0, 80)}`);
  } catch (e) {
    check("auditor REST checks completed", false, String(e.message).split("\n")[0]);
  }
  ev.checks = results.slice(start);
  ev.pass_count = ev.checks.filter((c) => c.pass).length;
  ev.fail_count = ev.checks.filter((c) => !c.pass).length;
  ev.notes = [
    "REST checks use the auditor's own JWT with the anon key; the service role key is not used.",
    "The 'time-bounded access' wording on /auditor is UI copy; the database policy (eye_event_visible_to_caller) checks role + tenant membership only.",
    "No supervisor UI currently calls useAuditorAccess.grantAccess (no caller in src/).",
  ];
  mkdirSync(REC_DIR, { recursive: true });
  const json = JSON.stringify(ev, null, 2) + "\n";
  if (/eyJ|sb_|PASSWORD=/.test(json)) throw new Error("auditor evidence would contain a secret-like string; not written");
  writeFileSync(AUDITOR_EVIDENCE_PATH, json);
  log(`auditor evidence: ${rel(AUDITOR_EVIDENCE_PATH)} (${ev.pass_count} passed, ${ev.fail_count} failed)`);
  await cleanupOwned();
}

// ───────────────────────── prepare / teardown ─────────────────────────

async function cmdPrepare() {
  const ts = runTimestamp();
  log(`prepare: project_id=${PROJECT_ID} ports=${JSON.stringify(PORTS)} app=${APP_URL} run=${ts}`);
  if (portListening(PORTS.app)) log(`note: app port ${PORTS.app} currently has a listener; recording steps will refuse until it is free`);
  const before = projectContainers();
  const alreadyRunning = before.length > 0;
  runStack("start");
  const after = projectContainers();
  log(`podman containers named *_${PROJECT_ID}: ${after.length}`);
  if (after.length === 0) throw new Error(`no *_${PROJECT_ID} containers after start`);
  const prev = loadState();
  saveState({ stackStartedByUs: prev.stackStartedByUs === true || !alreadyRunning, stack_start_note: alreadyRunning ? "stack was already running when prepare ran" : "stack started by this prepare" });

  const mig = spawnSync("podman", ["exec", `supabase_db_${PROJECT_ID}`, "psql", "-U", "postgres", "-d", "postgres", "-tAc", "select count(*) from supabase_migrations.schema_migrations"], { encoding: "utf8" });
  const applied = Number((mig.stdout || "").trim());
  const files = readdirSync(path.join(REPO_ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).length;
  check("migrations applied in this project's database", mig.status === 0 && applied === files, `applied=${Number.isFinite(applied) ? applied : "n/a"} of ${files} files`);

  const envPath = path.join(REPO_ROOT, ".env.local");
  let force = {};
  if (existsSync(envPath)) {
    const first = readFileSync(envPath, "utf8").split("\n")[0] || "";
    if (!first.startsWith("# Generated by scripts/demo-stack/demo-stack.sh env")) throw new Error(".env.local exists and was not generated by demo-stack.sh; refusing to overwrite");
    force = { DEMO_FORCE_ENV: "1" };
  }
  runStack("env", force);
  const out = runStack("seed");
  check("seed provisioned the auditor", /auditor\.demo@example\.test .*role=auditor tenant=A/.test(out), "auditor.demo@example.test role=auditor tenant=A");
  const creds = readEnvFile(CREDENTIALS_PATH);
  check("credentials file carries DEMO_AUDITOR_EMAIL/DEMO_AUDITOR_PASSWORD", !!creds.DEMO_AUDITOR_EMAIL && !!creds.DEMO_AUDITOR_PASSWORD, "values not shown");

  log("vite build ...");
  const b = spawnSync(path.join(REPO_ROOT, "node_modules/.bin/vite"), ["build"], { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  const tail = redact(((b.stdout || "") + (b.stderr || "")).split("\n").slice(-6).join("\n"));
  log(tail);
  check("vite build", b.status === 0, `exit ${b.status}`);
  saveState({ prepared_at: new Date().toISOString() });
}

async function cmdTeardown() {
  const st = loadState();
  for (const p of st.pids || []) {
    if (isAlive(p.pid)) { try { process.kill(-p.pid, "SIGTERM"); } catch { try { process.kill(p.pid, "SIGTERM"); } catch { /* ignore */ } } log(`stopped owned ${p.kind} pid ${p.pid}`); }
  }
  saveState({ pids: [] });
  if (st.stackStartedByUs === true || process.env.DEMO_FORCE_TEARDOWN === "1") {
    runStack("stop");
    saveState({ stackStartedByUs: false, stopped_at: new Date().toISOString() });
  } else {
    log(`stack for ${PROJECT_ID} was not started by this recorder (record-state.json); not stopping it (set DEMO_FORCE_TEARDOWN=1 to override)`);
  }
  await sleep(1500);
  const left = projectContainers();
  check(`no *_${PROJECT_ID} containers remain`, left.length === 0, `count=${left.length}`);
  const ports = [PORTS.shadow, PORTS.api, PORTS.db, PORTS.studio, PORTS.smtp, PORTS.analytics, PORTS.pooler, PORTS.inspector, PORTS.app];
  const busy = ports.filter(portListening);
  check("no listeners remain on this run's ports", busy.length === 0, busy.length ? `busy: ${busy.join(",")}` : ports.join(","));
}

// ───────────────────────── main ─────────────────────────

const argv = process.argv.slice(2);
const flag = argv[0];
const arg = argv[1] && !argv[1].startsWith("--") ? argv[1] : null;
let code = 0;
try {
  switch (flag) {
    case "--prepare": await cmdPrepare(); break;
    case "--verify-auditor": await cmdVerifyAuditor(); break;
    case "--overview": await recordFlow("overview"); break;
    case "--walkthrough": await recordFlow("walkthrough"); break;
    case "--export": await cmdExport(arg || "all"); break;
    case "--frames": await cmdFrames(arg || "all"); break;
    case "--teardown": await cmdTeardown(); break;
    case "--all": {
      const before = projectContainers().length > 0;
      await cmdPrepare();
      await cmdVerifyAuditor();
      await recordFlow("overview");
      await recordFlow("walkthrough");
      await cmdExport("all");
      await cmdFrames("all");
      if (!before) await cmdTeardown(); else log("stack was already running before --all; leaving it up");
      break;
    }
    default:
      console.error("usage: record-demo.mjs --prepare|--verify-auditor|--overview|--walkthrough|--export [overview|walkthrough|all]|--frames [overview|walkthrough|export|all]|--teardown|--all");
      process.exit(2);
  }
} catch (e) {
  check(`${flag} completed without exception`, false, String(e?.message ?? e).split("\n")[0]);
  if (e?.stack) log(`stack (redacted):\n${String(e.stack).split("\n").slice(0, 12).join("\n")}`);
} finally {
  await cleanupOwned().catch(() => {});
}
const fails = results.filter((r) => !r.pass);
console.log(`\n${results.length - fails.length} passed, ${fails.length} failed (${flag})`);
for (const f of fails) console.log(redact(`FAIL  ${f.name}${f.detail ? `  — ${f.detail}` : ""}`));
code = fails.length ? 1 : 0;
process.exit(code);
