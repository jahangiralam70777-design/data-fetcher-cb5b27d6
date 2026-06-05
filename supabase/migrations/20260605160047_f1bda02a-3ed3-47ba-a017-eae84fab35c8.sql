
-- 1. Profiles: restrict SELECT to authenticated users (close anonymous enumeration).
DROP POLICY IF EXISTS profiles_select_all ON public.profiles;
CREATE POLICY profiles_select_authenticated
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (true);

-- 2. user_roles: add explicit admin-only write policies so future
--    permissive policies cannot accidentally let users grant themselves admin.
DROP POLICY IF EXISTS user_roles_insert_admin ON public.user_roles;
CREATE POLICY user_roles_insert_admin
  ON public.user_roles
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS user_roles_update_admin ON public.user_roles;
CREATE POLICY user_roles_update_admin
  ON public.user_roles
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS user_roles_delete_admin ON public.user_roles;
CREATE POLICY user_roles_delete_admin
  ON public.user_roles
  FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- 3. Notifications: replace the broad public SELECT with two policies that
--    don't leak audience_user_ids targeting metadata to non-admins.
DROP POLICY IF EXISTS notifications_select_sent ON public.notifications;
CREATE POLICY notifications_select_admin
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY notifications_select_audience
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (
    status = 'sent'
    AND (
      audience = 'all'
      OR (audience = 'users' AND auth.uid() = ANY(audience_user_ids))
      OR (
        audience = 'level'
        AND audience_level IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = auth.uid() AND p.level = audience_level
        )
      )
    )
  );

-- 4. Revoke EXECUTE on admin-only SECURITY DEFINER helpers from anon.
--    Each function still checks has_role() internally, but defence-in-depth.
REVOKE EXECUTE ON FUNCTION public.admin_get_db_size() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_get_table_sizes() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_hard_delete_user(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_restore_user(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_soft_delete_user(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_user_analytics() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_activity_overview(integer) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_top_buttons(integer, integer) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_user_activity(uuid, integer) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_top_users(text, integer) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_top_pages(integer, integer) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_top_modules(integer, integer) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_activity_timeseries(integer, integer) FROM anon, public;
