create table if not exists public.allowed_user_emails (
  email text primary key check (email = lower(trim(email)) and email like '%@%'),
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  created_by_user_id uuid references auth.users (id)
);

insert into public.allowed_user_emails (email, notes)
select lower(trim(email)), 'Existing user imported during allowlist setup.'
from public.user_roles
where nullif(trim(email), '') is not null
on conflict (email) do nothing;

alter table public.allowed_user_emails enable row level security;

drop policy if exists "Admins can read allowed emails" on public.allowed_user_emails;
create policy "Admins can read allowed emails"
on public.allowed_user_emails for select to authenticated
using (public.is_admin());

drop policy if exists "Admins can insert allowed emails" on public.allowed_user_emails;
create policy "Admins can insert allowed emails"
on public.allowed_user_emails for insert to authenticated
with check (public.is_admin() and created_by_user_id = auth.uid());

drop policy if exists "Admins can delete allowed emails" on public.allowed_user_emails;
create policy "Admins can delete allowed emails"
on public.allowed_user_emails for delete to authenticated
using (public.is_admin());

create or replace function public.is_signup_email_allowed(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.allowed_user_emails
    where email = lower(trim(p_email))
  );
$$;

revoke all on function public.is_signup_email_allowed(text) from public;
grant execute on function public.is_signup_email_allowed(text) to anon, authenticated;

create or replace function public.hook_require_allowed_user_email(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  signup_email text := lower(trim(event->'user'->>'email'));
begin
  if signup_email is not null and exists (
    select 1 from public.allowed_user_emails where email = signup_email
  ) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'This email is not approved for this internal application.'
    )
  );
end;
$$;

grant execute on function public.hook_require_allowed_user_email(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_require_allowed_user_email(jsonb) from authenticated, anon, public;

select pg_notify('pgrst', 'reload schema');
