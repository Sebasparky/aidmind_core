# Readiness: prerequisites, boundaries, blocked items and open decisions

This document states what a reader needs to reproduce the demo, where the verified boundaries end, and what is still blocked or undecided. Status words: **verified** (executed in a saved check), **inspected** (read, not run), **designed** (present, untested), **disabled**, **BLOCKED**.

## Prerequisites and installed-tool matrix (verification machine)

| Prerequisite | Needed for | Installed during verification | Status |
|---|---|---|---|
| Node 20.20.2, npm 10.8.2 | build, tests, browser script | yes | verified |
| Deno 2.9.7 | seed, edge-function tests, runtime-verify | yes | verified |
| Supabase CLI 2.119.0 | isolated stack | yes | verified |
| Container runtime | Supabase CLI backend | podman 6.1.3 (no `docker` binary); `DOCKER_HOST` derived from the podman machine socket by `demo-stack.sh` | verified |
| Google Chrome 154.0.8037.98 + `playwright-core` 1.64 | real-browser demo | yes (no browser download) | verified |
| Ollama + `llama3` | live Reviewer path | **not installed**; downloads not permitted | BLOCKED |
| OpenAI API key | Guidance Phase 1, policy-pack compile, Records Room, embeddings | not provided; hosted calls not permitted | not exercised |
| Google Cloud Run worker | KB extraction | not deployed; deployment instructions only in `workers/kb_extractor/README.md` | not exercised |
| Presidio container | PII redaction | standalone `presidio-service/`; nothing calls it | disabled |

## Qualified boundaries

- **Demonstrated**: caseworker sign-in, Reviewer upload and findings (fixture replay), metadata-only audit RPC, supervisor feed and drawer, cross-tenant and cross-role denials. All on an isolated local stack with synthetic data, in a production build served by `vite preview`.
- **Fixture replay** is not a model run. It is enabled only by `VITE_REVIEWER_MODEL_SOURCE=fixture`, is labelled in the UI (two badges and a footer), in the audit row (`tool_name=run_reviewer_v2_fixture`) and in the supervisor drawer (`Tool` row). The live path (`runLocalReviewer`) is unchanged and untested here.
- **Authorization**: the runtime verification script checks the policies it enumerates (anonymous access, tenant membership, storage, audit RPCs, governance events, edge-function gateway vs handler). Tables and paths outside that list were inspected only. This is not a statement of end-to-end tenant isolation.
- **Privacy**: the demo path does not persist the document, its text or the findings; the parser artifact (structure) is stored by `generate-parser-artifacts`. No zero-retention guarantee is made for the product.
- **Hosted project**: nothing was run against the hosted Supabase project; treat it as unavailable.

## Hosted-AI paths elsewhere in the codebase

| Path | Model/provider | Where | Status |
|---|---|---|---|
| Guidance Phase 1 question generation | hosted OpenAI (`gpt-4o`) | `supabase/functions/generate-guidance-phase1` (also calls `ensure-phase2-schema`, `gpt-4o`) | inspected, not run |
| Guidance Phase 2 | hosted OpenAI (`gpt-4o`) | `supabase/functions/generate-guidance-phase2` (no caller in `src/`) | inspected, not run |
| Server-side reviewer (superseded by the browser path) | Lovable AI gateway or OpenAI (`LOVABLE_API_KEY` / `OPENAI_API_KEY`) | `supabase/functions/run-reviewer` (no caller in `src/`) | inspected, not run |
| Case-note text extraction service | external (`CASE_NOTE_EXTRACTOR_URL`) | `supabase/functions/extract-case-note-text` (no caller in `src/`) | inspected, not run |
| Policy-pack compilation | hosted OpenAI embeddings | `supabase/functions/compile-policy-pack` | inspected, not run |
| Records Room retrieval and citations | hosted OpenAI embeddings | `supabase/functions/records-room`, `get-citation-details` | inspected, not run |
| Knowledge-base ingestion (chunk and embed) | hosted OpenAI embeddings; Cloud Run worker (designed, not deployed) | `supabase/functions/ingest-kb-text`, `kb-kick`, `workers/` | inspected, not run |
| Phase 2 case-note extraction | local Ollama from the browser | `src/pages/CaseNotes.tsx`, `src/services/localCaseNotes.ts`, `src/services/localModel.ts` | inspected, not run |
| Reviewer span proposal (live) | local Ollama from the browser | `src/services/localReviewer.ts` | inspected, BLOCKED (no Ollama) |
| `llm-gateway` with supervisor approval | Lovable AI gateway (`LOVABLE_API_KEY`) | `supabase/functions/llm-gateway`, `_shared/llm-authorization.ts` | designed, not on the demo path |

## Integrated vs standalone components

| Component | Integration | Status |
|---|---|---|
| React SPA (`src/`) | integrated | verified (demo path) |
| Supabase migrations, RLS, audit RPCs | integrated | verified on a fresh isolated stack |
| `generate-parser-artifacts` edge function | integrated (demo path) | verified (artifact ready in the browser run) |
| Other user-facing edge functions with `require-user` | integrated | Deno unit tests verified; handlers exercised only by the runtime-verify script where it lists them |
| `transcribe-audio`, `redact-transcript` | integrated as 410 stubs | disabled |
| `presidio-service/` | standalone | not wired |
| `workers/` (Cloud Run trigger + extractor) | external | not exercised |
| `/platform/*` pages | front-end only | static mock, no backend |
| `backend/the_mind_backend/` (see [backend/README.md](../../backend/README.md)), `src/legacy/` | not integrated | legacy, kept for history; canonical code is `supabase/` and `presidio-service/` (lint debt lives partly here) |

## Tested vs designed privacy controls

| Control | Tested how | Status |
|---|---|---|
| Audit RPC metadata allowlist and PHI key denylist | browser request capture, REST and DB reads for every document sentence (checks 013, 019, 020, 023); runtime-verify audit section (015) | verified |
| Server-derived actor/role/tenant stamps, `source=client_reported`, `verified=false` | same | verified |
| Supervisor/auditor-only, tenant-scoped reads of `eye_events` | REST under user JWTs: tenant B supervisor 0 rows; owning caseworker 0 rows (013, 019, 023) | verified |
| Owner-scoped `sessions` | REST + UI "Session not found" for a same-tenant non-owner (013, 019, 023); runtime-verify (015) | verified |
| Findings and document text held in memory only | code inspection of `Reviewer.tsx` and absence of any persistence call on the path; DB rows contain no text (020) | verified for the demo path; inspected for the rest |
| Parser artifact stores structure, not body | inspection of `generate-parser-artifacts` | inspected |
| Local-model inference keeps text on the workstation | inspection of `localModel.ts` | designed, BLOCKED to test |
| Client-side encrypted case-notes vault (AES-256-GCM, PBKDF2) | none | designed |
| Presidio redaction | none | disabled |
| Transport guard in production | Deno unit test with `ENVIRONMENT=production` (16 passed) | verified at unit level |

## BLOCKED items and exact next action

| Item | Status | Next action |
|---|---|---|
| Live local-model Reviewer run | BLOCKED | Install Ollama and pull `llama3` locally; start Ollama with `OLLAMA_ORIGINS=http://127.0.0.1:55480`; remove `VITE_REVIEWER_MODEL_SOURCE` from `.env.local`; rerun `npm run demo:browser` with the fixture assertions adapted (the script currently refuses to run without the fixture flag; expect the fixture-specific assertions to need adjustment) and record the live `tool_name=run_reviewer_v2` events |
| `audio-uploads` storage policy check | resolved 2026-10-13 | The verify script now sends `audio/webm`; the caseworker upload is rejected by policy (PASS) |
| Lint clean | failing (250 problems, 221 errors on 2026-10-13) | Fix the errors (mostly `no-explicit-any`, two `rules-of-hooks` in `DevRoleToggle.tsx`) or scope ESLint to `src/` and `supabase/functions/`; re-run `npm run lint` |
| Vitest without environment | failing without `VITE_SUPABASE_URL` | CI now sets placeholder `VITE_*` values; a test-safe fallback in `src/integrations/supabase/client.ts` or `vitest.setup.ts` would remove the need locally |
| Hosted-AI features (Guidance, Records Room, KB ingestion) | not exercised | Provide an OpenAI key and the Cloud Run worker in a non-production project; run the flows and record evidence |
| `DEV: Cleanup Orphans` button in the supervisor header | pre-existing, not gated | Gate `OrphanCleanupButton` on `import.meta.env.DEV` or `VITE_DEV_MODE`, then recapture screenshots |
| Realtime for `eye_events` | not in publication | Add `eye_events` to `supabase_realtime` in a new migration if live updates are wanted; otherwise document polling |

## Open owner decisions (none done here)

1. Hosted Supabase project: decide whether it is live or retired; if live, rotate the anon key, remove the historical `*.test@aidmind.dev` accounts and apply the corrective migrations; if retired, say so publicly. This work ran only against an isolated local stack.
2. Anon key rotation and untracking of any committed env files: not done.
3. License: no `LICENSE` file and no `license` field decision; not added.
4. Test-account password in history: an early revision of `docs/mvp-auth-qa.md` contains a shared password for the hosted `*.test@aidmind.dev` accounts; rotate or delete those accounts before the repository is public (history is not rewritten).
5. Collaborator consent and attribution for publication; then the license choice in item 3.
6. Legacy directories (`backend/the_mind_backend/`, `src/legacy/`, `bun.lockb`, `supabase/functions/_future/`): kept; deletion is an owner decision.
