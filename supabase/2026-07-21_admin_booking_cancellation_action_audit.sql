-- Adds admin booking cancellations to the general admin action audit.
-- Also backfills existing admin cancellations without duplicating records.

alter table public.admin_action_audits
drop constraint if exists admin_action_audits_action_type_check;

alter table public.admin_action_audits
add constraint admin_action_audits_action_type_check
check (action_type in ('booking_started_as_borrow', 'vehicle_returned', 'booking_cancelled'));

create or replace function public.audit_admin_booking_cancellation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.cancelled_by_admin then
    insert into public.admin_action_audits (
      action_type,
      admin_user_id,
      admin_email,
      vehicle_id,
      booking_id,
      target_user_id,
      target_email,
      details,
      created_at
    ) values (
      'booking_cancelled',
      new.cancelled_by_user_id,
      new.cancelled_by_email,
      new.vehicle_id,
      new.booking_id,
      new.booked_by_user_id,
      new.booked_by_email,
      jsonb_build_object(
        'vehicle_plate_number', new.vehicle_plate_number,
        'vehicle_model', new.vehicle_model,
        'starts_at', new.starts_at,
        'ends_at', new.ends_at,
        'is_long_term', new.is_long_term,
        'booking_comments', new.booking_comments,
        'cancellation_note', new.cancellation_note
      ),
      new.cancelled_at
    );
  end if;

  return new;
end;
$$;

drop trigger if exists on_admin_booking_cancellation_audit on public.booking_cancellations;
create trigger on_admin_booking_cancellation_audit
after insert on public.booking_cancellations
for each row execute procedure public.audit_admin_booking_cancellation();

insert into public.admin_action_audits (
  action_type,
  admin_user_id,
  admin_email,
  vehicle_id,
  booking_id,
  target_user_id,
  target_email,
  details,
  created_at
)
select
  'booking_cancelled',
  cancellation.cancelled_by_user_id,
  cancellation.cancelled_by_email,
  cancellation.vehicle_id,
  cancellation.booking_id,
  cancellation.booked_by_user_id,
  cancellation.booked_by_email,
  jsonb_build_object(
    'vehicle_plate_number', cancellation.vehicle_plate_number,
    'vehicle_model', cancellation.vehicle_model,
    'starts_at', cancellation.starts_at,
    'ends_at', cancellation.ends_at,
    'is_long_term', cancellation.is_long_term,
    'booking_comments', cancellation.booking_comments,
    'cancellation_note', cancellation.cancellation_note
  ),
  cancellation.cancelled_at
from public.booking_cancellations cancellation
where cancellation.cancelled_by_admin = true
  and not exists (
    select 1
    from public.admin_action_audits audit
    where audit.action_type = 'booking_cancelled'
      and audit.booking_id = cancellation.booking_id
      and audit.created_at = cancellation.cancelled_at
  );
