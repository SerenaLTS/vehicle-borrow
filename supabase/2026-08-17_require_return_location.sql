-- Require and atomically save the vehicle's current location on every return.

drop function if exists public.return_vehicle(uuid, integer, text);

create function public.return_vehicle(
  p_loan_id uuid,
  p_end_odometer integer,
  p_return_notes text default null,
  p_vehicle_location text default null
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

  if nullif(trim(p_vehicle_location), '') is null then
    raise exception 'Please enter the current vehicle location.';
  end if;

  select * into v_loan
  from public.vehicle_loans
  where id = p_loan_id
  for update;

  if not found then raise exception 'Loan record not found.'; end if;
  if v_loan.borrowed_by_user_id <> v_user_id then raise exception 'You can only return vehicles borrowed by you.'; end if;
  if v_loan.returned_at is not null then raise exception 'This vehicle has already been returned.'; end if;
  if p_end_odometer is not null and (p_end_odometer < 0 or
      (v_loan.start_odometer is not null and p_end_odometer < v_loan.start_odometer)) then
    raise exception 'Return odometer cannot be less than the borrow odometer.';
  end if;

  update public.vehicle_loans
  set end_odometer = p_end_odometer,
      return_notes = p_return_notes,
      returned_at = timezone('utc', now())
  where id = p_loan_id
  returning * into v_loan;

  update public.vehicles
  set status = 'available',
      current_holder_user_id = null,
      location = trim(p_vehicle_location)
  where id = v_loan.vehicle_id;

  return v_loan;
end;
$$;

revoke all on function public.return_vehicle(uuid, integer, text, text) from public;
grant execute on function public.return_vehicle(uuid, integer, text, text) to authenticated;

drop function if exists public.admin_return_vehicle(uuid, uuid, integer, text);

create function public.admin_return_vehicle(
  p_loan_id uuid,
  p_vehicle_id uuid,
  p_end_odometer integer,
  p_return_notes text,
  p_vehicle_location text
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
  if v_admin_id is null or not public.is_admin(v_admin_id) then raise exception 'Admin access required.'; end if;
  if nullif(trim(p_return_notes), '') is null then raise exception 'Please enter an admin return note.'; end if;
  if nullif(trim(p_vehicle_location), '') is null then raise exception 'Please enter the current vehicle location.'; end if;

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
  set status = 'available',
      current_holder_user_id = null,
      location = trim(p_vehicle_location)
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
      'vehicle_location', trim(p_vehicle_location),
      'borrowed_at', v_loan.borrowed_at
    )
  );

  return v_loan;
end;
$$;

revoke all on function public.admin_return_vehicle(uuid, uuid, integer, text, text) from public;
grant execute on function public.admin_return_vehicle(uuid, uuid, integer, text, text) to authenticated;

select pg_notify('pgrst', 'reload schema');
