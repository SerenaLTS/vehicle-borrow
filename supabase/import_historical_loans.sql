-- Historical vehicle loan import
-- Assumptions used in this file:
-- 1. `JACUTE` is treated as `T9UTE`.
-- 2. `18/12/25 10+E23:30am` is treated as `2025-12-18 10:30`.
-- 3. If only a date is provided for borrowed_at, it defaults to 9:00 AM local time.
-- 4. If only a date is provided for returned_at, it defaults to 5:00 PM local time.
-- 5. If borrowed_at is blank and returned_at has a date, borrowed_at defaults to the same date at 9:00 AM.
-- 6. Blank driver values fall back to borrower_email.
-- 7. Blank purpose values fall back to `Historical record`.

with raw_rows (plate_number, borrower_email, driver_name, purpose, borrowed_at, returned_at, start_odometer, end_odometer) as (
  values
    ('FDI80U', 'tim@ltsauto.com.au', null, 'supplier', '2026-03-10 15:00:00+11', '2026-03-11 09:00:00+11', 37407, 37466),
    ('FDI80U', 'jason.davies@ltsauto.com.au', null, 'drive car', '2026-03-23 09:00:00+11', null, null, null),
    ('FZK92K', 'lubo.pikus@ltsauto.com.au', null, 'test', '2026-03-20 14:00:00+11', '2026-03-23 09:00:00+11', 1525, 1640),
    ('FZK92K', 'li@ltsauto.com.au', null, 'test', '2026-03-23 09:30:00+11', '2026-03-23 12:00:00+11', 1640, null),
    ('FWA79M', 'hong@ltsauto.com.au', null, 'testing', '2025-11-28 09:00:00+11', '2025-11-28 17:00:00+11', null, null),
    ('FWA79M', 'michael@ltsauto.com.au', null, 'testing', '2025-11-28 09:00:00+11', '2025-12-01 17:00:00+11', null, null),
    ('FWA79M', 'hong@ltsauto.com.au', null, 'testing', '2025-12-01 09:00:00+11', '2025-12-01 17:00:00+11', null, null),
    ('FWA79M', 'catriona.piper@ltsauto.com.au', null, 'hunter reveal', '2026-03-25 08:00:00+11', '2026-03-25 14:00:00+11', null, null),
    ('FWA79M', 'dilly.alemseged@ltsauto.com.au', null, 'mms display', '2026-03-27 09:00:00+11', null, null, null),
    ('FWF88F', 'dilly.alemseged@ltsauto.com.au', null, 'collect mkt', '2025-11-20 13:50:00+11', '2025-11-20 15:00:00+11', 447, 459),
    ('FWF88F', 'dilly.alemseged@ltsauto.com.au', null, 'BBQ', '2025-11-20 15:41:00+11', '2025-11-21 14:00:00+11', 459, 486),
    ('FWF88F', 'ahmed@ltsauto.com.au', null, null, '2025-11-12 17:00:00+11', '2025-11-24 09:00:00+11', 486, 702),
    ('FWF88F', 'dilly.alemseged@ltsauto.com.au', null, 'built popup', '2025-11-27 09:15:00+11', '2025-11-27 14:00:00+11', 702, 798),
    ('FWF88F', 'jade@ltsauto.com.au', null, 'built popup', '2025-11-27 14:20:00+11', '2025-11-28 14:00:00+11', 798, 820),
    ('FWF88F', 'jade@ltsauto.com.au', null, 'take to msr', '2025-12-03 10:00:00+11', '2025-12-03 17:00:00+11', 820, 836),
    ('FWF88F', 'dilly.alemseged@ltsauto.com.au', null, 'dragons launch', '2025-12-17 13:30:00+11', '2025-12-17 17:15:00+11', 1836, 1989),
    ('FWF88F', 'dilly.alemseged@ltsauto.com.au', null, 'built xmas', '2025-12-18 10:30:00+11', '2025-12-18 15:00:00+11', 1989, 2021),
    ('FWG16E', 'hong@ltsauto.com.au', null, 'test', '2025-11-26 16:50:00+11', '2025-11-28 14:39:00+11', null, null),
    ('FWG16E', 'jade@ltsauto.com.au', null, 'wrap', '2025-12-01 09:00:00+11', '2025-12-03 17:00:00+11', null, null),
    ('FWG16E', 'hong@ltsauto.com.au', null, 'regular test', '2025-12-03 14:00:00+11', '2025-12-03 17:00:00+11', null, null),
    ('T9UTE', 'fero.farag@ltsauto.com.au', null, 'test drive', '2026-01-13 09:00:00+11', '2026-01-13 17:00:00+11', null, null),
    ('T9UTE', 'li@ltsauto.com.au', null, 'temp loaw', '2026-02-20 12:55:00+11', null, null, null)
),
resolved_rows as (
  select
    r.plate_number as source_plate_number,
    v.id as vehicle_id,
    u.id as borrowed_by_user_id,
    r.borrower_email,
    coalesce(nullif(r.driver_name, ''), r.borrower_email) as driver_name,
    coalesce(nullif(r.purpose, ''), 'Historical record') as purpose,
    r.borrowed_at::timestamptz as borrowed_at,
    r.returned_at::timestamptz as returned_at,
    r.start_odometer,
    r.end_odometer
  from raw_rows r
  left join public.vehicles v
    on upper(regexp_replace(v.plate_number, '[^A-Z0-9]', '', 'g')) = upper(regexp_replace(r.plate_number, '[^A-Z0-9]', '', 'g'))
  left join auth.users u
    on lower(u.email) = lower(r.borrower_email)
),
missing_matches as (
  select *
  from resolved_rows
  where vehicle_id is null or borrowed_by_user_id is null
),
inserted_rows as (
  insert into public.vehicle_loans (
    vehicle_id,
    borrowed_by_user_id,
    borrower_email,
    driver_name,
    purpose,
    start_odometer,
    end_odometer,
    borrowed_at,
    returned_at
  )
  select
    vehicle_id,
    borrowed_by_user_id,
    borrower_email,
    driver_name,
    purpose,
    start_odometer,
    end_odometer,
    borrowed_at,
    returned_at
  from resolved_rows r
  where vehicle_id is not null
    and borrowed_by_user_id is not null
    and not exists (
      select 1
      from public.vehicle_loans existing
      where existing.vehicle_id = r.vehicle_id
        and existing.borrowed_by_user_id = r.borrowed_by_user_id
        and existing.borrowed_at = r.borrowed_at
        and existing.purpose = r.purpose
    )
  returning vehicle_id, borrowed_by_user_id, returned_at, borrowed_at
),
latest_active_loans as (
  select distinct on (vehicle_id)
    vehicle_id,
    borrowed_by_user_id
  from public.vehicle_loans
  where returned_at is null
  order by vehicle_id, borrowed_at desc
)
update public.vehicles v
set status = 'borrowed',
    current_holder_user_id = l.borrowed_by_user_id
from latest_active_loans l
where v.id = l.vehicle_id;

select *
from missing_matches;
