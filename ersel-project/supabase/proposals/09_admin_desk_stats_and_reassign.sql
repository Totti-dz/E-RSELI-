-- ============================================================
-- ERSEL — Proposal 09: Admin stats completeness + order reassign
-- Project: lkqmgidmxgjppsszwlvv
-- Status: PROPOSAL ONLY. Do not run until the founder approves.
--
-- DOES NOT replace 05 / 06 / 07 / 08.
-- DOES NOT run 02_promote_admin.sql.
-- DOES NOT grant admin for PIN 101112.
--
-- RELATION TO 08
--   08 (not executed) still owns:
--     * profiles.is_disabled
--     * admin_set_account_disabled(uuid, boolean)
--     * admin_cancel_order(uuid)  -- redundant if 07 staff_advance_order is live
--   09 does not add account freeze. Freeze remains unenforced until 08
--   is approved AND a later proposal actually blocks disabled sessions.
--
-- WHAT THIS FILE WOULD ADD
--   A) admin_dashboard_stats() with an `admins` count
--      CREATE OR REPLACE — safe if 08 never ran.
--   B) admin_reassign_order(uuid, uuid) — admin session only
--
-- CONFIRMED FROM FILES (not a live probe in this session)
--   * 07 defines staff_advance_order so an admin may set cancelled.
--     Cancel in the UI uses that RPC; 08's admin_cancel_order is optional.
--   * 07 staff_list_jobs / review_courier_application exist in files.
--     Live presence was reported in SECURITY_REVIEW_STAGE_2_1.md and
--     was not re-probed here.
--
-- DEPENDS ON
--   public.current_app_role(), public.orders, public.profiles,
--   public.courier_profiles, public.courier_applications (for pending count).
--   If courier_applications is missing, this function will fail until 07.
--
-- SAFETY
--   * No DROP TABLE. No role promotion. No service_role in the browser.
--   * Caller must already have profiles.role = 'admin'.
-- ============================================================

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
    'admins', (select count(*) from public.profiles where role = 'admin'::public.app_role),
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

-- Reassign an in-flight order to a verified courier or an internal employee.
-- Delivered / cancelled orders cannot be moved. Admin session required.
create or replace function public.admin_reassign_order(p_order_id uuid, p_staff_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_role  public.app_role;
  v_staff public.app_role;
  v_ok    boolean := false;
  v_row   public.orders%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if public.current_app_role() is distinct from 'admin'::public.app_role then
    raise exception 'permission_denied' using errcode = 'P0001';
  end if;
  if p_staff_id is null then
    raise exception 'permission_denied' using errcode = 'P0001';
  end if;

  select role into v_staff from public.profiles where id = p_staff_id;
  if v_staff is null then
    raise exception 'order_not_found' using errcode = 'P0001';
  end if;

  if v_staff = 'courier'::public.app_role then
    select true into v_ok
      from public.courier_profiles
     where user_id = p_staff_id
       and is_verified = true;
    if v_ok is not true then
      raise exception 'not_verified' using errcode = 'P0001';
    end if;
  elsif v_staff is distinct from 'employee'::public.app_role
        and v_staff is distinct from 'admin'::public.app_role then
    raise exception 'not_staff' using errcode = 'P0001';
  end if;

  select * into v_row from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0001';
  end if;
  if v_row.status in ('delivered'::public.order_status, 'cancelled'::public.order_status) then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;

  update public.orders
     set courier_id = p_staff_id,
         status = case
           when status = 'pending'::public.order_status then 'accepted'::public.order_status
           else status
         end
   where id = p_order_id
     and status not in ('delivered'::public.order_status, 'cancelled'::public.order_status);

  if not found then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;

  return jsonb_build_object('ok', true, 'courier_id', p_staff_id);
end;
$$;

revoke all on function public.admin_reassign_order(uuid, uuid) from public, anon;
grant execute on function public.admin_reassign_order(uuid, uuid) to authenticated;

-- TESTS after approval
-- 1) anon / customer admin_dashboard_stats → permission_denied / 42501
-- 2) admin session → counts include admins and match live tables
-- 3) customer admin_reassign_order → permission_denied
-- 4) admin reassign delivered order → invalid_transition
-- 5) admin reassign to unverified courier → not_verified
-- 6) PIN 101112 still does not change profiles.role

-- ROLLBACK
--   drop function if exists public.admin_reassign_order(uuid, uuid);
--   -- keep admin_dashboard_stats if 08 is still desired; otherwise:
--   -- drop function if exists public.admin_dashboard_stats();
