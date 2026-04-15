-- Normalize manually created mixed-case vehicle columns to lowercase.
-- Safe for repeated runs.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'vehicles'
      and column_name = 'VIN'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'vehicles'
      and column_name = 'vin'
  ) then
    execute 'alter table public.vehicles rename column "VIN" to vin';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'vehicles'
      and column_name = 'Color'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'vehicles'
      and column_name = 'color'
  ) then
    execute 'alter table public.vehicles rename column "Color" to color';
  end if;
end
$$;

alter table public.vehicles add column if not exists vin text;
alter table public.vehicles add column if not exists color text;
