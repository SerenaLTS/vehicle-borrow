create or replace function public.extend_vehicle_loan(
  p_loan_id uuid,
  p_expected_return_at timestamptz,
  p_extension_reason text
)
returns public.vehicle_loans
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_loan public.vehicle_loans;
  v_now timestamptz := timezone('utc', now());
  v_extension_note text;
begin
  if v_user_id is null then
    raise exception 'You must be logged in to extend a borrow.';
  end if;

  if p_expected_return_at is null or p_expected_return_at <= v_now then
    raise exception 'Please choose a valid new expected return time.';
  end if;

  if nullif(trim(p_extension_reason), '') is null then
    raise exception 'Please enter a reason for the extension.';
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
    raise exception 'You can only extend vehicles borrowed by you.';
  end if;

  if v_loan.returned_at is not null then
    raise exception 'This vehicle has already been returned.';
  end if;

  if v_loan.expected_return_at is not null and p_expected_return_at <= v_loan.expected_return_at then
    raise exception 'Please choose a return time later than the current expected return time.';
  end if;

  if exists (
    select 1
    from public.vehicle_bookings b
    where b.vehicle_id = v_loan.vehicle_id
      and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(v_loan.borrowed_at, p_expected_return_at, '[)')
  ) then
    raise exception 'Extend failed: this vehicle is booked during the requested extension period.';
  end if;

  v_extension_note := concat(
    'Extension requested at ',
    to_char(v_now, 'YYYY-MM-DD HH24:MI:SS TZ'),
    ': expected return extended to ',
    to_char(p_expected_return_at, 'YYYY-MM-DD HH24:MI:SS TZ'),
    '. Reason: ',
    trim(p_extension_reason)
  );

  update public.vehicle_loans
  set expected_return_at = p_expected_return_at,
      borrow_notes = case
        when nullif(trim(coalesce(borrow_notes, '')), '') is null then v_extension_note
        else concat(borrow_notes, E'\n\n', v_extension_note)
      end
  where id = p_loan_id
  returning *
  into v_loan;

  return v_loan;
end;
$$;

grant execute on function public.extend_vehicle_loan(uuid, timestamptz, text) to authenticated;

notify pgrst, 'reload schema';
