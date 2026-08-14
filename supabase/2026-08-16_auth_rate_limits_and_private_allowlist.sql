revoke all on function public.is_signup_email_allowed(text) from anon, authenticated, public;

create table if not exists public.auth_rate_limits (
  rate_key text not null,
  action text not null check (action in ('sign_in', 'sign_up')),
  window_started_at timestamptz not null,
  attempt_count integer not null default 1 check (attempt_count > 0),
  primary key (rate_key, action, window_started_at)
);
create index if not exists idx_auth_rate_limits_window_started_at on public.auth_rate_limits (window_started_at);

alter table public.auth_rate_limits enable row level security;
revoke all on table public.auth_rate_limits from anon, authenticated, public;

create or replace function public.consume_auth_rate_limit(
  p_key text,
  p_action text,
  p_max_attempts integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_window timestamptz;
  current_attempts integer;
begin
  if p_action not in ('sign_in', 'sign_up') or p_max_attempts < 1 or p_window_seconds < 60 then
    return false;
  end if;

  current_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.auth_rate_limits (rate_key, action, window_started_at, attempt_count)
  values (p_key, p_action, current_window, 1)
  on conflict (rate_key, action, window_started_at)
  do update set attempt_count = public.auth_rate_limits.attempt_count + 1
  returning attempt_count into current_attempts;

  delete from public.auth_rate_limits where window_started_at < now() - interval '2 days';
  return current_attempts <= p_max_attempts;
end;
$$;

revoke all on function public.consume_auth_rate_limit(text, text, integer, integer) from anon, authenticated, public;
grant execute on function public.consume_auth_rate_limit(text, text, integer, integer) to service_role;

create or replace function public.hook_require_allowed_user_email(event jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare signup_email text := lower(trim(event->'user'->>'email'));
begin
  if signup_email is not null and exists (select 1 from public.allowed_user_emails where email = signup_email) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'Unable to process this account request.'));
end;
$$;

grant execute on function public.hook_require_allowed_user_email(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_require_allowed_user_email(jsonb) from authenticated, anon, public;

select pg_notify('pgrst', 'reload schema');
