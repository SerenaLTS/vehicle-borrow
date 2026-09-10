-- Run only against an isolated fixture database after 2026-09-10_vehicle_fine_notices.sql.
-- Assertions raise exceptions, so psql -v ON_ERROR_STOP=1 fails on any regression.
set test.user_id = '11111111-1111-4111-8111-111111111111';
set test.is_admin = 'true';

create function pg_temp.notice_payload(p_id text, p_number text, p_start text, p_end text, p_time text)
returns jsonb language sql as $$
select jsonb_build_object('id', p_id, 'vehicle_id', '22222222-2222-4222-8222-222222222222',
'notice_number',p_number,'occurred_at',p_time,'starts_at',p_start,'ends_at',p_end,
'location','Test road','reason','Parking','amount_cents',12345,'rego','TEST123',
'driver_name','External Driver','driver_email','driver@example.test','requires_licence',true,
'email_subject','Fine TEST123','email_body','Please provide a licence copy.');
$$;

do $$
declare p jsonb; v_id uuid; v_count integer;
begin
  p := pg_temp.notice_payload('33333333-3333-4333-8333-333333333333','N1','2026-01-01T00:00Z','2026-01-01T02:00Z','2026-01-01T01:00Z');
  v_id := public.admin_create_fine_notice(p);
  if not exists(select 1 from public.vehicle_fine_notices where id=v_id and status='draft' and driver_record_id is not null) then raise exception 'Manual save did not create linked draft'; end if;
  perform public.admin_create_fine_notice(p);
  select count(*) into v_count from public.vehicle_driver_history;
  if v_count <> 1 then raise exception 'Repeated request created duplicate history'; end if;

  -- Duplicate notice numbers roll back the new history in the same transaction.
  begin
    perform public.admin_create_fine_notice(pg_temp.notice_payload('44444444-4444-4444-8444-444444444444','n1','2026-01-02T00:00Z','2026-01-02T02:00Z','2026-01-02T01:00Z'));
    raise exception 'Expected duplicate notice rejection';
  exception when unique_violation then null; end;
  select count(*) into v_count from public.vehicle_driver_history;
  if v_count <> 1 then raise exception 'Duplicate notice left orphan history'; end if;

  begin
    perform public.admin_create_fine_notice(pg_temp.notice_payload('55555555-5555-4555-8555-555555555555','N2','2026-01-01T01:00Z','2026-01-01T03:00Z','2026-01-01T02:30Z'));
    raise exception 'Overlap was accepted';
  exception when raise_exception then if sqlerrm not like '%overlaps an existing%' then raise; end if; end;

  begin
    perform public.admin_create_fine_notice(pg_temp.notice_payload('55555555-5555-4555-8555-555555555555','N2','2026-01-03T00:00Z','2026-01-03T02:00Z','2026-01-03T02:00Z'));
    raise exception 'End boundary was accepted';
  exception when raise_exception then if sqlerrm not like '%completed driving period%' then raise; end if; end;

  -- Existing records are reused rather than duplicated.
  p := pg_temp.notice_payload('66666666-6666-4666-8666-666666666666','N3',null,null,'2026-01-01T01:30Z');
  p := p || jsonb_build_object('driver_record_id',(select id from public.vehicle_driver_history limit 1));
  perform public.admin_create_fine_notice(p);
  select count(*) into v_count from public.vehicle_driver_history;
  if v_count <> 1 then raise exception 'Existing record was duplicated'; end if;

  insert into public.vehicle_loans values('77777777-7777-4777-8777-777777777777','22222222-2222-4222-8222-222222222222','2026-01-04T00:00Z','2026-01-04T02:00Z');
  p := pg_temp.notice_payload('88888888-8888-4888-8888-888888888888','N4',null,null,'2026-01-04T01:00Z') || jsonb_build_object('loan_id','77777777-7777-4777-8777-777777777777');
  perform public.admin_create_fine_notice(p);
  if (select count(*) from public.vehicle_driver_history) <> 1 then raise exception 'Loan matching created history'; end if;

  p := p || jsonb_build_object('id','99999999-9999-4999-8999-999999999999','notice_number','N5','occurred_at','2026-01-05T01:00Z');
  begin
    perform public.admin_create_fine_notice(p);
    raise exception 'Wrong-time loan accepted';
  exception when raise_exception then if sqlerrm not like '%no longer covers%' then raise; end if; end;

  perform set_config('test.is_admin','false',true);
  begin
    perform public.admin_create_fine_notice(p);
    raise exception 'Non-admin write accepted';
  exception when raise_exception then if sqlerrm <> 'Admin access required.' then raise; end if; end;
end;
$$;

set role authenticated;
set test.is_admin = 'false';
do $$ begin
  if (select count(*) from public.vehicle_fine_notices) <> 0 then raise exception 'Non-admin can read fines'; end if;
  if (select count(*) from public.vehicle_driver_history) <> 0 then raise exception 'Non-admin can read driving history'; end if;
end $$;
set test.is_admin = 'true';
do $$ begin
  if (select count(*) from public.vehicle_fine_notices) <> 3 then raise exception 'Admin cannot read fines'; end if;
  if has_table_privilege(current_user,'public.vehicle_fine_notices','UPDATE') then raise exception 'Direct authenticated updates allowed'; end if;
end $$;
reset role;
select 'Fine transaction, matching, duplicate and RLS assertions passed' as result;
