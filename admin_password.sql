-- Canyon Activities Board Timesheet — keep the staff (admin) password private
-- Run this once in the Supabase SQL editor. It is safe to re-run.
--
-- Before this, the password sat in plain text in the `settings` table, which anyone
-- holding the app's publishable key can read (the app even downloaded it on page load).
--
-- This script:
--   1. Moves the password into its own table, `admin_secret`, stored only as a bcrypt
--      hash. The table has row level security on and no policies, so the publishable
--      key can neither read nor write it.
--   2. Adds two functions the app calls instead:
--        verify_admin_password(pass)               -> true/false
--        set_admin_password(current_pass, new_pass) -> true/false (false = wrong current)
--      They run with the table owner's rights, so they're the only way in.
--   3. Removes the old plain-text `AdminPassword` row from `settings`.
--
-- The existing password keeps working. Because it was readable until now, change it
-- from the admin settings after running this (or set one directly with the statement
-- at the bottom of this file).

create extension if not exists pgcrypto with schema extensions;

create table if not exists admin_secret (
  id            int primary key default 1 check (id = 1),
  password_hash text not null
);

alter table admin_secret enable row level security;
revoke all on admin_secret from anon, authenticated;

-- 1. Carry over the current password (hashed), then drop the plain-text copy.
insert into admin_secret (id, password_hash)
select 1, extensions.crypt(value, extensions.gen_salt('bf'))
from settings
where key = 'AdminPassword' and coalesce(value, '') <> ''
on conflict (id) do nothing;

delete from settings where key = 'AdminPassword';

-- 2. The only ways the app can touch the password.
create or replace function public.verify_admin_password(pass text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from admin_secret
    where id = 1 and password_hash = extensions.crypt(coalesce(pass, ''), password_hash)
  );
$$;

create or replace function public.set_admin_password(current_pass text, new_pass text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if coalesce(new_pass, '') = '' then
    raise exception 'New password is empty';
  end if;
  if not public.verify_admin_password(current_pass) then
    return false;
  end if;
  update admin_secret
     set password_hash = extensions.crypt(new_pass, extensions.gen_salt('bf'))
   where id = 1;
  return true;
end;
$$;

revoke all on function public.verify_admin_password(text)     from public;
revoke all on function public.set_admin_password(text, text)  from public;
grant execute on function public.verify_admin_password(text)    to anon, authenticated;
grant execute on function public.set_admin_password(text, text) to anon, authenticated;

-- To set (or reset) the password directly, uncomment, fill in, and run:
-- insert into admin_secret (id, password_hash)
-- values (1, extensions.crypt('YOUR NEW PASSWORD', extensions.gen_salt('bf')))
-- on conflict (id) do update set password_hash = excluded.password_hash;
