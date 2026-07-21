-- Audits every booking cancellation and performs audit + delete atomically.
-- Run this migration before deploying the application code that calls cancel_vehicle_booking.

create table if not exists public.booking_cancellations (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null,
  vehicle_id uuid references public.vehicles (id) on delete set null,
  vehicle_plate_number text,
  vehicle_model text,
  booked_by_user_id uuid references auth.users (id) on delete set null,
  booked_by_email text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  is_long_term boolean not null default false,
  booking_comments text,
  cancelled_by_user_id uuid references auth.users (id) on delete set null,
  cancelled_by_email text not null,
  cancelled_by_admin boolean not null default false,
  cancellation_note text,
  cancelled_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_booking_cancellations_cancelled_at
on public.booking_cancellations (cancelled_at desc);

create index if not exists idx_booking_cancellations_booking_id
on public.booking_cancellations (booking_id);

create index if not exists idx_booking_cancellations_vehicle_id
on public.booking_cancellations (vehicle_id);

alter table public.booking_cancellations enable row level security;
grant select on public.booking_cancellations to authenticated;

drop policy if exists "Users can read own booking cancellations" on public.booking_cancellations;
create policy "Users can read own booking cancellations"
on public.booking_cancellations
for select
to authenticated
using (booked_by_user_id = auth.uid() or public.is_admin());

revoke insert, update, delete on public.booking_cancellations from authenticated;

create or replace function public.cancel_vehicle_booking(
  p_booking_id uuid,
  p_cancellation_note text default null,
  p_cancelled_as_admin boolean default false
)
returns public.booking_cancellations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text := coalesce(auth.jwt() ->> 'email', '');
  v_has_admin_role boolean := public.is_admin();
  v_booking public.vehicle_bookings;
  v_vehicle public.vehicles;
  v_audit public.booking_cancellations;
begin
  if v_user_id is null then
    raise exception 'You must be logged in to cancel a booking.';
  end if;

  select *
  into v_booking
  from public.vehicle_bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'Booking not found.';
  end if;

  if p_cancelled_as_admin and not v_has_admin_role then
    raise exception 'Admin access required.';
  end if;

  if not p_cancelled_as_admin and v_booking.booked_by_user_id <> v_user_id then
    raise exception 'You can only cancel your own booking.';
  end if;

  select *
  into v_vehicle
  from public.vehicles
  where id = v_booking.vehicle_id;

  insert into public.booking_cancellations (
    booking_id,
    vehicle_id,
    vehicle_plate_number,
    vehicle_model,
    booked_by_user_id,
    booked_by_email,
    starts_at,
    ends_at,
    is_long_term,
    booking_comments,
    cancelled_by_user_id,
    cancelled_by_email,
    cancelled_by_admin,
    cancellation_note
  )
  values (
    v_booking.id,
    v_booking.vehicle_id,
    v_vehicle.plate_number,
    v_vehicle.model,
    v_booking.booked_by_user_id,
    v_booking.booked_by_email,
    v_booking.starts_at,
    v_booking.ends_at,
    v_booking.is_long_term,
    v_booking.comments,
    v_user_id,
    v_email,
    p_cancelled_as_admin,
    nullif(trim(p_cancellation_note), '')
  )
  returning * into v_audit;

  delete from public.vehicle_bookings
  where id = v_booking.id;

  return v_audit;
end;
$$;

revoke all on function public.cancel_vehicle_booking(uuid, text, boolean) from public;
grant execute on function public.cancel_vehicle_booking(uuid, text, boolean) to authenticated;
