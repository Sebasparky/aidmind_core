# Demo scene map: features, scenes, timestamps, evidence

> **Recordings are not in the repository.** The videos, frames and `manifest.json` named below are generated locally under `docs/recruiter/recordings/` (gitignored) by `npm run demo:record`; paths are given for reproduction, not as links. The numbers come from the recording run of 2026-10-13.

This map ties every filmed feature to its scene, the exact video file and time range, the role, a status class and the saved evidence. All data is synthetic (invented tenants, `@example.test` users, a fictional client). The Reviewer output in every video is a labelled **fixture replay** (`VITE_REVIEWER_MODEL_SOURCE=fixture`); no local or hosted model was called. Nothing here implies the live-model path works.

How to reproduce: see [demo-runbook.md](demo-runbook.md#recording-the-demo-videos-npm-run-demorecord). Machine-readable source of every number below: `recordings/manifest.json` (scene offsets, `<video>.duration` measurements, joins, cuts, overlays, per-frame luma statistics).

## Status classes

| Class | Meaning |
|---|---|
| WORKING | Real local interaction against the isolated stack, verified by an assertion in a saved check of this run |
| FIXTURE-BACKED | Real UI and real audit events, but the analysis result is the labelled fixture replay, not a model |
| STATIC MOCK | Hard-coded content in the app; not filmed |
| UNVERIFIED | Needs a hosted key, a local model, or failed locally; not filmed |

Saved checks cited (run `20261013T015212Z-22370`, all run with the non-default overrides `DEMO_PROJECT_ID=aidmind_rec DEMO_PORT_BASE=55450 DEMO_INSPECTOR_PORT=8093 DEMO_APP_PORT=55490`):

| Label | What it verified |
|---|---|
| `005-demo-browser-preview-regression` | `npm run demo:browser:preview`, 31/31 assertions (caseworker Reviewer fixture flow, supervisor feed and drawer, tenant-B isolation) |
| `006-verify-auditor` | auditor account: 8/8 (login lands on `/auditor`; `/dashboard`, `/supervisor`, `/reviewer/<session>` end on `/auditor`; REST `eye_events` rows > 0 for tenant A; REST `sessions` 0 rows; `record_governance_event('AUDITOR_ACCESS_GRANTED')` refused with `EYE_SUPERVISOR_REQUIRED`) |
| `011-record-overview-r2-retime` | overview recording, every scene assertion passed |
| `013-record-walkthrough-r3` | walkthrough recording, 38/38 scene assertions passed |
| `016-export-all-r2` | both single-file exports written and measured |
| `017-frames-all-r2` | PNG frames from all 7 videos (every 5 s plus scene start/end), 14/14 checks, no blank frame after the raw lead-in |

## Videos

| Video | Kind | Measured duration (`video.duration`) |
|---|---|---|
| `recordings/raw/20261013T020346Z/01-overview-caseworker.webm` | raw, caseworker context | 40.04 s (lead-in 0.12 s) |
| `recordings/raw/20261013T020346Z/02-overview-supervisor.webm` | raw, supervisor context | 25.56 s (lead-in 0.11 s) |
| `recordings/export/aidmind-overview.webm` | export, short overview | **65.29 s** |
| `recordings/raw/20261013T020346Z/01-walkthrough-caseworker.webm` | raw, caseworker context | 74.08 s (lead-in 0.11 s) |
| `recordings/raw/20261013T020346Z/02-walkthrough-supervisor.webm` | raw, supervisor context | 101.32 s (lead-in 0.10 s) |
| `recordings/raw/20261013T020346Z/03-walkthrough-auditor.webm` | raw, auditor context | 41.16 s (lead-in 0.12 s) |
| `recordings/export/aidmind-walkthrough.webm` | export, walkthrough | **216.16 s** (3 min 36 s) |

Overview raw total 65.60 s (65.37 s after lead-in trim). Walkthrough raw total 216.56 s (216.23 s after lead-in trim). The walkthrough uses the same actions as the overview with on-screen pauses multiplied by 1.8 (`pause_scale` in the manifest) plus the extra scenes below.

## Short overview (export `aidmind-overview.webm`)

| Feature | Scene id | Raw file and range | Export range | Role | Status | Evidence (check, frame) | Limitation |
|---|---|---|---|---|---|---|---|
| Caseworker dashboard, seeded session with Reviewer action | `cw-dashboard` | `01-overview-caseworker.webm` 0.1-4.2 s | 0.0-4.1 s | caseworker | WORKING | `011`, `005`; frame `recordings/frames/aidmind-overview/005-t5.0s.png` | First ~0.3 s of the export shows the app's own "Signing you in..." screen (frame `recordings/frames/aidmind-overview/001-t0.0s.png`) |
| Open Reviewer, fixture badge before the run | `cw-open-reviewer` | 4.2-8.8 s | 4.1-8.6 s | caseworker | FIXTURE-BACKED | `011`; frame `recordings/frames/aidmind-overview/007-t8.9s.png` | Badge "Fixture replay — no live model" is the app's own label |
| Upload synthetic PDF, parser artifact status | `cw-upload` | 8.8-12.8 s | 8.6-12.7 s | caseworker | WORKING | `011` (artifact status "ready", via file chooser); frame `recordings/frames/aidmind-overview/008-t10.0s.png` | Synthetic document only |
| Run Reviewer (fixture replay) | `cw-run-reviewer` | 12.8-16.9 s | 12.7-16.8 s | caseworker | FIXTURE-BACKED | `011` (badge count 2, no error toast); frame `recordings/frames/aidmind-overview/011-t15.0s.png` | Findings come from the fixture, not a model |
| Three findings, unflagged attributed quote (Extracted Text tab) | `cw-findings` | 16.9-39.0 s | 16.8-38.9 s | caseworker | FIXTURE-BACKED | `011`, `005`; findings frame `recordings/frames/aidmind-overview/013-t17.1s.png`, quote frame `recordings/frames/aidmind-overview/018-t38.6s.png` | Same fixture limitation |
| Supervisor landing (Daily Assurance tab) | `sup-landing` | `02-overview-supervisor.webm` 0.1-4.2 s | 39.9-44.0 s | supervisor | WORKING | `011`; frame `recordings/frames/aidmind-overview/020-t40.2s.png` | Hard cut from the caseworker segment |
| Sessions tab, metadata-only feed | `sup-sessions` | 4.2-7.7 s | 44.0-47.5 s | supervisor | WORKING | `011`, `005`; frame `recordings/frames/02-overview-supervisor/006-t7.4s.png` | Header shows the pre-existing `DEV: Cleanup Orphans` button; never clicked |
| Select session, `tool.run.completed` listed | `sup-select-session` | 7.7-11.8 s | 47.5-51.6 s | supervisor | WORKING | `011`; frame `recordings/frames/aidmind-overview/026-t50.0s.png` | |
| Event drawer, `Tool: run_reviewer_v2_fixture`, no document text | `sup-event-drawer` | 11.8-24.6 s | 51.6-64.4 s | supervisor | WORKING (record of a FIXTURE-BACKED run) | `011` (tool row present, no document sentence on page), `005`; frame `recordings/frames/aidmind-overview/030-t60.0s.png` | The tool name itself discloses the fixture |

## Walkthrough (export `aidmind-walkthrough.webm`)

| Feature | Scene id | Raw file and range | Export range | Role | Status | Evidence (check, frame) | Limitation |
|---|---|---|---|---|---|---|---|
| Caseworker dashboard | `cw-dashboard` | `01-walkthrough-caseworker.webm` 0.1-7.0 s | 0.0-6.9 s | caseworker | WORKING | `013`; frame `recordings/frames/aidmind-walkthrough/003-t5.0s.png` | Work Radar column is on screen but not separately asserted |
| Session History panel | `cw-session-history` | 7.0-16.2 s | 6.9-16.1 s | caseworker | WORKING | `013` (heading visible, no error toast); frame `recordings/frames/aidmind-walkthrough/007-t15.0s.png` | Shows the app's empty state "No session history yet" (no closed sessions in the seed) |
| Open Reviewer, fixture badge | `cw-open-reviewer` | 16.2-23.6 s | 16.1-23.5 s | caseworker | FIXTURE-BACKED | `013`; frame `recordings/frames/aidmind-walkthrough/010-t20.0s.png` | |
| Upload synthetic PDF | `cw-upload` | 23.6-30.6 s | 23.5-30.4 s | caseworker | WORKING | `013`; frame `recordings/frames/aidmind-walkthrough/014-t30.0s.png` | |
| Run Reviewer (fixture replay) | `cw-run-reviewer` | 30.6-37.5 s | 30.4-37.4 s | caseworker | FIXTURE-BACKED | `013`; frame `recordings/frames/aidmind-walkthrough/017-t35.0s.png` | |
| Three findings and unflagged quote | `cw-findings` | 37.5-72.9 s | 37.4-72.8 s | caseworker | FIXTURE-BACKED | `013`; frame `recordings/frames/aidmind-walkthrough/023-t55.0s.png` | |
| Daily Assurance panel | `sup-landing` | `02-walkthrough-supervisor.webm` 0.1-17.0 s | 74.0-90.8 s | supervisor | WORKING | `013` (precheck rendered without error + in-scene assertion); frame `recordings/frames/aidmind-walkthrough/033-t90.5s.png` | Counts reflect the local seed only (1 session, in progress) |
| Sessions feed | `sup-sessions` | 17.0-23.0 s | 90.8-96.9 s | supervisor | WORKING | `013`; frame `recordings/frames/aidmind-walkthrough/035-t95.0s.png` | Feed holds events from every Reviewer run on this stack in this run (regression + recordings) |
| Select session | `sup-select-session` | 23.0-30.0 s | 96.9-103.8 s | supervisor | WORKING | `013`; frame `recordings/frames/aidmind-walkthrough/038-t100.0s.png` | |
| Event drawer, `Tool: run_reviewer_v2_fixture` | `sup-event-drawer` | 30.0-53.0 s | 103.8-126.9 s | supervisor | WORKING (record of a FIXTURE-BACKED run) | `013`; frame `recordings/frames/aidmind-walkthrough/043-t115.0s.png` | |
| System Issues tab (view only) | `sup-system-issues` | 53.0-64.3 s | 126.9-138.2 s | supervisor | WORKING | `013` (rendered without error; app empty state "No issues at this time"); frame `recordings/frames/aidmind-walkthrough/048-t130.0s.png` | Empty state only: no failing events exist locally |
| Data Deletion Proof tab (view only) | `sup-deletion-proof` | 64.3-75.6 s | 138.2-149.4 s | supervisor | WORKING | `013` (app empty state "No purge proof events yet"); frame `recordings/frames/aidmind-walkthrough/053-t145.0s.png` | No purge events are produced by the fixture Reviewer path, so no verified-deletion rows are shown |
| Governance tab: Generative AI Authorization, Compliance Export, Security Dashboard (view only) | `sup-governance` | 75.6-100.3 s | 149.4-174.2 s | supervisor | WORKING (read-only render) | `013` (each panel rendered without error, no error toast); frame `recordings/frames/aidmind-walkthrough/058-t160.0s.png` | "Authorize Generative AI" and "Generate Report" were deliberately not clicked; their write paths are not verified |
| Auditor landing, compliance cards | `aud-cards` | `03-walkthrough-auditor.webm` 0.1-10.4 s | 175.2-185.5 s | auditor | WORKING | `013`, `006`; frame `recordings/frames/aidmind-walkthrough/064-t180.0s.png` | Cards read "Not Authorized", "Not Instrumented", "No purge events yet" on this seed |
| Event Timeline tab (read-only) | `aud-timeline` | 10.4-20.3 s | 185.5-195.3 s | auditor | WORKING | `013`, `006` (REST rows > 0 under the auditor JWT); frame `recordings/frames/aidmind-walkthrough/068-t190.0s.png` | Tenant A only; no tenant-B auditor was provisioned |
| Deletion Proof tab | `aud-deletion-proof` | 20.3-26.8 s | 195.3-201.8 s | auditor | WORKING | `013` (app empty state); frame `recordings/frames/aidmind-walkthrough/072-t200.0s.png` | Empty state, same reason as the supervisor tab |
| Auditor Access Notice | `aud-access-notice` | 26.8-33.6 s | 201.8-208.7 s | auditor | WORKING (text rendered) | `013`; frame `recordings/frames/aidmind-walkthrough/075-t205.0s.png` | See "Auditor access: what is and is not enforced" below |
| Denial: auditor requests `/supervisor`, lands on `/auditor` | `aud-denial-supervisor` | 33.6-40.0 s | 208.7-215.1 s | auditor | WORKING | `013`, `006`; frame `recordings/frames/aidmind-walkthrough/080-t215.0s.png` | Visually subtle: there is no address bar in the footage and the redirect is immediate, so the viewer sees the page reload (the "Last updated" time changes) and the caption pathname stays `/auditor`; the requested URL is proven by the assertion, not by the picture |

## Auditor access: what is and is not enforced

- The auditor (`auditor.demo@example.test`, tenant A) was provisioned through the existing seed and the existing `auditor` value of the `app_role` enum. No migration, policy, grant or RPC was changed.
- The auditor page's wording "Access is time-bounded and automatically expires" and its access state are derived **in the UI** from governance events. The database policy that gates `eye_events` reads (`eye_event_visible_to_caller`) checks role and tenant membership only; it does not check a time window.
- No supervisor UI calls `grantAccess` (there is no caller in `src/`), so no time-bounded grant was ever issued or filmed. Calling `record_governance_event('AUDITOR_ACCESS_GRANTED', ...)` as the auditor is refused (`EYE_SUPERVISOR_REQUIRED`, check `006`).
- A tenant-B auditor was not provisioned; cross-tenant auditor isolation was not tested.

## Overlays, cuts, joins and format

Overlays (burned into the raw recordings by an `addInitScript`; both are `pointer-events:none` and not part of the app):

- Synthetic cursor (`__demo_cursor`): a dark arrow that follows real `mousemove` events from `page.mouse.move(..., { steps })`, with a short click ring on mousedown.
- Caption pill (`__demo_caption`): a 22 px dark bar at the bottom-left reading `<Role> · synthetic data · fixture replay, no live model · local isolated stack · <location.pathname>`. It covers about one line of app content at the bottom-left of the viewport (seen over the last Daily Assurance list line and over a finding quote while scrolling).
- Both overlays are also injected into the Reviewer's embedded PDF preview iframe (duplicate static cursor arrows and a faint second caption; see "Known visual defects").
- No slate, title card, narration or text was added at export time.

Cuts:

- Overview export: `01-overview-caseworker.webm` 0.00-0.12 s removed, `02-overview-supervisor.webm` 0.00-0.11 s removed (pre-landing lead-in before the first scene).
- Walkthrough export: `01-walkthrough-caseworker.webm` 0.00-0.11 s, `02-walkthrough-supervisor.webm` 0.00-0.10 s, `03-walkthrough-auditor.webm` 0.00-0.12 s removed (same reason).
- Nothing else was cut; every in-scene wait (upload, Reviewer run, feed refresh) plays in real time.

Joins (hard cuts, in this order): overview = caseworker -> supervisor (join at 39.92 s); walkthrough = caseworker -> supervisor (73.97 s) -> auditor (175.20 s).

Omitted (never recorded): the login of each role (done in a separate, non-recorded browser context; the session is handed to the recorded context as in-memory `storageState`), the supervisor panel precheck (non-recorded context, used to decide which panels are filmable), and the time the exporter spent loading the next segment (the MediaRecorder was paused).

Format: raw files are WebM (VP8) written by Playwright `recordVideo` at 1440x900 through the cached Playwright ffmpeg build (revision 1011, n7.0.1) via a generated `/bin/sh` adapter at `.cache/ms-playwright/ffmpeg-1013/ffmpeg-mac` that maps the requested `libvpx-vp9` to `libvpx` and drops `-tile-columns`/`-row-mt`. Exports are WebM (`video/webm;codecs=vp9`, as reported by `MediaRecorder`) produced in headless Chrome 154 by replaying the raw segments in real time into a 1440x900 canvas and recording `canvas.captureStream(30)`. No ffmpeg or other encoder is installed system-wide. WebM plays in Chrome, Firefox and VLC; QuickTime does not play it.

## Frame inspection

Frames: `recordings/frames/` (one folder per video, `NNN-t<sec>s.png`, every 5 s plus 0.3 s after each scene start and 0.3 s before each scene end). Blank rule: luma standard deviation < 4 (near-uniform at any brightness). After the fix in this run, the only near-uniform frames are the raw `001-t0.0s.png` of each raw segment, which lie inside the lead-in the export removes. Inspected by eye: scene boundaries of the overview export, Reviewer findings with both fixture badges, the supervisor drawer with `run_reviewer_v2_fixture`, the walkthrough supervisor tabs, all auditor scenes. No terminal, `.env` content, credential, JWT or Supabase key string appears in any inspected frame.

Known visual defects:

- The overview export opens on the app's own "Signing you in..." loading screen for its first fraction of a second (an app state, not a blank frame).
- The caption pill covers about one line of app content at the bottom-left.
- While the uploaded PDF is shown in the Reviewer's embedded PDF preview (`cw-upload`, e.g. overview frame 008 `recordings/frames/aidmind-overview/008-t10.0s.png`), the overlay script also runs inside that iframe: one or two extra, static cursor arrows appear over the PDF preview and a second caption pill shows faintly behind the main one. The overlay does not guard against sub-frames (no `window.top === window` check). Not fixed in these recordings.
- Faint VP9 compression artifacts are visible on large white areas in the exports.
- The denial scene does not visibly show the `/supervisor` request (see table).

## Limitations: features not filmed

| Feature | Class | Why |
|---|---|---|
| Guidance (`compile-policy-pack`) | UNVERIFIED | Requires a hosted OpenAI key; none is configured or allowed |
| Case Notes extraction | UNVERIFIED | Requires a local Ollama model; Ollama is not installed and downloads are not permitted |
| Records Room | UNVERIFIED | Not exercised locally |
| Knowledge base ingestion (upload, extraction, chunking, embedding) | UNVERIFIED | Rejected by RLS on the local stack during inventory; no policy was changed to make it work |
| Calendar | STATIC MOCK | Hard-coded sample events |
| `/platform/*` | STATIC MOCK | Static marketing/mock pages |
| Live Ollama Reviewer path (`runLocalReviewer`) | UNVERIFIED | No model available; every Reviewer scene is the fixture replay |
| Governance write actions (authorize AI, generate compliance report), `DEV: Cleanup Orphans` | not filmed | Deliberately not clicked |
| Time-bounded auditor grants (`grantAccess`) | UNVERIFIED | No UI caller exists in `src/` |
| Tenant-B auditor isolation | UNVERIFIED | Not provisioned |
