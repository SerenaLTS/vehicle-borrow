alter table public.vehicle_bookings
add column if not exists key_collection_reminded_at timestamptz;

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

  if v_booking.ends_at <= v_now then
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
      and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(v_now, v_booking.ends_at, '[)')
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
    expected_return_at
  )
  values (
    v_booking.vehicle_id,
    v_user_id,
    coalesce(v_email, v_booking.booked_by_email, ''),
    coalesce(v_email, v_booking.booked_by_email, ''),
    coalesce(nullif(trim(v_booking.comments), ''), 'Booking converted after key collection'),
    null,
    concat('Converted from booking ', v_booking.id::text, ' after key collection.'),
    v_booking.ends_at
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
