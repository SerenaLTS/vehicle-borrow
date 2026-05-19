alter table public.vehicle_loans
add column if not exists borrow_overdue_reminded_at timestamptz;

create index if not exists idx_vehicle_loans_overdue_reminders
on public.vehicle_loans (expected_return_at)
where returned_at is null
  and is_long_term = false
  and borrow_overdue_reminded_at is null;
