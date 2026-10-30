-- ============================================================
-- ERSEL — Migration 01: Secure foundation (profiles + roles + RLS)
-- Project: lkqmgidmxgjppsszwlvv (independent, NOT the old project)
-- Safe to re-run. It does NOT drop any table, data or column.
-- It only: strengthens profiles, adds an auto-profile trigger,
-- and (re)ensures RLS + role-protection policies.
-- REVIEW BEFORE RUNNING. Do not run without explicit approval.
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1) Ensure the app_role enum has the values we need.
--    (adds 'employee' used later for staff accounts)
-- ------------------------------------------------------------
alter type public.app_role add value if not exists 'employee';

-- ------------------------------------------------------------
-- 2) Ensure required columns exist on public.profiles.
--    add column if not exists => never overwrites existing data.
-- ------------------------------------------------------------
alter table public.profiles add column if not exists full_name  text        not null default '';
alter table public.profiles add column if not exists phone      text        not null default '';
alter table public.profiles add column if not exists role       public.app_role not null default 'customer';
alter table public.profiles add column if not exists created_at timestamptz not null default now();

-- One account per phone number (empty phone values are ignored).
create unique index if not exists profiles_phone_unique
  on public.profiles (phone) where phone <> '';

-- ------------------------------------------------------------
-- 3) Auto-create a profile row when a new auth user signs up.
--    Role is ALWAYS 'customer' here. Users can never choose it.
--    SECURITY DEFINER lets this run on auth.users insert.
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone, role)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), ''),
    coalesce(nullif(new.raw_user_meta_data->>'phone', ''), ''),
    'customer'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Recreate the trigger idempotently (trigger only; no data touched).
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- 4) Helper: current user's role (used by RLS policies).
-- ------------------------------------------------------------
create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- ------------------------------------------------------------
-- 5) Block role changes unless performed by an admin.
--    (fires on UPDATE so a user can never promote themselves)
-- ------------------------------------------------------------
create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and public.current_app_role() is distinct from 'admin'::public.app_role then
    raise exception 'Only an administrator may change account roles';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role
  before update on public.profiles
  for each row execute function public.protect_profile_role();

-- ------------------------------------------------------------
-- 6) Enable RLS on profiles and define self-only access.
--    (recreated with fixed names to guarantee correct rules)
-- ------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists "profiles read self or admin" on public.profiles;
create policy "profiles read self or admin"
  on public.profiles for select to authenticated
  using (id = auth.uid() or public.current_app_role() = 'admin');

drop policy if exists "profiles update self" on public.profiles;
create policy "profiles update self"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists "admin update profiles" on public.profiles;
create policy "admin update profiles"
  on public.profiles for update to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

-- NOTE: no INSERT policy is granted to users on purpose.
-- Profiles are created only by the SECURITY DEFINER trigger above,
-- so a user cannot insert a row with role = 'admin'.

-- ------------------------------------------------------------
-- 7) Verify (read-only) — run separately if you like
-- ------------------------------------------------------------
-- select policyname, cmd, roles from pg_policies where schemaname='public' and tablename='profiles';
-- select tgname from pg_trigger where tgrelid = 'public.profiles'::regclass and not tgisinternal;
