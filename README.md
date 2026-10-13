# AidMind

**A trust-first review and audit layer for human-services case management.**

Caseworkers in housing, benefits and child-welfare programs write case notes and forms that feed into decisions about people's lives. Language in those documents that is judgmental ("the client was rude and difficult"), unsupported ("will likely relapse") or out of line with policy can follow a client for years. Supervisors rarely have time to read every write-up, and in regulated settings they often should not be shown the document text at all.

AidMind checks a caseworker's completed document for that kind of language and leaves a **metadata-only audit trail** of every automated run, so a supervisor or auditor can confirm a review happened without seeing the document. The AI is never the final authority: findings are proposals that a human accepts or rejects.

> **Status: working prototype, not a production system.** This README separates what was executed and observed from what is only implemented, disabled, or mocked. Nothing here has been deployed or used with real client data. All data in the screenshots and test fixtures is invented.

## What I built and verified

The strongest, runtime-verified pieces (on a fresh, isolated local Supabase stack with synthetic data, driven by a real headless Chrome against a production build):

- **Two-stage document Reviewer.** The browser extracts PDF text (pdf.js), a model stage proposes candidate spans, and a deterministic engine classifies, merges, calibrates severity and caps confidence. The engine is covered by reproducibility tests. *In every verified run, the model stage was a labelled fixture replay, not a live model (see below).*
- **Metadata-only audit RPC.** `report_client_event` is a `SECURITY DEFINER` Postgres function with an event-type allowlist, a metadata-key allowlist and a PHI key denylist. It derives actor, role and tenant server-side and stamps rows `source=client_reported, verified=false`. In the exercised Reviewer workflow, request capture and database reads confirmed that none of the 15 sentences of the synthetic document appeared in the audit RPC request bodies or the stored `eye_events` rows. That finding covers this workflow's audit events only, not every request, table or workflow in the application.
- **Role- and tenant-scoped authorization.** Owner-scoped `sessions` RLS (the `session-manager` edge function additionally lets a same-tenant supervisor read a caseworker's session); tenant-scoped supervisor/auditor reads of audit events; caller verification in edge functions through a shared `require-user` helper. These are exercised at runtime by a verification script that sends real requests under user JWTs (**291 pass, 0 fail, 9 recorded observations** on 2026-10-13) and by browser denial checks.
- **Three roles end to end.** A caseworker lands on `/dashboard`, a supervisor on `/supervisor` (audit feed and event drawer) and an auditor on `/auditor`. A supervisor or auditor who opens another role's page is redirected to their own home page.

| Caseworker: Reviewer findings (fixture replay) | Supervisor: audit event detail (no document text) |
|---|---|
| ![Reviewer findings](docs/recruiter/screenshots/02-reviewer-findings.png) | ![Supervisor event drawer](docs/recruiter/screenshots/04-supervisor-event-detail.png) |

More screenshots and the machine-written evidence file are in [docs/recruiter/](docs/recruiter/README.md).

### Fixture replay disclosure

No local or hosted language model was available on the verification machine. The demo therefore runs the Reviewer in **fixture replay** mode. In this mode, [`src/services/reviewerFixtureReplay.ts`](src/services/reviewerFixtureReplay.ts) replays three hand-written candidate spans and keeps a span only if it is an exact substring of the uploaded text. The kept spans then go through the same deterministic post-processing as the live path.

The mode is enabled only by `VITE_REVIEWER_MODEL_SOURCE=fixture`, and it is labelled everywhere it appears:

- two "Fixture replay — no live model" badges on the Reviewer page;
- `tool_name = run_reviewer_v2_fixture` in the audit row;
- the `Tool` row of the supervisor's event detail drawer.

This proves the UI, the deterministic engine, the audit RPC and the authorization boundaries. **It does not prove a live model run.**

## Status at a glance

| Category | What falls in it |
|---|---|
| **Implemented and exercised at runtime** (local isolated stack, synthetic data) | Sign-in and role routing for caseworker, supervisor and auditor. Reviewer upload, the `generate-parser-artifacts` edge function and findings (fixture replay). The `report_client_event` audit RPC. Supervisor Sessions feed and event drawer. Read-only rendering of the Daily Assurance, System Issues, Data Deletion Proof and Governance panels. Auditor timeline. Owner-scoped `sessions` RLS (same-tenant supervisor reads allowed through `session-manager`), tenant-scoped audit reads, restricted RPCs, storage policies and edge-function caller checks, all exercised by `scripts/runtime-verify-local.ts`. |
| **Implemented, not runtime-verified** | **Live Reviewer path**: local Ollama `llama3` at `localhost:11434`, called from the browser. **Case Notes Phase 2 extraction**: local Ollama. **Guidance Phase 1/2 and Phase 2 schema generation**: hosted OpenAI from edge functions. **Policy-pack compilation, Records Room retrieval and citations**: hosted OpenAI embeddings. **Knowledge-base ingestion**: an edge function plus a Cloud Run job, see `workers/`. **Other components**: `llm-gateway` with supervisor approval, the `session-manager` state machine, and the client-side encrypted case-notes vault. Governance write actions (authorize AI, compliance export) are rendered but were never clicked. |
| **Disabled / stubbed** | **Audio transcription and PII redaction**: `transcribe-audio` and `redact-transcript` return `410 Gone`. **Presidio**: `presidio-service/` is a standalone container that nothing calls. **Generative note drafting, placeholder tasks and mock coordination events**: switched off in `src/config/features.ts`. **`run-reviewer`**: a hosted-model edge function that no frontend code calls; the browser path replaced it. |
| **Mocked screens** | `/platform/*` (cases, referrals, providers) reads static data from `src/lib/platform/mock-data.ts`. The caseworker Calendar shows hard-coded sample events. |
| **Deployment** | **None verified.** `workers/kb_extractor/README.md` contains Cloud Run deployment *instructions* only. `supabase/config.toml` names a hosted project, but no verification in this repository ran against it. There is no frontend hosting configuration. |

## Architecture

```
Browser (React + TypeScript, Vite)
  ├─ PDF text extraction (pdf.js), Reviewer span proposal (Ollama or fixture), deterministic engine
  ├─ Findings held in component state only (not persisted)
  └─ Supabase JS client with the publishable (anon) key only
        │
Supabase (local stack for all verification)
  ├─ Auth (GoTrue) + profiles / tenant memberships / roles
  ├─ Postgres with RLS on every public table; audit RPCs (report_client_event, record_governance_event)
  ├─ Storage buckets with tenant-path policies
  └─ Deno edge functions (20): 17 re-verify the caller in the handler (the rest: two 410 stubs,
     two server-to-server functions guarded by a shared secret / service key)
        │
External, not exercised: hosted OpenAI (guidance, embeddings), Cloud Run KB extractor (workers/),
Presidio (presidio-service/, standalone)
```

**On the demo path, the following are never persisted:** the uploaded PDF, its extracted text and the findings. The parser artifact *is* stored, but it holds only the template's section headings and field positions, derived from the stored template rather than from the upload. **This is not a zero-retention guarantee for the product:** other features have their own storage behaviour, described in [docs/recruiter/readiness.md](docs/recruiter/readiness.md).

## Engineering decisions

- **The model proposes; deterministic code decides.** The language model only suggests spans. Classification, merging, severity and confidence caps run in deterministic, unit-tested code, so the same document gives the same findings and the model cannot invent a severity.
- **Audit events are designed to carry metadata, not content.** The audit RPC accepts only allowlisted event types and metadata keys, at most 16 keys and primitives only, and it rejects PHI-like keys (`text`, `transcript`, `prompt`, ...) before checking the allowlist. Actor, role and tenant come from the caller's JWT and memberships, never from the request body. Client-reported events are marked `verified=false`, so they are never mistaken for server-observed facts. The allowlist constrains keys and value types, not the meaning of every value; the no-document-text result above was verified for the exercised Reviewer workflow only.
- **Defence in depth for user-facing edge functions.** The gateway verifies the JWT (`verify_jwt`), and the handler then re-checks the user, active profile, tenant membership and object ownership (`_shared/require-user.ts`, `_shared/authorization-rules.ts`). The service role is used only after that check, and never in the browser.
- **Corrective migrations instead of rewritten history.** Hardening was added as new migrations (`20261005*`, `20261006120000`, `20261013120000`) that drop permissive early policies and revoke Supabase's default `EXECUTE` grants on the internal KB-job and guidance `SECURITY DEFINER` functions (`claim_next_kb_job`, `complete_kb_job`, `enqueue_kb_continuation_job`, `append_kb_document_content`, `kb_has_queued_jobs`, `update_session_guidance_phase1`). Helper functions used by policies and the client (`is_tenant_member`, `has_role`, `get_my_profile`, `get_my_role`) remain executable by `anon`; they return only booleans or the caller's own data.
- **Verification that cannot pass vacuously.** In `runtime-verify-local.ts`, SQL errors, 5xx responses and failed positive prerequisites are counted as FAIL or BLOCKED, never as a successful denial.
- **Demo isolation.** The demo stack runs as its own Supabase project through `--workdir .cache/demo-stack` with configurable ports. Its credentials are generated per run, stored mode 600, and never printed.

## Setup (local, synthetic data)

Prerequisites, using the versions verified here; nearby versions should work but were not tried:

- Node 20 and npm
- Deno 2.x
- Supabase CLI 2.x
- A container runtime: Docker, or a running podman machine
- Google Chrome, for the browser demo

The demo scripts were written and run on macOS. Full details are in [docs/recruiter/demo-runbook.md](docs/recruiter/demo-runbook.md).

```bash
npm ci
npm run demo:stack            # isolated Supabase project "aidmind_demo" (ports 5542x), applies all migrations, writes .env.local
npm run demo:seed             # synthetic tenants, @example.test users (incl. an auditor), template, schema, session
npm run demo:browser:preview  # vite build + vite preview + headless Chrome: 31 assertions, screenshots, evidence JSON
npm run demo:stop             # removes the demo project's containers and volumes only
```

Generated demo credentials are written only to `.cache/demo-stack/.env.demo-credentials`, which is gitignored. If `.env.local` already exists, the env step refuses to overwrite it after the stack has started; move it aside, or run `DEMO_FORCE_ENV=1 sh scripts/demo-stack/demo-stack.sh env`. To use other ports or a different project id, set `DEMO_PROJECT_ID`, `DEMO_PORT_BASE`, `DEMO_INSPECTOR_PORT` and `DEMO_APP_PORT` (see the runbook).

`.env.local` is created by `npm run demo:stack` with `VITE_REVIEWER_MODEL_SOURCE=fixture`. **Never deploy a `dist/` built with that flag.** For manual configuration, see [`.env.example`](.env.example). Only publishable `VITE_*` values belong in the frontend; there is no service-role key in this repository.

## Verification

Run from the repository root:

```bash
# Unit tests (the Supabase client needs a URL at import time; placeholders are enough)
VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_PUBLISHABLE_KEY=placeholder npx vitest run
npm run build
npx tsx scripts/check-dangerous-html.ts

# Edge-function authorization unit tests
deno test --no-lock supabase/functions/_tests/authorization-rules.unit.test.ts supabase/functions/_tests/storage-path-authorization.unit.test.ts
ENVIRONMENT=production deno test --no-lock --allow-env --allow-net supabase/functions/_tests/transport-guard.unit.test.ts

# Runtime authorization checks against the running demo stack (default API port 55421 = DEMO_PORT_BASE + 1)
export DOCKER_HOST="unix://$(podman machine inspect --format '{{.ConnectionInfo.PodmanSocket.Path}}')"   # podman only
SUPABASE_WORKDIR=.cache/demo-stack deno run --no-lock --node-modules-dir=none --allow-run=supabase --allow-env \
  --allow-net=127.0.0.1:55421,localhost:55421 --allow-read=. scripts/runtime-verify-local.ts
```

Results from the latest pass (2026-10-13, macOS, fresh isolated stack `aidmind_rel` on non-default ports):

| Check | Result |
|---|---|
| `npm ci` | pass |
| `npx vitest run` (placeholder env) | 20 files, 572 tests passed |
| `npm run build` | pass (chunk-size warnings only) |
| `check-dangerous-html` | no dangerous HTML patterns |
| Deno authorization-rules + storage-path | 24 passed |
| Deno transport-guard (`ENVIRONMENT=production`) | 16 passed |
| Stack start | 32 of 32 migrations applied |
| Seed | 2 tenants, 5 synthetic users, 1 template, 1 schema, 1 session |
| `npm run demo:browser:preview` | 31 passed, 0 failed |
| Auditor checks (`record-demo.mjs --verify-auditor`) | 8 passed, 0 failed |
| `runtime-verify-local.ts` | **GREEN: 291 PASS, 0 FAIL, 0 FINDING, 0 BLOCKED, 9 OBSERVE** |
| `npm run lint` | **fails: 250 problems (221 errors, 29 warnings)**, pre-existing, mostly `no-explicit-any` |

The browser checks include these denials:

- a supervisor of another tenant reads 0 audit rows;
- a second caseworker in the same tenant gets 0 `sessions` rows and "Session not found";
- the owning caseworker cannot read audit rows;
- a supervisor or auditor who opens another role's page is redirected to their own.

The nine OBSERVE lines are known, documented behaviours rather than passes. One example: a *pending* tenant member can read their own tenant row and upload to their tenant's KB path, because `is_tenant_member()` does not check profile status. They are listed verbatim in [docs/recruiter/verification.md](docs/recruiter/verification.md).

## Limitations

- **No live model run has been verified.** With Ollama, `llama3` and `VITE_REVIEWER_MODEL_SOURCE` unset, the live path runs from the browser, but it was not exercised.
- **No hosted AI call has been made.** Guidance, Records Room, policy packs and KB ingestion need an OpenAI key and/or the Cloud Run worker. Template upload calls the hosted `*.supabase.co` functions URL directly (`src/pages/GuidanceTemplateSelection.tsx`), so it does not work against a local stack.
- **Tenant isolation is verified only for the policies the runtime script and browser checks enumerate.** Other paths were checked by inspection only. End-to-end tenant isolation is **not** claimed, and no tenant-B auditor was provisioned. The auditor's time-bounded access wording is enforced in the UI; the database policy checks role and tenant only.
- **Not production-ready.** Lint fails. The `DEV: Cleanup Orphans` button in the supervisor header is not gated by build mode. `eye_events` is not in the realtime publication, so the feed relies on polling and Refresh.
- **The demo tooling is macOS-oriented.** It expects Chrome at its default macOS path when `channel: "chrome"` fails, and video recording depends on a cached Playwright ffmpeg build.
- **Some code is kept for history and is not live:** [`backend/`](backend/README.md) is a **legacy**, diverged copy of the backend imported from a collaborator. The canonical implementation is [`supabase/`](supabase/) (migrations and edge functions) and [`presidio-service/`](presidio-service/). `src/legacy/` and `supabase/functions/_future/` are also historical.

## Repository layout

```
src/                     React app: pages, components, hooks, lib/tools (reviewer engine), lib/eye (audit types)
src/services/            localReviewer.ts (live path), reviewerFixtureReplay.ts (labelled demo replay)
supabase/migrations/     Schema, RLS policies, audit RPCs and corrective hardening migrations (32 files)
supabase/functions/      Deno edge functions; _shared/ (require-user, authorization-rules, eye, ...); _tests/
scripts/demo-stack/      Isolated stack driver, synthetic seed and document, browser demo, demo recorder
scripts/                 runtime-verify-local.ts, check-dangerous-html.ts
docs/recruiter/          Runbook, verification, readiness, scene map, resume bullets, screenshots
workers/                 Cloud Run KB trigger and PyMuPDF extraction job (not deployed, not exercised)
presidio-service/        Standalone PII redaction service (not wired in)
backend/                 LEGACY copy of the backend (see backend/README.md); canonical code is supabase/ and presidio-service/
src/legacy/              Historical code, not used by the app
```

## Provenance

The frontend was scaffolded with [Lovable](https://lovable.dev) (an AI app builder), so much of the early commit history is authored by its bot. The review engine, audit trail, authorization hardening, verification scripts and demo stack were built and checked afterwards with AI-assisted tooling. A collaborator contributed backend code; see the commit history.

No license has been chosen yet, so all rights are reserved by the authors until a `LICENSE` file is added.
