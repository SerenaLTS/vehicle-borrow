create extension if not exists "pgcrypto";

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  plate_number text not null unique,
  model text not null,
  vin text,
  color text,
  status text not null default 'available' check (status in ('available', 'booked', 'borrowed', 'maintenance', 'retired')),
  comments text,
  current_holder_user_id uuid references auth.users (id),
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.vehicles add column if not exists comments text;
alter table public.vehicles add column if not exists vin text;
alter table public.vehicles add column if not exists color text;
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
  returned_at timestamptz
);

alter table public.vehicle_loans add column if not exists expected_return_at timestamptz;

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
  ends_at timestamptz not null,
  comments text,
  created_at timestamptz not null default timezone('utc', now()),
  constraint vehicle_bookings_time_check check (ends_at > starts_at)
);

alter table public.vehicle_bookings drop constraint if exists vehicle_bookings_time_check;
alter table public.vehicle_bookings
add constraint vehicle_bookings_time_check
check (ends_at > starts_at);

create or replace function public.validate_vehicle_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vehicle public.vehicles;
begin
  if new.ends_at <= new.starts_at then
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
      and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(new.starts_at, new.ends_at, '[)')
  ) then
    raise exception 'This vehicle is already booked during the selected period.';
  end if;

  if exists (
    select 1
    from public.vehicle_loans l
    where l.vehicle_id = new.vehicle_id
      and l.returned_at is null
      and l.expected_return_at is null
  ) then
    raise exception 'This vehicle is currently borrowed and does not have a scheduled return time yet.';
  end if;

  if exists (
    select 1
    from public.vehicle_loans l
    where l.vehicle_id = new.vehicle_id
      and l.returned_at is null
      and l.expected_return_at is not null
      and tstzrange(l.borrowed_at, l.expected_return_at, '[)') && tstzrange(new.starts_at, new.ends_at, '[)')
  ) then
    raise exception 'This booking overlaps with an existing borrow period.';
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
create index if not exists idx_vehicles_status_plate_number on public.vehicles (status, plate_number);
create index if not exists idx_user_roles_email on public.user_roles (email);
create index if not exists idx_vehicle_bookings_vehicle_id on public.vehicle_bookings (vehicle_id);
create index if not exists idx_vehicle_bookings_starts_at on public.vehicle_bookings (starts_at);
create index if not exists idx_vehicle_bookings_vehicle_window on public.vehicle_bookings (vehicle_id, starts_at, ends_at);

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

create or replace function public.borrow_vehicle(
  p_vehicle_id uuid,
  p_driver_name text,
  p_purpose text,
  p_start_odometer integer default null,
  p_borrow_notes text default null,
  p_expected_return_at timestamptz default null
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

  if p_expected_return_at is null or p_expected_return_at <= v_now then
    raise exception 'Please choose a valid expected return time.';
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

  if exists (
    select 1
    from public.vehicle_bookings b
    where b.vehicle_id = p_vehicle_id
      and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(v_now, p_expected_return_at, '[)')
  ) then
    raise exception 'This vehicle is already booked during the selected period.';
  end if;

  insert into public.vehicle_loans (
    vehicle_id,
    borrowed_by_user_id,
    borrower_email,
    driver_name,
    purpose,
    start_odometer,
    borrow_notes,
    expected_return_at
  )
  values (
    p_vehicle_id,
    v_user_id,
    coalesce(v_email, ''),
    p_driver_name,
    p_purpose,
    p_start_odometer,
    p_borrow_notes,
    p_expected_return_at
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

grant execute on function public.borrow_vehicle(uuid, text, text, integer, text, timestamptz) to authenticated;

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

  if exists (
    select 1
    from public.vehicle_bookings b
    where b.vehicle_id = v_loan.vehicle_id
      and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(v_loan.borrowed_at, p_expected_return_at, '[)')
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
      borrow_notes = case
        when nullif(trim(coalesce(borrow_notes, '')), '') is null then v_extension_note
        else concat(borrow_notes, E'\n\n', v_extension_note)
      end
  where id = p_loan_id
  returning *
  into v_loan;

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
