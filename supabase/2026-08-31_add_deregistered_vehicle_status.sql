-- Add a non-bookable status for vehicles that are no longer registered.

alter table public.vehicles drop constraint if exists vehicles_status_check;
alter table public.vehicles
add constraint vehicles_status_check
check (status in (
  'available', 'booked', 'borrowed', 'in_transit', 'repair', 'maintenance',
  'suspended', 'employee_car', 'deregistered', 'sold', 'retired'
));

create or replace function public.fleet_require_operational_vehicle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status from public.vehicles where id = new.vehicle_id;
  if v_status is null then raise exception 'Vehicle not found.'; end if;
  if v_status in ('in_transit', 'repair', 'maintenance', 'suspended', 'employee_car', 'deregistered', 'sold', 'retired') then
    raise exception 'This vehicle is not available for booking or borrowing in its current status.';
  end if;
  return new;
end;
$$;

revoke all on function public.fleet_require_operational_vehicle() from public;

select pg_notify('pgrst', 'reload schema');
