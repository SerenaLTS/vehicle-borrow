-- Test-only fixture for a fresh disposable database, never production.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
end $$;
create schema auth;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb, deleted_at timestamptz, banned_until timestamptz);
create table public.user_roles(user_id uuid primary key references auth.users(id), is_admin boolean not null);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user_id',true),'')::uuid $$;
create function public.is_admin() returns boolean language sql stable as $$ select coalesce((select is_admin from public.user_roles where user_id=auth.uid()),false) $$;
create table public.vehicles(id uuid primary key, status text default 'available', current_holder_user_id uuid references auth.users(id));
create table public.vehicle_loans(id uuid primary key default gen_random_uuid(), vehicle_id uuid references public.vehicles(id), borrowed_by_user_id uuid references auth.users(id), borrower_email text, driver_name text, purpose text, start_odometer integer, borrow_notes text, expected_return_at timestamptz, is_long_term boolean, returned_at timestamptz, borrowed_at timestamptz default now());
create table public.vehicle_bookings(id uuid primary key default gen_random_uuid(), vehicle_id uuid references public.vehicles(id), starts_at timestamptz, ends_at timestamptz, is_long_term boolean default false);
grant usage on schema auth to authenticated;
grant select on public.user_roles, public.vehicle_loans, public.vehicles to authenticated;
insert into auth.users(id,email,raw_user_meta_data) values
('11111111-1111-4111-8111-111111111111','admin@company.test','{"full_name":"Admin"}'),
('22222222-2222-4222-8222-222222222222','employee@company.test','{"full_name":"Employee Name"}');
insert into public.user_roles values ('11111111-1111-4111-8111-111111111111',true),('22222222-2222-4222-8222-222222222222',false);
insert into public.vehicles(id) values ('33333333-3333-4333-8333-333333333333'),('44444444-4444-4444-8444-444444444444');
