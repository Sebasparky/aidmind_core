# kb-extractor-service

Lightweight Flask trigger that receives a kick from the Supabase Edge function
(`kb-kick`) and starts a **Cloud Run Job** execution (`kb-extractor-job`) to
process the KB ingestion queue.

```
Supabase Edge (kb-kick)
  → POST /run (X-AIDMIND-KICK-SECRET)
    → kb-extractor-service (this)
      → Cloud Run Jobs API → kb-extractor-job execution
```

The service does **no long-running work** itself — it validates the secret,
fetches an **OAuth2 access token** from the GCE metadata server, calls the
Jobs API, and returns immediately.

## Health check

> **Canonical endpoint: `GET /healthz/`** (trailing slash).
>
> Some Cloud Run / proxy configurations return a Google 404 for `/healthz`
> without forwarding to the container. `/healthz/` reliably reaches Flask.
> The Flask app still registers both `/healthz` and `/healthz/` for
> backward compatibility, but always use the trailing-slash form in docs,
> monitoring, and CI.

## Endpoints

| Method | Path        | Auth          | Description                         |
| ------ | ----------- | ------------- | ----------------------------------- |
| POST   | `/run`      | Kick secret   | Trigger Cloud Run Job (returns 202) |
| GET    | `/healthz/` | None          | Health check (canonical)            |
| GET    | `/`         | None          | Service info + endpoint list        |
| GET    | `/status`   | Secret / debug| Last trigger attempt info           |
| GET    | `/_routes`  | Secret / debug| Full Flask route map                |

### Debug endpoint access

`/status` and `/_routes` are **protected by default** in production. Access requires either:
- The `X-AIDMIND-KICK-SECRET` header, **or**
- Setting env var `DEBUG_ROUTES=true` (development only)

## IAM: Public invocation with secret protection

The Cloud Run service is deployed with `--allow-unauthenticated` so that
Supabase Edge Functions and Cloud Scheduler can call it without Google IAM
credentials. **The `/run` endpoint is protected by the `X-AIDMIND-KICK-SECRET`
header**, not by IAM.

```bash
# Grant allUsers invoker (required for unauthenticated access)
gcloud run services add-iam-policy-binding kb-extractor-service \
  --member="allUsers" \
  --role="roles/run.invoker" \
  --region=us-central1
```

- **401 from the service** = kick secret mismatch
- **403 from Google** = IAM policy missing (run the command above)

## Token type

The service uses an **OAuth2 access token** (not an identity token) to call the
Cloud Run Jobs API. It fetches the token from:

```
http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token
```

This returns a standard `access_token` that works with Google APIs.

## Environment Variables

| Name                       | Default                          | Description                            |
| -------------------------- | -------------------------------- | -------------------------------------- |
| `KICK_SECRET`              | —                                | Shared secret for `/run` auth          |
| `KICK_HEADER_NAME`         | `X-AIDMIND-KICK-SECRET`         | Header name for kick secret            |
| `GCP_PROJECT`              | —                                | Google Cloud project ID (**required**) |
| `RUN_REGION`               | `us-central1`                    | Cloud Run region                       |
| `RUN_JOB_NAME`             | `kb-extractor-job`               | Cloud Run Job name                     |
| `RUN_API_BASE`             | `https://run.googleapis.com`     | Run API base URL                       |
| `RUN_REQUEST_TIMEOUT_SECS` | `5`                              | Timeout for Jobs API call (seconds)    |
| `DEBUG_ROUTES`             | `false`                          | Expose /status, /_routes without auth  |

## IAM Permissions for Job Triggering

The service account used by `kb-extractor-service` must have permission to
run the Cloud Run Job:

```bash
# Grant roles/run.developer (includes permission to run jobs)
gcloud projects add-iam-policy-binding $GCP_PROJECT \
  --member="serviceAccount:$SERVICE_ACCOUNT" \
  --role="roles/run.developer"

# If the job runs as a different service account, also grant:
gcloud iam service-accounts add-iam-policy-binding $JOB_SERVICE_ACCOUNT \
  --member="serviceAccount:$SERVICE_ACCOUNT" \
  --role="roles/iam.serviceAccountUser"
```

## Cloud Scheduler Failsafe (every 10 minutes)

To ensure the queue always drains even if Supabase Edge kick fails, set up a
Cloud Scheduler job as a failsafe:

```bash
gcloud scheduler jobs create http kb-extractor-failsafe \
  --location=us-central1 \
  --schedule="*/10 * * * *" \
  --uri="https://<SERVICE_URL>/run" \
  --http-method=POST \
  --headers="X-AIDMIND-KICK-SECRET=<KICK_SECRET>" \
  --attempt-deadline=30s \
  --description="Failsafe: kick kb-extractor-service every 10 minutes"
```

Replace `<SERVICE_URL>` and `<KICK_SECRET>` with actual values (do not commit
secrets to source control).

## Build & Deploy

```bash
# Build (from repo root)
docker build -f workers/kb_extractor_service/Dockerfile -t kb-extractor-service .

# Deploy to Cloud Run
gcloud run deploy kb-extractor-service \
  --image gcr.io/$GCP_PROJECT/kb-extractor-service \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars "KICK_SECRET=$KICK_SECRET,GCP_PROJECT=$GCP_PROJECT,RUN_JOB_NAME=kb-extractor-job"

# Test
curl -X POST -H "X-AIDMIND-KICK-SECRET: $KICK_SECRET" https://$SERVICE_URL/run
```

## Quick sanity (Cloud Run)

```bash
SERVICE_URL="$(gcloud run services describe kb-extractor-service --region us-central1 --format='value(status.url)')"

# Health check (no auth needed)
curl -i "$SERVICE_URL/healthz/"

# Trigger job (requires secret)
curl -X POST -H "X-AIDMIND-KICK-SECRET: $KICK_SECRET" "$SERVICE_URL/run"

# Debug endpoints (require secret in production)
curl -H "X-AIDMIND-KICK-SECRET: $KICK_SECRET" "$SERVICE_URL/status"
curl -H "X-AIDMIND-KICK-SECRET: $KICK_SECRET" "$SERVICE_URL/_routes"
```

Expected:
- `/healthz/` returns HTTP 200 + JSON `{"ok": true}`
- `/run` returns HTTP 202 + JSON with `execution` name
- `/status` and `/_routes` return 401 without secret, 200 with secret
