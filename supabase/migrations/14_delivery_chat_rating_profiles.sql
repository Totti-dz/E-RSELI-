-- ============================================================
-- ERSEL — Migration 14: التسليم الثنائي + التقييم + الدردشة + الإشعارات + الملفات
-- يُنفَّذ بعد 13. آمن للتشغيل أكثر من مرة.
--
-- يضيف:
--   A) تأكيد التسليم من الطرفين:
--        orders.courier_confirmed_at  ← الموصّل يؤكد أنه سلّم
--        orders.customer_confirmed_at ← الزبون يؤكد أنه استلم
--        orders.completed_at          ← يُضبط تلقائيًا عند اجتماع التأكيدين
--   B) تقييم الموصّل بعد التسليم (order_ratings) — تقييم واحد لكل طلب.
--   C) دردشة كتابية لكل طلب (order_messages) بين الزبون والموصّل المسند.
--   D) إشعارات داخل التطبيق (notifications) تُبثّ لكل الموصّلين المعتمدين
--      عند وصول طلب جديد، وللزبون عند تغيّر الحالة، وللطرف الآخر عند الرسائل.
--   E) لوحة أسبوعية لكل موظف (courier_dashboard): مهام ناجحة / قيد التنفيذ
--      / مؤكَّدة من الزبون / ملغاة / مجموع الدخل، خلال كل أسبوع.
--   F) صورة شخصية لكل حساب (profiles.avatar_url) + دلو تخزين «avatars».
--
-- لماذا عمودان بدل حالة enum جديدة:
--   إضافة قيمة إلى enum قائمة تحتاج ALTER TYPE ... ADD VALUE وهي لا تعمل
--   داخل معاملة واحدة في نسخ PostgreSQL الأقدم. عمودا وقت يعطيان نفس
--   المعلومة بلا أي خطر على البيانات القائمة.
-- ============================================================

-- ------------------------------------------------------------
-- A) أعمدة التأكيد والملف الشخصي
-- ------------------------------------------------------------
alter table public.profiles add column if not exists avatar_url text;

alter table public.orders add column if not exists courier_confirmed_at  timestamptz;
alter table public.orders add column if not exists customer_confirmed_at timestamptz;
alter table public.orders add column if not exists completed_at          timestamptz;

create index if not exists orders_completed_idx
  on public.orders (completed_at desc) where completed_at is not null;

-- completed_at يُضبط مرة واحدة حين يوجد التأكيدان، أيًّا كان ترتيب وصولهما.
create or replace function public.orders_mark_completed()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.courier_confirmed_at is not null
     and new.customer_confirmed_at is not null
     and new.completed_at is null then
    new.completed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists orders_mark_completed on public.orders;
create trigger orders_mark_completed
  before update on public.orders
  for each row execute function public.orders_mark_completed();

-- ------------------------------------------------------------
-- B) من يشارك في الطلب؟ (يتجاوز RLS على orders)
--    تُستعمل في سياسات الدردشة كي لا تتكرر الاستعلامات المفتوحة.
-- ------------------------------------------------------------
create or replace function public.is_order_participant(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.orders o
     where o.id = p_order_id
       and (o.customer_id = auth.uid() or o.courier_id = auth.uid())
  );
$$;

revoke all on function public.is_order_participant(uuid) from public, anon;
grant execute on function public.is_order_participant(uuid) to authenticated;

-- ------------------------------------------------------------
-- C) الدردشة الكتابية
-- ------------------------------------------------------------
create table if not exists public.order_messages (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  sender_id   uuid not null references public.profiles(id) on delete cascade,
  sender_role public.app_role not null default 'customer',
  body        text not null check (char_length(btrim(body)) between 1 and 1000),
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists order_messages_order_idx
  on public.order_messages (order_id, created_at);

alter table public.order_messages enable row level security;

drop policy if exists "order messages read participants" on public.order_messages;
create policy "order messages read participants"
  on public.order_messages
  for select
  to authenticated
  using (
    public.is_order_participant(order_id)
    or public.current_app_role() = 'admin'::public.app_role
  );

-- لا سياسة كتابة: الإرسال يمر عبر send_order_message وحدها
-- (تضبط sender_id من الجلسة وترفض غير المشاركين).
drop policy if exists "order messages insert" on public.order_messages;

-- إرسال رسالة: الطرفان فقط، وبعد إسناد الطلب، وليس على طلب ملغى.
create or replace function public.send_order_message(p_order_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_row  public.orders%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if char_length(v_body) < 1 then
    return jsonb_build_object('ok', false, 'error', 'empty_message');
  end if;
  if char_length(v_body) > 1000 then
    return jsonb_build_object('ok', false, 'error', 'message_too_long');
  end if;

  select * into v_row from public.orders where id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;
  if v_row.customer_id is distinct from v_uid and v_row.courier_id is distinct from v_uid then
    return jsonb_build_object('ok', false, 'error', 'not_participant');
  end if;
  if v_row.courier_id is null then
    return jsonb_build_object('ok', false, 'error', 'no_courier_yet');
  end if;
  if v_row.status = 'cancelled'::public.order_status then
    return jsonb_build_object('ok', false, 'error', 'order_closed');
  end if;

  insert into public.order_messages (order_id, sender_id, sender_role, body)
  values (p_order_id, v_uid, coalesce(public.current_app_role(), 'customer'::public.app_role), v_body);

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.send_order_message(uuid, text) from public, anon;
grant execute on function public.send_order_message(uuid, text) to authenticated;

-- تعليم رسائل الطلب كمقروءة (للطرف المستدعي فقط).
create or replace function public.mark_order_messages_read(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if not public.is_order_participant(p_order_id) then
    return jsonb_build_object('ok', false, 'error', 'not_participant');
  end if;

  update public.order_messages
     set read_at = now()
   where order_id = p_order_id
     and sender_id <> v_uid
     and read_at is null;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.mark_order_messages_read(uuid) from public, anon;
grant execute on function public.mark_order_messages_read(uuid) to authenticated;

-- ------------------------------------------------------------
-- D) تقييم الموصّل
-- ------------------------------------------------------------
create table if not exists public.order_ratings (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null unique references public.orders(id) on delete cascade,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  courier_id  uuid not null references public.profiles(id) on delete cascade,
  stars       integer not null check (stars between 1 and 5),
  comment     text not null default '' check (char_length(comment) <= 500),
  created_at  timestamptz not null default now()
);

create index if not exists order_ratings_courier_idx
  on public.order_ratings (courier_id, created_at desc);

alter table public.order_ratings enable row level security;

drop policy if exists "ratings read own or admin" on public.order_ratings;
create policy "ratings read own or admin"
  on public.order_ratings
  for select
  to authenticated
  using (
    customer_id = auth.uid()
    or courier_id = auth.uid()
    or public.current_app_role() = 'admin'::public.app_role
  );

drop policy if exists "ratings insert" on public.order_ratings;

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
  on conflict (order_id) do update
    set stars = excluded.stars,
        comment = excluded.comment,
        created_at = now();

  return jsonb_build_object('ok', true, 'courier_id', v_row.courier_id, 'stars', p_stars);
end;
$$;

revoke all on function public.rate_courier(uuid, integer, text) from public, anon;
grant execute on function public.rate_courier(uuid, integer, text) to authenticated;

-- ------------------------------------------------------------
-- E) الإشعارات داخل التطبيق
--    جدول واحد لكل مستخدم. التطبيق يقرأ غير المقروء كل بضع ثوانٍ
--    ويُظهر إشعارًا محليًا بصوت مخصّص — يعمل بلا Firebase.
-- ------------------------------------------------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null default 'order'
             check (kind in ('new_order', 'status', 'message', 'rating', 'system')),
  title      text not null,
  body       text not null default '',
  order_id   uuid references public.orders(id) on delete cascade,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "notifications read own" on public.notifications;
create policy "notifications read own"
  on public.notifications for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "notifications update own" on public.notifications;
create policy "notifications update own"
  on public.notifications for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "notifications delete own" on public.notifications;
create policy "notifications delete own"
  on public.notifications for delete to authenticated
  using (user_id = auth.uid());

-- لا سياسة insert: كل الكتابة من محفّزات SECURITY DEFINER أدناه.

-- E1) طلب جديد → إشعار لكل موظف وكل موصّل معتمد (بثّ عام).
create or replace function public.ersel_broadcast_new_order()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status is distinct from 'pending'::public.order_status then
    return new;
  end if;

  insert into public.notifications (user_id, kind, title, body, order_id)
  select p.id,
         'new_order',
         'طلب جديد متاح الآن',
         concat_ws(' · ',
           nullif(coalesce(new.order_code, ''), ''),
           new.pickup || ' ← ' || new.dropoff,
           new.price_dzd::text || ' دج'
         ),
         new.id
    from public.profiles p
    left join public.courier_profiles cp on cp.user_id = p.id
   where (
           p.role = 'employee'::public.app_role
           or (p.role = 'courier'::public.app_role and coalesce(cp.is_verified, false))
         )
     and (new.customer_id is null or p.id <> new.customer_id);

  return new;
end;
$$;

drop trigger if exists orders_broadcast_new on public.orders;
create trigger orders_broadcast_new
  after insert on public.orders
  for each row execute function public.ersel_broadcast_new_order();

-- E2) تغيّر حالة الطلب → إشعار للزبون (وللموصّل عند الإلغاء).
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
    when 'delivered'::public.order_status then 'تم تسليم طلبك'
    when 'cancelled'::public.order_status then 'تم إلغاء الطلب'
    else 'تحديث على طلبك'
  end;
  v_body := concat_ws(' · ',
    nullif(coalesce(new.order_code, ''), ''),
    new.pickup || ' ← ' || new.dropoff
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

drop trigger if exists orders_notify_status on public.orders;
create trigger orders_notify_status
  after update of status on public.orders
  for each row execute function public.ersel_notify_order_status();

-- E3) رسالة جديدة → إشعار للطرف الآخر.
create or replace function public.ersel_notify_order_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order  public.orders%rowtype;
  v_target uuid;
  v_sender text;
begin
  select * into v_order from public.orders where id = new.order_id;
  if not found then
    return new;
  end if;

  v_target := case
    when new.sender_id = v_order.customer_id then v_order.courier_id
    else v_order.customer_id
  end;
  if v_target is null then
    return new;
  end if;

  select full_name into v_sender from public.profiles where id = new.sender_id;

  insert into public.notifications (user_id, kind, title, body, order_id)
  values (
    v_target,
    'message',
    'رسالة من ' || coalesce(nullif(v_sender, ''), 'الطرف الآخر'),
    left(new.body, 160),
    new.order_id
  );

  return new;
end;
$$;

drop trigger if exists order_messages_notify on public.order_messages;
create trigger order_messages_notify
  after insert on public.order_messages
  for each row execute function public.ersel_notify_order_message();

-- E4) قراءة الإشعارات وتعليمها.
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_n   integer;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  update public.notifications
     set read_at = now()
   where user_id = v_uid
     and read_at is null
     and (p_ids is null or id = any(p_ids));

  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'updated', v_n);
end;
$$;

revoke all on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

create or replace function public.unread_notification_count()
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::integer
    from public.notifications
   where user_id = auth.uid()
     and read_at is null;
$$;

revoke all on function public.unread_notification_count() from public, anon;
grant execute on function public.unread_notification_count() to authenticated;

-- ------------------------------------------------------------
-- F) تأكيد التسليم من الطرفين
-- ------------------------------------------------------------

-- الموصّل المسند فقط. يقبل من «تم الاستلام» أو «في الطريق»، ويُعاد بأمان
-- إذا سبق التأكيد.
create or replace function public.courier_confirm_delivery(p_order_id uuid)
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

  select * into v_row from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;
  if v_row.courier_id is distinct from v_uid then
    return jsonb_build_object('ok', false, 'error', 'not_assigned');
  end if;
  if v_row.status = 'cancelled'::public.order_status then
    return jsonb_build_object('ok', false, 'error', 'order_closed');
  end if;
  if v_row.status not in (
    'picked_up'::public.order_status,
    'in_transit'::public.order_status,
    'delivered'::public.order_status
  ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_transition');
  end if;

  update public.orders
     set status = 'delivered'::public.order_status,
         courier_confirmed_at = coalesce(courier_confirmed_at, now())
   where id = p_order_id;

  select * into v_row from public.orders where id = p_order_id;

  return jsonb_build_object(
    'ok', true,
    'status', 'delivered',
    'courier_confirmed', true,
    'customer_confirmed', v_row.customer_confirmed_at is not null,
    'completed', v_row.completed_at is not null
  );
end;
$$;

revoke all on function public.courier_confirm_delivery(uuid) from public, anon;
grant execute on function public.courier_confirm_delivery(uuid) to authenticated;

-- الزبون صاحب الطلب فقط، وبعد إسناد موصّل.
create or replace function public.customer_confirm_delivery(p_order_id uuid)
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

  select * into v_row from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;
  if v_row.customer_id is distinct from v_uid then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;
  if v_row.courier_id is null then
    return jsonb_build_object('ok', false, 'error', 'no_courier_yet');
  end if;
  if v_row.status = 'cancelled'::public.order_status then
    return jsonb_build_object('ok', false, 'error', 'order_closed');
  end if;
  if v_row.status = 'pending'::public.order_status then
    return jsonb_build_object('ok', false, 'error', 'invalid_transition');
  end if;

  update public.orders
     set customer_confirmed_at = coalesce(customer_confirmed_at, now())
   where id = p_order_id;

  select * into v_row from public.orders where id = p_order_id;

  return jsonb_build_object(
    'ok', true,
    'status', v_row.status,
    'courier_confirmed', v_row.courier_confirmed_at is not null,
    'customer_confirmed', true,
    'completed', v_row.completed_at is not null
  );
end;
$$;

revoke all on function public.customer_confirm_delivery(uuid) from public, anon;
grant execute on function public.customer_confirm_delivery(uuid) to authenticated;

-- ------------------------------------------------------------
-- تأكيد استلام طلب ضيف برمز التتبّع فقط.
--   رمز التتبّع سرّي (32 حرفًا على الأقل) ويُخزَّن مُهشَّرًا، ولا يُقبل
--   رقم الطلب ولا البريد. الطلب يجب أن يكون مُسندًا لموصّل وغير ملغى.
-- ------------------------------------------------------------
create or replace function public.guest_confirm_delivery(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hash text;
  v_row  public.orders%rowtype;
begin
  if p_token is null or char_length(btrim(p_token)) < 32 then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_hash := encode(digest(btrim(p_token) || (select value from public.private_config
                                               where key = 'guest_phone_pepper'), 'sha256'), 'hex');

  select * into v_row
    from public.orders
   where tracking_token_hash = v_hash
     and is_guest
   limit 1
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_row.courier_id is null then
    return jsonb_build_object('ok', false, 'error', 'no_courier_yet');
  end if;
  if v_row.status = 'cancelled'::public.order_status then
    return jsonb_build_object('ok', false, 'error', 'order_closed');
  end if;
  if v_row.status = 'pending'::public.order_status then
    return jsonb_build_object('ok', false, 'error', 'invalid_transition');
  end if;

  update public.orders
     set customer_confirmed_at = coalesce(customer_confirmed_at, now())
   where id = v_row.id;

  select * into v_row from public.orders where id = v_row.id;

  return jsonb_build_object(
    'ok', true,
    'status', v_row.status,
    'courier_confirmed', v_row.courier_confirmed_at is not null,
    'customer_confirmed', v_row.customer_confirmed_at is not null,
    'completed', v_row.completed_at is not null
  );
end;
$$;

revoke all on function public.guest_confirm_delivery(text) from public;
grant execute on function public.guest_confirm_delivery(text) to anon, authenticated;

-- نفس توقيع get_guest_order السابق، مع حقول التأكيد فقط (إضافة متوافقة).
create or replace function public.get_guest_order(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_hash text;
  v_row  record;
begin
  if p_token is null or char_length(p_token) < 32 then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_hash := encode(digest(p_token || (select value from public.private_config
                                        where key = 'guest_phone_pepper'), 'sha256'), 'hex');

  select order_code, service, status, created_at, updated_at,
         price_dzd, courier_confirmed_at, customer_confirmed_at, completed_at,
         (select p.full_name from public.profiles p where p.id = o.courier_id) as courier_name
    into v_row
  from public.orders o
  where tracking_token_hash = v_hash
    and is_guest
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'order_code', v_row.order_code,
    'service', v_row.service,
    'status', v_row.status,
    'created_at', v_row.created_at,
    'updated_at', v_row.updated_at,
    'price_dzd', v_row.price_dzd,
    'courier_name', v_row.courier_name,
    'courier_confirmed', v_row.courier_confirmed_at is not null,
    'customer_confirmed', v_row.customer_confirmed_at is not null,
    'completed', v_row.completed_at is not null
  );
end;
$$;

revoke all on function public.get_guest_order(text) from public;
grant execute on function public.get_guest_order(text) to anon, authenticated;

-- التقدّم العادي: حين يصل إلى delivered عبر staff_advance_order يُسجَّل
-- تأكيد الموصّل أيضًا، حتى لا يبقى الطلب بلا تأكيد.
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

  update public.orders
     set status = p_next,
         courier_confirmed_at = case
           when p_next = 'delivered'::public.order_status
             then coalesce(courier_confirmed_at, now())
           else courier_confirmed_at
         end
   where id = p_order_id;

  return jsonb_build_object('ok', true, 'status', p_next);
end;
$$;

revoke all on function public.staff_advance_order(uuid, public.order_status) from public;
grant execute on function public.staff_advance_order(uuid, public.order_status) to authenticated;

-- ------------------------------------------------------------
-- G) لوحة أسبوعية لكل موظف
--    أسبوع واحد = 7 أيام تبدأ الاثنين (date_trunc('week')).
--    «ناجحة» = سُلّمت. «مؤكَّدة» = أكّدها الزبون أيضًا.
-- ------------------------------------------------------------
create or replace function public.courier_dashboard(
  p_user uuid default null,
  p_weeks integer default 8
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := coalesce(p_user, auth.uid());
  v_weeks    integer := greatest(1, least(26, coalesce(p_weeks, 8)));
  v_role     public.app_role;
  v_rating   numeric;
  v_ratings  integer;
  v_weeks_j  jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  v_role := public.current_app_role();
  if v_uid is distinct from auth.uid()
     and v_role not in ('admin'::public.app_role, 'employee'::public.app_role) then
    return jsonb_build_object('ok', false, 'error', 'permission_denied');
  end if;

  select round(avg(r.stars)::numeric, 2), count(*)::integer
    into v_rating, v_ratings
    from public.order_ratings r
   where r.courier_id = v_uid;

  select coalesce(jsonb_agg(entry order by entry->>'week_start' desc), '[]'::jsonb)
    into v_weeks_j
    from (
      select jsonb_build_object(
        'week_start', to_char(w.week_start, 'YYYY-MM-DD'),
        'successful', coalesce(s.successful, 0),
        'active', coalesce(s.active, 0),
        'confirmed', coalesce(s.confirmed, 0),
        'cancelled', coalesce(s.cancelled, 0),
        'earnings_dzd', coalesce(s.earnings, 0)
      ) as entry
      from (
        select generate_series(
          date_trunc('week', now()) - ((v_weeks - 1) || ' weeks')::interval,
          date_trunc('week', now()),
          '1 week'::interval
        ) as week_start
      ) w
      left join lateral (
        select
          count(*) filter (where o.status = 'delivered'::public.order_status) as successful,
          count(*) filter (where o.status in (
            'accepted'::public.order_status,
            'picked_up'::public.order_status,
            'in_transit'::public.order_status
          )) as active,
          count(*) filter (where o.completed_at is not null) as confirmed,
          count(*) filter (where o.status = 'cancelled'::public.order_status) as cancelled,
          coalesce(sum(o.price_dzd) filter (where o.status = 'delivered'::public.order_status), 0) as earnings
        from public.orders o
        where o.courier_id = v_uid
          and o.created_at >= w.week_start
          and o.created_at <  w.week_start + interval '7 days'
      ) s on true
    ) listed;

  return jsonb_build_object(
    'ok', true,
    'user_id', v_uid,
    'rating_avg', v_rating,
    'rating_count', v_ratings,
    'totals', jsonb_build_object(
      'delivered', (select count(*) from public.orders o where o.courier_id = v_uid and o.status = 'delivered'),
      'completed', (select count(*) from public.orders o where o.courier_id = v_uid and o.completed_at is not null),
      'active',    (select count(*) from public.orders o where o.courier_id = v_uid
                    and o.status in ('accepted','picked_up','in_transit')),
      'offers',    (select count(*) from public.offers f where f.courier_id = v_uid)
    ),
    'weeks', v_weeks_j
  );
end;
$$;

revoke all on function public.courier_dashboard(uuid, integer) from public, anon;
grant execute on function public.courier_dashboard(uuid, integer) to authenticated;

-- ------------------------------------------------------------
-- H) تعديل الملف الشخصي (الاسم + الصورة) — الدور لا يتغيّر هنا
-- ------------------------------------------------------------
create or replace function public.update_my_profile(
  p_full_name text default null,
  p_avatar_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text;
  v_url  text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if p_full_name is not null then
    v_name := btrim(p_full_name);
    if char_length(v_name) < 2 or char_length(v_name) > 60 then
      return jsonb_build_object('ok', false, 'error', 'name_invalid');
    end if;
  end if;

  if p_avatar_url is not null then
    v_url := btrim(p_avatar_url);
    if v_url <> '' and v_url !~* '^https?://' then
      return jsonb_build_object('ok', false, 'error', 'avatar_invalid');
    end if;
    if char_length(v_url) > 800 then
      return jsonb_build_object('ok', false, 'error', 'avatar_invalid');
    end if;
  end if;

  update public.profiles
     set full_name  = coalesce(v_name, full_name),
         avatar_url = case when p_avatar_url is null then avatar_url else nullif(v_url, '') end
   where id = v_uid;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'profile_missing');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.update_my_profile(text, text) from public, anon;
grant execute on function public.update_my_profile(text, text) to authenticated;

-- ------------------------------------------------------------
-- I) staff_list_jobs — إضافة حقول التأكيد والعرض والدردشة
--    نفس التوقيع، لذا create or replace آمن.
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
          'courier_confirmed_at', o.courier_confirmed_at,
          'customer_confirmed_at', o.customer_confirmed_at,
          'completed_at', o.completed_at,
          'order_code', coalesce(o.order_code, ''),
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
          end,
          'customer_avatar', case
            when o.courier_id = v_uid or v_role = 'admin'::public.app_role then cp.avatar_url
            else null
          end,
          'customer_rating', case
            when o.courier_id = v_uid then (
              select r.stars from public.order_ratings r where r.order_id = o.id
            )
            else null
          end,
          'my_offer', (
            select f.price_dzd from public.offers f
             where f.order_id = o.id and f.courier_id = v_uid
             order by f.created_at desc limit 1
          ),
          'offers_count', (
            select count(*) from public.offers f
             where f.order_id = o.id and f.status = 'pending'
          ),
          'unread_messages', (
            select count(*) from public.order_messages m
             where m.order_id = o.id and m.sender_id <> v_uid and m.read_at is null
          )
        ) as job
        from public.orders o
        left join public.profiles cp on cp.id = o.customer_id
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
-- J) customer_my_orders — كل ما تحتاجه شاشة «طلباتي» في نداء واحد
--    (بيانات الموصّل + تقييمه + تقييمي + عروض السعر + رسائل غير مقروءة)
-- ------------------------------------------------------------
create or replace function public.customer_my_orders()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  return jsonb_build_object(
    'ok', true,
    'orders', coalesce((
      select jsonb_agg(entry order by entry->>'created_at' desc)
      from (
        select jsonb_build_object(
          'id', o.id,
          'order_code', coalesce(o.order_code, ''),
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
          'created_at', o.created_at,
          'updated_at', o.updated_at,
          'courier_confirmed_at', o.courier_confirmed_at,
          'customer_confirmed_at', o.customer_confirmed_at,
          'completed_at', o.completed_at,
          'courier_name', coalesce(cp.full_name, ''),
          'courier_avatar', cp.avatar_url,
          'courier_phone', coalesce(cp.phone, ''),
          'courier_rating', (
            select round(avg(r.stars)::numeric, 2) from public.order_ratings r
             where r.courier_id = o.courier_id
          ),
          'courier_rating_count', (
            select count(*) from public.order_ratings r where r.courier_id = o.courier_id
          ),
          'my_rating', (
            select jsonb_build_object('stars', r.stars, 'comment', r.comment)
              from public.order_ratings r where r.order_id = o.id
          ),
          'unread_messages', (
            select count(*) from public.order_messages m
             where m.order_id = o.id and m.sender_id <> v_uid and m.read_at is null
          ),
          'offers', coalesce((
            select jsonb_agg(jsonb_build_object(
                     'id', f.id,
                     'price_dzd', f.price_dzd,
                     'created_at', f.created_at,
                     'courier_name', coalesce(fp.full_name, ''),
                     'courier_avatar', fp.avatar_url,
                     'courier_rating', (
                       select round(avg(r2.stars)::numeric, 2) from public.order_ratings r2
                        where r2.courier_id = f.courier_id
                     ),
                     'courier_delivered', (
                       select count(*) from public.orders o2
                        where o2.courier_id = f.courier_id and o2.status = 'delivered'
                     )
                   ) order by f.price_dzd asc)
              from public.offers f
              left join public.profiles fp on fp.id = f.courier_id
             where f.order_id = o.id
               and f.status = 'pending'
               and o.status = 'pending'::public.order_status
               and o.courier_id is null
          ), '[]'::jsonb)
        ) as entry
        from public.orders o
        left join public.profiles cp on cp.id = o.courier_id
        where o.customer_id = v_uid
        order by o.created_at desc
        limit 60
      ) listed
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.customer_my_orders() from public, anon;
grant execute on function public.customer_my_orders() to authenticated;

-- ------------------------------------------------------------
-- K) صور الحسابات — دلو تخزين عام للقراءة، والكتابة لمجلد صاحبه فقط
--    (يعمل فقط على مشروع Supabase فيه مخطط storage؛ يُتجاوز بأمان خلافه)
-- ------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    execute $q$
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('avatars', 'avatars', true, 2097152,
              array['image/png','image/jpeg','image/webp','image/gif'])
      on conflict (id) do update
        set public = true,
            file_size_limit = 2097152,
            allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif']
    $q$;

    execute $q$ drop policy if exists "avatars public read" on storage.objects $q$;
    execute $q$
      create policy "avatars public read" on storage.objects
        for select using (bucket_id = 'avatars')
    $q$;

    execute $q$ drop policy if exists "avatars owner insert" on storage.objects $q$;
    execute $q$
      create policy "avatars owner insert" on storage.objects
        for insert to authenticated
        with check (
          bucket_id = 'avatars'
          and (storage.foldername(name))[1] = auth.uid()::text
        )
    $q$;

    execute $q$ drop policy if exists "avatars owner update" on storage.objects $q$;
    execute $q$
      create policy "avatars owner update" on storage.objects
        for update to authenticated
        using (
          bucket_id = 'avatars'
          and (storage.foldername(name))[1] = auth.uid()::text
        )
    $q$;

    execute $q$ drop policy if exists "avatars owner delete" on storage.objects $q$;
    execute $q$
      create policy "avatars owner delete" on storage.objects
        for delete to authenticated
        using (
          bucket_id = 'avatars'
          and (storage.foldername(name))[1] = auth.uid()::text
        )
    $q$;
  end if;
end $$;

-- ------------------------------------------------------------
-- L) تحديثات لحظية اختيارية (لا تُفشل التشغيل إن كانت مضافة مسبقًا)
-- ------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.order_messages;
exception when duplicate_object or undefined_object or insufficient_privilege then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object or undefined_object or insufficient_privilege then null;
end $$;

-- ============================================================
-- التحقق بعد التنفيذ (اقرأ فقط)
--
--   1) الأعمدة الجديدة:
--      select column_name from information_schema.columns
--       where table_schema='public' and table_name='orders'
--         and column_name like '%confirmed%' or column_name = 'completed_at';
--
--   2) بثّ الطلب الجديد لكل الموصّلين المعتمدين:
--      insert into public.orders (service, customer_name, phone, pickup, dropoff, price_dzd, city)
--      values ('parcel','اختبار','+213551111111','أ','ب',150,'السوقر');
--      select kind, count(*) from public.notifications
--       where kind = 'new_order' group by kind;
--
--   3) لوحة الأسبوع لموظف:
--      select public.courier_dashboard(null, 8);
--
--   4) التقييم قبل التأكيد يجب أن يُرفض:
--      select public.rate_courier('<order-id>', 5, '');
--      -- {"ok": false, "error": "confirm_first"} قبل تأكيد الزبون
-- ============================================================
