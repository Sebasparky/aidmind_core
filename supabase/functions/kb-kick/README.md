# kb-kick

Kicks the Cloud Run `kb-extractor-service` to start processing queued KB ingestion jobs.

## Architecture

```
Client upload → kb_ingestion_jobs row → kickExtractor() → kb-kick edge fn → POST /run → Cloud Run Job
```

## Secrets (set in Supabase Dashboard → Edge Functions → Secrets)

| Secret Name                | Description                                  |
| -------------------------- | -------------------------------------------- |
| `KB_EXTRACTOR_SERVICE_URL` | Base URL of the Cloud Run service            |
| `KB_EXTRACTOR_KICK_SECRET` | Shared secret for `X-AIDMIND-KICK-SECRET`    |

## Response format

**Success:**
```json
{ "ok": true, "status": "kick_sent", "cloudRunStatus": 202, "body": { ... } }
```

**Failure:**
```json
{ "ok": false, "status": "kick_failed", "error": "..." }
```

## Invoke locally

```bash
supabase functions invoke kb-kick --method POST
```

## Invoke from client

```typescript
await supabase.functions.invoke("kb-kick", { method: "POST" });
```
