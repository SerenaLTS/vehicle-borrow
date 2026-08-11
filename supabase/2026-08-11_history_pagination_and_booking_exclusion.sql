create extension if not exists btree_gist;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'vehicle_bookings_no_overlap'
      and conrelid = 'public.vehicle_bookings'::regclass
  ) then
    alter table public.vehicle_bookings
      add constraint vehicle_bookings_no_overlap
      exclude using gist (
        vehicle_id with =,
        (tstzrange(starts_at, coalesce(ends_at, 'infinity'::timestamptz), '[)')) with &&
      );
  end if;
end;
$$;

create or replace function public.search_vehicle_loan_history(
  p_query text default '',
  p_from timestamptz default null,
  p_to_exclusive timestamptz default null,
  p_status text default '',
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  vehicle_id uuid,
  borrowed_by_user_id uuid,
  borrower_email text,
  driver_name text,
  purpose text,
  start_odometer integer,
  end_odometer integer,
  borrow_notes text,
  return_notes text,
  borrowed_at timestamptz,
  expected_return_at timestamptz,
  is_long_term boolean,
  returned_at timestamptz,
  vehicle jsonb,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    l.id,
    l.vehicle_id,
    l.borrowed_by_user_id,
    l.borrower_email,
    l.driver_name,
    l.purpose,
    l.start_odometer,
    l.end_odometer,
    l.borrow_notes,
    l.return_notes,
    l.borrowed_at,
    l.expected_return_at,
    l.is_long_term,
    l.returned_at,
    jsonb_build_object('plate_number', v.plate_number, 'model', v.model) as vehicle,
    count(*) over() as total_count
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
    end
  order by l.borrowed_at desc
  limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
$$;

revoke all on function public.search_vehicle_loan_history(text, timestamptz, timestamptz, text, integer, integer) from public;
grant execute on function public.search_vehicle_loan_history(text, timestamptz, timestamptz, text, integer, integer) to authenticated;

select pg_notify('pgrst', 'reload schema');
