-- Completes and hardens the incremental fleet field upgrade.
-- Run after the original fleet field migration. Safe to rerun.

alter table public.vehicles drop constraint if exists vehicles_status_check;
alter table public.vehicles add constraint vehicles_status_check check (status in (
  'available', 'booked', 'borrowed', 'in_transit', 'repair', 'maintenance',
  'suspended', 'sold', 'retired'
));

alter table public.vehicles drop constraint if exists vehicles_model_year_check;
alter table public.vehicles add constraint vehicles_model_year_check
  check (model_year is null or model_year between 1900 and 2100);
alter table public.vehicles drop constraint if exists vehicles_reminder_days_check;
alter table public.vehicles add constraint vehicles_reminder_days_check
  check (reminder_days between 0 and 365);

alter table public.vehicle_bookings drop constraint if exists vehicle_bookings_pickup_energy_check;
alter table public.vehicle_bookings add constraint vehicle_bookings_pickup_energy_check
  check (pickup_energy_percent is null or pickup_energy_percent between 0 and 100);
alter table public.vehicle_bookings drop constraint if exists vehicle_bookings_return_energy_check;
alter table public.vehicle_bookings add constraint vehicle_bookings_return_energy_check
  check (return_energy_percent is null or return_energy_percent between 0 and 100);
alter table public.vehicle_bookings drop constraint if exists vehicle_bookings_odometer_check;
alter table public.vehicle_bookings add constraint vehicle_bookings_odometer_check check (
  (pickup_odometer_km is null or pickup_odometer_km >= 0) and
  (return_odometer_km is null or return_odometer_km >= 0) and
  (return_odometer_km is null or pickup_odometer_km is null or return_odometer_km >= pickup_odometer_km)
);
alter table public.vehicle_bookings drop constraint if exists vehicle_bookings_external_approval_check;
alter table public.vehicle_bookings add constraint vehicle_bookings_external_approval_check check (
  borrower_type = 'internal' or approval_status <> 'not_required'
);

alter table public.vehicle_location_history drop constraint if exists vehicle_location_latitude_check;
alter table public.vehicle_location_history add constraint vehicle_location_latitude_check
  check (latitude is null or latitude between -90 and 90);
alter table public.vehicle_location_history drop constraint if exists vehicle_location_longitude_check;
alter table public.vehicle_location_history add constraint vehicle_location_longitude_check
  check (longitude is null or longitude between -180 and 180);

create or replace function public.fleet_set_updated_audit_fields()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at = now();
  if auth.uid() is not null then new.updated_by = auth.uid(); end if;
  if tg_table_name = 'vehicles' and (
    tg_op = 'INSERT' or new.current_location_name is distinct from old.current_location_name or
    new.current_location_address is distinct from old.current_location_address or
    new.location_source is distinct from old.location_source or new.location_comments is distinct from old.location_comments
  ) then
    new.location = new.current_location_name;
    new.location_updated_at = now();
    if auth.uid() is not null then new.location_updated_by = auth.uid(); end if;
  end if;
  return new;
end;
$$;
drop trigger if exists fleet_vehicles_set_updated_audit_fields on public.vehicles;
create trigger fleet_vehicles_set_updated_audit_fields before insert or update on public.vehicles
for each row execute function public.fleet_set_updated_audit_fields();
drop trigger if exists fleet_bookings_set_updated_audit_fields on public.vehicle_bookings;
create trigger fleet_bookings_set_updated_audit_fields before insert or update on public.vehicle_bookings
for each row execute function public.fleet_set_updated_audit_fields();

-- RLS is row-based, so protect sensitive vehicle columns with column grants and
-- expose them only through an admin-filtered view.
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

create or replace view public.admin_vehicle_details
with (security_barrier = true)
as select * from public.vehicles where public.is_admin();
revoke all on public.admin_vehicle_details from anon, public;
grant select on public.admin_vehicle_details to authenticated;

create or replace function public.fleet_require_operational_vehicle()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  select status into v_status from public.vehicles where id = new.vehicle_id;
  if v_status is null then raise exception 'Vehicle not found.'; end if;
  if v_status in ('in_transit', 'repair', 'maintenance', 'suspended', 'sold', 'retired') then
    raise exception 'This vehicle is not available for booking or borrowing in its current status.';
  end if;
  return new;
end;
$$;
revoke all on function public.fleet_require_operational_vehicle() from public;
drop trigger if exists fleet_booking_operational_vehicle on public.vehicle_bookings;
create trigger fleet_booking_operational_vehicle before insert or update of vehicle_id on public.vehicle_bookings
for each row execute function public.fleet_require_operational_vehicle();
drop trigger if exists fleet_loan_operational_vehicle on public.vehicle_loans;
create trigger fleet_loan_operational_vehicle before insert on public.vehicle_loans
for each row execute function public.fleet_require_operational_vehicle();

-- The original migration enabled RLS but deliberately supplied no policies.
-- Explicit grants plus policies below make the intended application access usable.
grant select, insert, update, delete on public.drivers to authenticated;
grant select, insert, update, delete on public.vehicle_files to authenticated;
grant select, insert, update, delete on public.booking_photos to authenticated;
grant select, insert, update, delete on public.vehicle_location_history to authenticated;
grant select, insert, update, delete on public.vehicle_compliance_records to authenticated;
grant select, insert, update, delete on public.compliance_files to authenticated;
revoke all on public.drivers, public.vehicle_files, public.booking_photos,
  public.vehicle_location_history, public.vehicle_compliance_records, public.compliance_files from anon;

drop policy if exists "Drivers can read own record and admins can read all" on public.drivers;
create policy "Drivers can read own record and admins can read all" on public.drivers
for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "Admins can manage drivers" on public.drivers;
create policy "Admins can manage drivers" on public.drivers
for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Authenticated users can read vehicle files" on public.vehicle_files;
create policy "Authenticated users can read vehicle files" on public.vehicle_files
for select to authenticated using (true);
drop policy if exists "Admins can manage vehicle files" on public.vehicle_files;
create policy "Admins can manage vehicle files" on public.vehicle_files
for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Booking participants can read photos" on public.booking_photos;
create policy "Booking participants can read photos" on public.booking_photos
for select to authenticated using (
  public.is_admin() or exists (
    select 1 from public.vehicle_bookings b
    where b.id = booking_id and b.booked_by_user_id = auth.uid()
  )
);
drop policy if exists "Booking participants can add photos" on public.booking_photos;
create policy "Booking participants can add photos" on public.booking_photos
for insert to authenticated with check (
  created_by = auth.uid() and (public.is_admin() or exists (
    select 1 from public.vehicle_bookings b
    where b.id = booking_id and b.booked_by_user_id = auth.uid()
  ))
);
drop policy if exists "Admins can manage booking photos" on public.booking_photos;
create policy "Admins can manage booking photos" on public.booking_photos
for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Authenticated users can read location history" on public.vehicle_location_history;
create policy "Authenticated users can read location history" on public.vehicle_location_history
for select to authenticated using (true);
drop policy if exists "Admins can manage location history" on public.vehicle_location_history;
create policy "Admins can manage location history" on public.vehicle_location_history
for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins can manage compliance records" on public.vehicle_compliance_records;
create policy "Admins can manage compliance records" on public.vehicle_compliance_records
for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Admins can manage compliance files" on public.compliance_files;
create policy "Admins can manage compliance files" on public.compliance_files
for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Prevent the reminder view from bypassing vehicle RLS on supported PostgreSQL versions.
alter view public.vehicle_expiry_reminders set (security_invoker = true);
revoke all on public.vehicle_expiry_reminders from anon, public;
grant select on public.vehicle_expiry_reminders to authenticated;

-- Existing rows created before audit triggers should have useful audit timestamps.
update public.vehicles
set location_updated_at = coalesce(location_updated_at, updated_at, created_at),
    current_location_name = coalesce(current_location_name, location)
where current_location_name is null or location_updated_at is null;

select pg_notify('pgrst', 'reload schema');
