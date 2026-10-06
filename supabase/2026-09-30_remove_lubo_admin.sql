-- Remove Lubo from administrator access and the dynamically loaded admin
-- notification recipients. Keep his account and borrowing history intact.
begin;

update public.user_roles
set is_admin = false,
    updated_at = now()
where lower(trim(email)) = 'lubo.pikus@ltsauto.com.au';

-- Verify the resulting role after applying this script in Supabase SQL Editor.
select user_id, email, is_admin
from public.user_roles
where lower(trim(email)) = 'lubo.pikus@ltsauto.com.au';

commit;
