
-- ============================================================
-- AidMind: Combined base auth schema + hardening (polished)
-- ============================================================

-- 1. Role enum
CREATE TYPE public.app_role AS ENUM ('caseworker', 'supervisor', 'auditor');

-- 2. Profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 3. User roles table (single role per user)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE (user_id)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 4. update_updated_at_column helper
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 5. Profiles updated_at trigger
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 6. has_role security definer
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

REVOKE ALL ON FUNCTION public.has_role(UUID, app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, app_role) TO authenticated;

-- 7. get_my_role RPC
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles
  WHERE user_id = auth.uid()
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.get_my_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated;

-- 8. get_my_profile RPC
CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS JSON
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'user_id', p.user_id,
    'display_name', p.display_name,
    'status', p.status,
    'role', COALESCE(r.role::text, null)
  )
  FROM public.profiles p
  LEFT JOIN public.user_roles r ON r.user_id = p.user_id
  WHERE p.user_id = auth.uid()
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.get_my_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_profile() TO authenticated;

-- 9. handle_new_user trigger function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name, status)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email, ''), 'pending');

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'caseworker');

  RETURN NEW;
END;
$$;

-- 10. Idempotent trigger creation
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- Profiles: users read own, no self-update (admin via service_role)
CREATE POLICY "Users can read own profile"
  ON public.profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Service role manages profiles"
  ON public.profiles FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- User roles: users read own
CREATE POLICY "Users can read own role"
  ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Service role manages user_roles"
  ON public.user_roles FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- eye_events: harden – drop any legacy authenticated write policies
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'eye_events'
      AND roles::text[] @> ARRAY['authenticated']
      AND cmd IN ('INSERT','UPDATE','DELETE')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.eye_events', pol.policyname);
  END LOOP;
END;
$$;

-- eye_events: active supervisor/auditor SELECT only
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'eye_events'
      AND policyname = 'Active supervisors and auditors can read eye_events'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "Active supervisors and auditors can read eye_events"
        ON public.eye_events FOR SELECT TO authenticated
        USING (
          EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND status = 'active')
          AND (
            public.has_role(auth.uid(), 'supervisor')
            OR public.has_role(auth.uid(), 'auditor')
          )
        )
    $pol$;
  END IF;
END;
$$;

-- eye_events: service_role full access
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'eye_events'
      AND policyname = 'Service role manages eye_events'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "Service role manages eye_events"
        ON public.eye_events FOR ALL TO service_role
        USING (true) WITH CHECK (true)
    $pol$;
  END IF;
END;
$$;
