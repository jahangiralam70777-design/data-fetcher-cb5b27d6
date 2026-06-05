
-- Profile extensions
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz,
  ADD COLUMN IF NOT EXISTS total_login_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_usage_seconds bigint NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS profiles_last_login_at_idx ON public.profiles(last_login_at DESC);
CREATE INDEX IF NOT EXISTS profiles_deleted_at_idx ON public.profiles(deleted_at);

-- user_login_events
CREATE TABLE IF NOT EXISTS public.user_login_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  login_at timestamptz NOT NULL DEFAULT now(),
  logout_at timestamptz,
  duration_seconds integer,
  user_agent text,
  device text,
  browser text,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_login_events_user_id_idx ON public.user_login_events(user_id);
CREATE INDEX IF NOT EXISTS user_login_events_login_at_idx ON public.user_login_events(login_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.user_login_events TO authenticated;
GRANT ALL ON public.user_login_events TO service_role;

ALTER TABLE public.user_login_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_login_events_own_insert"
  ON public.user_login_events FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_login_events_own_update"
  ON public.user_login_events FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_login_events_select"
  ON public.user_login_events FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

-- Analytics RPC: aggregate stats
CREATE OR REPLACE FUNCTION public.admin_user_analytics()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  SELECT jsonb_build_object(
    'total_users', (SELECT count(*) FROM public.profiles WHERE deleted_at IS NULL),
    'deleted_users', (SELECT count(*) FROM public.profiles WHERE deleted_at IS NOT NULL),
    'active_24h', (SELECT count(DISTINCT user_id) FROM public.user_login_events WHERE login_at >= now() - interval '24 hours'),
    'active_7d', (SELECT count(DISTINCT user_id) FROM public.user_login_events WHERE login_at >= now() - interval '7 days'),
    'active_30d', (SELECT count(DISTINCT user_id) FROM public.user_login_events WHERE login_at >= now() - interval '30 days'),
    'lifetime_active', (SELECT count(DISTINCT user_id) FROM public.user_login_events),
    'total_logins', (SELECT count(*) FROM public.user_login_events),
    'avg_session_seconds', COALESCE((SELECT avg(duration_seconds)::bigint FROM public.user_login_events WHERE duration_seconds IS NOT NULL AND duration_seconds > 0), 0),
    'usage_24h', COALESCE((SELECT sum(duration_seconds)::bigint FROM public.user_login_events WHERE login_at >= now() - interval '24 hours'), 0),
    'usage_7d', COALESCE((SELECT sum(duration_seconds)::bigint FROM public.user_login_events WHERE login_at >= now() - interval '7 days'), 0),
    'usage_30d', COALESCE((SELECT sum(duration_seconds)::bigint FROM public.user_login_events WHERE login_at >= now() - interval '30 days'), 0)
  ) INTO result;

  RETURN result;
END $$;

-- Top users
CREATE OR REPLACE FUNCTION public.admin_top_users(_order text DEFAULT 'most', _limit integer DEFAULT 10)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  total_login_count integer,
  total_usage_seconds bigint,
  last_login_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  IF _order = 'least' THEN
    RETURN QUERY
      SELECT p.id, p.display_name, p.total_login_count, p.total_usage_seconds, p.last_login_at
      FROM public.profiles p
      WHERE p.deleted_at IS NULL
      ORDER BY p.total_usage_seconds ASC, p.total_login_count ASC
      LIMIT _limit;
  ELSE
    RETURN QUERY
      SELECT p.id, p.display_name, p.total_login_count, p.total_usage_seconds, p.last_login_at
      FROM public.profiles p
      WHERE p.deleted_at IS NULL AND p.total_login_count > 0
      ORDER BY p.total_usage_seconds DESC, p.total_login_count DESC
      LIMIT _limit;
  END IF;
END $$;

-- Soft delete
CREATE OR REPLACE FUNCTION public.admin_soft_delete_user(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  IF public.has_role(_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Cannot remove an admin. Demote first.';
  END IF;
  UPDATE public.profiles SET deleted_at = now(), status = 'suspended' WHERE id = _id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_restore_user(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  UPDATE public.profiles SET deleted_at = NULL, status = 'active' WHERE id = _id;
END $$;

-- Hard delete (cascades via auth.users)
CREATE OR REPLACE FUNCTION public.admin_hard_delete_user(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  IF public.has_role(_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Cannot permanently delete an admin. Demote first.';
  END IF;
  DELETE FROM public.user_login_events WHERE user_id = _id;
  DELETE FROM public.user_roles WHERE user_id = _id;
  DELETE FROM public.profiles WHERE id = _id;
  DELETE FROM auth.users WHERE id = _id;
END $$;
