-- ============================================================
-- ERSEL — Proposal 06: Courier join applications
-- Project: lkqmgidmxgjppsszwlvv
-- Status: PROPOSAL ONLY. Do not run until the founder approves.
--
-- PURPOSE
--   Let an authenticated customer submit one join request to work as a
--   courier. The request stays pending until an admin reviews it.
--   Approval is the only path that may set courier_profiles.is_verified
--   and profiles.role = 'courier'. The browser never writes those fields.
--
-- WHY A NEW TABLE
--   Live courier_profiles (probed, not assumed from schema.sql) has:
--     user_id, vehicle, city, is_verified, is_available,
--     license_storage_path, identity_storage_path, created_at
--   It does NOT have name, age, plate, application status, or review
--   metadata. Existing INSERT/UPDATE policies on courier_profiles allow
--   a user to write their own row, including is_verified, so that table
--   must NOT be used as the application form.
--
-- SAFETY
--   * Additive: new enum, table, indexes, functions, policies.
--   * Does not drop tables, rows, or existing policies.
--   * Does not grant service_role to the browser.
--   * Does not create Storage buckets or document upload.
--   * Does not auto-promote anyone to admin.
--
-- ROLLBACK is at the bottom.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Application status
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'courier_application_status') then
    create type public.courier_application_status as enum ('pending', 'approved', 'rejected');
  end if;
end $$;

-- ------------------------------------------------------------
-- 2) Applications table — one row per user
-- ------------------------------------------------------------
create table if not exists public.courier_applications (
  user_id           uuid primary key references public.profiles(id) on delete cascade,
  first_name        text not null,
  last_name         text not null,
  phone             text not null,
  age_years         integer not null check (age_years between 18 and 80),
  vehicle           public.vehicle_type not null,
  vehicle_make      text not null default '',
  vehicle_model     text not null default '',
  vehicle_plate     text not null default '',
  city              text not null default 'السوقر',
  status            public.courier_application_status not null default 'pending',
  rejection_reason  text not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  reviewed_at       timestamptz,
  reviewed_by       uuid references public.profiles(id) on delete set null,
  constraint courier_applications_names_chk
    check (char_length(btrim(first_name)) between 2 and 40
       and char_length(btrim(last_name)) between 2 and 40),
  constraint courier_applications_phone_chk
    check (phone ~ '^\+213[5-7][0-9]{8}$'),
  constraint courier_applications_city_chk
    check (char_length(btrim(city)) between 2 and 60)
);

create index if not exists courier_applications_status_idx
  on public.courier_applications (status, created_at desc);

create or replace function public.courier_applications_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists courier_applications_set_updated_at on public.courier_applications;
create trigger courier_applications_set_updated_at
  before update on public.courier_applications
  for each row execute function public.courier_applications_set_updated_at();

-- Applicants may never change status, reviewer, or timestamps.
create or replace function public.protect_courier_application()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('ersel.bypass_application_guard', true) = 'on' then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'permission_denied' using errcode = 'P0001';
    end if;
    if (new.status is distinct from old.status
        or new.reviewed_at is distinct from old.reviewed_at
        or new.reviewed_by is distinct from old.reviewed_by
        or new.rejection_reason is distinct from old.rejection_reason)
       and public.current_app_role() is distinct from 'admin'::public.app_role then
      raise exception 'permission_denied' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists courier_applications_protect on public.courier_applications;
create trigger courier_applications_protect
  before update on public.courier_applications
  for each row execute function public.protect_courier_application();

alter table public.courier_applications enable row level security;
revoke all on table public.courier_applications from public, anon;
grant select, insert, update on table public.courier_applications to authenticated;

drop policy if exists "courier applications read self or admin" on public.courier_applications;
create policy "courier applications read self or admin"
  on public.courier_applications
  for select
  to authenticated
  using (user_id = auth.uid() or public.current_app_role() = 'admin');

-- Direct INSERT/UPDATE from the client is denied. Writes go through RPCs.
-- (No insert/update/delete policies on purpose.)

-- ------------------------------------------------------------
-- 3) Customer submits or resubmits an application
--    Never touches profiles.role or courier_profiles.is_verified.
-- ------------------------------------------------------------
create or replace function public.submit_courier_application(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_role    public.app_role;
  v_first   text;
  v_last    text;
  v_phone   text;
  v_age     integer;
  v_vehicle public.vehicle_type;
  v_make    text;
  v_model   text;
  v_plate   text;
  v_city    text;
  v_row     public.courier_applications%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  select role into v_role from public.profiles where id = v_uid;
  if v_role is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if v_role in ('employee'::public.app_role, 'courier'::public.app_role, 'admin'::public.app_role) then
    raise exception 'already_staff' using errcode = 'P0001';
  end if;
  if v_role is distinct from 'customer'::public.app_role then
    raise exception 'not_customer' using errcode = 'P0001';
  end if;

  v_first := btrim(coalesce(payload->>'first_name', ''));
  v_last  := btrim(coalesce(payload->>'last_name', ''));
  if char_length(v_first) < 2 or char_length(v_first) > 40 then
    raise exception 'first_name_invalid' using errcode = 'P0001';
  end if;
  if char_length(v_last) < 2 or char_length(v_last) > 40 then
    raise exception 'last_name_invalid' using errcode = 'P0001';
  end if;

  v_phone := btrim(coalesce(payload->>'phone', ''));
  if v_phone = '' then
    raise exception 'phone_required' using errcode = 'P0001';
  end if;
  if v_phone !~ '^\+213[5-7][0-9]{8}$' then
    raise exception 'phone_invalid' using errcode = 'P0001';
  end if;

  begin
    v_age := (payload->>'age_years')::integer;
  exception when others then
    raise exception 'age_invalid' using errcode = 'P0001';
  end;
  if v_age is null or v_age < 18 or v_age > 80 then
    raise exception 'age_invalid' using errcode = 'P0001';
  end if;

  begin
    v_vehicle := (payload->>'vehicle')::public.vehicle_type;
  exception when others then
    raise exception 'vehicle_invalid' using errcode = 'P0001';
  end;

  v_make  := left(btrim(coalesce(payload->>'vehicle_make', '')), 40);
  v_model := left(btrim(coalesce(payload->>'vehicle_model', '')), 40);
  v_plate := left(btrim(coalesce(payload->>'vehicle_plate', '')), 20);
  if v_vehicle = 'car'::public.vehicle_type and char_length(v_plate) < 3 then
    raise exception 'vehicle_plate_required' using errcode = 'P0001';
  end if;

  v_city := left(btrim(coalesce(payload->>'city', 'السوقر')), 60);
  if char_length(v_city) < 2 then
    raise exception 'city_invalid' using errcode = 'P0001';
  end if;

  perform set_config('ersel.bypass_application_guard', 'on', true);

  select * into v_row from public.courier_applications where user_id = v_uid;
  if found then
    if v_row.status = 'pending'::public.courier_application_status then
      raise exception 'already_pending' using errcode = 'P0001';
    end if;
    if v_row.status = 'approved'::public.courier_application_status then
      raise exception 'already_approved' using errcode = 'P0001';
    end if;
    update public.courier_applications
       set first_name = v_first,
           last_name = v_last,
           phone = v_phone,
           age_years = v_age,
           vehicle = v_vehicle,
           vehicle_make = v_make,
           vehicle_model = v_model,
           vehicle_plate = v_plate,
           city = v_city,
           status = 'pending'::public.courier_application_status,
           rejection_reason = '',
           reviewed_at = null,
           reviewed_by = null
     where user_id = v_uid;
  else
    insert into public.courier_applications (
      user_id, first_name, last_name, phone, age_years, vehicle,
      vehicle_make, vehicle_model, vehicle_plate, city, status
    ) values (
      v_uid, v_first, v_last, v_phone, v_age, v_vehicle,
      v_make, v_model, v_plate, v_city, 'pending'::public.courier_application_status
    );
  end if;

  return jsonb_build_object('ok', true, 'status', 'pending');
end;
$$;

revoke all on function public.submit_courier_application(jsonb) from public, anon;
grant execute on function public.submit_courier_application(jsonb) to authenticated;

-- ------------------------------------------------------------
-- 4) Admin review — the only path that may grant courier role
-- ------------------------------------------------------------
create or replace function public.review_courier_application(
  p_user_id uuid,
  p_decision public.courier_application_status,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role public.app_role;
  v_row  public.courier_applications%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  v_role := public.current_app_role();
  if v_role is distinct from 'admin'::public.app_role then
    raise exception 'permission_denied' using errcode = 'P0001';
  end if;
  if p_decision not in (
    'approved'::public.courier_application_status,
    'rejected'::public.courier_application_status
  ) then
    raise exception 'permission_denied' using errcode = 'P0001';
  end if;

  select * into v_row from public.courier_applications where user_id = p_user_id for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0001';
  end if;
  if v_row.status is distinct from 'pending'::public.courier_application_status then
    raise exception 'already_taken' using errcode = 'P0001';
  end if;

  update public.courier_applications
     set status = p_decision,
         rejection_reason = case
           when p_decision = 'rejected'::public.courier_application_status
           then left(btrim(coalesce(p_reason, '')), 300)
           else ''
         end,
         reviewed_at = now(),
         reviewed_by = auth.uid()
   where user_id = p_user_id;

  if p_decision = 'approved'::public.courier_application_status then
    update public.profiles
       set role = 'courier'::public.app_role
     where id = p_user_id;

    insert into public.courier_profiles (user_id, vehicle, city, is_verified, is_available)
    values (p_user_id, v_row.vehicle, v_row.city, true, false)
    on conflict (user_id) do update
      set vehicle = excluded.vehicle,
          city = excluded.city,
          is_verified = true;
  end if;

  return jsonb_build_object('ok', true, 'status', p_decision);
end;
$$;

revoke all on function public.review_courier_application(uuid, public.courier_application_status, text) from public, anon;
grant execute on function public.review_courier_application(uuid, public.courier_application_status, text) to authenticated;

-- ------------------------------------------------------------
-- 5) Harden courier_profiles so applicants cannot self-verify
--    Existing update policy allows any self-update, including is_verified.
--    Keep the policy for availability toggles after approval, but block
--    verification / identity path changes unless the caller is admin.
-- ------------------------------------------------------------
create or replace function public.protect_courier_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_app_role() is distinct from 'admin'::public.app_role then
    if new.is_verified is distinct from old.is_verified
       or new.license_storage_path is distinct from old.license_storage_path
       or new.identity_storage_path is distinct from old.identity_storage_path then
      raise exception 'permission_denied' using errcode = 'P0001';
    end if;
    if new.user_id is distinct from old.user_id then
      raise exception 'permission_denied' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists courier_profiles_protect on public.courier_profiles;
create trigger courier_profiles_protect
  before update on public.courier_profiles
  for each row execute function public.protect_courier_profile();

-- Applicants must not insert a verified courier_profiles row themselves.
create or replace function public.protect_courier_profile_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_app_role() is distinct from 'admin'::public.app_role then
    new.is_verified := false;
    new.is_available := false;
    new.license_storage_path := null;
    new.identity_storage_path := null;
  end if;
  return new;
end;
$$;

drop trigger if exists courier_profiles_protect_insert on public.courier_profiles;
create trigger courier_profiles_protect_insert
  before insert on public.courier_profiles
  for each row execute function public.protect_courier_profile_insert();

-- ------------------------------------------------------------
-- TESTS (run after approval, as separate queries)
-- 1) anon cannot select courier_applications
-- 2) customer can call submit_courier_application once → status pending
-- 3) second submit while pending raises already_pending
-- 4) customer cannot update status / is_verified / role
-- 5) customer cannot execute review_courier_application
-- 6) admin can approve → profiles.role = courier, is_verified = true
-- 7) admin can reject → status rejected, role unchanged
-- 8) rejected customer can resubmit → status pending again
-- 9) unverified courier cannot claim orders (existing staff_claim_order
--    should later require is_verified; not changed in this proposal)
-- ------------------------------------------------------------

-- ROLLBACK
--   drop trigger if exists courier_profiles_protect_insert on public.courier_profiles;
--   drop trigger if exists courier_profiles_protect on public.courier_profiles;
--   drop function if exists public.protect_courier_profile_insert();
--   drop function if exists public.protect_courier_profile();
--   drop function if exists public.review_courier_application(uuid, public.courier_application_status, text);
--   drop function if exists public.submit_courier_application(jsonb);
--   drop trigger if exists courier_applications_protect on public.courier_applications;
--   drop function if exists public.protect_courier_application();
--   drop trigger if exists courier_applications_set_updated_at on public.courier_applications;
--   drop function if exists public.courier_applications_set_updated_at();
--   drop table if exists public.courier_applications;
--   drop type if exists public.courier_application_status;
