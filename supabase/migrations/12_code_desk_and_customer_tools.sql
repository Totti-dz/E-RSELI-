-- ============================================================
-- ERSEL — Migration 12: لوحة قراءة بالرمز + أدوات الزبون والموصّل
-- يعتمد على: 00, 01, 03, 04, 05, 07, 10, ersel_v2, 11
-- آمن للتشغيل أكثر من مرة.
--
-- يضيف:
--   A) admin_code_view(code)  — قراءة فقط: الطلبات الجارية/المكتملة/الملغاة
--                               والحسابات والإحصائيات، بلا منح أي دور.
--   B) customer_cancel_order(order_id) — الزبون يلغي طلبه قبل الاستلام.
--   C) set_admin_code(code)            — يرفع الحد الأدنى للرمز إلى 10 محارف.
--
-- لماذا القراءة بالرمز:
--   لوحة الإدارة الكاملة تتطلب جلسة بدور admin. المالك يريد الاطلاع السريع
--   من الهاتف بالرمز فقط. هذا المسار:
--     * لا يغيّر أي دور ولا يكتب أي بيانات (قراءة فقط)
--     * يرفض الرمز الافتراضي 101112 حتى يُغيَّر إلى رمز قوي
--     * يحدّ المحاولات الفاشلة عالميًا (20 كل 15 دقيقة)
--     * لا يخزّن الرمز في المتصفح
--   يبقى خطرًا مقبولًا: من يعرف الرمز يرى أرقام هواتف الزبائن.
-- ============================================================

-- ------------------------------------------------------------
-- A) لوحة القراءة بالرمز
-- ------------------------------------------------------------
create or replace function public.admin_code_view(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hash       text;
  v_fail       integer;
  v_orders     jsonb;
  v_accounts   jsonb;
  v_is_default boolean := false;
begin
  -- حد المحاولات: عدّاد عالمي لأن المستدعي قد يكون مجهولًا.
  select count(*) into v_fail
    from public.admin_unlock_attempts
   where not ok and at > now() - interval '15 minutes';
  if v_fail >= 20 then
    return jsonb_build_object('ok', false, 'error', 'locked');
  end if;

  select code_hash into v_hash from public.admin_secret where id;
  if v_hash is null or p_code is null or crypt(p_code, v_hash) <> v_hash then
    insert into public.admin_unlock_attempts (user_id, ok) values (auth.uid(), false);
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;

  -- الرمز الافتراضي يفتح الباب لكل من قرأ ملف SQL. نرفضه هنا حتى يُغيَّر.
  v_is_default := crypt('101112', v_hash) = v_hash;
  if v_is_default or length(coalesce(p_code, '')) < 8 then
    return jsonb_build_object('ok', false, 'error', 'weak_code');
  end if;

  insert into public.admin_unlock_attempts (user_id, ok) values (auth.uid(), true);

  select coalesce(jsonb_agg(entry order by entry->>'created_at' desc), '[]'::jsonb)
    into v_orders
    from (
      select jsonb_build_object(
        'id', o.id,
        'code', coalesce(o.order_code, ''),
        'service', o.service,
        'status', o.status,
        'customer_name', o.customer_name,
        'phone', o.phone,
        'pickup', o.pickup,
        'dropoff', o.dropoff,
        'details', o.details,
        'notes', o.notes,
        'price_dzd', o.price_dzd,
        'vehicle', o.vehicle,
        'courier_id', o.courier_id,
        'courier_name', coalesce(cp.full_name, ''),
        'is_guest', o.is_guest,
        'created_at', o.created_at,
        'updated_at', o.updated_at
      ) as entry
      from public.orders o
      left join public.profiles cp on cp.id = o.courier_id
      order by o.created_at desc
      limit 120
    ) listed;

  select coalesce(jsonb_agg(entry order by entry->>'created_at' desc), '[]'::jsonb)
    into v_accounts
    from (
      select jsonb_build_object(
        'id', p.id,
        'full_name', p.full_name,
        'phone', p.phone,
        'role', p.role,
        'created_at', p.created_at,
        'verified', case when p.role = 'courier'::public.app_role then cpf.is_verified else null end,
        'available', case when p.role = 'courier'::public.app_role then coalesce(cpf.is_available, false) else null end
      ) as entry
      from public.profiles p
      left join public.courier_profiles cpf on cpf.user_id = p.id
      order by p.created_at desc
      limit 200
    ) listed;

  return jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'read_only', true,
    'stats', jsonb_build_object(
      'active', (select count(*) from public.orders where status in ('pending','accepted','picked_up','in_transit')),
      'delivered', (select count(*) from public.orders where status = 'delivered'),
      'cancelled', (select count(*) from public.orders where status = 'cancelled'),
      'customers', (select count(*) from public.profiles where role = 'customer'),
      'couriers', (select count(*) from public.profiles where role = 'courier'),
      'verified_couriers', (
        select count(*) from public.courier_profiles where is_verified
      ),
      'available_couriers', (
        select count(*) from public.courier_profiles where is_verified and is_available
      ),
      'employees', (select count(*) from public.profiles where role = 'employee'),
      'admins', (select count(*) from public.profiles where role = 'admin')
    ),
    'orders', v_orders,
    'accounts', v_accounts,
    'orders_truncated', jsonb_array_length(v_orders) >= 120,
    'accounts_truncated', jsonb_array_length(v_accounts) >= 200
  );
end;
$$;

revoke all on function public.admin_code_view(text) from public;
grant execute on function public.admin_code_view(text) to anon, authenticated;

-- ------------------------------------------------------------
-- B) إلغاء الزبون لطلبه (قبل الاستلام فقط)
-- ------------------------------------------------------------
create or replace function public.customer_cancel_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.orders%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if p_order_id is null then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;

  select * into v_row from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;
  if v_row.customer_id is distinct from v_uid then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;
  if v_row.status not in ('pending'::public.order_status, 'accepted'::public.order_status) then
    return jsonb_build_object('ok', false, 'error', 'invalid_transition');
  end if;

  update public.orders set status = 'cancelled'::public.order_status where id = p_order_id;
  return jsonb_build_object('ok', true, 'status', 'cancelled');
end;
$$;

revoke all on function public.customer_cancel_order(uuid) from public, anon;
grant execute on function public.customer_cancel_order(uuid) to authenticated;

-- ------------------------------------------------------------
-- C) رمز الإدارة: 10 محارف على الأقل لأي رمز جديد
-- ------------------------------------------------------------
create or replace function public.set_admin_code(p_code text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if length(coalesce(p_code, '')) < 10 then
    raise exception 'code_too_short';
  end if;
  insert into public.admin_secret (id, code_hash)
  values (true, crypt(p_code, gen_salt('bf', 10)))
  on conflict (id) do update set code_hash = excluded.code_hash;
end;
$$;

revoke all on function public.set_admin_code(text) from public, anon, authenticated;

-- ------------------------------------------------------------
-- D) فهرس للوحة القراءة (ترتيب الطلبات بالتاريخ)
-- ------------------------------------------------------------
create index if not exists orders_created_at_desc_idx
  on public.orders (created_at desc);

-- ============================================================
-- التحقق بعد التنفيذ
--
--   1) غيّر الرمز أولًا (وإلا سترفض اللوحة الرمز الافتراضي):
--      select public.set_admin_code('ERSEL-2026-ADMIN');
--
--   2) من جلسة عادية أو من المتصفح:
--      select public.admin_code_view('ERSEL-2026-ADMIN');
--      -- يجب أن يرجع ok=true مع orders و accounts
--
--   3) الرمز الافتراضي يجب أن يُرفض:
--      select public.admin_code_view('101112');
--      -- {"ok": false, "error": "weak_code"}
--
--   4) زبون يلغي طلب غيره:
--      select public.customer_cancel_order('<order-id>');
--      -- {"ok": false, "error": "not_owner"}
-- ============================================================
