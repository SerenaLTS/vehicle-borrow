-- Fine notices and admin-confirmed historical driving periods (including drivers without accounts).
begin;

create table if not exists public.vehicle_driver_history (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  driver_name text not null check (length(trim(driver_name)) between 1 and 200),
  driver_email text not null check (length(driver_email) between 3 and 254),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists vehicle_driver_history_vehicle_time on public.vehicle_driver_history(vehicle_id, starts_at, ends_at);

create table if not exists public.vehicle_fine_notices (
  id uuid primary key,
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  notice_number text not null check (length(trim(notice_number)) between 1 and 100),
  occurred_at timestamptz not null,
  location text not null check (length(trim(location)) between 1 and 500),
  reason text not null check (length(trim(reason)) between 1 and 2000),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 999999999),
  rego text not null,
  driver_name text not null check (length(trim(driver_name)) between 1 and 200),
  driver_email text not null check (length(driver_email) between 3 and 254),
  requires_licence boolean not null,
  loan_id uuid references public.vehicle_loans(id) on delete set null,
  driver_record_id uuid references public.vehicle_driver_history(id) on delete restrict,
  attachment_path text,
  attachment_name text,
  email_subject text not null,
  email_body text not null,
  status text not null default 'draft' check (status in ('draft','sending','sent','failed','delivery_unknown')),
  send_started_at timestamptz,
  sent_at timestamptz,
  sent_by uuid references auth.users(id) on delete set null,
  message_id text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((attachment_path is null) = (attachment_name is null))
);
create unique index if not exists vehicle_fine_notice_number on public.vehicle_fine_notices(vehicle_id, lower(trim(notice_number)));
create index if not exists vehicle_fine_notices_vehicle_time on public.vehicle_fine_notices(vehicle_id, occurred_at desc);

alter table public.vehicle_driver_history enable row level security;
alter table public.vehicle_fine_notices enable row level security;
revoke all on public.vehicle_driver_history, public.vehicle_fine_notices from anon, authenticated;
grant select on public.vehicle_driver_history, public.vehicle_fine_notices to authenticated;
grant all on public.vehicle_driver_history, public.vehicle_fine_notices to service_role;
drop policy if exists "Admins read driving history" on public.vehicle_driver_history;
create policy "Admins read driving history" on public.vehicle_driver_history for select to authenticated using (public.is_admin());
drop policy if exists "Admins read fine notices" on public.vehicle_fine_notices;
create policy "Admins read fine notices" on public.vehicle_fine_notices for select to authenticated using (public.is_admin());

create or replace function public.admin_create_fine_notice(p_data jsonb)
returns uuid
language plpgsql security definer set search_path = public
set lock_timeout = '8s'
set statement_timeout = '15s'
as $$
declare
  v_id uuid := (p_data->>'id')::uuid;
  v_vehicle_id uuid := (p_data->>'vehicle_id')::uuid;
  v_time timestamptz := (p_data->>'occurred_at')::timestamptz;
  v_start timestamptz := (p_data->>'starts_at')::timestamptz;
  v_end timestamptz := (p_data->>'ends_at')::timestamptz;
  v_loan_id uuid := (p_data->>'loan_id')::uuid;
  v_history_id uuid := (p_data->>'driver_record_id')::uuid;
  v_rego text;
  v_existing public.vehicle_fine_notices;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Admin access required.'; end if;
  select plate_number into v_rego from public.vehicles where id = v_vehicle_id for update;
  if not found then raise exception 'Vehicle not found.'; end if;
  select * into v_existing from public.vehicle_fine_notices where id = v_id;
  if found then
    if v_existing.vehicle_id <> v_vehicle_id or v_existing.created_by <> auth.uid() then raise exception 'Notice ID already used.'; end if;
    return v_id;
  end if;
  if v_time > now() then raise exception 'The offence time cannot be in the future.'; end if;
  if p_data->>'rego' is distinct from v_rego then raise exception 'Vehicle rego changed. Reload and try again.'; end if;
  if v_loan_id is not null then
    if v_history_id is not null then raise exception 'Choose one driver record.'; end if;
    perform 1 from public.vehicle_loans where id = v_loan_id and vehicle_id = v_vehicle_id
      and borrowed_at <= v_time and (returned_at is null or returned_at > v_time) for share;
    if not found then raise exception 'The driver record no longer covers the offence time.'; end if;
  elsif v_history_id is not null then
    perform 1 from public.vehicle_driver_history where id = v_history_id and vehicle_id = v_vehicle_id
      and starts_at <= v_time and ends_at > v_time for share;
    if not found then raise exception 'The driver record no longer covers the offence time.'; end if;
  else
    if v_start is null or v_end is null or v_start > v_time or v_end <= v_time or v_end > now() then
      raise exception 'Enter a completed driving period that includes the offence time.';
    end if;
    if exists (select 1 from public.vehicle_loans where vehicle_id = v_vehicle_id
      and borrowed_at < v_end and (returned_at is null or returned_at > v_start))
      or exists (select 1 from public.vehicle_driver_history where vehicle_id = v_vehicle_id and starts_at < v_end and ends_at > v_start) then
      raise exception 'The driving period overlaps an existing driver record. Review the vehicle calendar.';
    end if;
    insert into public.vehicle_driver_history(vehicle_id, driver_name, driver_email, starts_at, ends_at, created_by)
      values (v_vehicle_id, p_data->>'driver_name', p_data->>'driver_email', v_start, v_end, auth.uid()) returning id into v_history_id;
  end if;
  insert into public.vehicle_fine_notices(id, vehicle_id, notice_number, occurred_at, location, reason, amount_cents, rego,
    driver_name, driver_email, requires_licence, loan_id, driver_record_id, attachment_path, attachment_name, email_subject, email_body, created_by)
  values (v_id, v_vehicle_id, p_data->>'notice_number', v_time, p_data->>'location', p_data->>'reason', (p_data->>'amount_cents')::bigint, v_rego,
    p_data->>'driver_name', p_data->>'driver_email', (p_data->>'requires_licence')::boolean, v_loan_id, v_history_id,
    p_data->>'attachment_path', p_data->>'attachment_name', p_data->>'email_subject', p_data->>'email_body', auth.uid());
  return v_id;
end;
$$;
revoke all on function public.admin_create_fine_notice(jsonb) from public, anon;
grant execute on function public.admin_create_fine_notice(jsonb) to authenticated;

-- No client storage policies: PDFs are uploaded/downloaded by authenticated admin server routes only.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('fine-notices', 'fine-notices', false, 3145728, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 3145728, allowed_mime_types = array['application/pdf'];
commit;
