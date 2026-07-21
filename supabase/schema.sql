create extension if not exists "pgcrypto";

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  plate_number text not null unique,
  model text not null,
  vin text,
  color text,
  location text,
  status text not null default 'available' check (status in ('available', 'booked', 'borrowed', 'maintenance', 'retired')),
  comments text,
  current_holder_user_id uuid references auth.users (id),
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.vehicles add column if not exists comments text;
alter table public.vehicles add column if not exists vin text;
alter table public.vehicles add column if not exists color text;
alter table public.vehicles add column if not exists location text;
alter table public.vehicles drop constraint if exists vehicles_status_check;
alter table public.vehicles
add constraint vehicles_status_check
check (status in ('available', 'booked', 'borrowed', 'maintenance', 'retired'));

create unique index if not exists idx_vehicles_vin_unique
on public.vehicles (vin)
where vin is not null;

create table if not exists public.vehicle_loans (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles (id),
  borrowed_by_user_id uuid not null references auth.users (id),
  borrower_email text not null,
  driver_name text not null,
  purpose text not null,
  start_odometer integer check (start_odometer is null or start_odometer >= 0),
  end_odometer integer check (end_odometer is null or start_odometer is null or end_odometer >= start_odometer),
  borrow_notes text,
  return_notes text,
  borrowed_at timestamptz not null default timezone('utc', now()),
  expected_return_at timestamptz,
  borrow_overdue_reminded_at timestamptz,
  is_long_term boolean not null default false,
  returned_at timestamptz
);

alter table public.vehicle_loans add column if not exists expected_return_at timestamptz;
alter table public.vehicle_loans add column if not exists borrow_overdue_reminded_at timestamptz;
alter table public.vehicle_loans add column if not exists is_long_term boolean not null default false;

alter table public.vehicle_loans
drop constraint if exists vehicle_loans_start_odometer_check;

alter table public.vehicle_loans
add constraint vehicle_loans_start_odometer_check
check (start_odometer is null or start_odometer >= 0);

alter table public.vehicle_loans
drop constraint if exists vehicle_loans_end_odometer_check;

alter table public.vehicle_loans
add constraint vehicle_loans_end_odometer_check
check (end_odometer is null or start_odometer is null or end_odometer >= start_odometer);

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  is_admin boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.vehicle_bookings (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles (id) on delete cascade,
  booked_by_user_id uuid not null references auth.users (id),
  booked_by_email text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  is_long_term boolean not null default false,
  comments text,
  key_collection_reminded_at timestamptz,
  borrow_click_reminded_on date,
  created_at timestamptz not null default timezone('utc', now()),
  constraint vehicle_bookings_time_check check (
    (is_long_term = true and ends_at is null)
    or
    (is_long_term = false and ends_at is not null and ends_at > starts_at)
  )
);

alter table public.vehicle_bookings add column if not exists key_collection_reminded_at timestamptz;
alter table public.vehicle_bookings add column if not exists borrow_click_reminded_on date;
alter table public.vehicle_bookings add column if not exists is_long_term boolean not null default false;
alter table public.vehicle_bookings alter column ends_at drop not null;

alter table public.vehicle_bookings drop constraint if exists vehicle_bookings_time_check;
alter table public.vehicle_bookings
add constraint vehicle_bookings_time_check
check (
  (is_long_term = true and ends_at is null)
  or
  (is_long_term = false and ends_at is not null and ends_at > starts_at)
);

alter table public.vehicle_loans drop constraint if exists vehicle_loans_long_term_expected_return_check;
alter table public.vehicle_loans
add constraint vehicle_loans_long_term_expected_return_check
check (
  returned_at is not null
  or is_long_term = true
  or expected_return_at is not null
);

create or replace function public.validate_vehicle_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vehicle public.vehicles;
  v_new_ends_at timestamptz := case when new.is_long_term then 'infinity'::timestamptz else new.ends_at end;
begin
  if new.is_long_term and new.ends_at is not null then
    raise exception 'Long term bookings must not have an end time.';
  end if;

  if (not new.is_long_term) and (new.ends_at is null or new.ends_at <= new.starts_at) then
    raise exception 'Please choose a valid booking time range.';
  end if;

  select *
  into v_vehicle
  from public.vehicles
  where id = new.vehicle_id;

  if not found then
    raise exception 'Vehicle not found.';
  end if;

  if v_vehicle.status in ('retired', 'maintenance') then
    raise exception 'This vehicle cannot be booked in its current status.';
  end if;

  if exists (
    select 1
    from public.vehicle_bookings b
    where b.vehicle_id = new.vehicle_id
      and b.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and tstzrange(b.starts_at, case when b.is_long_term then 'infinity'::timestamptz else b.ends_at end, '[)') && tstzrange(new.starts_at, v_new_ends_at, '[)')
  ) then
    raise exception 'This vehicle is already booked during the selected period.';
  end if;

  return new;
end;
$$;

drop trigger if exists vehicle_booking_validation_trigger on public.vehicle_bookings;
create trigger vehicle_booking_validation_trigger
before insert or update on public.vehicle_bookings
for each row execute procedure public.validate_vehicle_booking();

create index if not exists idx_vehicle_loans_vehicle_id on public.vehicle_loans (vehicle_id);
create index if not exists idx_vehicle_loans_borrowed_by_user_id on public.vehicle_loans (borrowed_by_user_id);
create index if not exists idx_vehicle_loans_active on public.vehicle_loans (vehicle_id, returned_at);
create index if not exists idx_vehicle_loans_overdue_reminders
on public.vehicle_loans (expected_return_at)
where returned_at is null
  and is_long_term = false
  and borrow_overdue_reminded_at is null;
create index if not exists idx_vehicles_status_plate_number on public.vehicles (status, plate_number);
create index if not exists idx_user_roles_email on public.user_roles (email);
create index if not exists idx_vehicle_bookings_vehicle_id on public.vehicle_bookings (vehicle_id);
create index if not exists idx_vehicle_bookings_starts_at on public.vehicle_bookings (starts_at);
create index if not exists idx_vehicle_bookings_vehicle_window on public.vehicle_bookings (vehicle_id, starts_at, ends_at);
create index if not exists idx_vehicle_bookings_borrow_click_reminders
on public.vehicle_bookings (starts_at, ends_at, borrow_click_reminded_on);

alter table public.vehicles enable row level security;
alter table public.vehicle_loans enable row level security;
alter table public.user_roles enable row level security;
alter table public.vehicle_bookings enable row level security;

create or replace function public.handle_user_role_sync()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.user_roles (user_id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (user_id) do update
  set email = excluded.email,
      updated_at = timezone('utc', now());

  return new;
end;
$$;

drop trigger if exists on_auth_user_role_sync on auth.users;
create trigger on_auth_user_role_sync
after insert or update of email on auth.users
for each row execute procedure public.handle_user_role_sync();

insert into public.user_roles (user_id, email)
select id, coalesce(email, '')
from auth.users
on conflict (user_id) do update
set email = excluded.email,
    updated_at = timezone('utc', now());

create or replace function public.is_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = coalesce(p_user_id, auth.uid())
      and is_admin = true
  );
$$;

grant execute on function public.is_admin(uuid) to authenticated;

drop policy if exists "Authenticated users can read vehicles" on public.vehicles;
create policy "Authenticated users can read vehicles"
on public.vehicles
for select
to authenticated
using (true);

drop policy if exists "Admins can insert vehicles" on public.vehicles;
create policy "Admins can insert vehicles"
on public.vehicles
for insert
to authenticated
with check (public.is_admin());

drop policy if exists "Admins can update vehicles" on public.vehicles;
create policy "Admins can update vehicles"
on public.vehicles
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Authenticated users can read loans" on public.vehicle_loans;
create policy "Authenticated users can read loans"
on public.vehicle_loans
for select
to authenticated
using (true);

drop policy if exists "Authenticated users can read bookings" on public.vehicle_bookings;
create policy "Authenticated users can read bookings"
on public.vehicle_bookings
for select
to authenticated
using (true);

drop policy if exists "Users and admins can insert bookings" on public.vehicle_bookings;
create policy "Users and admins can insert bookings"
on public.vehicle_bookings
for insert
to authenticated
with check (booked_by_user_id = auth.uid() or public.is_admin());

drop policy if exists "Users and admins can update bookings" on public.vehicle_bookings;
create policy "Users and admins can update bookings"
on public.vehicle_bookings
for update
to authenticated
using (booked_by_user_id = auth.uid() or public.is_admin())
with check (booked_by_user_id = auth.uid() or public.is_admin());

drop policy if exists "Users and admins can delete bookings" on public.vehicle_bookings;
create policy "Users and admins can delete bookings"
on public.vehicle_bookings
for delete
to authenticated
using (booked_by_user_id = auth.uid() or public.is_admin());

drop policy if exists "Users can read roles" on public.user_roles;
create policy "Users can read roles"
on public.user_roles
for select
to authenticated
using (user_id = auth.uid() or public.is_admin());

drop function if exists public.borrow_vehicle(uuid, text, text, integer, text);
drop function if exists public.borrow_vehicle(uuid, text, text, integer, text, timestamptz);
drop function if exists public.borrow_vehicle(uuid, text, text, integer, text, timestamptz, boolean);

create or replace function public.borrow_vehicle(
  p_vehicle_id uuid,
  p_driver_name text,
  p_purpose text,
  p_start_odometer integer default null,
  p_borrow_notes text default null,
  p_expected_return_at timestamptz default null,
  p_long_term boolean default false
)
returns public.vehicle_loans
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text := auth.jwt() ->> 'email';
  v_vehicle public.vehicles;
  v_loan public.vehicle_loans;
  v_now timestamptz := timezone('utc', now());
begin
  if v_user_id is null then
    raise exception 'You must be logged in to borrow a vehicle.';
  end if;

  if (not p_long_term) and (p_expected_return_at is null or p_expected_return_at <= v_now) then
    raise exception 'Please choose a valid expected return time.';
  end if;

  if p_long_term and p_expected_return_at is not null then
    raise exception 'Long term borrows must not have an expected return time.';
  end if;

  select *
  into v_vehicle
  from public.vehicles
  where id = p_vehicle_id
  for update;

  if not found then
    raise exception 'Vehicle not found.';
  end if;

  if v_vehicle.status in ('retired', 'maintenance') or v_vehicle.current_holder_user_id is not null then
    raise exception 'This vehicle is not currently available.';
  end if;

  if not p_long_term and exists (
    select 1
    from public.vehicle_bookings b
    where b.vehicle_id = p_vehicle_id
      and tstzrange(b.starts_at, case when b.is_long_term then 'infinity'::timestamptz else b.ends_at end, '[)') && tstzrange(v_now, p_expected_return_at, '[)')
  ) then
    raise exception 'This vehicle is already booked during the selected period.';
  end if;

  if p_long_term and exists (
    select 1
    from public.vehicle_bookings b
    where b.vehicle_id = p_vehicle_id
      and (b.is_long_term = true or b.ends_at > v_now)
  ) then
    raise exception 'This vehicle already has an active or upcoming booking.';
  end if;

  insert into public.vehicle_loans (
    vehicle_id,
    borrowed_by_user_id,
    borrower_email,
    driver_name,
    purpose,
    start_odometer,
    borrow_notes,
    expected_return_at,
    is_long_term
  )
  values (
    p_vehicle_id,
    v_user_id,
    coalesce(v_email, ''),
    coalesce(nullif(trim(p_driver_name), ''), coalesce(v_email, '')),
    p_purpose,
    p_start_odometer,
    case
      when p_long_term and nullif(trim(coalesce(p_borrow_notes, '')), '') is null then 'Long term borrow.'
      when p_long_term then concat('Long term borrow.', E'\n\n', p_borrow_notes)
      else p_borrow_notes
    end,
    case when p_long_term then null else p_expected_return_at end,
    p_long_term
  )
  returning *
  into v_loan;

  update public.vehicles
  set status = 'borrowed',
      current_holder_user_id = v_user_id
  where id = p_vehicle_id;

  return v_loan;
end;
$$;

grant execute on function public.borrow_vehicle(uuid, text, text, integer, text, timestamptz, boolean) to authenticated;

create or replace function public.collect_booking_key(
  p_booking_id uuid
)
returns public.vehicle_loans
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text := auth.jwt() ->> 'email';
  v_booking public.vehicle_bookings;
  v_vehicle public.vehicles;
  v_loan public.vehicle_loans;
  v_now timestamptz := timezone('utc', now());
begin
  if v_user_id is null then
    raise exception 'You must be logged in to collect a key.';
  end if;

  select *
  into v_booking
  from public.vehicle_bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'Booking not found.';
  end if;

  if v_booking.booked_by_user_id <> v_user_id then
    raise exception 'You can only collect keys for your own bookings.';
  end if;

  if (not v_booking.is_long_term) and v_booking.ends_at <= v_now then
    raise exception 'This booking has already ended.';
  end if;

  select *
  into v_vehicle
  from public.vehicles
  where id = v_booking.vehicle_id
  for update;

  if not found then
    raise exception 'Vehicle not found.';
  end if;

  if v_vehicle.status in ('retired', 'maintenance') or v_vehicle.current_holder_user_id is not null then
    raise exception 'This vehicle is not currently available.';
  end if;

  if exists (
    select 1
    from public.vehicle_loans l
    where l.vehicle_id = v_booking.vehicle_id
      and l.returned_at is null
  ) then
    raise exception 'This vehicle is currently borrowed.';
  end if;

  if exists (
    select 1
    from public.vehicle_bookings b
    where b.vehicle_id = v_booking.vehicle_id
      and b.id <> v_booking.id
      and tstzrange(b.starts_at, case when b.is_long_term then 'infinity'::timestamptz else b.ends_at end, '[)') && tstzrange(v_now, case when v_booking.is_long_term then 'infinity'::timestamptz else v_booking.ends_at end, '[)')
  ) then
    raise exception 'This vehicle has another booking during the borrow period.';
  end if;

  insert into public.vehicle_loans (
    vehicle_id,
    borrowed_by_user_id,
    borrower_email,
    driver_name,
    purpose,
    start_odometer,
    borrow_notes,
    expected_return_at,
    is_long_term
  )
  values (
    v_booking.vehicle_id,
    v_user_id,
    coalesce(v_email, v_booking.booked_by_email, ''),
    coalesce(v_email, v_booking.booked_by_email, ''),
    coalesce(nullif(trim(v_booking.comments), ''), 'Booking converted after key collection'),
    null,
    case
      when v_booking.is_long_term then concat('Long term booking ', v_booking.id::text, ' converted after key collection.')
      else concat('Converted from booking ', v_booking.id::text, ' after key collection.')
    end,
    case when v_booking.is_long_term then null else v_booking.ends_at end,
    v_booking.is_long_term
  )
  returning *
  into v_loan;

  delete from public.vehicle_bookings
  where id = v_booking.id;

  update public.vehicles
  set status = 'borrowed',
      current_holder_user_id = v_user_id
  where id = v_booking.vehicle_id;

  return v_loan;
end;
$$;

grant execute on function public.collect_booking_key(uuid) to authenticated;

create table if not exists public.loan_extensions (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.vehicle_loans (id) on delete cascade,
  vehicle_id uuid not null references public.vehicles (id) on delete cascade,
  extended_by_user_id uuid not null references auth.users (id),
  previous_expected_return_at timestamptz,
  new_expected_return_at timestamptz not null,
  reason text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_loan_extensions_loan_id on public.loan_extensions (loan_id);
create index if not exists idx_loan_extensions_vehicle_id on public.loan_extensions (vehicle_id);

alter table public.loan_extensions enable row level security;

drop policy if exists "Authenticated users can read loan extensions" on public.loan_extensions;
create policy "Authenticated users can read loan extensions"
on public.loan_extensions
for select
to authenticated
using (true);

create or replace function public.extend_vehicle_loan(
  p_loan_id uuid,
  p_expected_return_at timestamptz,
  p_extension_reason text
)
returns public.vehicle_loans
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_loan public.vehicle_loans;
  v_now timestamptz := timezone('utc', now());
  v_extension_note text;
  v_previous_expected_return_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'You must be logged in to extend a borrow.';
  end if;

  if p_expected_return_at is null or p_expected_return_at <= v_now then
    raise exception 'Please choose a valid new expected return time.';
  end if;

  if nullif(trim(p_extension_reason), '') is null then
    raise exception 'Please enter a reason for the extension.';
  end if;

  select *
  into v_loan
  from public.vehicle_loans
  where id = p_loan_id
  for update;

  if not found then
    raise exception 'Loan record not found.';
  end if;

  if v_loan.borrowed_by_user_id <> v_user_id then
    raise exception 'You can only extend vehicles borrowed by you.';
  end if;

  if v_loan.returned_at is not null then
    raise exception 'This vehicle has already been returned.';
  end if;

  if v_loan.expected_return_at is not null and p_expected_return_at <= v_loan.expected_return_at then
    raise exception 'Please choose a return time later than the current expected return time.';
  end if;

  v_previous_expected_return_at := v_loan.expected_return_at;

  if exists (
    select 1
    from public.vehicle_bookings b
    where b.vehicle_id = v_loan.vehicle_id
      and tstzrange(b.starts_at, case when b.is_long_term then 'infinity'::timestamptz else b.ends_at end, '[)') && tstzrange(v_loan.borrowed_at, p_expected_return_at, '[)')
  ) then
    raise exception 'Extend failed: this vehicle is booked during the requested extension period.';
  end if;

  v_extension_note := concat(
    'Extension requested at ',
    to_char(v_now, 'YYYY-MM-DD HH24:MI:SS TZ'),
    ': expected return extended to ',
    to_char(p_expected_return_at, 'YYYY-MM-DD HH24:MI:SS TZ'),
    '. Reason: ',
    trim(p_extension_reason)
  );

  update public.vehicle_loans
  set expected_return_at = p_expected_return_at,
      is_long_term = false,
      borrow_notes = case
        when nullif(trim(coalesce(borrow_notes, '')), '') is null then v_extension_note
        else concat(borrow_notes, E'\n\n', v_extension_note)
      end
  where id = p_loan_id
  returning *
  into v_loan;

  insert into public.loan_extensions (
    loan_id,
    vehicle_id,
    extended_by_user_id,
    previous_expected_return_at,
    new_expected_return_at,
    reason
  )
  values (
    v_loan.id,
    v_loan.vehicle_id,
    v_user_id,
    v_previous_expected_return_at,
    p_expected_return_at,
    trim(p_extension_reason)
  );

  return v_loan;
end;
$$;

grant execute on function public.extend_vehicle_loan(uuid, timestamptz, text) to authenticated;

select pg_notify('pgrst', 'reload schema');

create or replace function public.return_vehicle(
  p_loan_id uuid,
  p_end_odometer integer,
  p_return_notes text default null
)
returns public.vehicle_loans
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_loan public.vehicle_loans;
begin
  if v_user_id is null then
    raise exception 'You must be logged in to return a vehicle.';
  end if;

  select *
  into v_loan
  from public.vehicle_loans
  where id = p_loan_id
  for update;

  if not found then
    raise exception 'Loan record not found.';
  end if;

  if v_loan.borrowed_by_user_id <> v_user_id then
    raise exception 'You can only return vehicles borrowed by you.';
  end if;

  if v_loan.returned_at is not null then
    raise exception 'This vehicle has already been returned.';
  end if;

  if p_end_odometer < v_loan.start_odometer then
    raise exception 'Return odometer cannot be less than the borrow odometer.';
  end if;

  update public.vehicle_loans
  set end_odometer = p_end_odometer,
      return_notes = p_return_notes,
      returned_at = timezone('utc', now())
  where id = p_loan_id
  returning *
  into v_loan;

  update public.vehicles
  set status = 'available',
      current_holder_user_id = null
  where id = v_loan.vehicle_id;

  return v_loan;
end;
$$;

grant execute on function public.return_vehicle(uuid, integer, text) to authenticated;


-- Booking cancellation audit. Keep this in sync with
-- 2026-07-20_booking_cancellation_audit.sql.
create table if not exists public.booking_cancellations (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null,
  vehicle_id uuid references public.vehicles (id) on delete set null,
  vehicle_plate_number text,
  vehicle_model text,
  booked_by_user_id uuid references auth.users (id) on delete set null,
  booked_by_email text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  is_long_term boolean not null default false,
  booking_comments text,
  cancelled_by_user_id uuid references auth.users (id) on delete set null,
  cancelled_by_email text not null,
  cancelled_by_admin boolean not null default false,
  cancellation_note text,
  cancelled_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_booking_cancellations_cancelled_at on public.booking_cancellations (cancelled_at desc);
create index if not exists idx_booking_cancellations_booking_id on public.booking_cancellations (booking_id);
create index if not exists idx_booking_cancellations_vehicle_id on public.booking_cancellations (vehicle_id);
alter table public.booking_cancellations enable row level security;
grant select on public.booking_cancellations to authenticated;

drop policy if exists "Users can read own booking cancellations" on public.booking_cancellations;
create policy "Users can read own booking cancellations" on public.booking_cancellations
for select to authenticated
using (booked_by_user_id = auth.uid() or public.is_admin());

revoke insert, update, delete on public.booking_cancellations from authenticated;

create or replace function public.cancel_vehicle_booking(p_booking_id uuid, p_cancellation_note text default null)
returns public.booking_cancellations
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text := coalesce(auth.jwt() ->> 'email', '');
  v_is_admin boolean := public.is_admin();
  v_booking public.vehicle_bookings;
  v_vehicle public.vehicles;
  v_audit public.booking_cancellations;
begin
  if v_user_id is null then raise exception 'You must be logged in to cancel a booking.'; end if;
  select * into v_booking from public.vehicle_bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found.'; end if;
  if v_booking.booked_by_user_id <> v_user_id and not v_is_admin then
    raise exception 'You can only cancel your own booking.';
  end if;
  select * into v_vehicle from public.vehicles where id = v_booking.vehicle_id;
  insert into public.booking_cancellations (
    booking_id, vehicle_id, vehicle_plate_number, vehicle_model, booked_by_user_id,
    booked_by_email, starts_at, ends_at, is_long_term, booking_comments,
    cancelled_by_user_id, cancelled_by_email, cancelled_by_admin, cancellation_note
  ) values (
    v_booking.id, v_booking.vehicle_id, v_vehicle.plate_number, v_vehicle.model,
    v_booking.booked_by_user_id, v_booking.booked_by_email, v_booking.starts_at,
    v_booking.ends_at, v_booking.is_long_term, v_booking.comments, v_user_id,
    v_email, v_is_admin, nullif(trim(p_cancellation_note), '')
  ) returning * into v_audit;
  delete from public.vehicle_bookings where id = v_booking.id;
  return v_audit;
end;
$$;

revoke all on function public.cancel_vehicle_booking(uuid, text) from public;
grant execute on function public.cancel_vehicle_booking(uuid, text) to authenticated;

-- Atomic admin booking/loan operations plus a permanent admin action audit trail.
-- Run after 2026-07-20_booking_cancellation_audit.sql.

create table if not exists public.admin_action_audits (
  id uuid primary key default gen_random_uuid(),
  action_type text not null check (action_type in ('booking_started_as_borrow', 'vehicle_returned')),
  admin_user_id uuid references auth.users (id) on delete set null,
  admin_email text not null,
  vehicle_id uuid references public.vehicles (id) on delete set null,
  booking_id uuid,
  loan_id uuid,
  target_user_id uuid references auth.users (id) on delete set null,
  target_email text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_admin_action_audits_created_at
on public.admin_action_audits (created_at desc);

create index if not exists idx_admin_action_audits_vehicle_id
on public.admin_action_audits (vehicle_id);

alter table public.admin_action_audits enable row level security;
grant select on public.admin_action_audits to authenticated;
revoke insert, update, delete on public.admin_action_audits from authenticated;

drop policy if exists "Admins can read admin action audits" on public.admin_action_audits;
create policy "Admins can read admin action audits"
on public.admin_action_audits
for select
to authenticated
using (public.is_admin());

create or replace function public.admin_start_booking_borrow(
  p_booking_id uuid,
  p_vehicle_id uuid
)
returns public.vehicle_loans
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_admin_email text := coalesce(auth.jwt() ->> 'email', 'admin');
  v_now timestamptz := timezone('utc', now());
  v_booking public.vehicle_bookings;
  v_vehicle public.vehicles;
  v_loan public.vehicle_loans;
begin
  if v_admin_id is null or not public.is_admin(v_admin_id) then
    raise exception 'Admin access required.';
  end if;

  select * into v_booking
  from public.vehicle_bookings
  where id = p_booking_id and vehicle_id = p_vehicle_id
  for update;

  if not found then raise exception 'Reservation not found.'; end if;
  if v_booking.starts_at > v_now then raise exception 'This reservation has not started yet.'; end if;
  if not v_booking.is_long_term and v_booking.ends_at <= v_now then
    raise exception 'This reservation has already ended.';
  end if;

  select * into v_vehicle
  from public.vehicles
  where id = p_vehicle_id
  for update;

  if not found or v_vehicle.status in ('retired', 'maintenance') then
    raise exception 'This vehicle cannot be borrowed in its current status.';
  end if;

  if exists (
    select 1 from public.vehicle_loans
    where vehicle_id = p_vehicle_id and returned_at is null
  ) then
    raise exception 'This vehicle is still borrowed. Return it first, then start the reservation borrow.';
  end if;

  insert into public.vehicle_loans (
    vehicle_id, borrowed_by_user_id, borrower_email, driver_name, purpose,
    start_odometer, borrow_notes, expected_return_at, is_long_term
  ) values (
    v_booking.vehicle_id,
    v_booking.booked_by_user_id,
    v_booking.booked_by_email,
    v_booking.booked_by_email,
    coalesce(nullif(trim(v_booking.comments), ''), 'Reservation converted by admin'),
    null,
    concat('Admin started borrow from reservation ', v_booking.id::text, ' by ', v_admin_email,
      case when v_booking.comments is null then '.' else E'.\n\nReservation comments: ' || v_booking.comments end),
    case when v_booking.is_long_term then null else v_booking.ends_at end,
    v_booking.is_long_term
  )
  returning * into v_loan;

  delete from public.vehicle_bookings where id = v_booking.id;

  update public.vehicles
  set status = 'borrowed', current_holder_user_id = v_booking.booked_by_user_id
  where id = v_booking.vehicle_id;

  insert into public.admin_action_audits (
    action_type, admin_user_id, admin_email, vehicle_id, booking_id, loan_id,
    target_user_id, target_email, details
  ) values (
    'booking_started_as_borrow', v_admin_id, v_admin_email, v_booking.vehicle_id,
    v_booking.id, v_loan.id, v_booking.booked_by_user_id, v_booking.booked_by_email,
    jsonb_build_object(
      'starts_at', v_booking.starts_at,
      'ends_at', v_booking.ends_at,
      'is_long_term', v_booking.is_long_term,
      'booking_comments', v_booking.comments
    )
  );

  return v_loan;
end;
$$;

revoke all on function public.admin_start_booking_borrow(uuid, uuid) from public;
grant execute on function public.admin_start_booking_borrow(uuid, uuid) to authenticated;

create or replace function public.admin_return_vehicle(
  p_loan_id uuid,
  p_vehicle_id uuid,
  p_end_odometer integer,
  p_return_notes text
)
returns public.vehicle_loans
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_admin_email text := coalesce(auth.jwt() ->> 'email', 'admin');
  v_loan public.vehicle_loans;
  v_return_note text;
begin
  if v_admin_id is null or not public.is_admin(v_admin_id) then
    raise exception 'Admin access required.';
  end if;

  if nullif(trim(p_return_notes), '') is null then
    raise exception 'Please enter an admin return note.';
  end if;

  select * into v_loan
  from public.vehicle_loans
  where id = p_loan_id and vehicle_id = p_vehicle_id
  for update;

  if not found then raise exception 'Active loan record not found.'; end if;
  if v_loan.returned_at is not null then raise exception 'This vehicle has already been returned.'; end if;
  if p_end_odometer is not null and (p_end_odometer < 0 or
      (v_loan.start_odometer is not null and p_end_odometer < v_loan.start_odometer)) then
    raise exception 'Return odometer cannot be less than the borrow odometer.';
  end if;

  v_return_note := concat('Admin return by ', v_admin_email, ': ', trim(p_return_notes));

  update public.vehicle_loans
  set end_odometer = p_end_odometer,
      return_notes = case
        when return_notes is null or trim(return_notes) = '' then v_return_note
        else return_notes || E'\n' || v_return_note
      end,
      returned_at = timezone('utc', now())
  where id = v_loan.id
  returning * into v_loan;

  update public.vehicles
  set status = 'available', current_holder_user_id = null
  where id = p_vehicle_id;

  insert into public.admin_action_audits (
    action_type, admin_user_id, admin_email, vehicle_id, loan_id,
    target_user_id, target_email, details
  ) values (
    'vehicle_returned', v_admin_id, v_admin_email, p_vehicle_id, v_loan.id,
    v_loan.borrowed_by_user_id, v_loan.borrower_email,
    jsonb_build_object(
      'end_odometer', p_end_odometer,
      'return_notes', trim(p_return_notes),
      'borrowed_at', v_loan.borrowed_at
    )
  );

  return v_loan;
end;
$$;

revoke all on function public.admin_return_vehicle(uuid, uuid, integer, text) from public;
grant execute on function public.admin_return_vehicle(uuid, uuid, integer, text) to authenticated;

insert into public.vehicles (plate_number, model, status)
values
  ('FDI-80U', 'T9 Haven', 'available'),
  ('EOP16B', 'TOYOTA ALPHARD', 'available'),
  ('FSI02M', 'T9 PHEV', 'available'),
  ('FSI02T', 'T9 PHEV', 'available'),
  ('FWA79M', 'T9 PHEV', 'available'),
  ('FWG16E', 'T9 PHEV', 'available'),
  ('FYJ16A', 'T9 PHEV', 'available'),
  ('CSJ516', 'T9 Haven', 'available'),
  ('T9UTE', 'T9 Haven', 'available'),
  ('FWF88F', 'T9 Osprey X', 'available'),
  ('FZK92L', 'T9 PHEV', 'available'),
  ('FZK92K', 'T9 PHEV', 'available'),
  ('FWG16T', 'T9 Osprey X', 'available'),
  ('2DP4JQ', 'T9 Haven', 'available')
on conflict (plate_number) do nothing;
