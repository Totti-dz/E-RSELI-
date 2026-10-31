-- ============================================================
-- ERSEL — 15: قفل التقييم + إشعار تأكيد الاستلام + Realtime للطلبات
-- يُنفَّذ بعد 14. آمن للتشغيل أكثر من مرة.
-- لا يحذف جداول ولا بيانات.
-- ============================================================

-- ------------------------------------------------------------
-- 1) تقييم واحد لكل طلب: رفض التكرار بدل التحديث
-- ------------------------------------------------------------
create or replace function public.rate_courier(
  p_order_id uuid,
  p_stars integer,
  p_comment text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_comment text := left(btrim(coalesce(p_comment, '')), 500);
  v_row     public.orders%rowtype;
  v_id      uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if p_stars is null or p_stars < 1 or p_stars > 5 then
    return jsonb_build_object('ok', false, 'error', 'stars_invalid');
  end if;

  select * into v_row from public.orders where id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;
  if v_row.customer_id is distinct from v_uid then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;
  if v_row.courier_id is null then
    return jsonb_build_object('ok', false, 'error', 'no_courier');
  end if;
  if v_row.status is distinct from 'delivered'::public.order_status then
    return jsonb_build_object('ok', false, 'error', 'not_delivered');
  end if;
  if v_row.customer_confirmed_at is null then
    return jsonb_build_object('ok', false, 'error', 'confirm_first');
  end if;

  insert into public.order_ratings (order_id, customer_id, courier_id, stars, comment)
  values (p_order_id, v_uid, v_row.courier_id, p_stars, v_comment)
  on conflict (order_id) do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'already_rated');
  end if;

  return jsonb_build_object('ok', true, 'courier_id', v_row.courier_id, 'stars', p_stars);
end;
$$;

revoke all on function public.rate_courier(uuid, integer, text) from public, anon;
grant execute on function public.rate_courier(uuid, integer, text) to authenticated;

-- ------------------------------------------------------------
-- 2) إشعار الموصّل عندما يؤكد الزبون الاستلام
--    (إشعار الزبون عند تأكيد الموصّل يمر عبر تغيّر الحالة إلى delivered)
-- ------------------------------------------------------------
create or replace function public.ersel_notify_customer_receipt()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.customer_confirmed_at is not null
     and old.customer_confirmed_at is null
     and new.courier_id is not null then
    insert into public.notifications (user_id, kind, title, body, order_id)
    values (
      new.courier_id,
      'status',
      'أكد الزبون استلام الطلب',
      concat_ws(' · ',
        nullif(coalesce(new.order_code, ''), ''),
        case when new.completed_at is not null then 'اكتمل الطلب من الطرفين' else 'بانتظار تأكيدك للتسليم' end
      ),
      new.id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists orders_notify_customer_receipt on public.orders;
create trigger orders_notify_customer_receipt
  after update of customer_confirmed_at on public.orders
  for each row execute function public.ersel_notify_customer_receipt();

-- عنوان أوضح عندما يصل الطلب إلى delivered عبر تأكيد الموصّل.
create or replace function public.ersel_notify_order_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_title text;
  v_body  text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  v_title := case new.status
    when 'accepted'::public.order_status  then 'تم قبول طلبك'
    when 'picked_up'::public.order_status then 'استلم الموصّل طلبك'
    when 'in_transit'::public.order_status then 'طلبك في الطريق'
    when 'delivered'::public.order_status then 'أكد الموصّل تسليم طلبك'
    when 'cancelled'::public.order_status then 'تم إلغاء الطلب'
    else 'تحديث على طلبك'
  end;
  v_body := concat_ws(' · ',
    nullif(coalesce(new.order_code, ''), ''),
    new.pickup || ' ← ' || new.dropoff,
    case when new.status = 'delivered'::public.order_status
         then 'أكّد الاستلام من جهتك حتى يكتمل الطلب'
         else null end
  );

  if new.customer_id is not null then
    insert into public.notifications (user_id, kind, title, body, order_id)
    values (new.customer_id, 'status', v_title, v_body, new.id);
  end if;

  if new.status = 'cancelled'::public.order_status and new.courier_id is not null then
    insert into public.notifications (user_id, kind, title, body, order_id)
    values (new.courier_id, 'status', 'أُلغي طلب كنت مسندًا له', v_body, new.id);
  end if;

  return new;
end;
$$;

-- ------------------------------------------------------------
-- 3) Realtime: الطلبات (لوحة الموظف تختفي فور الإسناد)
-- ------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.orders;
exception when duplicate_object or undefined_object or insufficient_privilege then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object or undefined_object or insufficient_privilege then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.order_messages;
exception when duplicate_object or undefined_object or insufficient_privilege then null;
end $$;
