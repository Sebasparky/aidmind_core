# KB Extractor Worker

Processes queued `kb_ingestion_jobs` rows: downloads PDFs from Supabase Storage,
extracts native text via PyMuPDF, updates `kb_documents.content` and
`metadata.ingestion`, and marks jobs succeeded/failed.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SUPABASE_URL` | ✅ | — | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | — | Service role key (bypasses RLS) |
| `SUPABASE_STORAGE_BUCKET` | — | `kb-documents` | Storage bucket name |
| `MAX_JOBS_PER_RUN` | — | `10` | Max jobs to process per invocation |
| `SLEEP_NO_JOB_SECONDS` | — | `0` | Seconds to wait when no jobs (0 = exit) |
| `WORKER_ID` | — | hostname | Identifier for locking |
| `DRY_RUN` | — | `false` | If true, skips writing content |

## Local Run

```bash
cd workers/kb_extractor
pip install -r requirements.txt

export SUPABASE_URL="https://qdbfjxmxnxtubltahuqe.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<your-service-role-key>"
python main.py
```

## Deploy to Google Cloud Run Jobs

### Prerequisites

- Google Cloud project with billing enabled
- `gcloud` CLI installed and authenticated

### 1. Enable APIs

```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com
```

### 2. Create Artifact Registry repo (once)

```bash
gcloud artifacts repositories create aidmind-workers \
  --repository-format=docker \
  --location=us-central1
```

### 3. Create secrets in Secret Manager

```bash
echo -n "https://qdbfjxmxnxtubltahuqe.supabase.co" | \
  gcloud secrets create SUPABASE_URL --data-file=-

echo -n "<your-service-role-key>" | \
  gcloud secrets create SUPABASE_SERVICE_ROLE_KEY --data-file=-
```

### 4. Build & push container

```bash
cd workers/kb_extractor

IMAGE=us-central1-docker.pkg.dev/YOUR_PROJECT/aidmind-workers/kb-extractor:latest

gcloud builds submit --tag "$IMAGE" .
```

### 5. Deploy Cloud Run Job

```bash
gcloud run jobs create kb-extractor \
  --image "$IMAGE" \
  --region us-central1 \
  --cpu 2 \
  --memory 4Gi \
  --task-timeout 15m \
  --max-retries 0 \
  --set-env-vars "MAX_JOBS_PER_RUN=10,SUPABASE_STORAGE_BUCKET=kb-documents" \
  --set-secrets "SUPABASE_URL=SUPABASE_URL:latest,SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest"
```

### 6. Run the job (drain backlog)

```bash
gcloud run jobs execute kb-extractor --region us-central1
```

Run multiple times or increase `MAX_JOBS_PER_RUN` to drain large backlogs.

### 7. View logs

```bash
gcloud run jobs executions logs kb-extractor --region us-central1
```

Or in the Cloud Console: **Cloud Run → Jobs → kb-extractor → Executions**.

## Cost Safety

- No minimum instances — job only runs when invoked.
- Exits when no queued jobs remain (no idle polling).
- Hard limits: 150MB PDF max, 1000 pages max, 10-min timeout per doc.
- Increase memory to 8Gi for very large PDFs if needed.

## Hard Limits

| Limit | Value |
|---|---|
| Max PDF size | 150 MB |
| Max pages | 1,000 |
| Per-doc timeout | 600 s |
| Min chars for non-empty page | 30 |
| Text quality threshold | 0.70 |
