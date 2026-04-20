alter table public.vehicle_loans add column if not exists expected_return_at timestamptz;

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
