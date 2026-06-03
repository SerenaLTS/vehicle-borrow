alter table public.vehicle_bookings
add column if not exists borrow_click_reminded_on date;

create index if not exists idx_vehicle_bookings_borrow_click_reminders
on public.vehicle_bookings (starts_at, ends_at, borrow_click_reminded_on);
