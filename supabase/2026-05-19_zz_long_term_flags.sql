alter table public.vehicle_loans
add column if not exists is_long_term boolean not null default false;

alter table public.vehicle_bookings
add column if not exists is_long_term boolean not null default false;

update public.vehicle_loans
set is_long_term = true
where returned_at is null
  and expected_return_at is null;

update public.vehicle_bookings
set is_long_term = true
where ends_at is null;

alter table public.vehicle_bookings
alter column ends_at drop not null;

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

  if exists (
    select 1
    from public.vehicle_loans l
    where l.vehicle_id = new.vehicle_id
      and l.returned_at is null
      and l.is_long_term = true
  ) then
    raise exception 'This vehicle is currently borrowed long term.';
  end if;

  if exists (
    select 1
    from public.vehicle_loans l
    where l.vehicle_id = new.vehicle_id
      and l.returned_at is null
      and l.is_long_term = false
      and l.expected_return_at is not null
      and tstzrange(l.borrowed_at, l.expected_return_at, '[)') && tstzrange(new.starts_at, v_new_ends_at, '[)')
  ) then
    raise exception 'This booking overlaps with an existing borrow period.';
  end if;

  return new;
end;
$$;

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

select pg_notify('pgrst', 'reload schema');
