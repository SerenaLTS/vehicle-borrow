create or replace function public.count_vehicle_loan_history(
  p_query text default '',
  p_from timestamptz default null,
  p_to_exclusive timestamptz default null,
  p_status text default ''
)
returns bigint
language sql
stable
security invoker
set search_path = public
as $$
  select count(*)
  from public.vehicle_loans l
  join public.vehicles v on v.id = l.vehicle_id
  where
    (p_from is null or l.borrowed_at >= p_from)
    and (p_to_exclusive is null or l.borrowed_at < p_to_exclusive)
    and (
      nullif(trim(p_query), '') is null
      or concat_ws(' ', v.plate_number, v.model, l.borrower_email, l.driver_name, l.purpose, l.borrow_notes, l.return_notes)
        ilike '%' || trim(p_query) || '%'
    )
    and case p_status
      when 'active' then l.returned_at is null
      when 'returned' then l.returned_at is not null
      when 'long-term' then l.is_long_term = true
      when 'overdue' then l.returned_at is null and l.is_long_term = false and l.expected_return_at < now()
      when 'admin-returned' then l.return_notes ilike '%admin return by%'
      else true
    end;
$$;

revoke all on function public.count_vehicle_loan_history(text, timestamptz, timestamptz, text) from public;
grant execute on function public.count_vehicle_loan_history(text, timestamptz, timestamptz, text) to authenticated;

select pg_notify('pgrst', 'reload schema');
