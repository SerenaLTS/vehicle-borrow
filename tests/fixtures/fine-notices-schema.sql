-- Test-only minimal Supabase fixture. Run in a fresh disposable PostgreSQL cluster, never a real application database.
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create schema storage;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user_id',true),'')::uuid $$;
create function public.is_admin() returns boolean language sql stable as $$ select coalesce(current_setting('test.is_admin',true),'false')::boolean $$;
create table public.vehicles(id uuid primary key, plate_number text);
create table public.vehicle_loans(id uuid primary key, vehicle_id uuid references public.vehicles(id), borrowed_at timestamptz, returned_at timestamptz);
create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
grant usage on schema auth to authenticated;
insert into auth.users values ('11111111-1111-4111-8111-111111111111');
insert into public.vehicles values ('22222222-2222-4222-8222-222222222222','TEST123');
