-- Safe additive migration for an existing database.
-- Purpose:
-- 1. Keep all existing vehicle rows unchanged
-- 2. Add VIN and color as optional vehicle fields

alter table public.vehicles add column if not exists vin text;
alter table public.vehicles add column if not exists color text;

create unique index if not exists idx_vehicles_vin_unique
on public.vehicles (vin)
where vin is not null;
