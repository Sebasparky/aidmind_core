-- ============================================================
-- Eye Events: DB-level idempotency + query performance indexes
-- ============================================================

-- 1. Add generated column for request_id extraction from JSONB
ALTER TABLE public.eye_events 
ADD COLUMN IF NOT EXISTS request_id_text TEXT GENERATED ALWAYS AS (event_data->>'request_id') STORED;

-- 2. Add unique index for idempotency (only where request_id is present and non-empty)
-- This prevents duplicate events when an action retries with same request_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_eye_events_idempotency 
ON public.eye_events (session_id, event_type, request_id_text)
WHERE request_id_text IS NOT NULL AND request_id_text <> '';

-- 3. Add performance index on created_at (for time-range queries)
CREATE INDEX IF NOT EXISTS idx_eye_events_created_at 
ON public.eye_events (created_at);

-- 4. Add composite index for session timeline queries
CREATE INDEX IF NOT EXISTS idx_eye_events_session_created_at 
ON public.eye_events (session_id, created_at);

-- 5. Add index on event_type for filtering
CREATE INDEX IF NOT EXISTS idx_eye_events_event_type 
ON public.eye_events (event_type);