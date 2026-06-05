
REVOKE EXECUTE ON FUNCTION public.admin_user_analytics() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_top_users(text, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_soft_delete_user(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_restore_user(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_hard_delete_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_user_analytics() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_top_users(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_soft_delete_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_restore_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_hard_delete_user(uuid) TO authenticated;
