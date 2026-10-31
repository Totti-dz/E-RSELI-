-- ============================================================
-- ERSEL — Migration 05 (PROPOSAL ONLY — do not run until approved)
-- Project: lkqmgidmxgjppsszwlvv
--
-- PURPOSE
--   Let an authenticated employee/courier:
--     * see pending unassigned orders and orders assigned to them
--     * claim a pending order (sets courier_id = auth.uid())
--     * advance status along the allowed chain
--   Admin keeps full access. Customers keep existing access.
--
-- WHY THE UI LOGIN FAILS TODAY (read-only diagnosis)
--   1) AuthScreen signs the employee OUT if the profile role is missing
--      or still loading, then treats them as a customer.
--   2) App.tsx forces role = profile?.role ?? 'customer' and always
--      lands on the home page after login.
--   3) Even after a successful login, RLS on orders only allows:
--        customer_id = auth.uid() OR courier_id = auth.uid() OR admin
--      so an employee with role='employee' and courier_id NULL sees 0 orders
--      and cannot UPDATE a pending row to claim it (USING sees courier_id NULL).
--
-- SAFETY
--   * Additive: one extra SELECT policy, two SECURITY DEFINER functions.
--   * No table, row, or existing policy is dropped.
--   * Writes go through the functions, not a broad UPDATE grant.
--   * service_role is never exposed to the browser.
--   * 101112 is NOT used here and must stay off the frontend.
--
-- ROLLBACK at the bottom.
-- ============================================================

-- Employees/couriers may read the pool of unclaimed jobs and their own jobs.
-- Admin already matches the existing "orders read related or admin" policy.
-- (Proposal 07 removes this broad policy again; drop-first keeps re-runs safe.)
drop policy if exists "staff read pool or assigned" on public.orders;
create policy "staff read pool or assigned"
  on public.orders
  for select
  to authenticated
  using (
    public.current_app_role() in ('employee'::public.app_role, 'courier'::public.app_role)
    and (
      (status = 'pending'::public.order_status and courier_id is null)
      or courier_id = auth.uid()
    )
  );

-- Claim a pending unassigned order. Race-safe: first writer wins.
create or replace function public.staff_claim_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role public.app_role;
  v_row  public.orders%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  v_role := public.current_app_role();
  if v_role not in ('employee'::public.app_role, 'courier'::public.app_role, 'admin'::public.app_role) then
    raise exception 'not_staff' using errcode = 'P0001';
  end if;

  select * into v_row from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0001';
  end if;
  if v_row.status is distinct from 'pending'::public.order_status
     or v_row.courier_id is not null then
    raise exception 'already_taken' using errcode = 'P0001';
  end if;

  update public.orders
     set courier_id = auth.uid(),
         status = 'accepted'::public.order_status
   where id = p_order_id;

  return jsonb_build_object('ok', true, 'status', 'accepted', 'courier_id', auth.uid());
end;
$$;

revoke all on function public.staff_claim_order(uuid) from public;
grant execute on function public.staff_claim_order(uuid) to authenticated;

-- Advance an order the caller owns (or admin). Allowed chain only.
create or replace function public.staff_advance_order(p_order_id uuid, p_next public.order_status)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role public.app_role;
  v_row  public.orders%rowtype;
  v_ok   boolean := false;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  v_role := public.current_app_role();
  if v_role not in ('employee'::public.app_role, 'courier'::public.app_role, 'admin'::public.app_role) then
    raise exception 'not_staff' using errcode = 'P0001';
  end if;

  select * into v_row from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0001';
  end if;
  if v_role is distinct from 'admin'::public.app_role
     and v_row.courier_id is distinct from auth.uid() then
    raise exception 'not_assigned' using errcode = 'P0001';
  end if;

  v_ok :=
    (v_row.status = 'accepted'::public.order_status  and p_next = 'picked_up'::public.order_status) or
    (v_row.status = 'picked_up'::public.order_status and p_next = 'in_transit'::public.order_status) or
    (v_row.status = 'in_transit'::public.order_status and p_next = 'delivered'::public.order_status) or
    (v_role = 'admin'::public.app_role and p_next in (
      'pending','accepted','picked_up','in_transit','delivered','cancelled'
    ));

  if not v_ok then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;

  update public.orders set status = p_next where id = p_order_id;
  return jsonb_build_object('ok', true, 'status', p_next);
end;
$$;

revoke all on function public.staff_advance_order(uuid, public.order_status) from public;
grant execute on function public.staff_advance_order(uuid, public.order_status) to authenticated;

-- Verification (read-only):
-- select polname, polcmd from pg_policy where polrelid = 'public.orders'::regclass;
-- select proname, prosecdef from pg_proc
--   where proname in ('staff_claim_order','staff_advance_order');

-- ROLLBACK
--   drop function if exists public.staff_advance_order(uuid, public.order_status);
--   drop function if exists public.staff_claim_order(uuid);
--   drop policy if exists "staff read pool or assigned" on public.orders;
