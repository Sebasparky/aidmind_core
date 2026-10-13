# Demo runbook: 60 to 90 seconds, synthetic data, isolated local stack

This runbook reproduces the caseworker Reviewer to supervisor audit flow on a fresh, project-local Supabase stack with invented data. The Reviewer runs in a labelled **fixture replay** mode (no local or hosted model); see "Optional live model" at the end.

## Prerequisites

Versions below are the ones the saved checks ran with. Newer patch versions should work but were not tried.

| Tool | Version used | Notes |
|---|---|---|
| Node / npm | 20.20.2 / 10.8.2 | `npm ci` installs `playwright-core` as a devDependency; no browser download |
| Deno | 2.9.7 | seed script and edge-function tests |
| Supabase CLI | 2.119.0 | drives the isolated project through `--workdir .cache/demo-stack` |
| Container runtime | podman 6.1.3 (no `docker` binary on the verification machine) | `demo-stack.sh` derives `DOCKER_HOST` from `podman machine inspect` when `DOCKER_HOST` is unset and `/var/run/docker.sock` is absent. With Docker Desktop it uses `/var/run/docker.sock`, or `~/.docker/run/docker.sock` if only that exists (this Docker Desktop path was not exercised on the verification machine). The podman machine must already be running; the script does not start it. |
| Google Chrome | 154.0.8037.98 | launched headless by `playwright-core` through `channel: "chrome"` (falls back to the macOS app path) |
| Ollama | not installed | not required for the fixture replay demo |

Ports used: 55420 to 55429 for the Supabase project `aidmind_demo` (API 55421, DB 55422), 55480 for the app. They are loopback only. The CLI's default project on 54321 to 54324, if you have one, is never read or touched. All of these are overridable through environment variables; see [Environment overrides](#environment-overrides).

## Commands

From the repository root:

```bash
npm ci
npm run demo:stack            # start the isolated stack (32 migrations) and write .env.local
npm run demo:seed             # idempotent synthetic seed
npm run demo:browser:preview  # vite build + vite preview + headless Chrome; writes screenshots + evidence
```

`npm run demo:stack` refuses to overwrite an existing `.env.local`; move yours aside or run `DEMO_FORCE_ENV=1 sh scripts/demo-stack/demo-stack.sh env`. The written `.env.local` points Vite at `http://127.0.0.1:55421`, sets `VITE_DEV_MODE=false` and `VITE_REVIEWER_MODEL_SOURCE=fixture`.

`npm run demo:browser` (without `:preview`) uses the Vite dev server instead; DEV-only panels then appear in the screenshots. The preview variant builds `dist/` first. Because the build reads `.env.local`, that `dist/` has the fixture flag baked in: never deploy it.

What the seed creates (all invented): tenants "Riverside Family Services" (A) and "Northgate Community Support" (B); users `caseworker.demo`, `caseworker2.demo`, `supervisor.demo`, `auditor.demo` (role `auditor`, tenant A) and `supervisor.other` (tenant B), all `@example.test`, profiles active; one template "Housing Stability Check-In" v1; one active Phase 2 schema with 8 fields; one session `7d2f3c1e-5a4b-4c8d-9e6f-0a1b2c3d4e5f` (case `HS-24017`) owned by `caseworker.demo`. Passwords are random per seed run and are written only to `.cache/demo-stack/.env.demo-credentials` (mode 600, gitignored). The synthetic document is `scripts/demo-stack/demo-document.html`, rendered to a text-layer PDF by headless Chrome at `.cache/demo-stack/demo-document.pdf`.

## Manual recording steps

1. Run the three commands above once; the browser script also renders the PDF you will upload.
2. Start the app for recording with a production build: `node_modules/.bin/vite build && node_modules/.bin/vite preview --port 55480 --strictPort --host 127.0.0.1` (or `npm run dev` on its default port if DEV panels are acceptable).
3. Read the credentials: `cat .cache/demo-stack/.env.demo-credentials` in a terminal that is **not** on screen. Use `DEMO_CASEWORKER_EMAIL` / `DEMO_CASEWORKER_PASSWORD` and `DEMO_SUPERVISOR_EMAIL` / `DEMO_SUPERVISOR_PASSWORD`.
4. Open `http://127.0.0.1:55480/login` in a 1440 x 900 window and record the shot list below.
5. When finished: `npm run demo:stop` (removes only the `aidmind_demo` containers and volumes). Delete `dist/` if you built one.

## Shot list (target 75 seconds)

| t | Screen | Action | What it shows |
|---|---|---|---|
| 0 to 8 s | `/login` to `/dashboard` | Sign in as `caseworker.demo` | Role-aware landing; the seeded session card "Housing stability check-in" with Guidance / Case Notes / Reviewer buttons |
| 8 to 18 s | `/reviewer/7d2f3c1e-5a4b-4c8d-9e6f-0a1b2c3d4e5f` | Click "Reviewer" on the session card; point at the "Fixture replay — no live model" badge | Honest labelling before anything runs |
| 18 to 30 s | Reviewer | Upload `.cache/demo-stack/demo-document.pdf`; wait for "Parser artifacts ... sections" | Browser-side PDF parsing; structural artifact of the template from the edge function |
| 30 to 45 s | Reviewer | Click "Run Reviewer"; scroll the three findings; show that the quoted client sentence is not flagged | Deterministic classification, severity, confidence caps; human stays in charge |
| 45 to 55 s | Sign out, `/login` to `/supervisor` | Sign in as `supervisor.demo`; Sessions tab; select the session | Supervisor lands on the audit view, not the caseworker dashboard |
| 55 to 70 s | Supervisor feed | Click the `Tool.Run.Completed` row; show the drawer | Counts and identifiers only; `Tool: run_reviewer_v2_fixture`; no document text anywhere |
| 70 to 80 s (optional) | Second window, `supervisor.other` | Select the same session id | Zero rows: the other tenant cannot see the event |

### Narration (about 120 words)

"AidMind helps caseworkers check their own write-ups for language that could harm a client. I sign in as a caseworker and open a session. The Reviewer is labelled as a fixture replay, because this machine has no local model; the live path calls a local Ollama model from the browser. I upload a synthetic form. The parser artifact stores only the template's structure, not my upload. The Reviewer flags three sentences and leaves the client's own quote alone; a deterministic engine decides categories and caps confidence, and the caseworker decides what to do. The supervisor sees only that a tool ran: counts, tier, risk level, the tool name, never the document. A supervisor in another agency sees nothing at all."

## What not to show

- The terminal with `.env.demo-credentials` or `.env.local` (keys and passwords).
- The Supabase Studio (it is disabled in this stack anyway) or `supabase status` output.
- The `DEV: Cleanup Orphans` button is pre-existing and not gated by build mode; avoid clicking it. The `DEV` badge in the supervisor header is also pre-existing but is gated by `import.meta.env.DEV`: it appears only under `npm run dev`, not in the preview build.
- Any feature outside this path (Guidance, Records Room, case notes vault, `/platform/*`): they are either hosted-AI dependent, untested here, or static mocks.

## Teardown

```bash
npm run demo:stop   # supabase stop --no-backup --project-id aidmind_demo, via the demo workdir only
```

Then delete `.cache/demo-stack/` and `.env.local` if you want a clean tree. The script never stops or resets any other Supabase project.

## Recording the demo videos (`npm run demo:record`)

The recorder `scripts/demo-stack/record-demo.mjs` drives the real app (production build served by `vite preview`) against the isolated stack with `playwright-core` and the installed Google Chrome, headless, 1440 x 900. Nothing is downloaded. Credentials are typed only in non-recorded browser contexts; each recorded context receives the session as in-memory `storageState` (never written to disk), so no login appears in the footage. The Reviewer remains the labelled fixture replay in every video.

One command prepares, records, exports, extracts frames and cleans up:

```bash
npm run demo:record   # = node scripts/demo-stack/record-demo.mjs --all
```

`--all` chains: prepare, verify-auditor, overview, walkthrough, export all, frames all, teardown. Teardown runs only if the project's containers were not already running when `--all` started. Each step is also available on its own (each one finished in under 600 s in this run):

| Command | Flag | What it does |
|---|---|---|
| `npm run demo:record:prepare` | `--prepare` | start or reuse this project's stack, check migrations, write `.env.local` (only overwrites a file generated by `demo-stack.sh`), seed (including the auditor), `vite build` |
| `npm run demo:record:verify-auditor` | `--verify-auditor` | browser + REST checks under the auditor account; writes `docs/recruiter/recordings/auditor-evidence.json` |
| `npm run demo:record:overview` | `--overview` | records the short overview (caseworker, supervisor) |
| `npm run demo:record:walkthrough` | `--walkthrough` | records the walkthrough (caseworker, supervisor incl. Daily Assurance / System Issues / Data Deletion Proof / Governance view-only, auditor incl. one denial) |
| `npm run demo:record:export` (defaults to `all`) | `--export [overview\|walkthrough\|all]` | single-file exports (see format note) |
| `npm run demo:record:frames` | `--frames [overview\|walkthrough\|export\|all]` | PNG frames from the actual video files, every 5 s plus scene boundaries, with blank-frame flags |
| `npm run demo:record:teardown` | `--teardown` | stops this recorder's own `vite preview`, and the stack only if this recorder started it (`DEMO_FORCE_TEARDOWN=1` overrides); then checks no `*_<project id>` containers and no listeners on this project's ports remain |

The recording steps start and stop their own `vite preview` on `DEMO_APP_PORT` and refuse to run if that port already has a listener.

### Environment overrides

The defaults match the stack described above. Override them when those ports or that project id are taken (the same variables are honoured by `demo-stack.sh`, `seed-demo.ts`, `demo-browser.mjs` and the recorder).

| Variable | Default | Notes |
|---|---|---|
| `DEMO_PROJECT_ID` | `aidmind_demo` | Supabase project id; containers are named `*_<id>` |
| `DEMO_PORT_BASE` | `55420` | derives shadow = base, API = base+1, DB = base+2, studio = base+3, SMTP = base+4, analytics = base+7, pooler = base+9 |
| `DEMO_SHADOW_PORT`, `DEMO_API_PORT`, `DEMO_DB_PORT`, `DEMO_STUDIO_PORT`, `DEMO_SMTP_PORT`, `DEMO_ANALYTICS_PORT`, `DEMO_POOLER_PORT` | derived from `DEMO_PORT_BASE` | set individually to override one port |
| `DEMO_INSPECTOR_PORT` | `8083` | edge runtime inspector port |
| `DEMO_APP_PORT` | `55480` | `vite preview` port for the app |
| `DEMO_RECORD_RUN` | first recorder run's UTC timestamp (kept in `.cache/demo-stack/record-state.json`) | pins the `raw/<run-timestamp>/` folder |
| `DEMO_FORCE_TEARDOWN` | unset | `1` lets `--teardown` stop a stack the recorder did not start |

Example used in this run (because the defaults were busy on the recording machine):

```bash
export DEMO_PROJECT_ID=aidmind_rec DEMO_PORT_BASE=55450 DEMO_INSPECTOR_PORT=8093 DEMO_APP_PORT=55490
# API 55451, DB 55452, shadow 55450, studio 55453, SMTP 55454, analytics 55457, pooler 55459, app 55490
node scripts/demo-stack/record-demo.mjs --prepare
npm run demo:browser:preview        # regression: 31 assertions
node scripts/demo-stack/record-demo.mjs --verify-auditor
node scripts/demo-stack/record-demo.mjs --overview
node scripts/demo-stack/record-demo.mjs --walkthrough
node scripts/demo-stack/record-demo.mjs --export all
node scripts/demo-stack/record-demo.mjs --frames all
node scripts/demo-stack/record-demo.mjs --teardown
```

### Where the output goes

| Kind | Location |
|---|---|
| Raw recordings, untouched, one WebM per recorded browser context | `docs/recruiter/recordings/raw/<run-timestamp>/NN-<flow>-<role>.webm` |
| Edited single-file exports | `docs/recruiter/recordings/export/aidmind-overview.webm`, `aidmind-walkthrough.webm` |
| Frames | `docs/recruiter/recordings/frames/<video-name>/NNN-t<sec>s.png` |
| Manifest (durations measured from `<video>.duration`, scene offsets, cuts, joins, overlays, frame stats; secret-free, grep-checked for JWT prefixes, Supabase key prefixes and password assignments before writing) | `docs/recruiter/recordings/manifest.json` |
| Auditor evidence | `docs/recruiter/recordings/auditor-evidence.json` |

Format note: the raw files are WebM (VP8) from Playwright `recordVideo`. No video encoder is installed system-wide; the recorder points Playwright at the cached Playwright ffmpeg build through a generated `/bin/sh` adapter in `.cache/ms-playwright/` (maps the requested VP9 encoder to VP8). Exports are WebM (VP9 as reported by `MediaRecorder`) produced in headless Chrome by replaying the raw segments in real time into a canvas; they cut only the sub-second pre-landing lead-in of each segment and hard-cut between roles. The videos carry two non-app overlays: a synthetic cursor and a small caption pill (role, "synthetic data", "fixture replay, no live model", "local isolated stack", current pathname). WebM plays in Chrome, Firefox and VLC, not in QuickTime.

Auditor account: `auditor.demo@example.test` (invented name, role `auditor`, tenant A), created by the same seed. Its password is random per seed run and is written only to `.cache/demo-stack/.env.demo-credentials` as `DEMO_AUDITOR_EMAIL` / `DEMO_AUDITOR_PASSWORD`. Auditors land on `/auditor`; the app routes them back to `/auditor` from `/dashboard`, `/supervisor` and `/reviewer/<session>`.

What each scene shows, its timestamps, status class, evidence and every limitation (including what the auditor page's "time-bounded access" wording does and does not mean): [demo-scene-map.md](demo-scene-map.md).

## Optional live model (not verified here)

With Ollama installed, `llama3` pulled, `OLLAMA_ORIGINS` set to `http://127.0.0.1:55480`, and `VITE_REVIEWER_MODEL_SOURCE` removed from `.env.local`, `Reviewer.tsx` selects `runLocalReviewer` (`src/services/localReviewer.ts`), which calls the model from the browser and then applies the same `finalizeReviewReport` post-processing the fixture uses. The badges disappear and the audit `tool_name` becomes `run_reviewer_v2`. This path was **not** executed during verification (no Ollama, no model, downloads not permitted), so no claim is made about its output; `npm run demo:browser` will refuse to run without the fixture flag because its assertions are written for the fixture findings.
