# Legacy: not the canonical backend

`backend/the_mind_backend/` is an older copy of AidMind's Supabase backend and Presidio service, imported from a collaborator's repository. It has **diverged** from the live code: several edge functions and shared helpers differ, and it contains a migration that is not in the canonical set. It lacks the later authorization hardening. Nothing in the app, the demo stack or the verification scripts uses it.

It is kept only for history. Do not deploy it, and do not use it as a reference for current behaviour.

Canonical implementation:

- Database migrations and RLS policies: [`../supabase/migrations/`](../supabase/migrations/)
- Edge functions and shared helpers: [`../supabase/functions/`](../supabase/functions/)
- Supabase configuration: [`../supabase/config.toml`](../supabase/config.toml)
- PII redaction service (standalone, not wired in): [`../presidio-service/`](../presidio-service/)
