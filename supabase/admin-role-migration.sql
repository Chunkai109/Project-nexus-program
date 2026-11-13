-- SmartPhysio: add the admin role (v1.2.0)
-- =================================================================
-- Run this ONCE in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- It changes nothing that exists: no accounts, exercises or sessions are
-- touched. It is safe to run again.
--
-- What an admin is:
--   • One or two trusted team accounts. An admin signs in on the normal login
--     screen and lands on the Admin page.
--   • An admin can see every account's name, email, role and clinic, across
--     all clinics, and can turn a patient account into a physiotherapist
--     account (or back), and move an account to another clinic.
--   • An admin can NOT see exercises, sessions or any exercise data, and
--     cannot make another admin. Admins are made only here, in the SQL Editor.
--
-- After running this, make your first admin (the account must already
-- exist: create it in the app with "Create account", or under
-- Authentication → Users → Add user):
--
--     select make_admin('you@example.com');
-- =================================================================

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('patient', 'physio', 'admin'));

-- Admins can read every account row. Everyone else keeps the existing rule
-- (your own row; physios also see their clinic's patients).
drop policy if exists "admin reads all profiles" on profiles;
create policy "admin reads all profiles" on profiles
  for select to authenticated
  using (public.my_role() = 'admin');

-- SQL Editor only: turn an existing account into an admin.
create or replace function public.make_admin(user_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set role = 'admin' where lower(email) = lower(user_email);
  if not found then
    raise exception 'No account with email %. Create it first, then run this again.', user_email;
  end if;
end;
$$;
revoke execute on function public.make_admin(text) from public, anon, authenticated;

-- Called from the Admin page. Only an admin can run it; it can only set
-- patient or physio (never admin), and never changes an admin's account.
create or replace function public.admin_set_account(target uuid, new_role text, new_practice text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.my_role() is distinct from 'admin' then
    raise exception 'Only an admin can change accounts.';
  end if;
  if new_role not in ('patient', 'physio') then
    raise exception 'The role must be patient or physio.';
  end if;
  if not exists (select 1 from public.practices where id = new_practice) then
    raise exception 'Unknown clinic %.', new_practice;
  end if;
  update public.profiles
     set role = new_role, practice_id = new_practice
   where id = target and role <> 'admin';
  if not found then
    raise exception 'That account was not found, or it is an admin account.';
  end if;
end;
$$;
revoke execute on function public.admin_set_account(uuid, text, text) from public, anon;
grant execute on function public.admin_set_account(uuid, text, text) to authenticated;
