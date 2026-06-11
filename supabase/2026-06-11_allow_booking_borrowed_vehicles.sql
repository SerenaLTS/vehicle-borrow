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

select pg_notify('pgrst', 'reload schema');
