-- ============================================================
-- ERSEL — Proposal 07: Security review (stage 2.1)
-- Project: lkqmgidmxgjppsszwlvv
-- Status: PROPOSAL ONLY. Do not run until the founder approves.
--
-- DEPENDS ON (logical, not executed here)
--   Live (probed this session): profiles, orders, courier_profiles,
--     staff_claim_order, staff_advance_order, current_app_role.
--   Not live (probed): courier_applications, submit_courier_application,
--     review_courier_application.
--   File 05 (migrations/05_staff_desk.sql) and file 06
--     (proposals/06_courier_applications.sql) are NOT replaced.
--     This file is the security patch that should run after them,
--     or on a database that already has the staff RPCs.
--
-- WHAT THIS FILE CHANGES
--   A) staff_claim_order / staff_advance_order: verified couriers only;
--      atomic claim; employee/admin keep desk powers (see comments).
--   B) Replace pool-wide orders SELECT with assigned-only SELECT.
--      Unclaimed jobs are listed via staff_list_jobs() with redacted PII.
--   C) Recreate 06 objects with the current_setting bypass removed,
--      narrower GRANTs, safer triggers, and clearer error keys.
--
-- SAFETY
--   * No DROP TABLE. No role promotion. No service_role in the browser.
--   * DROP POLICY IF EXISTS only for "staff read pool or assigned"
--     (the broad pool read from file 05).
--   * CREATE OR REPLACE functions only.
-- ============================================================

-- ------------------------------------------------------------
-- A1. Atomic claim — courier must be verified
--     employee: internally provisioned desk role, not self-signup.
--       Employees may claim because they dispatch; they do not receive
--       the courier role and cannot self-verify.
--     courier: requires courier_profiles.is_verified = true.
--     admin: may claim (ops override).
-- ------------------------------------------------------------
create or replace function public.staff_claim_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_role  public.app_role;
  v_ok    boolean := false;
  v_id    uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  v_role := public.current_app_role();
  if v_role is null then
    raise exception 'not_staff' using errcode = 'P0001';
  end if;

  if v_role = 'courier'::public.app_role then
    select true into v_ok
      from public.courier_profiles
     where user_id = v_uid
       and is_verified = true;
    if v_ok is not true then
      raise exception 'not_verified' using errcode = 'P0001';
    end if;
  elsif v_role not in ('employee'::public.app_role, 'admin'::public.app_role) then
    raise exception 'not_staff' using errcode = 'P0001';
  end if;

  update public.orders
     set courier_id = v_uid,
         status = 'accepted'::public.order_status
   where id = p_order_id
     and status = 'pending'::public.order_status
     and courier_id is null
  returning id into v_id;

  if v_id is null then
    if exists (select 1 from public.orders where id = p_order_id) then
      raise exception 'already_taken' using errcode = 'P0001';
    end if;
    raise exception 'order_not_found' using errcode = 'P0001';
  end if;

  return jsonb_build_object('ok', true, 'status', 'accepted', 'courier_id', v_uid);
end;
$$;

revoke all on function public.staff_claim_order(uuid) from public, anon;
grant execute on function public.staff_claim_order(uuid) to authenticated;

-- ------------------------------------------------------------
-- A2. Advance — same verification gate for courier
-- ------------------------------------------------------------
create or replace function public.staff_advance_order(p_order_id uuid, p_next public.order_status)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_role public.app_role;
  v_row  public.orders%rowtype;
  v_ok   boolean := false;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  v_role := public.current_app_role();
  if v_role is null then
    raise exception 'not_staff' using errcode = 'P0001';
  end if;

  if v_role = 'courier'::public.app_role then
    select true into v_ok
      from public.courier_profiles
     where user_id = v_uid
       and is_verified = true;
    if v_ok is not true then
      raise exception 'not_verified' using errcode = 'P0001';
    end if;
  elsif v_role not in ('employee'::public.app_role, 'admin'::public.app_role) then
    raise exception 'not_staff' using errcode = 'P0001';
  end if;

  select * into v_row from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0001';
  end if;
  if v_role is distinct from 'admin'::public.app_role
     and v_row.courier_id is distinct from v_uid then
    raise exception 'not_assigned' using errcode = 'P0001';
  end if;

  v_ok :=
    (v_row.status = 'accepted'::public.order_status  and p_next = 'picked_up'::public.order_status) or
    (v_row.status = 'picked_up'::public.order_status and p_next = 'in_transit'::public.order_status) or
    (v_row.status = 'in_transit'::public.order_status and p_next = 'delivered'::public.order_status) or
    (v_role = 'admin'::public.app_role and p_next in (
      'pending','accepted','picked_up','in_transit','delivered','cancelled'
    ));

  if v_ok is not true then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;

  update public.orders set status = p_next where id = p_order_id;
  return jsonb_build_object('ok', true, 'status', p_next);
end;
$$;

revoke all on function public.staff_advance_order(uuid, public.order_status) from public, anon;
grant execute on function public.staff_advance_order(uuid, public.order_status) to authenticated;

-- ------------------------------------------------------------
-- A3. Stop pool-wide SELECT of customer PII.
--     Assigned jobs remain readable by the assignee.
--     Admin keeps the existing "orders read related or admin" policy.
-- ------------------------------------------------------------
drop policy if exists "staff read pool or assigned" on public.orders;

drop policy if exists "staff read assigned only" on public.orders;
create policy "staff read assigned only"
  on public.orders
  for select
  to authenticated
  using (
    courier_id = auth.uid()
    and public.current_app_role() in ('employee'::public.app_role, 'courier'::public.app_role)
  );

-- ------------------------------------------------------------
-- A4. Job list for the desk. Unclaimed rows omit phone / name / id / notes.
-- ------------------------------------------------------------
create or replace function public.staff_list_jobs()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  v_role     public.app_role;
  v_verified boolean := false;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  v_role := public.current_app_role();
  if v_role is distinct from 'admin'::public.app_role
     and v_role is distinct from 'employee'::public.app_role
     and v_role is distinct from 'courier'::public.app_role then
    raise exception 'not_staff' using errcode = 'P0001';
  end if;

  if v_role = 'courier'::public.app_role then
    select is_verified into v_verified
      from public.courier_profiles
     where user_id = v_uid;
    if v_verified is not true then
      return jsonb_build_object('ok', true, 'orders', '[]'::jsonb, 'verified', false);
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'verified', true,
    'orders', coalesce((
      select jsonb_agg(job order by job->>'created_at' desc)
      from (
        select jsonb_build_object(
          'id', o.id,
          'service', o.service,
          'pickup', o.pickup,
          'dropoff', o.dropoff,
          'details', o.details,
          'vehicle', o.vehicle,
          'status', o.status,
          'price_dzd', o.price_dzd,
          'courier_id', o.courier_id,
          'pickup_lat', o.pickup_lat,
          'pickup_lng', o.pickup_lng,
          'dropoff_lat', o.dropoff_lat,
          'dropoff_lng', o.dropoff_lng,
          'created_at', o.created_at,
          'updated_at', o.updated_at,
          'customer_name', case
            when o.courier_id = v_uid or v_role = 'admin'::public.app_role then o.customer_name
            else ''
          end,
          'phone', case
            when o.courier_id = v_uid or v_role = 'admin'::public.app_role then o.phone
            else ''
          end,
          'customer_id', case
            when o.courier_id = v_uid or v_role = 'admin'::public.app_role then o.customer_id
            else null
          end,
          'notes', case
            when o.courier_id = v_uid or v_role = 'admin'::public.app_role then o.notes
            else ''
          end
        ) as job
        from public.orders o
        where
          (v_role = 'admin'::public.app_role)
          or (o.courier_id = v_uid)
          or (
            o.status = 'pending'::public.order_status
            and o.courier_id is null
            and v_role in ('employee'::public.app_role, 'courier'::public.app_role)
          )
        order by o.created_at desc
        limit 80
      ) listed
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.staff_list_jobs() from public, anon;
grant execute on function public.staff_list_jobs() to authenticated;

-- ------------------------------------------------------------
-- B. Courier applications — corrected 06 (idempotent)
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'courier_application_status') then
    create type public.courier_application_status as enum ('pending', 'approved', 'rejected');
  end if;
end $$;

-- قاعدة قديمة قد تحمل courier_applications.status من نوع text.
-- نُصلحها الآن قبل أي مقارنة مع الـ enum (الدالة معرّفة في 00).
do $$
begin
  if to_regprocedure('public.ersel_normalize_legacy_types()') is not null then
    perform public.ersel_normalize_legacy_types();
  end if;
end $$;

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
set search_path = public, pg_temp
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

-- No current_setting bypass. Applicant may only move rejected -> pending
-- and clear review fields. Approval still requires admin.
create or replace function public.protect_courier_application()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if public.current_app_role() is distinct from 'admin'::public.app_role then
      new.status := 'pending'::public.courier_application_status;
      new.reviewed_at := null;
      new.reviewed_by := null;
      new.rejection_reason := '';
      new.user_id := auth.uid();
    end if;
    return new;
  end if;

  if new.user_id is distinct from old.user_id then
    raise exception 'permission_denied' using errcode = 'P0001';
  end if;

  if public.current_app_role() = 'admin'::public.app_role then
    return new;
  end if;

  if auth.uid() = old.user_id
     and old.status = 'rejected'::public.courier_application_status
     and new.status = 'pending'::public.courier_application_status
     and new.reviewed_at is null
     and new.reviewed_by is null
     and new.rejection_reason = '' then
    return new;
  end if;

  if new.status is distinct from old.status
     or new.reviewed_at is distinct from old.reviewed_at
     or new.reviewed_by is distinct from old.reviewed_by
     or new.rejection_reason is distinct from old.rejection_reason then
    raise exception 'permission_denied' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists courier_applications_protect on public.courier_applications;
create trigger courier_applications_protect
  before insert or update on public.courier_applications
  for each row execute function public.protect_courier_application();

alter table public.courier_applications enable row level security;
revoke all on table public.courier_applications from public, anon, authenticated;
grant select on table public.courier_applications to authenticated;

drop policy if exists "courier applications read self or admin" on public.courier_applications;
create policy "courier applications read self or admin"
  on public.courier_applications
  for select
  to authenticated
  using (user_id = auth.uid() or public.current_app_role() = 'admin');

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

  select * into v_row from public.courier_applications where user_id = v_uid for update;
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
     where user_id = v_uid
       and status = 'rejected'::public.courier_application_status;
    if not found then
      raise exception 'already_pending' using errcode = 'P0001';
    end if;
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
    raise exception 'application_not_found' using errcode = 'P0001';
  end if;
  if v_row.status is distinct from 'pending'::public.courier_application_status then
    raise exception 'already_reviewed' using errcode = 'P0001';
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
   where user_id = p_user_id
     and status = 'pending'::public.courier_application_status;

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

create or replace function public.protect_courier_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
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

create or replace function public.protect_courier_profile_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
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
-- TESTS (run only after explicit approval, as separate sessions)
-- Allowed
--   1) customer submit_courier_application → pending
--   2) rejected customer resubmits → pending
--   3) admin review approve → role courier, is_verified true
--   4) admin review reject → role unchanged
--   5) verified courier staff_claim_order on pending unassigned → accepted
--   6) second concurrent claim → already_taken
--   7) employee (internally provisioned) may claim
--   8) assigned staff sees phone; unclaimed list has empty phone/name
-- Forbidden
--   9) unverified courier staff_claim_order → not_verified
--  10) customer staff_claim_order → not_staff
--  11) customer review_courier_application → permission_denied
--  12) customer update applications.status to approved → RLS / trigger
--  13) customer update courier_profiles.is_verified → permission_denied
--  14) customer read another user's application → 0 rows
--  15) anon select courier_applications / orders PII → 0 rows
--  16) second submit while pending → already_pending
-- ------------------------------------------------------------

-- ROLLBACK (manual, only if this proposal was applied)
--   drop function if exists public.staff_list_jobs();
--   drop policy if exists "staff read assigned only" on public.orders;
--   -- restoring 05 pool policy would re-expose PII; do not restore it
--   -- without a replacement list function.
--   -- 06 objects: see rollback block in proposals/06_courier_applications.sql
