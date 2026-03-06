"""
kb-extractor-service — Flask supervisor that kicks the KB extractor worker
and drains the queue until empty (or safety limits hit).

Endpoints:
  POST /run      — Start drain loop (returns 202 immediately)
  GET  /status   — Current drain state + last run info
  GET  /healthz  — Health check

Env vars:
  KICK_SECRET             — shared secret for X-AIDMIND-KICK-SECRET header auth
  DRAIN_MAX_LOOPS         — max worker invocations per drain (default 20)
  DRAIN_MAX_SECONDS       — wall-clock cap per drain (default 840 = 14 min)
  DRAIN_SLEEP_MS          — pause between loops in ms (default 250)
  DRAIN_EMPTY_STREAK      — stop after N consecutive empty runs (default 2)
"""

from __future__ import annotations

import logging
import os
import subprocess
import sys
import threading
import time

from flask import Flask, request, jsonify

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

KICK_SECRET = os.environ.get("KICK_SECRET", "")
DRAIN_MAX_LOOPS = int(os.environ.get("DRAIN_MAX_LOOPS", "20"))
DRAIN_MAX_SECONDS = int(os.environ.get("DRAIN_MAX_SECONDS", "840"))
DRAIN_SLEEP_MS = int(os.environ.get("DRAIN_SLEEP_MS", "250"))
DRAIN_EMPTY_STREAK = int(os.environ.get("DRAIN_EMPTY_STREAK", "2"))

WORKER_SCRIPT = os.environ.get(
    "WORKER_SCRIPT", "/app/workers/kb_extractor/main.py"
)

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("kb_extractor_service")

# ---------------------------------------------------------------------------
# Shared state (process-level, guarded by _lock)
# ---------------------------------------------------------------------------

_lock = threading.Lock()
_running = False
_last: dict = {}

app = Flask(__name__)


# ---------------------------------------------------------------------------
# Auth helper
# ---------------------------------------------------------------------------

def _check_auth() -> str | None:
    """Return an error message if auth fails, else None."""
    if not KICK_SECRET:
        return "KICK_SECRET not configured on server"
    header = request.headers.get("X-AIDMIND-KICK-SECRET", "")
    if header != KICK_SECRET:
        return "Invalid or missing X-AIDMIND-KICK-SECRET"
    return None


# ---------------------------------------------------------------------------
# Drain loop (runs in background thread)
# ---------------------------------------------------------------------------

def _drain_loop() -> None:
    global _running, _last

    start_wall = time.monotonic()
    loops = 0
    empty_streak = 0

    log.info(
        "Drain loop started: max_loops=%d max_seconds=%d empty_streak_limit=%d",
        DRAIN_MAX_LOOPS, DRAIN_MAX_SECONDS, DRAIN_EMPTY_STREAK,
    )

    try:
        while loops < DRAIN_MAX_LOOPS:
            elapsed = time.monotonic() - start_wall
            if elapsed >= DRAIN_MAX_SECONDS:
                log.info("Drain loop hit wall-clock cap (%.1fs)", elapsed)
                break

            loops += 1
            log.info("Drain iteration %d / %d (%.1fs elapsed)", loops, DRAIN_MAX_LOOPS, elapsed)

            try:
                proc = subprocess.run(
                    ["python", WORKER_SCRIPT],
                    capture_output=True,
                    text=True,
                    timeout=DRAIN_MAX_SECONDS - elapsed + 10,  # generous per-run timeout
                )
                exit_code = proc.returncode
                stdout_tail = (proc.stdout or "")[-2000:]
                stderr_tail = (proc.stderr or "")[-2000:]
            except subprocess.TimeoutExpired:
                log.warning("Worker subprocess timed out on iteration %d", loops)
                exit_code = -1
                stdout_tail = ""
                stderr_tail = "subprocess.TimeoutExpired"
            except Exception as exc:
                log.exception("Failed to run worker subprocess: %s", exc)
                exit_code = -1
                stdout_tail = ""
                stderr_tail = str(exc)

            # Detect empty queue signal
            no_jobs = "NO_JOBS_AVAILABLE=true" in stdout_tail
            if no_jobs:
                empty_streak += 1
                log.info("Worker reported no jobs (streak=%d/%d)", empty_streak, DRAIN_EMPTY_STREAK)
            else:
                empty_streak = 0

            # Update shared state
            with _lock:
                _last = {
                    "loops_completed": loops,
                    "elapsed_seconds": round(time.monotonic() - start_wall, 1),
                    "last_exit_code": exit_code,
                    "last_stdout_tail": stdout_tail[-500:],
                    "last_stderr_tail": stderr_tail[-500:],
                    "empty_streak": empty_streak,
                    "stopped_reason": None,
                }

            if empty_streak >= DRAIN_EMPTY_STREAK:
                log.info("Drain loop stopping: empty streak reached (%d)", empty_streak)
                break

            if exit_code != 0:
                log.warning("Worker exited with code %d on iteration %d", exit_code, loops)
                # Continue trying — transient errors shouldn't stop the drain

            # Small sleep between loops
            time.sleep(DRAIN_SLEEP_MS / 1000.0)

    except Exception as exc:
        log.exception("Drain loop crashed: %s", exc)
    finally:
        elapsed_final = round(time.monotonic() - start_wall, 1)
        reason = "completed"
        if loops >= DRAIN_MAX_LOOPS:
            reason = "max_loops"
        elif elapsed_final >= DRAIN_MAX_SECONDS:
            reason = "max_seconds"
        elif empty_streak >= DRAIN_EMPTY_STREAK:
            reason = "queue_empty"

        with _lock:
            _last["stopped_reason"] = reason
            _last["elapsed_seconds"] = elapsed_final
            _last["loops_completed"] = loops
            _running = False

        log.info(
            "Drain loop finished: loops=%d elapsed=%.1fs reason=%s",
            loops, elapsed_final, reason,
        )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/healthz", methods=["GET"])
@app.route("/healthz/", methods=["GET"])
def healthz():
    return jsonify({"ok": True}), 200


@app.get("/")
def index():
    return jsonify({
        "service": "kb-extractor-service",
        "endpoints": sorted([str(r) for r in app.url_map.iter_rules()]),
    })


@app.get("/_routes")
def routes():
    return jsonify({
        "rules": sorted([{
            "rule": r.rule,
            "methods": sorted([m for m in r.methods if m not in ("HEAD", "OPTIONS")]),
            "endpoint": r.endpoint,
        } for r in app.url_map.iter_rules()], key=lambda x: x["rule"])
    })


@app.route("/status", methods=["GET"])
def status():
    with _lock:
        return jsonify({
            "running": _running,
            "status": "running" if _running else "idle",
            "last": dict(_last),
        }), 200


@app.route("/run", methods=["POST"])
def run():
    global _running

    auth_err = _check_auth()
    if auth_err:
        return jsonify({"ok": False, "error": auth_err}), 401

    with _lock:
        if _running:
            return jsonify({"ok": False, "error": "already_running"}), 409
        _running = True

    # Start drain in background thread
    t = threading.Thread(target=_drain_loop, daemon=True)
    t.start()

    return jsonify({"ok": True, "status": "draining"}), 202


# ---------------------------------------------------------------------------
# Entrypoint (for local dev — production uses gunicorn)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080, debug=False)
