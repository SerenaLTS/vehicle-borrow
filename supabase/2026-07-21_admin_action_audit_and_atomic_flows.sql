-- Atomic admin booking/loan operations plus a permanent admin action audit trail.
-- Run after 2026-07-20_booking_cancellation_audit.sql.

create table if not exists public.admin_action_audits (
  id uuid primary key default gen_random_uuid(),
  action_type text not null check (action_type in ('booking_started_as_borrow', 'vehicle_returned')),
  admin_user_id uuid references auth.users (id) on delete set null,
  admin_email text not null,
  vehicle_id uuid references public.vehicles (id) on delete set null,
  booking_id uuid,
  loan_id uuid,
  target_user_id uuid references auth.users (id) on delete set null,
  target_email text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_admin_action_audits_created_at
on public.admin_action_audits (created_at desc);

create index if not exists idx_admin_action_audits_vehicle_id
on public.admin_action_audits (vehicle_id);

alter table public.admin_action_audits enable row level security;
grant select on public.admin_action_audits to authenticated;
revoke insert, update, delete on public.admin_action_audits from authenticated;

drop policy if exists "Admins can read admin action audits" on public.admin_action_audits;
create policy "Admins can read admin action audits"
on public.admin_action_audits
for select
to authenticated
using (public.is_admin());

create or replace function public.admin_start_booking_borrow(
  p_booking_id uuid,
  p_vehicle_id uuid
)
returns public.vehicle_loans
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_admin_email text := coalesce(auth.jwt() ->> 'email', 'admin');
  v_now timestamptz := timezone('utc', now());
  v_booking public.vehicle_bookings;
  v_vehicle public.vehicles;
  v_loan public.vehicle_loans;
begin
  if v_admin_id is null or not public.is_admin(v_admin_id) then
    raise exception 'Admin access required.';
  end if;

  select * into v_booking
  from public.vehicle_bookings
  where id = p_booking_id and vehicle_id = p_vehicle_id
  for update;

  if not found then raise exception 'Reservation not found.'; end if;
  if v_booking.starts_at > v_now then raise exception 'This reservation has not started yet.'; end if;
  if not v_booking.is_long_term and v_booking.ends_at <= v_now then
    raise exception 'This reservation has already ended.';
  end if;

  select * into v_vehicle
  from public.vehicles
  where id = p_vehicle_id
  for update;

  if not found or v_vehicle.status in ('retired', 'maintenance') then
    raise exception 'This vehicle cannot be borrowed in its current status.';
  end if;

  if exists (
    select 1 from public.vehicle_loans
    where vehicle_id = p_vehicle_id and returned_at is null
  ) then
    raise exception 'This vehicle is still borrowed. Return it first, then start the reservation borrow.';
  end if;

  insert into public.vehicle_loans (
    vehicle_id, borrowed_by_user_id, borrower_email, driver_name, purpose,
    start_odometer, borrow_notes, expected_return_at, is_long_term
  ) values (
    v_booking.vehicle_id,
    v_booking.booked_by_user_id,
    v_booking.booked_by_email,
    v_booking.booked_by_email,
    coalesce(nullif(trim(v_booking.comments), ''), 'Reservation converted by admin'),
    null,
    concat('Admin started borrow from reservation ', v_booking.id::text, ' by ', v_admin_email,
      case when v_booking.comments is null then '.' else E'.\n\nReservation comments: ' || v_booking.comments end),
    case when v_booking.is_long_term then null else v_booking.ends_at end,
    v_booking.is_long_term
  )
  returning * into v_loan;

  delete from public.vehicle_bookings where id = v_booking.id;

  update public.vehicles
  set status = 'borrowed', current_holder_user_id = v_booking.booked_by_user_id
  where id = v_booking.vehicle_id;

  insert into public.admin_action_audits (
    action_type, admin_user_id, admin_email, vehicle_id, booking_id, loan_id,
    target_user_id, target_email, details
  ) values (
    'booking_started_as_borrow', v_admin_id, v_admin_email, v_booking.vehicle_id,
    v_booking.id, v_loan.id, v_booking.booked_by_user_id, v_booking.booked_by_email,
    jsonb_build_object(
      'starts_at', v_booking.starts_at,
      'ends_at', v_booking.ends_at,
      'is_long_term', v_booking.is_long_term,
      'booking_comments', v_booking.comments
    )
  );

  return v_loan;
end;
$$;

revoke all on function public.admin_start_booking_borrow(uuid, uuid) from public;
grant execute on function public.admin_start_booking_borrow(uuid, uuid) to authenticated;

create or replace function public.admin_return_vehicle(
  p_loan_id uuid,
  p_vehicle_id uuid,
  p_end_odometer integer,
  p_return_notes text
)
returns public.vehicle_loans
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_admin_email text := coalesce(auth.jwt() ->> 'email', 'admin');
  v_loan public.vehicle_loans;
  v_return_note text;
begin
  if v_admin_id is null or not public.is_admin(v_admin_id) then
    raise exception 'Admin access required.';
  end if;

  if nullif(trim(p_return_notes), '') is null then
    raise exception 'Please enter an admin return note.';
  end if;

  select * into v_loan
  from public.vehicle_loans
  where id = p_loan_id and vehicle_id = p_vehicle_id
  for update;

  if not found then raise exception 'Active loan record not found.'; end if;
  if v_loan.returned_at is not null then raise exception 'This vehicle has already been returned.'; end if;
  if p_end_odometer is not null and (p_end_odometer < 0 or
      (v_loan.start_odometer is not null and p_end_odometer < v_loan.start_odometer)) then
    raise exception 'Return odometer cannot be less than the borrow odometer.';
  end if;

  v_return_note := concat('Admin return by ', v_admin_email, ': ', trim(p_return_notes));

  update public.vehicle_loans
  set end_odometer = p_end_odometer,
      return_notes = case
        when return_notes is null or trim(return_notes) = '' then v_return_note
        else return_notes || E'\n' || v_return_note
      end,
      returned_at = timezone('utc', now())
  where id = v_loan.id
  returning * into v_loan;

  update public.vehicles
  set status = 'available', current_holder_user_id = null
  where id = p_vehicle_id;

  insert into public.admin_action_audits (
    action_type, admin_user_id, admin_email, vehicle_id, loan_id,
    target_user_id, target_email, details
  ) values (
    'vehicle_returned', v_admin_id, v_admin_email, p_vehicle_id, v_loan.id,
    v_loan.borrowed_by_user_id, v_loan.borrower_email,
    jsonb_build_object(
      'end_odometer', p_end_odometer,
      'return_notes', trim(p_return_notes),
      'borrowed_at', v_loan.borrowed_at
    )
  );

  return v_loan;
end;
$$;

revoke all on function public.admin_return_vehicle(uuid, uuid, integer, text) from public;
grant execute on function public.admin_return_vehicle(uuid, uuid, integer, text) to authenticated;

