create extension if not exists "pgcrypto";

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  plate_number text not null unique,
  model text not null,
  status text not null default 'available' check (status in ('available', 'borrowed', 'maintenance', 'retired')),
  current_holder_user_id uuid references auth.users (id),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.vehicle_loans (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles (id),
  borrowed_by_user_id uuid not null references auth.users (id),
  borrower_email text not null,
  driver_name text not null,
  purpose text not null,
  start_odometer integer not null check (start_odometer >= 0),
  end_odometer integer check (end_odometer is null or end_odometer >= start_odometer),
  borrow_notes text,
  return_notes text,
  borrowed_at timestamptz not null default timezone('utc', now()),
  returned_at timestamptz
);

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  is_admin boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_vehicle_loans_vehicle_id on public.vehicle_loans (vehicle_id);
create index if not exists idx_vehicle_loans_borrowed_by_user_id on public.vehicle_loans (borrowed_by_user_id);
create index if not exists idx_vehicle_loans_active on public.vehicle_loans (vehicle_id, returned_at);

alter table public.vehicles enable row level security;
alter table public.vehicle_loans enable row level security;
alter table public.user_roles enable row level security;

create or replace function public.handle_user_role_sync()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.user_roles (user_id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (user_id) do update
  set email = excluded.email,
      updated_at = timezone('utc', now());

  return new;
end;
$$;

drop trigger if exists on_auth_user_role_sync on auth.users;
create trigger on_auth_user_role_sync
after insert or update of email on auth.users
for each row execute procedure public.handle_user_role_sync();

insert into public.user_roles (user_id, email)
select id, coalesce(email, '')
from auth.users
on conflict (user_id) do update
set email = excluded.email,
    updated_at = timezone('utc', now());

create or replace function public.is_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = coalesce(p_user_id, auth.uid())
      and is_admin = true
  );
$$;

grant execute on function public.is_admin(uuid) to authenticated;

drop policy if exists "Authenticated users can read vehicles" on public.vehicles;
create policy "Authenticated users can read vehicles"
on public.vehicles
for select
to authenticated
using (true);

drop policy if exists "Authenticated users can read loans" on public.vehicle_loans;
create policy "Authenticated users can read loans"
on public.vehicle_loans
for select
to authenticated
using (true);

drop policy if exists "Users can read roles" on public.user_roles;
create policy "Users can read roles"
on public.user_roles
for select
to authenticated
using (user_id = auth.uid() or public.is_admin());

create or replace function public.borrow_vehicle(
  p_vehicle_id uuid,
  p_driver_name text,
  p_purpose text,
  p_start_odometer integer,
  p_borrow_notes text default null
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
begin
  if v_user_id is null then
    raise exception 'You must be logged in to borrow a vehicle.';
  end if;

  select *
  into v_vehicle
  from public.vehicles
  where id = p_vehicle_id
  for update;

  if not found then
    raise exception 'Vehicle not found.';
  end if;

  if v_vehicle.status <> 'available' or v_vehicle.current_holder_user_id is not null then
    raise exception 'This vehicle is not currently available.';
  end if;

  insert into public.vehicle_loans (
    vehicle_id,
    borrowed_by_user_id,
    borrower_email,
    driver_name,
    purpose,
    start_odometer,
    borrow_notes
  )
  values (
    p_vehicle_id,
    v_user_id,
    coalesce(v_email, ''),
    p_driver_name,
    p_purpose,
    p_start_odometer,
    p_borrow_notes
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

grant execute on function public.borrow_vehicle(uuid, text, text, integer, text) to authenticated;

create or replace function public.return_vehicle(
  p_loan_id uuid,
  p_end_odometer integer,
  p_return_notes text default null
)
returns public.vehicle_loans
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_loan public.vehicle_loans;
begin
  if v_user_id is null then
    raise exception 'You must be logged in to return a vehicle.';
  end if;

  select *
  into v_loan
  from public.vehicle_loans
  where id = p_loan_id
  for update;

  if not found then
    raise exception 'Loan record not found.';
  end if;

  if v_loan.borrowed_by_user_id <> v_user_id then
    raise exception 'You can only return vehicles borrowed by you.';
  end if;

  if v_loan.returned_at is not null then
    raise exception 'This vehicle has already been returned.';
  end if;

  if p_end_odometer < v_loan.start_odometer then
    raise exception 'Return odometer cannot be less than the borrow odometer.';
  end if;

  update public.vehicle_loans
  set end_odometer = p_end_odometer,
      return_notes = p_return_notes,
      returned_at = timezone('utc', now())
  where id = p_loan_id
  returning *
  into v_loan;

  update public.vehicles
  set status = 'available',
      current_holder_user_id = null
  where id = v_loan.vehicle_id;

  return v_loan;
end;
$$;

grant execute on function public.return_vehicle(uuid, integer, text) to authenticated;

insert into public.vehicles (plate_number, model, status)
values
  ('ABC-101', 'Toyota Corolla', 'available'),
  ('ABC-202', 'Hyundai i30', 'available'),
  ('ABC-303', 'Ford Ranger', 'maintenance')
on conflict (plate_number) do nothing;

insert into public.vehicles (plate_number, model, status)
values
  ('FDI-80U', 'T9 Haven', 'available'),
  ('EOP16B', 'TOYOTA ALPHARD', 'available'),
  ('FSI02M', 'T9 PHEV', 'available'),
  ('FSI02T', 'T9 PHEV', 'available'),
  ('FWA79M', 'T9 PHEV', 'available'),
  ('FWG16E', 'T9 PHEV', 'available'),
  ('FYJ16A', 'T9 PHEV', 'available'),
  ('CSJ516', 'T9 Haven', 'available'),
  ('T9UTE', 'T9 Haven', 'available'),
  ('FWF88F', 'T9 Osprey X', 'available'),
  ('FZK92L', 'T9 PHEV', 'available'),
  ('FZK92K', 'T9 PHEV', 'available'),
  ('FWG16T', 'T9 Osprey X', 'available'),
  ('2DP4JQ', 'T9 Haven', 'available')
on conflict (plate_number) do nothing;
