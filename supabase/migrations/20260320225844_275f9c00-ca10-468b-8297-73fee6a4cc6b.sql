
-- 1. Add user_id column to ephemeral_artifacts for ownership scoping
ALTER TABLE public.ephemeral_artifacts ADD COLUMN IF NOT EXISTS user_id uuid;

-- 2. Drop the overly permissive RLS policy
DROP POLICY IF EXISTS "Allow all operations on ephemeral_artifacts" ON public.ephemeral_artifacts;

-- 3. Create scoped RLS policies

-- Users can only read their own sealed artifacts
CREATE POLICY "Users can read own ephemeral_artifacts"
ON public.ephemeral_artifacts
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Users can insert artifacts they own
CREATE POLICY "Users can insert own ephemeral_artifacts"
ON public.ephemeral_artifacts
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Users can delete their own artifacts
CREATE POLICY "Users can delete own ephemeral_artifacts"
ON public.ephemeral_artifacts
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

-- Service role retains full access (for TTL cleanup etc.)
CREATE POLICY "Service role manages ephemeral_artifacts"
ON public.ephemeral_artifacts
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
