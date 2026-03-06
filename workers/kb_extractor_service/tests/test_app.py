"""Tests for kb-extractor-service Flask app (Cloud Run Job trigger)."""

import json
import os
import unittest
from unittest.mock import patch, MagicMock

# Set env before importing app
os.environ["KICK_SECRET"] = "test-secret"
os.environ["GCP_PROJECT"] = "test-project"
os.environ["RUN_REGION"] = "us-central1"
os.environ["RUN_JOB_NAME"] = "kb-extractor-job"

from app import app


class TestHealthz(unittest.TestCase):
    """Canonical health endpoint is /healthz/ (trailing slash)."""

    def setUp(self):
        self.client = app.test_client()

    def test_healthz_canonical_trailing_slash(self):
        resp = self.client.get("/healthz/")
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.data)
        self.assertTrue(data["ok"])

    def test_healthz_no_trailing_slash_still_works(self):
        resp = self.client.get("/healthz")
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
        self.assertIn("/healthz/", data["endpoints"])
        self.assertIn("/run", data["endpoints"])

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

    def test_run_401_missing_header(self):
        resp = self.client.post("/run")
        self.assertEqual(resp.status_code, 401)

    def test_run_401_wrong_secret(self):
        resp = self.client.post("/run", headers={"X-AIDMIND-KICK-SECRET": "wrong"})
        self.assertEqual(resp.status_code, 401)


class TestRunTrigger(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    @patch("app._run_cloud_run_job")
    def test_run_202_on_success(self, mock_trigger):
        mock_trigger.return_value = {
            "ok": True,
            "execution": "projects/test/locations/us-central1/jobs/kb-extractor-job/executions/exec-abc",
        }
        resp = self.client.post("/run", headers={"X-AIDMIND-KICK-SECRET": "test-secret"})
        self.assertEqual(resp.status_code, 202)
        data = json.loads(resp.data)
        self.assertTrue(data["ok"])
        self.assertEqual(data["status"], "job_triggered")
        self.assertIn("exec-abc", data["execution"])

    @patch("app._run_cloud_run_job")
    def test_run_502_on_api_failure(self, mock_trigger):
        mock_trigger.return_value = {
            "ok": False,
            "error": "api_non_2xx",
            "status_code": 403,
            "details": "Permission denied",
        }
        resp = self.client.post("/run", headers={"X-AIDMIND-KICK-SECRET": "test-secret"})
        self.assertEqual(resp.status_code, 502)
        data = json.loads(resp.data)
        self.assertFalse(data["ok"])
        self.assertEqual(data["error"], "job_trigger_failed")

    @patch("app._fetch_access_token")
    @patch("app.http_requests.post")
    def test_run_end_to_end_with_access_token(self, mock_post, mock_token):
        """Verify the service uses an OAuth2 access token (not identity token)."""
        mock_token.return_value = "ya29.fake-access-token"
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"name": "executions/exec-123"}
        mock_post.return_value = mock_resp

        resp = self.client.post("/run", headers={"X-AIDMIND-KICK-SECRET": "test-secret"})
        self.assertEqual(resp.status_code, 202)
        data = json.loads(resp.data)
        self.assertTrue(data["ok"])
        self.assertIn("exec-123", data["execution"])

        # Verify the API call used access token
        mock_post.assert_called_once()
        call_kwargs = mock_post.call_args
        auth_header = call_kwargs.kwargs.get("headers", {}).get("Authorization", "")
        self.assertEqual(auth_header, "Bearer ya29.fake-access-token")

    @patch("app._fetch_access_token")
    @patch("app.http_requests.post")
    def test_run_502_when_jobs_api_returns_401(self, mock_post, mock_token):
        """Verify 502 when Cloud Run Jobs API returns 401."""
        mock_token.return_value = "ya29.fake-access-token"
        mock_resp = MagicMock()
        mock_resp.status_code = 401
        mock_resp.text = '{"error": {"code": 401, "message": "UNAUTHENTICATED"}}'
        mock_post.return_value = mock_resp

        resp = self.client.post("/run", headers={"X-AIDMIND-KICK-SECRET": "test-secret"})
        self.assertEqual(resp.status_code, 502)
        data = json.loads(resp.data)
        self.assertFalse(data["ok"])
        self.assertEqual(data["error"], "job_trigger_failed")


class TestStatus(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_status_returns_shape(self):
        resp = self.client.get("/status")
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.data)
        self.assertFalse(data["running"])
        self.assertEqual(data["status"], "idle")
        self.assertIn("last_trigger", data)


if __name__ == "__main__":
    unittest.main()
