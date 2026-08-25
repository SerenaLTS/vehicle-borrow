-- Hotfix for databases where the 2026-08-26 migration stopped while updating
-- vehicle_bookings. Safe to run independently and safe to rerun.

create or replace function public.fleet_set_updated_audit_fields()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at = now();
  if auth.uid() is not null then new.updated_by = auth.uid(); end if;

  -- NEW is table-specific. Resolve vehicle-only fields only for vehicles.
  if tg_table_name = 'vehicles' then
    if tg_op = 'INSERT' then
      new.location = new.current_location_name;
      new.location_updated_at = coalesce(new.location_updated_at, now());
      if auth.uid() is not null then new.location_updated_by = auth.uid(); end if;
    elsif new.current_location_name is distinct from old.current_location_name
       or new.current_location_address is distinct from old.current_location_address
       or new.location_source is distinct from old.location_source
       or new.location_comments is distinct from old.location_comments then
      new.location = new.current_location_name;
      new.location_updated_at = now();
      if auth.uid() is not null then new.location_updated_by = auth.uid(); end if;
    end if;
  end if;

  return new;
end;
$$;

select pg_notify('pgrst', 'reload schema');
