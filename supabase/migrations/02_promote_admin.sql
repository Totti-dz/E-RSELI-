-- ============================================================
-- ERSEL — Migration 02: Grant admin role to the founder account
-- Project: lkqmgidmxgjppsszwlvv
-- Safe to re-run. No data is deleted.
--
-- PART A fixes the role-protection trigger so trusted server-side
-- operations (SQL Editor / service role, where auth.uid() is NULL)
-- can change roles, while logged-in normal users still cannot
-- promote themselves.
--
-- PART B promotes ONE account (matched by its email) to admin.
--
-- REVIEW BEFORE RUNNING. Do not run without explicit approval.
-- ============================================================

-- ---------- PART A: restrict only end-user (session) context
create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null
     and public.current_app_role() is distinct from 'admin'::public.app_role then
    raise exception 'Only an administrator may change account roles';
  end if;
  return new;
end;
$$;

-- ---------- PART B: promote the founder account to admin
-- Creates the profile row if missing, otherwise updates the role.
-- Role is set only from a trusted SQL context (never from the browser).
insert into public.profiles (id, full_name, phone, role)
select
  u.id,
  coalesce(nullif(u.raw_user_meta_data->>'full_name', ''), ''),
  coalesce(nullif(u.raw_user_meta_data->>'phone', ''), ''),
  'admin'::public.app_role
from auth.users u
where lower(u.email) = lower('condorplum9@gmail.com')
on conflict (id) do update set role = 'admin'::public.app_role;

-- ---------- VERIFY (read-only result; run and check output)
select p.id, p.full_name, p.phone, p.role, u.email
from public.profiles p
join auth.users u on u.id = p.id
where lower(u.email) = lower('condorplum9@gmail.com');
