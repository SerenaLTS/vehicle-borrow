-- External-driver approval and acknowledged registration-expiry reminders.
-- Run after 2026-08-25_fleet_fields_rls_and_constraints.sql. Safe to rerun.

alter table public.vehicle_bookings add column if not exists driver_name text;
alter table public.vehicles
  add column if not exists registration_reminder_acknowledged_at timestamptz,
  add column if not exists registration_reminder_acknowledged_by uuid references auth.users(id) on delete set null,
  add column if not exists registration_reminder_last_sent_on date;

-- Existing internal reservations remain immediately usable.
update public.vehicle_bookings
set booking_status = 'approved', approval_status = 'not_required', borrower_type = 'internal'
where borrower_type = 'internal' and booking_status = 'draft';

-- A changed rego expiry starts a fresh reminder cycle.
create or replace function public.fleet_reset_registration_reminder()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.registration_expires_on is distinct from old.registration_expires_on then
    new.registration_reminder_acknowledged_at = null;
    new.registration_reminder_acknowledged_by = null;
    new.registration_reminder_last_sent_on = null;
  end if;
  return new;
end;
$$;
drop trigger if exists fleet_reset_registration_reminder on public.vehicles;
create trigger fleet_reset_registration_reminder before update of registration_expires_on on public.vehicles
for each row execute function public.fleet_reset_registration_reminder();

-- Keep the sensitive admin view current after adding columns.
create or replace view public.admin_vehicle_details with (security_barrier = true)
as select * from public.vehicles where public.is_admin();
revoke all on public.admin_vehicle_details from anon, public;
grant select on public.admin_vehicle_details to authenticated;

-- The general authenticated grant intentionally excludes acknowledgement audit fields.
revoke select on public.vehicles from authenticated;
grant select (
  id, plate_number, model, vin, color, location, make, model_year, vehicle_type,
  department, fuel_type, default_parking_location, current_location_name,
  current_location_address, location_source, location_comments, location_updated_at,
  location_updated_by, current_custodian_name, current_custodian_user_id,
  current_key_holder_name, current_key_holder_user_id, expected_return_or_arrival_at,
  registration_state, registration_expires_on, insurer, insurance_expires_on,
  inspection_expires_on, usage_restrictions, reminder_days, status, comments,
  current_holder_user_id, created_at, updated_at, updated_by
) on public.vehicles to authenticated;

create or replace function public.collect_booking_key(p_booking_id uuid)
returns public.vehicle_loans language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid(); v_email text := auth.jwt() ->> 'email';
  v_booking public.vehicle_bookings; v_vehicle public.vehicles; v_loan public.vehicle_loans;
  v_now timestamptz := timezone('utc', now());
begin
  if v_user_id is null then raise exception 'You must be logged in to collect a key.'; end if;
  select * into v_booking from public.vehicle_bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found.'; end if;
  if v_booking.booked_by_user_id <> v_user_id then raise exception 'You can only collect keys for your own bookings.'; end if;
  if v_booking.borrower_type = 'external' and v_booking.approval_status <> 'approved' then
    raise exception 'This external driver reservation must be approved before key collection.';
  end if;
  if v_booking.booking_status = 'rejected' then raise exception 'This reservation was rejected.'; end if;
  if (not v_booking.is_long_term) and v_booking.ends_at <= v_now then raise exception 'This booking has already ended.'; end if;
  select * into v_vehicle from public.vehicles where id = v_booking.vehicle_id for update;
  if not found then raise exception 'Vehicle not found.'; end if;
  if v_vehicle.status in ('in_transit','repair','maintenance','suspended','sold','retired') or v_vehicle.current_holder_user_id is not null then
    raise exception 'This vehicle is not currently available.';
  end if;
  if exists (select 1 from public.vehicle_loans l where l.vehicle_id = v_booking.vehicle_id and l.returned_at is null) then
    raise exception 'This vehicle is currently borrowed.';
  end if;
  if exists (
    select 1 from public.vehicle_bookings b where b.vehicle_id = v_booking.vehicle_id and b.id <> v_booking.id
      and tstzrange(b.starts_at, case when b.is_long_term then 'infinity'::timestamptz else b.ends_at end, '[)')
        && tstzrange(v_now, case when v_booking.is_long_term then 'infinity'::timestamptz else v_booking.ends_at end, '[)')
  ) then raise exception 'This vehicle has another booking during the borrow period.'; end if;
  insert into public.vehicle_loans (
    vehicle_id, borrowed_by_user_id, borrower_email, driver_name, purpose, start_odometer,
    borrow_notes, expected_return_at, is_long_term
  ) values (
    v_booking.vehicle_id, v_user_id, coalesce(v_email, v_booking.booked_by_email, ''),
    coalesce(nullif(trim(v_booking.driver_name), ''), coalesce(v_email, v_booking.booked_by_email, '')),
    coalesce(nullif(trim(v_booking.comments), ''), 'Booking converted after key collection'), null,
    case when v_booking.is_long_term then concat('Long term booking ', v_booking.id::text, ' converted after key collection.')
         else concat('Converted from booking ', v_booking.id::text, ' after key collection.') end,
    case when v_booking.is_long_term then null else v_booking.ends_at end, v_booking.is_long_term
  ) returning * into v_loan;
  delete from public.vehicle_bookings where id = v_booking.id;
  update public.vehicles set status = 'borrowed', current_holder_user_id = v_user_id where id = v_booking.vehicle_id;
  return v_loan;
end;
$$;
revoke all on function public.collect_booking_key(uuid) from public;
grant execute on function public.collect_booking_key(uuid) to authenticated;

select pg_notify('pgrst', 'reload schema');
