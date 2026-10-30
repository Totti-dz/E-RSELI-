-- ============================================================
-- ERSEL — Proposal 08: Admin desk extras (accounts + stats)
-- Project: lkqmgidmxgjppsszwlvv
-- Status: PROPOSAL ONLY. Do not run until the founder approves.
--
-- DOES NOT replace 05 / 06 / 07. Additive only.
-- DOES NOT run 02_promote_admin.sql.
-- DOES NOT grant admin for PIN 101112. That PIN is a UI gate only.
--
-- WHAT THIS FILE WOULD ADD
--   A) profiles.is_disabled for reversible account freeze
--   B) admin_set_account_disabled(uuid, boolean) — admin session only
--   C) admin_dashboard_stats() — counts without a full table dump
--   D) admin_cancel_order(uuid) — cancel via server, not a client UPDATE
--
-- SAFETY
--   * No DROP TABLE. No role promotion. No service_role in the browser.
--   * Caller must already have profiles.role = 'admin'.
--   * Non-admin cannot freeze, unfreeze, or read other profiles.
-- ============================================================

alter table public.profiles
  add column if not exists is_disabled boolean not null default false;

create or replace function public.admin_set_account_disabled(p_user_id uuid, p_disabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_role public.app_role;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  v_role := public.current_app_role();
  if v_role is distinct from 'admin'::public.app_role then
    raise exception 'permission_denied' using errcode = 'P0001';
  end if;
  if p_user_id = v_uid then
    raise exception 'permission_denied' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.profiles
     where id = p_user_id and role = 'admin'::public.app_role
  ) then
    raise exception 'permission_denied' using errcode = 'P0001';
  end if;

  update public.profiles
     set is_disabled = p_disabled
   where id = p_user_id;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0001';
  end if;
  return jsonb_build_object('ok', true, 'is_disabled', p_disabled);
end;
$$;

revoke all on function public.admin_set_account_disabled(uuid, boolean) from public, anon;
grant execute on function public.admin_set_account_disabled(uuid, boolean) to authenticated;

create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if public.current_app_role() is distinct from 'admin'::public.app_role then
    raise exception 'permission_denied' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'ok', true,
    'customers', (select count(*) from public.profiles where role = 'customer'::public.app_role),
    'employees', (select count(*) from public.profiles where role = 'employee'::public.app_role),
    'couriers', (select count(*) from public.profiles where role = 'courier'::public.app_role),
    'verified_couriers', (
      select count(*) from public.courier_profiles cp
      join public.profiles p on p.id = cp.user_id
      where p.role = 'courier'::public.app_role and cp.is_verified = true
    ),
    'pending_applications', (
      select count(*) from public.courier_applications
      where status = 'pending'::public.courier_application_status
    ),
    'orders_active', (
      select count(*) from public.orders
      where status in ('pending','accepted','picked_up','in_transit')
    ),
    'orders_delivered', (select count(*) from public.orders where status = 'delivered'),
    'orders_cancelled', (select count(*) from public.orders where status = 'cancelled')
  );
end;
$$;

revoke all on function public.admin_dashboard_stats() from public, anon;
grant execute on function public.admin_dashboard_stats() to authenticated;

create or replace function public.admin_cancel_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.orders%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if public.current_app_role() is distinct from 'admin'::public.app_role then
    raise exception 'permission_denied' using errcode = 'P0001';
  end if;

  select * into v_row from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0001';
  end if;
  if v_row.status in ('delivered'::public.order_status, 'cancelled'::public.order_status) then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;

  update public.orders
     set status = 'cancelled'::public.order_status
   where id = p_order_id;
  return jsonb_build_object('ok', true, 'status', 'cancelled');
end;
$$;

revoke all on function public.admin_cancel_order(uuid) from public, anon;
grant execute on function public.admin_cancel_order(uuid) to authenticated;

-- TESTS after approval
-- 1) anon / customer admin_dashboard_stats → permission_denied / 42501
-- 2) admin session → counts match live tables
-- 3) admin_set_account_disabled on self or another admin → permission_denied
-- 4) admin_cancel_order on delivered → invalid_transition
-- 5) PIN 101112 in the browser still does not change profiles.role

-- ROLLBACK
--   drop function if exists public.admin_cancel_order(uuid);
--   drop function if exists public.admin_dashboard_stats();
--   drop function if exists public.admin_set_account_disabled(uuid, boolean);
--   -- keep is_disabled column unless explicitly asked to drop it
