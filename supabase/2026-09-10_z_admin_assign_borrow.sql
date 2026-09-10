-- Admin-initiated borrows belong to the assigned employee; retain the administrator separately.
begin;
alter table public.vehicle_loans add column if not exists assigned_by_admin_user_id uuid references auth.users(id) on delete set null;

create or replace function public.admin_borrow_vehicle(
  p_vehicle_id uuid,
  p_borrower_user_id uuid,
  p_purpose text,
  p_start_odometer integer default null,
  p_borrow_notes text default null,
  p_expected_return_at timestamptz default null,
  p_long_term boolean default false
)
returns public.vehicle_loans
language plpgsql
security definer
set search_path = public
set lock_timeout = '8s'
set statement_timeout = '15s'
as $$
declare
  v_admin_id uuid := auth.uid();
  v_user_id uuid := p_borrower_user_id;
  v_email text;
  v_driver_name text;
  v_vehicle public.vehicles;
  v_loan public.vehicle_loans;
  v_now timestamptz := timezone('utc', now());
begin
  if v_admin_id is null or not public.is_admin() then
    raise exception 'Admin access required.';
  end if;
  select u.email, coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'), ''), u.email)
  into v_email, v_driver_name
  from auth.users u join public.user_roles r on r.user_id = u.id
  where u.id = v_user_id and u.deleted_at is null and (u.banned_until is null or u.banned_until <= now());
  if not found or nullif(trim(v_email), '') is null then
    raise exception 'Employee account not found or unavailable.';
  end if;
  if nullif(trim(p_purpose), '') is null or p_long_term is null or p_start_odometer < 0 then
    raise exception 'Please complete all required fields.';
  end if;

  if (not p_long_term) and (p_expected_return_at is null or p_expected_return_at <= v_now) then
    raise exception 'Please choose a valid expected return time.';
  end if;

  if p_long_term and p_expected_return_at is not null then
    raise exception 'Long term borrows must not have an expected return time.';
  end if;

  select *
  into v_vehicle
  from public.vehicles
  where id = p_vehicle_id
  for update;

  if not found then
    raise exception 'Vehicle not found.';
  end if;

  if v_vehicle.status in ('in_transit','repair','maintenance','suspended','employee_car','deregistered','sold','retired') or v_vehicle.current_holder_user_id is not null then
    raise exception 'This vehicle is not currently available.';
  end if;

  if exists (select 1 from public.vehicle_loans where vehicle_id = p_vehicle_id and returned_at is null) then
    raise exception 'This vehicle is currently borrowed.';
  end if;

  if not p_long_term and exists (
    select 1
    from public.vehicle_bookings b
    where b.vehicle_id = p_vehicle_id
      and tstzrange(b.starts_at, case when b.is_long_term then 'infinity'::timestamptz else b.ends_at end, '[)') && tstzrange(v_now, p_expected_return_at, '[)')
  ) then
    raise exception 'This vehicle is already booked during the selected period.';
  end if;

  if p_long_term and exists (
    select 1
    from public.vehicle_bookings b
    where b.vehicle_id = p_vehicle_id
      and (b.is_long_term = true or b.ends_at > v_now)
  ) then
    raise exception 'This vehicle already has an active or upcoming booking.';
  end if;

  insert into public.vehicle_loans (
    vehicle_id,
    assigned_by_admin_user_id,
    borrowed_by_user_id,
    borrower_email,
    driver_name,
    purpose,
    start_odometer,
    borrow_notes,
    expected_return_at,
    is_long_term
  )
  values (
    p_vehicle_id,
    v_admin_id,
    v_user_id,
    coalesce(v_email, ''),
    v_driver_name,
    p_purpose,
    p_start_odometer,
    case
      when p_long_term and nullif(trim(coalesce(p_borrow_notes, '')), '') is null then 'Long term borrow.'
      when p_long_term then concat('Long term borrow.', E'\n\n', p_borrow_notes)
      else p_borrow_notes
    end,
    case when p_long_term then null else p_expected_return_at end,
    p_long_term
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

revoke all on function public.admin_borrow_vehicle(uuid, uuid, text, integer, text, timestamptz, boolean) from public, anon;
grant execute on function public.admin_borrow_vehicle(uuid, uuid, text, integer, text, timestamptz, boolean) to authenticated;

select pg_notify('pgrst', 'reload schema');
commit;
