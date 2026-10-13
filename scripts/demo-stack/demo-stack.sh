#!/bin/sh
# demo-stack.sh — isolated, project-local Supabase stack for the AidMind demo.
#
# Creates and drives a SEPARATE Supabase CLI project (project_id "aidmind_demo",
# ports 5542x) in the gitignored workdir <repo>/.cache/demo-stack. The repo's own
# supabase/config.toml (and any other local stack) is never read, started,
# stopped or reset by this script: every CLI call carries --workdir .cache/demo-stack.
#
# Usage: sh scripts/demo-stack/demo-stack.sh <start|reset|status|stop|env|seed>
#   start   copy supabase/migrations + supabase/functions + scripts/demo-stack/config.toml
#           into .cache/demo-stack/supabase and `supabase start` (studio/analytics/etc excluded)
#   reset   `supabase db reset` on the demo project only (re-applies all migrations)
#   status  `supabase status` with keys redacted
#   stop    `supabase stop --no-backup --project-id aidmind_demo` (removes demo volumes)
#   env     write <repo>/.env.local pointing the Vite app at the demo stack
#           (refuses to overwrite an existing .env.local unless DEMO_FORCE_ENV=1)
#   seed    run scripts/demo-stack/seed-demo.ts (Deno) against the demo stack
#
# Environment overrides (defaults = the values above; unset = unchanged behaviour):
#   DEMO_PROJECT_ID      project id (default aidmind_demo)
#   DEMO_PORT_BASE       base port (default 55420): shadow=+0 api=+1 db=+2 studio=+3
#                        smtp=+4 analytics=+7 pooler=+9
#   DEMO_SHADOW_PORT DEMO_API_PORT DEMO_DB_PORT DEMO_STUDIO_PORT DEMO_SMTP_PORT
#   DEMO_ANALYTICS_PORT DEMO_POOLER_PORT   individual port overrides
#   DEMO_INSPECTOR_PORT  edge runtime inspector port (default 8083)
#   DEMO_APP_PORT        Vite app port used for site_url/redirects (default 55480)
# The source scripts/demo-stack/config.toml is never edited: only the copy in
# .cache/demo-stack/supabase/config.toml is patched, and every patch is verified.
#
# Keys/passwords are never printed by this script.

set -eu
(set -o pipefail) 2>/dev/null && set -o pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
WORKDIR_NAME=".cache/demo-stack"
WORKDIR="$REPO_ROOT/$WORKDIR_NAME"
PROJECT_ID="${DEMO_PROJECT_ID:-aidmind_demo}"
PORT_BASE="${DEMO_PORT_BASE:-55420}"
SHADOW_PORT="${DEMO_SHADOW_PORT:-$((PORT_BASE + 0))}"
API_PORT="${DEMO_API_PORT:-$((PORT_BASE + 1))}"
DB_PORT="${DEMO_DB_PORT:-$((PORT_BASE + 2))}"
STUDIO_PORT="${DEMO_STUDIO_PORT:-$((PORT_BASE + 3))}"
SMTP_PORT="${DEMO_SMTP_PORT:-$((PORT_BASE + 4))}"
ANALYTICS_PORT="${DEMO_ANALYTICS_PORT:-$((PORT_BASE + 7))}"
POOLER_PORT="${DEMO_POOLER_PORT:-$((PORT_BASE + 9))}"
INSPECTOR_PORT="${DEMO_INSPECTOR_PORT:-8083}"
APP_PORT="${DEMO_APP_PORT:-55480}"
APP_URL="http://127.0.0.1:$APP_PORT"
case "$PROJECT_ID" in
  *[!A-Za-z0-9_-]*|"") echo "ERROR: DEMO_PROJECT_ID must match [A-Za-z0-9_-]+" >&2; exit 2 ;;
esac
for p in "$SHADOW_PORT" "$API_PORT" "$DB_PORT" "$STUDIO_PORT" "$SMTP_PORT" "$ANALYTICS_PORT" "$POOLER_PORT" "$INSPECTOR_PORT" "$APP_PORT"; do
  case "$p" in
    *[!0-9]*|"") echo "ERROR: demo ports must be numeric (got '$p')" >&2; exit 2 ;;
  esac
done
EXCLUDE="studio,imgproxy,logflare,vector,mailpit,supavisor,postgres-meta"
REDACT='s/eyJ[A-Za-z0-9_.-]+/[REDACTED_JWT]/g; s/sb_[A-Za-z0-9_-]+/[REDACTED_KEY]/g; s/"(JWT_SECRET|S3_PROTOCOL_ACCESS_KEY_ID|S3_PROTOCOL_ACCESS_KEY_SECRET)":"[^"]*"/"\1":"[REDACTED]"/g; s/^(JWT_SECRET|S3_PROTOCOL_ACCESS_KEY_ID|S3_PROTOCOL_ACCESS_KEY_SECRET)=.*/\1=[REDACTED]/'

cd "$REPO_ROOT"

derive_docker_host() {
  if [ -n "${DOCKER_HOST:-}" ]; then return 0; fi
  if [ -S /var/run/docker.sock ]; then return 0; fi
  # Docker Desktop on macOS without the default /var/run/docker.sock symlink
  if [ -S "$HOME/.docker/run/docker.sock" ]; then
    DOCKER_HOST="unix://$HOME/.docker/run/docker.sock"
    export DOCKER_HOST
    echo "DOCKER_HOST derived from Docker Desktop socket"
    return 0
  fi
  if command -v podman >/dev/null 2>&1; then
    sock=$(podman machine inspect --format '{{.ConnectionInfo.PodmanSocket.Path}}' 2>/dev/null || true)
    if [ -n "$sock" ] && [ -S "$sock" ]; then
      DOCKER_HOST="unix://$sock"
      export DOCKER_HOST
      echo "DOCKER_HOST derived from podman machine socket"
      return 0
    fi
  fi
  echo "ERROR: no container runtime socket (set DOCKER_HOST, or start the podman machine)" >&2
  exit 2
}

require_demo_workdir() {
  cfg="$WORKDIR/supabase/config.toml"
  if [ ! -f "$cfg" ]; then
    echo "ERROR: $cfg not found; run '$0 start' first" >&2
    exit 2
  fi
  if ! grep -Eq "^project_id = \"$PROJECT_ID\"$" "$cfg"; then
    echo "ERROR: refusing: $cfg does not carry project_id \"$PROJECT_ID\"" >&2
    exit 2
  fi
}

sb() {
  # Always scoped to the demo workdir; never the repo's supabase/config.toml.
  supabase --workdir "$WORKDIR_NAME" "$@"
}

# patch_copy <file> <old line> <new line>: anchored whole-line substitution in the
# workdir COPY only; fails loudly if the old line is missing or the new line did not land.
patch_copy() {
  f="$1"; old="$2"; new="$3"
  if [ "$old" = "$new" ]; then
    grep -Fxq "$old" "$f" || { echo "ERROR: expected line '$old' not found in $f" >&2; exit 2; }
    return 0
  fi
  grep -Fxq "$old" "$f" || { echo "ERROR: cannot patch: line '$old' not found in $f" >&2; exit 2; }
  esc_old=$(printf '%s' "$old" | sed -e 's/[]\/$*.^[]/\\&/g')
  esc_new=$(printf '%s' "$new" | sed -e 's/[\/&]/\\&/g')
  sed "s/^${esc_old}\$/${esc_new}/" "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  if grep -Fxq "$old" "$f" || ! grep -Fxq "$new" "$f"; then
    echo "ERROR: substitution '$old' -> '$new' did not apply in $f" >&2
    exit 2
  fi
}

patch_config_copy() {
  cfg="$WORKDIR/supabase/config.toml"
  patch_copy "$cfg" 'project_id = "aidmind_demo"' "project_id = \"$PROJECT_ID\""
  patch_copy "$cfg" 'port = 55421' "port = $API_PORT"
  patch_copy "$cfg" 'port = 55422' "port = $DB_PORT"
  patch_copy "$cfg" 'shadow_port = 55420' "shadow_port = $SHADOW_PORT"
  patch_copy "$cfg" 'port = 55429' "port = $POOLER_PORT"
  patch_copy "$cfg" 'port = 55423' "port = $STUDIO_PORT"
  patch_copy "$cfg" 'port = 55424' "port = $SMTP_PORT"
  patch_copy "$cfg" 'port = 55427' "port = $ANALYTICS_PORT"
  patch_copy "$cfg" 'inspector_port = 8083' "inspector_port = $INSPECTOR_PORT"
  if [ "$APP_URL" != "http://127.0.0.1:55480" ]; then
    sed -E "s#http://127\\.0\\.0\\.1:55480([^0-9]|\$)#${APP_URL}\\1#g" "$cfg" > "$cfg.tmp" && mv "$cfg.tmp" "$cfg"
    if grep -Fq "http://127.0.0.1:55480" "$cfg"; then
      echo "ERROR: app url substitution did not apply in $cfg" >&2; exit 2
    fi
  fi
  n_app=$(grep -Fc "$APP_URL" "$cfg" || true)
  if [ "$n_app" -lt 2 ]; then
    echo "ERROR: expected site_url and additional_redirect_urls to carry $APP_URL in $cfg" >&2; exit 2
  fi
  if ! grep -Eq "^project_id = \"$PROJECT_ID\"$" "$cfg"; then
    echo "ERROR: patched copy does not carry project_id \"$PROJECT_ID\"" >&2; exit 2
  fi
  echo "config copy patched and verified: project_id=$PROJECT_ID api=$API_PORT db=$DB_PORT shadow=$SHADOW_PORT pooler=$POOLER_PORT studio=$STUDIO_PORT smtp=$SMTP_PORT analytics=$ANALYTICS_PORT inspector=$INSPECTOR_PORT app=$APP_URL"
  grep -nE '^(project_id|port|shadow_port|inspector_port) = |^site_url|^additional_redirect_urls' "$cfg"
}

# Refuse to start if any chosen port already has a listener (it would belong to someone else).
check_ports_free() {
  busy=""
  for p in "$SHADOW_PORT" "$API_PORT" "$DB_PORT" "$STUDIO_PORT" "$SMTP_PORT" "$ANALYTICS_PORT" "$POOLER_PORT" "$INSPECTOR_PORT"; do
    if lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then busy="$busy $p"; fi
  done
  if [ -n "$busy" ]; then
    echo "ERROR: refusing to start: port(s)$busy already listening (not this project's running stack)" >&2
    exit 2
  fi
  echo "ports free: $SHADOW_PORT $API_PORT $DB_PORT $STUDIO_PORT $SMTP_PORT $ANALYTICS_PORT $POOLER_PORT $INSPECTOR_PORT"
}

cmd_start() {
  derive_docker_host
  if ! grep -Eq "^project_id = \"aidmind_demo\"$" "$SCRIPT_DIR/config.toml"; then
    echo "ERROR: scripts/demo-stack/config.toml must carry project_id \"aidmind_demo\"" >&2
    exit 2
  fi
  cfg="$WORKDIR/supabase/config.toml"
  if [ -f "$cfg" ] && grep -Eq "^project_id = \"$PROJECT_ID\"$" "$cfg" && sb status >/dev/null 2>&1; then
    echo "workdir: $WORKDIR (project_id=$PROJECT_ID, api=$API_PORT)"
    echo "demo stack already running for project_id=$PROJECT_ID; start skipped (idempotent)"
    return 0
  fi
  mkdir -p "$WORKDIR/supabase"
  rm -rf "$WORKDIR/supabase/migrations" "$WORKDIR/supabase/functions"
  cp -R "$REPO_ROOT/supabase/migrations" "$WORKDIR/supabase/migrations"
  cp -R "$REPO_ROOT/supabase/functions" "$WORKDIR/supabase/functions"
  cp "$SCRIPT_DIR/config.toml" "$cfg"
  patch_config_copy
  echo "workdir: $WORKDIR (project_id=$PROJECT_ID, api=$API_PORT)"
  echo "migrations copied: $(ls "$WORKDIR/supabase/migrations" | wc -l | tr -d ' ')"
  echo "functions copied:  $(ls -d "$WORKDIR"/supabase/functions/*/ | wc -l | tr -d ' ')"
  check_ports_free
  sb start -x "$EXCLUDE" 2>&1 | sed -E "$REDACT"
  echo "demo stack started (project_id=$PROJECT_ID)"
}

cmd_reset() {
  derive_docker_host
  require_demo_workdir
  sb db reset 2>&1 | sed -E "$REDACT"
  echo "demo stack database reset (project_id=$PROJECT_ID)"
}

cmd_status() {
  derive_docker_host
  require_demo_workdir
  sb status 2>&1 | sed -E "$REDACT"
}

cmd_stop() {
  derive_docker_host
  require_demo_workdir
  sb stop --no-backup --project-id "$PROJECT_ID" 2>&1 | sed -E "$REDACT"
  echo "demo stack stopped and volumes removed (project_id=$PROJECT_ID)"
}

cmd_env() {
  derive_docker_host
  require_demo_workdir
  target="$REPO_ROOT/.env.local"
  if [ -f "$target" ] && [ "${DEMO_FORCE_ENV:-0}" != "1" ]; then
    echo "ERROR: $target already exists; set DEMO_FORCE_ENV=1 to overwrite" >&2
    exit 2
  fi
  anon=$(sb status -o env 2>/dev/null | sed -n -E 's/^ANON_KEY="?([^"]*)"?$/\1/p' | head -n 1)
  api=$(sb status -o env 2>/dev/null | sed -n -E 's/^API_URL="?([^"]*)"?$/\1/p' | head -n 1)
  if [ -z "$anon" ] || [ -z "$api" ]; then
    echo "ERROR: could not read ANON_KEY/API_URL from the demo stack status" >&2
    exit 2
  fi
  case "$api" in
    http://127.0.0.1:$API_PORT|http://localhost:$API_PORT) ;;
    *) echo "ERROR: demo stack API_URL is not loopback:$API_PORT (refusing)" >&2; exit 2 ;;
  esac
  umask 077
  {
    echo "# Generated by scripts/demo-stack/demo-stack.sh env — isolated demo stack (gitignored)"
    echo "VITE_SUPABASE_URL=http://127.0.0.1:$API_PORT"
    echo "VITE_SUPABASE_PUBLISHABLE_KEY=$anon"
    echo "VITE_SUPABASE_PROJECT_ID=$PROJECT_ID"
    echo "VITE_DEV_MODE=false"
    echo "# Reviewer runs the labelled fixture replay (no local/hosted model): see src/services/reviewerFixtureReplay.ts"
    echo "VITE_REVIEWER_MODEL_SOURCE=fixture"
  } > "$target"
  echo "wrote $target (VITE_SUPABASE_URL=http://127.0.0.1:$API_PORT, VITE_REVIEWER_MODEL_SOURCE=fixture; key not shown)"
  echo "app url for the demo browser: $APP_URL"
}

cmd_seed() {
  derive_docker_host
  require_demo_workdir
  DEMO_PROJECT_ID="$PROJECT_ID" DEMO_API_PORT="$API_PORT" \
  deno run --no-lock --node-modules-dir=none \
    --allow-run=supabase --allow-env \
    --allow-net=127.0.0.1:$API_PORT,localhost:$API_PORT \
    --allow-read="$WORKDIR_NAME" --allow-write="$WORKDIR_NAME" \
    "$SCRIPT_DIR/seed-demo.ts" 2>&1 | sed -E "$REDACT"
}

case "${1:-}" in
  start)  cmd_start ;;
  reset)  cmd_reset ;;
  status) cmd_status ;;
  stop)   cmd_stop ;;
  env)    cmd_env ;;
  seed)   cmd_seed ;;
  *) echo "usage: $0 <start|reset|status|stop|env|seed>" >&2; exit 2 ;;
esac
