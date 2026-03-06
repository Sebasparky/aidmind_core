"""Tests for kb-extractor-service Flask app."""

import json
import os
import threading
import time
import unittest
from unittest.mock import patch, MagicMock

# Set env before importing app
os.environ["KICK_SECRET"] = "test-secret"
os.environ["DRAIN_MAX_LOOPS"] = "3"
os.environ["DRAIN_MAX_SECONDS"] = "10"
os.environ["DRAIN_EMPTY_STREAK"] = "2"
os.environ["DRAIN_SLEEP_MS"] = "50"

from app import app, _lock, _drain_loop
import app as app_module


class TestHealthz(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_healthz_returns_200(self):
        resp = self.client.get("/healthz")
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.data)
        self.assertTrue(data["ok"])

    def test_healthz_trailing_slash_returns_200(self):
        resp = self.client.get("/healthz/")
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.data)
        self.assertTrue(data["ok"])


class TestIndex(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_index_lists_endpoints(self):
        resp = self.client.get("/")
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.data)
        self.assertEqual(data["service"], "kb-extractor-service")
        endpoints = data["endpoints"]
        self.assertIn("/healthz", endpoints)
        self.assertIn("/run", endpoints)

    def test_routes_endpoint(self):
        resp = self.client.get("/_routes")
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.data)
        rules = [r["rule"] for r in data["rules"]]
        self.assertIn("/healthz", rules)
        self.assertIn("/run", rules)


class TestRunAuth(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()
        # Reset running state
        with _lock:
            app_module._running = False

    def test_run_401_missing_header(self):
        resp = self.client.post("/run")
        self.assertEqual(resp.status_code, 401)

    def test_run_401_wrong_secret(self):
        resp = self.client.post("/run", headers={"X-AIDMIND-KICK-SECRET": "wrong"})
        self.assertEqual(resp.status_code, 401)

    @patch("app.threading.Thread")
    def test_run_202_correct_secret(self, mock_thread_cls):
        mock_thread = MagicMock()
        mock_thread_cls.return_value = mock_thread
        resp = self.client.post("/run", headers={"X-AIDMIND-KICK-SECRET": "test-secret"})
        self.assertEqual(resp.status_code, 202)
        data = json.loads(resp.data)
        self.assertTrue(data["ok"])
        self.assertEqual(data["status"], "draining")
        # Reset
        with _lock:
            app_module._running = False

    @patch("app.threading.Thread")
    def test_run_409_already_running(self, mock_thread_cls):
        mock_thread = MagicMock()
        mock_thread_cls.return_value = mock_thread
        # First call
        resp1 = self.client.post("/run", headers={"X-AIDMIND-KICK-SECRET": "test-secret"})
        self.assertEqual(resp1.status_code, 202)
        # Second call while "running"
        resp2 = self.client.post("/run", headers={"X-AIDMIND-KICK-SECRET": "test-secret"})
        self.assertEqual(resp2.status_code, 409)
        data = json.loads(resp2.data)
        self.assertEqual(data["error"], "already_running")
        # Reset
        with _lock:
            app_module._running = False


class TestDrainLoop(unittest.TestCase):
    def setUp(self):
        with _lock:
            app_module._running = True
            app_module._last = {}

    @patch("app.subprocess.run")
    def test_drain_stops_on_empty_streak(self, mock_run):
        """Drain should stop after DRAIN_EMPTY_STREAK consecutive no-job runs."""
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout="some output\nNO_JOBS_AVAILABLE=true\n",
            stderr="",
        )
        _drain_loop()

        with _lock:
            self.assertFalse(app_module._running)
            self.assertEqual(app_module._last["stopped_reason"], "queue_empty")
            # With DRAIN_EMPTY_STREAK=2, should run exactly 2 iterations
            self.assertEqual(app_module._last["loops_completed"], 2)


class TestStatus(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_status_returns_shape(self):
        resp = self.client.get("/status")
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.data)
        self.assertIn("running", data)
        self.assertIn("status", data)
        self.assertIn("last", data)


if __name__ == "__main__":
    unittest.main()
