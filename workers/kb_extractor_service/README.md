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
fetches a metadata identity token, calls the Jobs API, and returns immediately.

## Health check

> **Canonical endpoint: `GET /healthz/`** (trailing slash).
>
> Some Cloud Run / proxy configurations return a Google 404 for `/healthz`
> without forwarding to the container. `/healthz/` reliably reaches Flask.
> The Flask app still registers both `/healthz` and `/healthz/` for
> backward compatibility, but always use the trailing-slash form in docs,
> monitoring, and CI.

## Endpoints

| Method | Path        | Description                                |
| ------ | ----------- | ------------------------------------------ |
| POST   | `/run`      | Trigger Cloud Run Job (returns 202)        |
| GET    | `/status`   | Last trigger attempt info                  |
| GET    | `/healthz/` | Health check (canonical)                   |
| GET    | `/`         | Service info + registered endpoints        |
| GET    | `/_routes`  | Debug: full Flask route map                |

## Auth

`POST /run` requires header `X-AIDMIND-KICK-SECRET` matching the `KICK_SECRET`
env var. The service itself can be publicly invocable (no IAM auth needed) since
the kick secret protects the endpoint.

## Environment Variables

| Name                       | Default                          | Description                            |
| -------------------------- | -------------------------------- | -------------------------------------- |
| `KICK_SECRET`              | —                                | Shared secret for `/run` auth          |
| `KICK_HEADER_NAME`         | `X-AIDMIND-KICK-SECRET`         | Header name for kick secret            |
| `GCP_PROJECT`              | —                                | Google Cloud project ID (**required**) |
| `RUN_REGION`               | `us-central1`                    | Cloud Run region                       |
| `RUN_JOB_NAME`             | `kb-extractor-job`               | Cloud Run Job name                     |
| `RUN_API_BASE`             | `https://run.googleapis.com`     | Run API base URL                       |
| `RUN_API_AUDIENCE`         | `https://run.googleapis.com/`    | Audience for metadata identity token   |
| `RUN_REQUEST_TIMEOUT_SECS` | `10`                             | Timeout for Jobs API call (seconds)    |

## IAM Permissions

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

curl -i "$SERVICE_URL/healthz/"
curl -sS "$SERVICE_URL/_routes"
curl -X POST -H "X-AIDMIND-KICK-SECRET: $KICK_SECRET" "$SERVICE_URL/run"
curl -sS "$SERVICE_URL/status"
```

Expected:
- `/healthz/` returns HTTP 200 + JSON `{"ok": true}`
- `/run` returns HTTP 202 + JSON with `execution` name
- `/status` shows last trigger info
- `/_routes` lists all registered routes
