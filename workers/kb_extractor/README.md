# KB Extractor Worker

Processes queued `kb_ingestion_jobs` rows: downloads PDFs from Supabase Storage,
extracts native text via PyMuPDF, updates `kb_documents.content` and
`metadata.ingestion`, and marks jobs succeeded/failed.

## Continuation Mode

For documents exceeding `MAX_PAGES` (default 1000), the worker automatically:

1. Extracts the first `MAX_PAGES` pages, writes to `kb_documents.content`.
2. Enqueues a continuation job for the next page range via `enqueue_kb_continuation_job` RPC.
3. Repeats until all pages are processed or a limit is hit.

Each job operates on a page range `[start_page, end_page)`. The first chunk (start_page=0) **overwrites** content; subsequent chunks **append** server-side via `append_kb_document_content` RPC to avoid downloading large content into the worker.

### Idempotency

- Each continuation job has a unique `dedupe_key` (`{doc_id}:{start_page}:{end_page}`).
- The worker tracks `completed_ranges` in `metadata.ingestion`. If a range is already complete, the job is skipped.
- DB unique constraint on `dedupe_key` prevents duplicate enqueue.

### Safety Limits

| Limit | Default | Description |
|---|---|---|
| `MAX_PAGES` | 1000 | Pages per chunk/job |
| `MAX_PDF_BYTES` | 150 MB | Max file size |
| `MAX_SECONDS_PER_DOC` | 600s | Timeout per chunk |
| `MAX_TOTAL_CHUNKS_PER_DOC` | 20 | Max continuation chunks (prevents infinite spam) |

If `MAX_TOTAL_CHUNKS_PER_DOC` is exceeded, the document is marked `needs_review`.

### Metadata Contract

After processing, `kb_documents.metadata.ingestion` contains:

```json
{
  "status": "extracting|ready|needs_review|failed",
  "original_page_count": 2500,
  "processed_pages_total": 2000,
  "next_start_page": 2000,
  "hit_max_pages": true,
  "chunks_completed": 2,
  "completed_ranges": ["0-1000", "1000-2000"],
  "last_chunk": {
    "start_page": 1000,
    "end_page": 2000,
    "pages_extracted": 1000,
    "char_count": 123456,
    "job_id": 42,
    "finished_at": "..."
  },
  "page_count": 1000,
  "char_count": 123456,
  "non_empty_pages": 990,
  "text_quality_score": 0.99,
  "native_pages": 1000,
  "ocr_pages": 0,
  "hit_timeout": false,
  "error": null,
  "file_path": "tenants/.../file.pdf"
}
```

`status` becomes `ready` only when `processed_pages_total == original_page_count`.

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
  --set-secrets "SUPABASE_URL=SUPABASE_URL:latest,SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest,KB_INGEST_SECRET=KB_INGEST_SECRET:latest"
```

### 6. Run the job (drain backlog)

```bash
gcloud run jobs execute kb-extractor --region us-central1
```

For large-document continuation processing, set `MAX_JOBS_PER_RUN` higher (e.g. 30) so continuation chunks are processed in the same run.

### 7. View logs

```bash
gcloud run jobs executions logs kb-extractor --region us-central1
```

Or in the Cloud Console: **Cloud Run → Jobs → kb-extractor → Executions**.

## Backfill Truncated Documents

For documents that were previously truncated (before continuation support), run this SQL to enqueue continuation jobs:

```sql
SELECT public.enqueue_kb_continuation_job(
  kd.id,
  kd.tenant_id,
  (kd.metadata->'ingestion'->>'processed_pages_total')::int,
  LEAST(
    (kd.metadata->'ingestion'->>'processed_pages_total')::int + 1000,
    (kd.metadata->'ingestion'->>'original_page_count')::int
  ),
  50
)
FROM public.kb_documents kd
WHERE kd.metadata->'ingestion'->>'hit_max_pages' = 'true'
  AND (kd.metadata->'ingestion'->>'processed_pages_total')::int
      < (kd.metadata->'ingestion'->>'original_page_count')::int
  AND kd.metadata->'ingestion'->>'status' != 'failed';
```

Then run the worker to process them.

## Tuning

- **Large documents**: Increase `MAX_JOBS_PER_RUN` so continuation chunks process in one invocation.
- **Memory**: Use 4Gi for most PDFs; increase to 8Gi for very large ones.
- **Parallelism**: Run multiple Cloud Run Job instances — `FOR UPDATE SKIP LOCKED` prevents double-processing.

## Cost Safety

- No minimum instances — job only runs when invoked.
- Exits when no queued jobs remain (no idle polling).
- Hard limits: 150MB PDF max, 1000 pages per chunk, 10-min timeout per chunk.
- Max 20 continuation chunks per document.

## Hard Limits

| Limit | Value |
|---|---|
| Max PDF size | 150 MB |
| Max pages per chunk | 1,000 |
| Per-chunk timeout | 600 s |
| Max continuation chunks | 20 |
| Min chars for non-empty page | 30 |
| Text quality threshold | 0.70 |
