# kb-extractor-service

Flask supervisor that wraps the KB extractor worker. On a single `POST /run`,
it drains the `kb_ingestion_jobs` queue by repeatedly invoking the worker
until the queue is empty or safety limits are hit.

## Endpoints

| Method | Path       | Description                          |
| ------ | ---------- | ------------------------------------ |
| POST   | `/run`     | Start drain loop (returns 202)       |
| GET    | `/status`  | Current drain state + last run info  |
| GET    | `/healthz` | Health check                         |

## Auth

`POST /run` requires header `X-AIDMIND-KICK-SECRET` matching the `KICK_SECRET` env var.

## Environment Variables

| Name                 | Default | Description                                   |
| -------------------- | ------- | --------------------------------------------- |
| `KICK_SECRET`        | —       | Shared secret for `/run` auth                 |
| `DRAIN_MAX_LOOPS`    | 20      | Max worker invocations per drain              |
| `DRAIN_MAX_SECONDS`  | 840     | Wall-clock cap (14 min, under 15m CR timeout) |
| `DRAIN_SLEEP_MS`     | 250     | Pause between iterations (ms)                 |
| `DRAIN_EMPTY_STREAK` | 2       | Stop after N consecutive "no jobs" runs       |
| `WORKER_SCRIPT`      | `/app/workers/kb_extractor/main.py` | Path to worker script |

Plus all worker env vars (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, etc.).

## Build & Deploy

```bash
# Build
docker build -t kb-extractor-service .

# Run locally
docker run -p 8080:8080 \
  -e KICK_SECRET=test \
  -e SUPABASE_URL=... \
  -e SUPABASE_SERVICE_ROLE_KEY=... \
  kb-extractor-service

# Test
curl http://localhost:8080/healthz
curl -X POST http://localhost:8080/run -H "X-AIDMIND-KICK-SECRET: test"
curl http://localhost:8080/status
```
