grant select, insert, delete on table public.allowed_user_emails to authenticated;
revoke all on table public.allowed_user_emails from anon;

grant execute on function public.is_signup_email_allowed(text) to anon, authenticated;
grant execute on function public.hook_require_allowed_user_email(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_require_allowed_user_email(jsonb) from authenticated, anon, public;

select pg_notify('pgrst', 'reload schema');
