# Regular Maintenance Checklist

Last local check: 2026-05-14

## Current Local Health

- [x] `npm run lint` passes.
- [x] `npm run typecheck` passes.
- [x] `npm run build` passes.
- [x] Production build generated all app routes successfully.
- [ ] Production Vercel runtime logs were not checked locally. Review Vercel logs before closing a maintenance cycle.
- [ ] Supabase production data health was not checked locally. Run the SQL checks below in Supabase.

## Signals To Watch This Week

- Booking key reminders run through `/api/booking-key-reminders`.
- The cron is configured as `0 22 * * *` and `0 23 * * *` in `vercel.json` to cover Sydney 9:00 across daylight saving changes.
- The reminder endpoint checks bookings starting in the next 24 hours and marks each booking with `key_collection_reminded_at` after sending.
- Bookings created or updated before the next Sydney 9:00 reminder run are sent an immediate key collection reminder after the booking is saved.
- Reminder rows are only marked with `key_collection_reminded_at` after an email is actually sent.
- Time display and form conversion are pinned to `Australia/Sydney` in `lib/datetime.ts`, so daylight saving transitions should be part of manual testing around April and October.

## Every Maintenance Cycle

- [ ] Pull the latest production branch and confirm `git status --short` is clean or only has expected local files.
- [ ] Run `npm run lint`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
- [ ] Check Vercel deployment status for the latest production deploy.
- [ ] Check Vercel Function logs for `/borrow`, `/return`, `/book`, `/admin`, and `/api/booking-key-reminders`.
- [ ] Confirm there are no repeated `Unauthorized`, Supabase, SMTP, or redirect-loop errors.
- [ ] Confirm required environment variables exist in Vercel:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `CRON_SECRET`
  - `COMPANY_EMAIL_DOMAIN`
  - `SMTP_HOST`
  - `SMTP_PORT`
  - `SMTP_SECURE`
  - `SMTP_USER`
  - `SMTP_PASS`
  - `SMTP_FROM`
- [ ] Confirm Supabase Auth redirect URLs include the production `/auth/callback` URL.
- [ ] Confirm the Vercel cron route returns JSON with expected `windowStart`, `windowEnd`, `checked`, `sent`, and `failed` fields when called with `Authorization: Bearer <CRON_SECRET>`.
- [ ] Check whether any reminder response contains non-empty `failed`.
- [ ] Confirm SMTP credentials still work by creating or updating a test booking and verifying the email.
- [ ] After the daily reminder time, create a test booking before the next Sydney 9:00 cutoff and confirm the immediate key collection reminder is sent.

## Supabase Data Checks

Run these in Supabase SQL Editor.

```sql
-- Active loans with missing expected return time.
select id, vehicle_id, borrower_email, borrowed_at, expected_return_at
from public.vehicle_loans
where returned_at is null
  and expected_return_at is null;
```

```sql
-- Active loans already past expected return.
select id, vehicle_id, borrower_email, borrowed_at, expected_return_at
from public.vehicle_loans
where returned_at is null
  and expected_return_at < now()
order by expected_return_at asc;
```

```sql
-- Vehicles marked borrowed but without an active loan.
select v.id, v.plate_number, v.model, v.status
from public.vehicles v
where v.status = 'borrowed'
  and not exists (
    select 1
    from public.vehicle_loans l
    where l.vehicle_id = v.id
      and l.returned_at is null
  );
```

```sql
-- Active loans whose vehicle is not marked borrowed.
select l.id, l.vehicle_id, l.borrower_email, l.borrowed_at, v.status
from public.vehicle_loans l
join public.vehicles v on v.id = l.vehicle_id
where l.returned_at is null
  and v.status <> 'borrowed';
```

```sql
-- Future or active bookings that have already been reminded.
select id, vehicle_id, booked_by_email, starts_at, ends_at, key_collection_reminded_at
from public.vehicle_bookings
where ends_at >= now()
order by starts_at asc;
```

```sql
-- Upcoming booking overlaps, should normally be prevented by triggers.
select a.id as booking_a, b.id as booking_b, a.vehicle_id, a.starts_at, a.ends_at, b.starts_at, b.ends_at
from public.vehicle_bookings a
join public.vehicle_bookings b
  on a.vehicle_id = b.vehicle_id
 and a.id < b.id
 and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(b.starts_at, b.ends_at, '[)')
where a.ends_at >= now()
  and b.ends_at >= now();
```

```sql
-- User role rows missing email, which can break admin notification recipients.
select id, user_id, email, is_admin, created_at
from public.user_roles
where email is null
   or trim(email) = '';
```

## Manual Smoke Test

- [ ] Sign in with a normal company-domain user.
- [ ] Open dashboard and confirm current loans/bookings render.
- [ ] Create a future booking.
- [ ] Edit that booking.
- [ ] Cancel a future booking.
- [ ] Borrow an available vehicle with an expected return time.
- [ ] Confirm borrowed vehicle disappears from available list and appears on dashboard/return page.
- [ ] Extend the expected return time.
- [ ] Return the vehicle.
- [ ] Confirm history export downloads and includes the latest loan.
- [ ] Sign in as admin.
- [ ] Confirm admin page loads vehicles, active loans, and bookings.
- [ ] Admin-create a booking for another user.
- [ ] Admin-return an active loan only after confirming vehicle/key return.

## Incident Notes Template

- Date/time:
- User affected:
- Vehicle plate:
- Page/action:
- Error message:
- Vercel log link:
- Supabase row IDs:
- Was email expected:
- Was email received:
- Fix applied:
- Follow-up needed:
