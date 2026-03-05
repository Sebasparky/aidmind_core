
-- Add guidance scope fields to sessions table
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS guidance_scope text,
  ADD COLUMN IF NOT EXISTS guidance_scope_other text,
  ADD COLUMN IF NOT EXISTS guidance_scope_set_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS guidance_scope_set_by uuid;

-- Validation trigger: enforce scope constraints
CREATE OR REPLACE FUNCTION public.validate_guidance_scope()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public'
AS $$
DECLARE
  allowed_scopes text[] := ARRAY[
    'social_welfare', 'substance_use', 'housing_homelessness',
    'domestic_violence', 'child_welfare', 'mental_health',
    'immigration_refugee', 'employment_income', 'disability_services',
    'elder_services', 'reentry_justice', 'other'
  ];
BEGIN
  -- If guidance_scope is set, validate it
  IF NEW.guidance_scope IS NOT NULL THEN
    IF NOT (NEW.guidance_scope = ANY(allowed_scopes)) THEN
      RAISE EXCEPTION 'Invalid guidance_scope: %', NEW.guidance_scope;
    END IF;

    -- If scope is 'other', guidance_scope_other must be present and >= 3 chars
    IF NEW.guidance_scope = 'other' THEN
      IF NEW.guidance_scope_other IS NULL OR length(trim(NEW.guidance_scope_other)) < 3 THEN
        RAISE EXCEPTION 'guidance_scope_other is required (min 3 chars) when guidance_scope is other';
      END IF;
    ELSE
      -- If scope is not 'other', clear guidance_scope_other
      NEW.guidance_scope_other := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_guidance_scope ON public.sessions;
CREATE TRIGGER trg_validate_guidance_scope
  BEFORE INSERT OR UPDATE ON public.sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_guidance_scope();

-- Index for scope queries
CREATE INDEX IF NOT EXISTS idx_sessions_guidance_scope ON public.sessions (guidance_scope);
