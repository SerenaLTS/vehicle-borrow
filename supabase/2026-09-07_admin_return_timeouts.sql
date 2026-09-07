-- Prevent an admin return from waiting indefinitely behind a database lock.
-- The HTTP-side timeout is slightly longer so PostgreSQL can return the useful
-- lock/statement timeout error first.

alter function public.admin_return_vehicle(uuid, uuid, integer, text, text)
  set lock_timeout = '8s';

alter function public.admin_return_vehicle(uuid, uuid, integer, text, text)
  set statement_timeout = '15s';
