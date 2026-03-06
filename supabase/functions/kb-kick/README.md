# kb-kick

Kicks the Cloud Run `kb-extractor-service` to start processing queued KB ingestion jobs.

## Secrets (set in Supabase Dashboard → Edge Functions → Secrets)

| Secret Name                | Description                                  |
| -------------------------- | -------------------------------------------- |
| `KB_EXTRACTOR_SERVICE_URL` | Base URL of the Cloud Run service            |
| `KB_EXTRACTOR_KICK_SECRET` | Shared secret for `X-AIDMIND-KICK-SECRET`    |

## Invoke locally

```bash
supabase functions invoke kb-kick --method POST
```

## Invoke from client

```typescript
await supabase.functions.invoke("kb-kick", { method: "POST" });
```
