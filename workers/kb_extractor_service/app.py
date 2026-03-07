"""
kb-extractor-service — lightweight Flask trigger that kicks a Cloud Run Job
to process the KB ingestion queue.

Architecture:
  Supabase Edge (kb-kick) → POST /run → this service → Cloud Run Jobs API → kb-extractor-job

Endpoints:
  POST /run       — Trigger Cloud Run Job execution (returns 202)
  GET  /healthz/  — Health check (canonical, trailing slash)
  GET  /          — Service info + registered endpoints

Debug endpoints (disabled by default in production):
  GET  /status    — Last trigger attempt info (requires DEBUG_ROUTES=true or KICK_SECRET header)
  GET  /_routes   — Full Flask route map (requires DEBUG_ROUTES=true or KICK_SECRET header)

Env vars:
  KICK_SECRET             — shared secret for X-AIDMIND-KICK-SECRET header auth
  GCP_PROJECT             — Google Cloud project ID
  RUN_REGION              — Cloud Run region (default us-central1)
  RUN_JOB_NAME            — Cloud Run Job name (default kb-extractor-job)
  RUN_API_BASE            — Run API base URL (default https://run.googleapis.com)
  RUN_REQUEST_TIMEOUT_SECS — Timeout for Run API call (default 5)
  DEBUG_ROUTES            — Set to "true" to expose /status and /_routes without secret (default false)
"""

from __future__ import annotations

import logging
import os
import sys
import time

import requests as http_requests
from flask import Flask, request, jsonify

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

KICK_SECRET = os.environ.get("KICK_SECRET", "")
KICK_HEADER_NAME = os.environ.get("KICK_HEADER_NAME", "X-AIDMIND-KICK-SECRET")

GCP_PROJECT = os.environ.get("GCP_PROJECT", "")
RUN_REGION = os.environ.get("RUN_REGION", "us-central1")
RUN_JOB_NAME = os.environ.get("RUN_JOB_NAME", "kb-extractor-job")
RUN_API_BASE = os.environ.get("RUN_API_BASE", "https://run.googleapis.com")
RUN_REQUEST_TIMEOUT_SECS = int(os.environ.get("RUN_REQUEST_TIMEOUT_SECS", "5"))
DEBUG_ROUTES = os.environ.get("DEBUG_ROUTES", "false").lower() == "true"

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
# State — last trigger attempt (no concurrency guard needed now)
# ---------------------------------------------------------------------------

_last_trigger: dict = {}

app = Flask(__name__)


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

def _check_auth() -> str | None:
    """Return an error message if auth fails, else None."""
    if not KICK_SECRET:
        return "KICK_SECRET not configured on server"
    header = request.headers.get(KICK_HEADER_NAME, "")
    if header != KICK_SECRET:
        return f"Invalid or missing {KICK_HEADER_NAME}"
    return None


def _check_debug_auth() -> str | None:
    """Return error if debug endpoints are not accessible. None = allowed."""
    if DEBUG_ROUTES:
        return None
    # Fall back to kick secret header
    return _check_auth()


# ---------------------------------------------------------------------------
# Cloud Run Job helpers
# ---------------------------------------------------------------------------

def _fetch_access_token() -> str:
    """Fetch an OAuth2 access token from the GCE metadata server.

    Uses the access token endpoint (not identity token) because the
    Cloud Run Jobs API requires standard OAuth2 bearer tokens.
    """
    url = (
        "http://metadata.google.internal/computeMetadata/v1/"
        "instance/service-accounts/default/token"
    )
    resp = http_requests.get(
        url,
        headers={"Metadata-Flavor": "Google"},
        timeout=2,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


def _run_cloud_run_job() -> dict:
    """Trigger a Cloud Run Job execution. Returns dict with result info."""
    if not GCP_PROJECT:
        return {"ok": False, "error": "GCP_PROJECT env var not set"}

    job_url = (
        f"{RUN_API_BASE}/v2/projects/{GCP_PROJECT}"
        f"/locations/{RUN_REGION}/jobs/{RUN_JOB_NAME}:run"
    )

    try:
        token = _fetch_access_token()
    except Exception as exc:
        log.error("Failed to fetch access token: %s", exc)
        return {"ok": False, "error": "access_token_failed", "details": str(exc)}

    try:
        resp = http_requests.post(
            job_url,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json={},
            timeout=RUN_REQUEST_TIMEOUT_SECS,
        )
    except Exception as exc:
        log.error("Cloud Run Jobs API call failed: %s", exc)
        return {"ok": False, "error": "api_call_failed", "details": str(exc)}

    if resp.status_code < 200 or resp.status_code >= 300:
        body = resp.text[:2000]
        log.error(
            "Cloud Run Jobs API returned %d: %s", resp.status_code, body
        )
        return {
            "ok": False,
            "error": "api_non_2xx",
            "status_code": resp.status_code,
            "details": body,
        }

    data = resp.json()
    execution_name = data.get("metadata", {}).get("name", data.get("name", "unknown"))
    log.info("Cloud Run Job triggered: execution=%s", execution_name)
    return {"ok": True, "execution": execution_name}


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
        "endpoints": ["/healthz/", "POST /run"],
    })


@app.get("/_routes")
def routes():
    auth_err = _check_debug_auth()
    if auth_err:
        return jsonify({"ok": False, "error": auth_err}), 401
    return jsonify({
        "rules": sorted([{
            "rule": r.rule,
            "methods": sorted([m for m in r.methods if m not in ("HEAD", "OPTIONS")]),
            "endpoint": r.endpoint,
        } for r in app.url_map.iter_rules()], key=lambda x: x["rule"])
    })


@app.route("/status", methods=["GET"])
def status():
    auth_err = _check_debug_auth()
    if auth_err:
        return jsonify({"ok": False, "error": auth_err}), 401
    return jsonify({
        "running": False,
        "status": "idle",
        "last_trigger": dict(_last_trigger),
    }), 200


@app.route("/run", methods=["POST"])
def run():
    global _last_trigger

    auth_err = _check_auth()
    if auth_err:
        return jsonify({"ok": False, "error": auth_err}), 401

    result = _run_cloud_run_job()

    _last_trigger = {
        "ts": time.time(),
        "execution": result.get("execution"),
        "error": result.get("error"),
        "details": result.get("details"),
    }

    if result["ok"]:
        return jsonify({
            "ok": True,
            "status": "job_triggered",
            "execution": result["execution"],
        }), 202
    else:
        return jsonify({
            "ok": False,
            "error": "job_trigger_failed",
            "details": {
                k: v for k, v in result.items() if k != "ok"
            },
        }), 502


# ---------------------------------------------------------------------------
# Entrypoint (for local dev — production uses gunicorn)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080, debug=False)
