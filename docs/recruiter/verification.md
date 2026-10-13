# Verification: claims, evidence and how to reproduce

Every claim in this evidence pack is classified as one of: **executed-test** (a saved check ran it), **real-browser** (playwright-core driving the installed Chrome against the running app and API), **code-inspection** (read, not run), **designed-but-untested**, or **disabled**. Unless a section says otherwise, check labels refer to the saved check directories (`checks/<number>-<label>/stdout.txt`) of the October 8 verification run (Sparky verification run `0.2.1/20261008T163743Z-19451`), which is kept outside this repository. Its numbers are stable within that run. The 2026-10-13 re-verification below supersedes its runtime-verify result.

Reviewer mode for every browser run: **fixture replay, no live model** (`VITE_REVIEWER_MODEL_SOURCE=fixture`). Server mode for the final screenshots: **preview** (`vite build` then `vite preview`).

## Re-verification on 2026-10-13 (current tree)

This pass ran after the forward-port of the demo work into the repository and three small fixes:

- the corrective migration `20261013120000_revoke_client_execute_complete_kb_job.sql`;
- the `audio-uploads` check in `runtime-verify-local.ts` now sends an audio MIME type, so the bucket's MIME filter no longer pre-empts the policy;
- `complete_kb_job` was added to the restricted-RPC checks.

Everything ran on a fresh isolated stack (`DEMO_PROJECT_ID=aidmind_rel`, `DEMO_PORT_BASE=55460`, app port 55495), which was then stopped and its volumes removed.

| Check | Result |
|---|---|
| `npm ci` | exit 0 |
| `npx vitest run` with placeholder `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` | 20 files, 572 tests passed |
| `npm run build` | exit 0 (chunk-size warnings only) |
| `npx tsx scripts/check-dangerous-html.ts` | no dangerous HTML patterns |
| Deno authorization-rules + storage-path (`--no-lock`) | 24 passed |
| Deno transport-guard, `ENVIRONMENT=production`, `--allow-env` | 16 passed |
| `npm run demo:stack` | 32 "Applying migration" lines, exit 0 |
| `npm run demo:seed` | 2 tenants, 5 users (`@example.test`, incl. the auditor), template, 8-field schema, session; exit 0 |
| `npm run demo:browser:preview` | 31 passed, 0 failed; regenerated `screenshots/` and `demo-evidence.json` |
| `node scripts/demo-stack/record-demo.mjs --verify-auditor` | 8 passed, 0 failed |
| `scripts/runtime-verify-local.ts` | `GREEN`: `PASS 291  FAIL 0  FINDING 0  BLOCKED 0  OBSERVE 9  SKIP 0`. Same nine OBSERVE lines as listed below; `anon` / caseworker / supervisor cannot execute `complete_kb_job`; caseworker upload to `audio-uploads` is rejected by policy |
| Read-only grant sweep (`has_function_privilege`) over public `SECURITY DEFINER` functions | Internal KB/guidance functions, including `complete_kb_job`, are not executable by `anon` or `authenticated`. Still executable by `anon`: `get_my_profile`, `get_my_role` (caller's own row), `has_role`, `is_tenant_member` (booleans) and the trigger function `handle_new_user` |
| `npm run lint` | fails: 250 problems (221 errors, 29 warnings). Pre-existing; the increase over 245 comes from the later demo scripts. `.cache/` is now ignored by ESLint, because the demo stack copies the edge functions there |

The older sections below are kept as the record of the October 8 run.

## Claim / evidence table

| Claim | Evidence type | Check label(s) | Result |
|---|---|---|---|
| Dependencies install from the lockfile | executed-test | 001-npm-ci | exit 0 |
| Frontend unit tests pass when a Supabase URL is configured | executed-test | 012-vitest-and-build, 017-review-vitest-build, 024-round2-tests-build-deno-browser | 20 files, 572 tests passed |
| Frontend unit tests depend on `VITE_SUPABASE_URL` | executed-test | 002-vitest-run | 3 of 19 files fail at import with `supabaseUrl is required`; 532 tests in the other 16 files pass |
| Production build succeeds | executed-test | 003-npm-build, 012-vitest-and-build, 017-review-vitest-build, 024-round2-tests-build-deno-browser | exit 0 (chunk-size warnings only) |
| Lint is clean | executed-test | 005-lint-dangerous-html-deno-tests | **FAILS**: 245 problems (216 errors, 29 warnings), pre-existing |
| No `dangerouslySetInnerHTML` / `innerHTML` in the frontend | executed-test | 005-lint-dangerous-html-deno-tests | 225 files scanned, no violations |
| Edge-function authorization rules and storage-path checks | executed-test (Deno) | 005, 014-deno-tests, 018-review-deno-tests, 024-round2-tests-build-deno-browser | 24 passed |
| Transport guard rejects insecure transport in production | executed-test (Deno, `ENVIRONMENT=production`) | 005, 014, 018, 024 | 16 passed |
| Fixture replay drops absent excerpts, keeps and classifies the three present ones, never flags the attributed quote, is deterministic | executed-test | 014-deno-tests (check label; the file is a vitest file, `src/services/__tests__/reviewerFixtureReplay.test.ts`) | 3 passed |
| All 31 migrations apply on a fresh isolated stack | executed-test | 010-demo-stack-start, 022-round2-fresh-stack-start-env-seed | 31 "Applying migration" lines, exit 0; 022 started from removed volumes |
| Seed is repeatable and synthetic | executed-test | 011-demo-seed, 022-round2-fresh-stack-start-env-seed | 2 tenants, 4 users (`@example.test`), 1 template, 1 schema (8 fields), 1 session; exit 0 |
| Caseworker lands on `/dashboard`; supervisor on `/supervisor`; supervisor visiting `/dashboard` is redirected | real-browser | 013-demo-browser, 019-review-demo-browser, 023-round2-demo-browser-preview | PASS |
| Reviewer shows two "Fixture replay — no live model" badges, three expected findings, and does not flag the attributed quote | real-browser | 013, 019, 023 | PASS |
| `report_client_event` bodies for `tool.run.started` / `completed` carry only allowlisted metadata keys, `tool_name=run_reviewer_v2_fixture`, HTTP 200, and no sentence of the document | real-browser (request capture) | 013, 019, 023 | PASS (15 document sentences checked against every body) |
| Supervisor of the same tenant reads the session's `eye_events` rows; keys are within allowlist plus server stamps; `source=client_reported`, `verified=false`; no document sentence | real-browser (REST under the user's JWT) | 013, 019, 023 | PASS |
| Supervisor detail drawer opens, is settled in the viewport, and shows `Tool: run_reviewer_v2_fixture` | real-browser | 023-round2-demo-browser-preview, 024-round2-tests-build-deno-browser | PASS (drawer bounding box x=1056, width 384 inside the 1440 px viewport; `Tool` row matched once) |
| Supervisor of tenant B sees 0 rows for the session | real-browser | 013, 019, 023 | PASS |
| Same-tenant non-owner caseworker sees 0 `sessions` rows and "Session not found" in the UI | real-browser | 013, 019, 023 | PASS |
| Owning caseworker cannot read `eye_events` (0 rows) | real-browser | 013, 019, 023 | PASS |
| Stored audit rows contain no document text | executed-test (read-only `psql` in the demo DB container) | 020-review-db-eye-events | 0 rows containing "lying", "rude" or "Rivera"; all session rows `tool_name=run_reviewer_v2_fixture`, `source=client_reported`, `verified=false` |
| Runtime authorization verification on the isolated stack | executed-test (Deno script, real requests under user JWTs) | 015-runtime-verify-local-demo-stack | `NOT GREEN — PASS 287 FAIL 1 FINDING 0 BLOCKED 0 OBSERVE 9`; details below |
| Edge functions verify the calling user (`_shared/require-user.ts`) | code-inspection + executed-test | 015 (edge-function section), 018 | 17 of the 20 function directories with an `index.ts` import `require-user`; the exceptions are `ingest-kb-text` (shared-secret, worker-only) and the two 410 stubs `transcribe-audio` and `redact-transcript` |
| Live local-model Reviewer run | not run | none | **BLOCKED**: no Ollama / `llama3` on the machine; downloads not permitted |
| Guidance Phase 1, policy-pack compile, Records Room, embeddings, Cloud Run KB worker | not run | none | hosted AI / external services; not exercised |
| Audio transcription, Presidio redaction | disabled | none | 410 stubs; `presidio-service/` standalone and uncalled |
| Case-notes vault, `llm-gateway`, `session-manager` state machine | designed-but-untested | none | present in the tree, not on the demo path |
| Production hardening, end-to-end tenant isolation | not claimed | | runtime-verify covers the policies it lists; everything else is inspection only |

## Executed and passing

- `npm ci` (001).
- `npx vitest run` with `.env.local` present: 20 files, 572 tests (012, 017, 024).
- `npm run build` (003, 012, 017, 024).
- `npx tsx scripts/check-dangerous-html.ts`: 225 files, no violations (005).
- Deno: `authorization-rules.unit.test.ts` + `storage-path-authorization.unit.test.ts` 24 passed; `transport-guard.unit.test.ts` with `ENVIRONMENT=production` 16 passed (005, 014, 018, 024).
- Isolated stack start with 31 migrations, from removed volumes (010, 022) and seed (011, 022).
- Real-browser demo: 30 of 30 assertions in the dev-server runs (013, 019); 31 of 31 assertions (the extra one is the drawer Tool row) in the preview-build run (023).
- Read-only DB inspection of `eye_events` (020).

## Executed and failing

- `npm run lint` (005): `245 problems (216 errors, 29 warnings)`. Mostly `@typescript-eslint/no-explicit-any` and two `react-hooks/rules-of-hooks` errors in `src/components/dev/DevRoleToggle.tsx`. Pre-existing; not addressed in this work.
- `npx vitest run` without any `VITE_SUPABASE_URL` (002): 3 test files fail at import (`Error: supabaseUrl is required.`). With the generated `.env.local` (or any placeholder `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`), all 20 files pass. This is an environment dependency, not a code regression, and it is still a sharp edge for CI.
- *(Superseded by the 2026-10-13 re-verification, which is GREEN.)* `scripts/runtime-verify-local.ts` against the isolated stack (015). Summary line verbatim: `PASS 287  FAIL 1  FINDING 0  BLOCKED 0  OBSERVE 9  SKIP 0`, overall `NOT GREEN`. The saved check's exit code is 0 because of the redaction pipe; the script's own exit was non-zero per its contract.
  - FAIL (verbatim, truncated by the script): `[Storage policies (20261005220000 + corrective 20261006120000)] A1 cannot upload to audio-uploads — error: HTTP 400 {"statusCode":"415","error":"invalid_mime_type","message":"mime type application/pdf is not supported","code":"InvalidMi`. The check's positive prerequisite (the owner uploads a PDF) is rejected by the bucket's MIME restriction before the policy is reached, so the policy was neither proven nor disproven. Audio upload is a disabled feature. Not fixed.
  - OBSERVE lines (verbatim):
    1. `[Anonymous access] No apikey → request reaches PostgREST — HTTP 200, 0 rows. No credentials were sent; /auth/v1/user → 401; report_client_event → permission denied (request ran as role anon). The local gateway does not require an apikey; access is constrained by anon grants and RLS (checks below).`
    2. `[Anonymous access] anon EXECUTE on is_tenant_member — HTTP 200 false; REVOKE ... FROM PUBLIC does not remove Supabase's explicit anon default grant. Returns false for anon.`
    3. `[Tenant membership SELECT (20261005210000)] Pending member can read own tenant row — 1 rows; policy checks membership only, not profile status`
    4. `[Storage policies (20261005220000 + corrective 20261006120000)] Pending member upload to own tenant — accepted — is_tenant_member() does not check profile status`
    5. `[Audit events: direct writes + report_client_event] Supervisor may report client events on a caseworker's session (role != caseworker) — accepted by design of report_client_event`
    6. `[Governance events: record_governance_event + approval consumers] Caseworker cannot read approval status (eye_events SELECT is supervisor/auditor only) — server-side gate uses the service role and is unaffected`
    7. `[Edge functions: gateway (verify_jwt) vs handler (requireUser)] kb-kick: active member passes authorization — HTTP 500 {"ok":false,"status":"config_error","error":"Missing Edge secrets (KB_EXTRACTOR_SERVICE_URL or KB_EX (past auth; downstream config/service not available locally)`
    8. `[Edge functions: gateway (verify_jwt) vs handler (requireUser)] session-manager get: tenant A supervisor on A1 session — HTTP 200 {"success":true,"session":{"id":"8a70bed9-dc46-494f-ba08-2630b624c27a","session_ — allowSupervisor=true in handler while PostgREST RLS is owner-only`
    9. `[Edge functions: gateway (verify_jwt) vs handler (requireUser)] ingest-kb-text: no shared secret → rejected — HTTP 500 {"success":false,"error":"KB_INGEST_SECRET not configured"} (KB_INGEST_SECRET not configured locally; request still refused)`
  - Side effect worth knowing: the verify script leaves two genuine server-side rows in the demo DB that are not tied to the demo session (`parser_artifact.generated` and a `SECURITY_INSECURE_TRANSPORT` rejection from the transport guard). They contain no document text and may appear under the supervisor's System Issues tab. The final screenshots were taken on a fresh stack where the script had not been run.

## Skipped or not run

- Live local-model Reviewer (`runLocalReviewer` to Ollama): no Ollama, no `llama3`, downloads not permitted.
- Hosted-AI edge functions (Guidance Phase 1, `compile-policy-pack`, Records Room, embeddings) and the Cloud Run KB worker: no API keys, no external calls allowed, and not part of the chosen workflow.
- Python worker unit tests (`workers/kb_extractor_service/tests`): not run.
- `npm run lint` was run once (failing) and not re-run after edits.

## Verified by inspection only

- (October 8 run) `supabase/` directory was byte-identical to the baseline snapshot: no migration, RLS, auth, edge-function or `config.toml` change was made by that work (reviewer diff). The 2026-10-13 pass added one corrective migration.
- `scripts/demo-stack/config.toml` copies the `[functions.*] verify_jwt` entries verbatim from `supabase/config.toml`; project id `aidmind_demo`; studio, analytics, smtp and pooler disabled.
- `reviewerFixtureReplay.ts` imports only `./localReviewer` (never `localModel.ts`); `finalizeReviewReport` is a verbatim move of the live path's post-processing; `Reviewer.tsx` selects the fixture only when `import.meta.env.VITE_REVIEWER_MODEL_SOURCE === "fixture"`.
- `eye_events` is not in the `supabase_realtime` publication (only `sessions` is); the supervisor feed uses polling and the Refresh button.
- The `DEV: Cleanup Orphans` button (`src/components/supervisor/OrphanCleanupButton.tsx`) is not gated by `import.meta.env.DEV` and appears in the supervisor screenshots in both server modes.

## Reproducing each check

All commands from the repository root. `DOCKER_HOST` is derived by `demo-stack.sh`; for the verify script export it yourself as shown.

```bash
npm ci
VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_PUBLISHABLE_KEY=placeholder npx vitest run   # or with .env.local present
npm run build
npm run lint                       # expected to fail (pre-existing)
npx tsx scripts/check-dangerous-html.ts
deno test --no-lock supabase/functions/_tests/authorization-rules.unit.test.ts supabase/functions/_tests/storage-path-authorization.unit.test.ts
ENVIRONMENT=production deno test --no-lock --allow-env --allow-net supabase/functions/_tests/transport-guard.unit.test.ts
npx vitest run src/services/__tests__/reviewerFixtureReplay.test.ts

npm run demo:stop                  # only if a previous demo stack exists
npm run demo:stack                 # start + env (DEMO_FORCE_ENV=1 sh scripts/demo-stack/demo-stack.sh env if .env.local exists)
npm run demo:seed
DEMO_SERVER=preview node scripts/demo-stack/demo-browser.mjs     # or: npm run demo:browser:preview

export DOCKER_HOST="unix://$(podman machine inspect --format '{{.ConnectionInfo.PodmanSocket.Path}}')"   # podman only
SUPABASE_WORKDIR=.cache/demo-stack deno run --no-lock --node-modules-dir=none --allow-run=supabase --allow-env \
  --allow-net=127.0.0.1:55421,localhost:55421 --allow-read=. scripts/runtime-verify-local.ts
```

Running the Deno tests with the default lockfile discovery rewrote `deno.lock` (esm.sh redirect entries) during verification; the file was restored to its baseline state before the final snapshot. Use `--no-lock` or `--frozen` to avoid the rewrite.
