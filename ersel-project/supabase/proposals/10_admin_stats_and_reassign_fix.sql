-- ============================================================
-- ERSEL — Proposal 10: Corrected admin stats + reassign
-- Project: lkqmgidmxgjppsszwlvv
-- Status: PROPOSAL ONLY. Do not run until the founder approves.
--
-- DOES NOT replace files 05 / 06 / 07 / 08 / 09 on disk.
-- DOES NOT run 02_promote_admin.sql.
-- DOES NOT add profiles.is_disabled or account freeze (see 08 analysis).
-- DOES NOT grant admin for PIN 101112.
--
-- THIS FILE SUPERSEDES 09 IF APPROVED.
--   Keep 09 as the original draft. Apply 10 instead of 09.
--   If 08 already defined admin_dashboard_stats(), 10 replaces that
--   function body (CREATE OR REPLACE) and adds admins + a safe
--   pending-applications count.
--
-- WHAT THIS FILE WOULD ADD
--   A) admin_dashboard_stats() — admin session only, exact counts
--   B) admin_reassign_order(uuid, uuid) — admin session only
--
-- CONFIRMED FROM FILES (not a live probe in this session)
--   * Assignment column on public.orders is courier_id
--     (schema.sql, 05 staff_claim_order, 07 staff_claim_order).
--     There is no employee_id / assigned_to column.
--   * app_role values used by later files: customer, courier,
--     employee (added in 01_foundation.sql), admin.
--     schema.sql is stale (no employee) and is not the live source.
--   * order_status: pending, accepted, picked_up, in_transit,
--     delivered, cancelled.
--   * courier_application_status (06/07): pending, approved, rejected.
--   * 07 staff_advance_order: non-admin must own courier_id;
--     courier must be courier_profiles.is_verified = true;
--     admin may set any status including cancelled.
--
-- SAFETY
--   * No DROP TABLE. No role promotion. No service_role in the browser.
--   * Caller must already have profiles.role = 'admin'.
-- ============================================================

-- ------------------------------------------------------------
-- A. Dashboard counts. Admin only.
--    courier_applications is optional: if 07 was never applied the
--    pending_applications key is 0 instead of failing the whole RPC.
-- ------------------------------------------------------------
create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_pending_applications bigint := 0;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if public.current_app_role() is distinct from 'admin'::public.app_role then
    raise exception 'permission_denied' using errcode = 'P0001';
  end if;

  if to_regclass('public.courier_applications') is not null then
    -- status is an enum (courier_application_status), not text: compare
    -- against a typed literal. The statement is only parsed when the table
    -- exists, so the type is guaranteed to be present.
    select count(*) into v_pending_applications
      from public.courier_applications
     where status = 'pending'::public.courier_application_status;
  end if;

  return jsonb_build_object(
    'ok', true,
    'customers', (select count(*)::bigint from public.profiles where role = 'customer'::public.app_role),
    'employees', (select count(*)::bigint from public.profiles where role = 'employee'::public.app_role),
    'couriers', (select count(*)::bigint from public.profiles where role = 'courier'::public.app_role),
    'admins', (select count(*)::bigint from public.profiles where role = 'admin'::public.app_role),
    'verified_couriers', (
      select count(*)::bigint
        from public.courier_profiles cp
        join public.profiles p on p.id = cp.user_id
       where p.role = 'courier'::public.app_role
         and cp.is_verified = true
    ),
    'pending_applications', v_pending_applications,
    'orders_active', (
      select count(*)::bigint from public.orders
       where status in (
         'pending'::public.order_status,
         'accepted'::public.order_status,
         'picked_up'::public.order_status,
         'in_transit'::public.order_status
       )
    ),
    'orders_delivered', (
      select count(*)::bigint from public.orders
       where status = 'delivered'::public.order_status
    ),
    'orders_cancelled', (
      select count(*)::bigint from public.orders
       where status = 'cancelled'::public.order_status
    )
  );
end;
$$;

revoke all on function public.admin_dashboard_stats() from public, anon;
grant execute on function public.admin_dashboard_stats() to authenticated;

-- ------------------------------------------------------------
-- B. Reassign an in-flight order.
--    Writes public.orders.courier_id (the only assignee column).
--
--    Allowed targets:
--      * courier with courier_profiles.is_verified = true
--      * employee (internal desk role; not self-signup)
--    Forbidden targets:
--      * customer
--      * admin (ops override, not a field assignee)
--      * missing / null id
--      * unverified courier
--
--    Allowed current statuses: pending, accepted, picked_up, in_transit.
--      pending  -> sets courier_id and status = accepted
--      others   -> sets courier_id only; status unchanged
--    Forbidden: delivered, cancelled.
--    Same courier_id as the target: already_assigned (no write).
-- ------------------------------------------------------------
create or replace function public.admin_reassign_order(p_order_id uuid, p_staff_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_staff public.app_role;
  v_ok    boolean := false;
  v_row   public.orders%rowtype;
  v_id    uuid;
  v_next  public.order_status;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if public.current_app_role() is distinct from 'admin'::public.app_role then
    raise exception 'permission_denied' using errcode = 'P0001';
  end if;
  if p_order_id is null then
    raise exception 'order_not_found' using errcode = 'P0001';
  end if;
  if p_staff_id is null then
    raise exception 'staff_not_found' using errcode = 'P0001';
  end if;

  select role into v_staff from public.profiles where id = p_staff_id;
  if v_staff is null then
    raise exception 'staff_not_found' using errcode = 'P0001';
  end if;

  if v_staff = 'courier'::public.app_role then
    select true into v_ok
      from public.courier_profiles
     where user_id = p_staff_id
       and is_verified = true;
    if v_ok is not true then
      raise exception 'not_verified' using errcode = 'P0001';
    end if;
  elsif v_staff = 'employee'::public.app_role then
    null;
  else
    raise exception 'not_staff' using errcode = 'P0001';
  end if;

  select * into v_row from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0001';
  end if;

  if v_row.status in ('delivered'::public.order_status, 'cancelled'::public.order_status) then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;

  if v_row.status not in (
    'pending'::public.order_status,
    'accepted'::public.order_status,
    'picked_up'::public.order_status,
    'in_transit'::public.order_status
  ) then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;

  if v_row.courier_id is not distinct from p_staff_id then
    raise exception 'already_assigned' using errcode = 'P0001';
  end if;

  v_next := case
    when v_row.status = 'pending'::public.order_status then 'accepted'::public.order_status
    else v_row.status
  end;

  update public.orders
     set courier_id = p_staff_id,
         status = v_next
   where id = p_order_id
     and status = v_row.status
     and status not in ('delivered'::public.order_status, 'cancelled'::public.order_status)
     and courier_id is distinct from p_staff_id
  returning id into v_id;

  if v_id is null then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'courier_id', p_staff_id,
    'status', v_next
  );
end;
$$;

revoke all on function public.admin_reassign_order(uuid, uuid) from public, anon;
grant execute on function public.admin_reassign_order(uuid, uuid) to authenticated;

-- TESTS after approval (do not run from the browser as a substitute for RLS)
-- 1) anon / customer admin_dashboard_stats → permission_denied / 42501
-- 2) admin session → keys include admins; counts are table totals
-- 3) customer admin_reassign_order → permission_denied
-- 4) admin reassign delivered or cancelled → invalid_transition
-- 5) admin reassign to unverified courier → not_verified
-- 6) admin reassign to customer → not_staff
-- 7) admin reassign to admin → not_staff
-- 8) admin reassign to current courier_id → already_assigned
-- 9) admin reassign pending → courier_id set, status accepted
-- 10) admin reassign accepted/picked_up/in_transit → courier_id set, status unchanged
-- 11) PIN 101112 still does not change profiles.role

-- ROLLBACK
--   drop function if exists public.admin_reassign_order(uuid, uuid);
--   -- drop function if exists public.admin_dashboard_stats();
--   -- only drop stats if 08/09 must also be rolled back
