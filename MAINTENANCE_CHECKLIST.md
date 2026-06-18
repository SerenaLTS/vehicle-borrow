# Regular Maintenance Checklist

Last local check: 2026-05-14

Use this checklist for both local/offline checks and production/online checks. A full maintenance cycle should cover the local code health, Vercel production health, Supabase configuration, Supabase data health, email/reminder behavior, and one manual smoke test.

## Maintenance Schedule

- [ ] Daily or every active business day: Check Vercel production logs for errors, check overdue active loans, and confirm no vehicle status mismatch.
- [ ] Weekly: Run the full local code health checks, Vercel checks, Supabase data checks, and one manual smoke test.
- [ ] Monthly: Confirm environment variables, Supabase Auth redirect URLs, cron schedules, SMTP credentials, and daylight-saving-sensitive reminder timing.
- [ ] After any booking, borrow, return, admin, email, or schema change: Run the full checklist before considering the change stable.

## Current Local Health

- [x] `npm run lint` passes.
- [x] `npm run typecheck` passes.
- [x] `npm run build` passes.
- [x] Production build generated all app routes successfully.
- [ ] Production Vercel runtime logs were checked.
- [ ] Supabase production data health was checked.
- [ ] Manual smoke test was completed in production.

## Local Code Checks

Run these from the project folder.

- [ ] Pull the latest production branch.
- [ ] Confirm `git status --short` is clean or only has expected local changes.
- [ ] Run `npm run lint`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
- [ ] Confirm the build includes these important routes:
  - `/dashboard`
  - `/borrow`
  - `/return`
  - `/book`
  - `/admin`
  - `/history`
  - `/api/booking-key-reminders`
- [ ] Confirm no generated cache file, such as `tsconfig.tsbuildinfo`, is left as an unintended change.

## Vercel Production Checks

Open the Vercel project dashboard for `vehicle-usage-management`.

- [ ] Check the latest Production deployment is `Ready`.
- [ ] Open the latest deployment and confirm there are no build errors.
- [ ] Open Logs and filter to Production.
- [ ] Confirm there are no repeated `Warning`, `Error`, or `Fatal` logs.
- [ ] Confirm there are no repeated `500`, `401`, `403`, or redirect-loop responses.
- [ ] Check request paths:
  - `/dashboard`
  - `/borrow`
  - `/return`
  - `/book`
  - `/admin`
  - `/history`
  - `/history/export`
  - `/api/booking-key-reminders`
- [ ] Search logs for these terms:
  - `Unauthorized`
  - `Missing SUPABASE_SERVICE_ROLE_KEY`
  - `Missing Supabase environment variables`
  - `Supabase`
  - `SMTP`
  - `Failed to send`
  - `redirect`
- [ ] Ignore normal `304 Not Modified` responses unless they are attached to another error. `304` usually means browser/Vercel cache is working.

## Vercel Cron Checks

The reminder endpoint is `/api/booking-key-reminders`.

- [ ] Confirm `vercel.json` still contains both cron entries:
  - `0 22 * * *`
  - `0 23 * * *`
- [ ] Confirm these schedules are still intended to cover Sydney 9:00 across daylight saving changes.
- [ ] In Vercel Logs, filter or search for `/api/booking-key-reminders`.
- [ ] Confirm recent cron requests return `200` or a normal skipped response when outside the Sydney 9:00 hour.
- [ ] Confirm the cron response contains:
  - `windowStart`
  - `windowEnd`
  - `bookingKeyReminders`
  - `bookingBorrowReminders`
  - `borrowOverdueReminders`
- [ ] Confirm each reminder result group includes:
  - `checked`
  - `sent`
  - `failed`
- [ ] Confirm every `failed` array is empty.

## Vercel Environment Variables

These do not need to be checked daily, but should be checked monthly and after deployment/configuration changes.

- [ ] Confirm required Production variables exist:
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
- [ ] If the environment variable UI is hard to find, do not block urgent checks. Confirm the website works, then prioritize Vercel logs and Supabase data health.
- [ ] If `/api/booking-key-reminders` returns `401`, re-check `CRON_SECRET`.
- [ ] If `/api/booking-key-reminders` returns a service role error, re-check `SUPABASE_SERVICE_ROLE_KEY`.
- [ ] If booking/borrow actions work but no email arrives, re-check SMTP variables.

## Supabase Configuration Checks

Open the Supabase project dashboard.

- [ ] Confirm the project is the expected Production Supabase project.
- [ ] Confirm Supabase Auth email/password sign-in is enabled.
- [ ] Confirm Supabase Auth `Site URL` is the production Vercel domain.
- [ ] Confirm Supabase Auth redirect URLs include:
  - `http://localhost:3000/auth/callback`
  - the production `/auth/callback` URL
- [ ] Confirm `user_roles` contains the expected admin users.
- [ ] Confirm no admin user has a missing or blank email.

## Supabase Data Checks

Run these in Supabase SQL Editor against the Production database.

```sql
-- Active loans with missing expected return time.
-- Results are acceptable only when every returned row is an intentional long-term loan.
select id, vehicle_id, borrower_email, borrowed_at, expected_return_at, is_long_term
from public.vehicle_loans
where returned_at is null
  and expected_return_at is null;
```

```sql
-- Active loans already past expected return.
-- Results are not always system errors, but they need operational follow-up.
select id, vehicle_id, borrower_email, borrowed_at, expected_return_at
from public.vehicle_loans
where returned_at is null
  and expected_return_at < now()
order by expected_return_at asc;
```

```sql
-- Vehicles marked or held as borrowed but without an active loan.
-- Expected result: 0 rows.
select v.id, v.plate_number, v.model, v.status, v.current_holder_user_id
from public.vehicles v
where (v.status = 'borrowed' or v.current_holder_user_id is not null)
  and not exists (
    select 1
    from public.vehicle_loans l
    where l.vehicle_id = v.id
      and l.returned_at is null
  );
```

```sql
-- Active loans whose vehicle is not marked borrowed.
-- Expected result: 0 rows.
select l.id, l.vehicle_id, l.borrower_email, l.borrowed_at, v.status, v.current_holder_user_id
from public.vehicle_loans l
join public.vehicles v on v.id = l.vehicle_id
where l.returned_at is null
  and (v.status <> 'borrowed' or v.current_holder_user_id is null);
```

```sql
-- Future or active bookings that have already been reminded.
-- Review this for reasonableness; it is not expected to be 0 rows.
select id, vehicle_id, booked_by_email, starts_at, ends_at, is_long_term, key_collection_reminded_at, borrow_click_reminded_on
from public.vehicle_bookings
where is_long_term = true
   or ends_at >= now()
order by starts_at asc;
```

```sql
-- Upcoming booking overlaps, should normally be prevented by triggers.
-- Expected result: 0 rows.
select a.id as booking_a, b.id as booking_b, a.vehicle_id, a.starts_at, a.ends_at, b.starts_at, b.ends_at
from public.vehicle_bookings a
join public.vehicle_bookings b
  on a.vehicle_id = b.vehicle_id
 and a.id < b.id
 and tstzrange(a.starts_at, case when a.is_long_term then 'infinity'::timestamptz else a.ends_at end, '[)')
     && tstzrange(b.starts_at, case when b.is_long_term then 'infinity'::timestamptz else b.ends_at end, '[)')
where (a.is_long_term = true or a.ends_at >= now())
  and (b.is_long_term = true or b.ends_at >= now());
```

```sql
-- User role rows missing email, which can break admin notification recipients.
-- Expected result: 0 rows.
select user_id, email, is_admin, created_at
from public.user_roles
where email is null
   or trim(email) = '';
```

## Email And Reminder Checks

- [ ] Create or update a test booking and confirm the booking notification email is received.
- [ ] Create or update a booking before the next Sydney 9:00 cutoff and confirm the immediate key collection reminder is received when expected.
- [ ] Confirm reminder rows are only marked with `key_collection_reminded_at` after an email is actually sent.
- [ ] Confirm booking borrow reminders do not repeatedly send more than once per Sydney date.
- [ ] Confirm overdue borrow reminders are sent only once until the loan is extended or otherwise updated.
- [ ] Check spam/junk if emails are missing.
- [ ] If no email arrives, check Vercel logs for SMTP errors before changing application code.

## Manual Smoke Test

Run this in Production after a release or during a weekly maintenance cycle.

- [ ] Sign in with a normal company-domain user.
- [ ] Open dashboard and confirm current loans/bookings render.
- [ ] Create a future booking.
- [ ] Edit that booking.
- [ ] Cancel a future booking.
- [ ] Borrow an available vehicle with an expected return time.
- [ ] Confirm borrowed vehicle disappears from the available list.
- [ ] Confirm borrowed vehicle appears on dashboard and return page.
- [ ] Extend the expected return time.
- [ ] Return the vehicle.
- [ ] Confirm history shows the latest loan.
- [ ] Confirm history CSV export downloads.
- [ ] Sign in as admin.
- [ ] Confirm admin page loads vehicles, active loans, bookings, and overdue counts.
- [ ] Admin-create a booking for another user.
- [ ] Admin-edit that booking.
- [ ] Admin-cancel that booking.
- [ ] Admin-return an active loan only after confirming vehicle/key return.

## If A Vehicle Looks Available But Cannot Be Borrowed

Run this SQL first.

```sql
select v.id, v.plate_number, v.model, v.status, v.current_holder_user_id
from public.vehicles v
where (v.status = 'borrowed' or v.current_holder_user_id is not null)
  and not exists (
    select 1
    from public.vehicle_loans l
    where l.vehicle_id = v.id
      and l.returned_at is null
  );
```

If the row is confirmed as stale and the vehicle is physically available, fix it with:

```sql
update public.vehicles
set status = 'available',
    current_holder_user_id = null
where id = '<vehicle_id>'
  and not exists (
    select 1
    from public.vehicle_loans l
    where l.vehicle_id = vehicles.id
      and l.returned_at is null
  );
```

After the fix, refresh the app and rerun the vehicle mismatch SQL. Expected result: 0 rows.

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
