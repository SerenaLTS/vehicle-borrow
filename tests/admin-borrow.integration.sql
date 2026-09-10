-- Run after tests/fixtures/admin-borrow-schema.sql and the admin assignment migration.
set test.user_id = '11111111-1111-4111-8111-111111111111';
set role authenticated;
do $$ declare loan public.vehicle_loans; begin
  loan := public.admin_borrow_vehicle('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','Client visit',100,null,now()+interval '2 hours',false);
  if loan.borrowed_by_user_id <> '22222222-2222-4222-8222-222222222222' or loan.borrower_email <> 'employee@company.test' or loan.driver_name <> 'Employee Name' then raise exception 'Wrong employee identity'; end if;
  if loan.assigned_by_admin_user_id <> auth.uid() then raise exception 'Missing admin attribution'; end if;
  if (select current_holder_user_id from public.vehicles where id=loan.vehicle_id) <> loan.borrowed_by_user_id then raise exception 'Wrong current holder'; end if;
  begin
    perform public.admin_borrow_vehicle(loan.vehicle_id,loan.borrowed_by_user_id,'Duplicate',null,null,null,true);
    raise exception 'Duplicate active loan accepted';
  exception when raise_exception then if sqlerrm not like '%not currently available%' then raise; end if; end;
end $$;
set test.user_id = '22222222-2222-4222-8222-222222222222';
do $$ begin
  if (select count(*) from public.vehicle_loans where borrowed_by_user_id=auth.uid() and returned_at is null) <> 1 then raise exception 'Employee dashboard query cannot see assignment'; end if;
  begin
    perform public.admin_borrow_vehicle('44444444-4444-4444-8444-444444444444',auth.uid(),'Forged assignment',null,null,null,true);
    raise exception 'Non-admin assignment accepted';
  exception when raise_exception then if sqlerrm <> 'Admin access required.' then raise; end if; end;
end $$;
reset role;
insert into public.vehicle_bookings(vehicle_id,starts_at,ends_at) values ('44444444-4444-4444-8444-444444444444',now()+interval '1 hour',now()+interval '3 hours');
set test.user_id = '11111111-1111-4111-8111-111111111111';
set role authenticated;
do $$ begin
  if (select count(*) from public.vehicle_loans where borrowed_by_user_id=auth.uid()) <> 0 then raise exception 'Loan incorrectly belongs to admin'; end if;
  begin
    perform public.admin_borrow_vehicle('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','Overlap',null,null,now()+interval '2 hours',false);
    raise exception 'Booking conflict accepted';
  exception when raise_exception then if sqlerrm not like '%already booked%' then raise; end if; end;
  begin
    perform public.admin_borrow_vehicle('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','Long term overlap',null,null,null,true);
    raise exception 'Long term conflict accepted';
  exception when raise_exception then if sqlerrm not like '%upcoming booking%' then raise; end if; end;
  begin
    perform public.admin_borrow_vehicle('44444444-4444-4444-8444-444444444444','99999999-9999-4999-8999-999999999999','Missing user',null,null,null,true);
    raise exception 'Missing employee accepted';
  exception when raise_exception then if sqlerrm not like '%Employee account not found%' then raise; end if; end;
end $$;
reset role;
delete from public.vehicle_bookings;
update public.vehicles set status='deregistered' where id='44444444-4444-4444-8444-444444444444';
set role authenticated;
do $$ begin
  begin
    perform public.admin_borrow_vehicle('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','Inactive vehicle',null,null,null,true);
    raise exception 'Inactive vehicle accepted';
  exception when raise_exception then if sqlerrm not like '%not currently available%' then raise; end if; end;
end $$;
reset role;
select 'Admin assignment, employee visibility, conflicts and permissions passed' as result;
