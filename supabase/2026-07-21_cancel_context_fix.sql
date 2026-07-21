-- Distinguishes the UI context used to cancel a booking from the user's role.
-- An admin cancelling their own booking from the normal user UI remains a personal cancellation.

drop function if exists public.cancel_vehicle_booking(uuid, text);

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

  select * into v_booking
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

  select * into v_vehicle
  from public.vehicles
  where id = v_booking.vehicle_id;

  insert into public.booking_cancellations (
    booking_id, vehicle_id, vehicle_plate_number, vehicle_model,
    booked_by_user_id, booked_by_email, starts_at, ends_at, is_long_term,
    booking_comments, cancelled_by_user_id, cancelled_by_email,
    cancelled_by_admin, cancellation_note
  ) values (
    v_booking.id, v_booking.vehicle_id, v_vehicle.plate_number, v_vehicle.model,
    v_booking.booked_by_user_id, v_booking.booked_by_email, v_booking.starts_at,
    v_booking.ends_at, v_booking.is_long_term, v_booking.comments, v_user_id,
    v_email, p_cancelled_as_admin, nullif(trim(p_cancellation_note), '')
  )
  returning * into v_audit;

  delete from public.vehicle_bookings where id = v_booking.id;
  return v_audit;
end;
$$;

revoke all on function public.cancel_vehicle_booking(uuid, text, boolean) from public;
grant execute on function public.cancel_vehicle_booking(uuid, text, boolean) to authenticated;
