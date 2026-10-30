-- ============================================================
-- ERSEL v2 — ملف SQL واحد (يمكن تشغيله أكثر من مرة بأمان)
-- يضيف: الحد الأدنى 100 دج، عروض السائقين (تفاوض السعر)،
--       دخول الإدارة بالرمز من الخادم، واستعادة كلمة السر بالهاتف.
-- شغّله في Supabase → SQL Editor بعد الهجرات 01 إلى 05.
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1) الحد الأدنى للسعر 100 دج (الطلبات القديمة لا تتأثر)
--
-- `not valid` ضروري: الطلبات التجريبية القديمة قد تحمل سعرًا أقل من 100 دج،
-- وكان القيد يفشل التشغيل كله على قاعدة فيها بيانات. القيد يبقى مفعّلًا على
-- كل صف جديد أو معدّل، ثم نحاول التحقق من القديم بلا إفشال الملف.
-- ------------------------------------------------------------
alter table public.orders drop constraint if exists orders_min_price;
alter table public.orders add constraint orders_min_price
  check (price_dzd >= 100 or created_at < timestamptz '2026-10-29') not valid;

do $$
begin
  alter table public.orders validate constraint orders_min_price;
exception when check_violation then
  raise notice 'ERSEL: طلبات قديمة بسعر أقل من 100 دج موجودة؛ القيد يطبق على الطلبات الجديدة فقط.';
end $$;

-- سعر مقترح من المسافة بالمتر: 100 دج + 30 دج لكل كم بعد أول كم، مقرّب لأقرب 10
create or replace function public.suggest_price_dzd(p_distance_m numeric)
returns integer language sql immutable as $$
  select greatest(100, (round((100 + 30 * greatest(coalesce(p_distance_m, 0) / 1000.0 - 1, 0)) / 10.0) * 10)::integer);
$$;

-- ------------------------------------------------------------
-- 2) حماية الأدوار: لا تتغير إلا بيد مدير أو عبر admin_unlock
-- ------------------------------------------------------------
create or replace function public.protect_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role
     and coalesce(current_setting('app.role_change_ok', true), '') <> '1'
     and public.current_app_role() is distinct from 'admin'::public.app_role then
    raise exception 'Only an administrator may change account roles';
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------
-- 3) دخول الإدارة بالرمز — الرمز مخزَّن مشفّراً في القاعدة فقط
--    لا يوجد في كود المتصفح. أي حساب مسجّل يعرف الرمز يصبح مديراً.
--    5 محاولات فاشلة للحساب / 30 عامة كل 15 دقيقة ثم قفل مؤقت.
-- ------------------------------------------------------------
create table if not exists public.admin_secret (
  id boolean primary key default true check (id),
  code_hash text not null
);
create table if not exists public.admin_unlock_attempts (
  id bigserial primary key,
  user_id uuid,
  ok boolean not null,
  at timestamptz not null default now()
);
alter table public.admin_secret enable row level security;
alter table public.admin_unlock_attempts enable row level security;
revoke all on public.admin_secret, public.admin_unlock_attempts from anon, authenticated;

-- الرمز الابتدائي 101112 (يُضاف مرة واحدة فقط). غيّره بعد التشغيل:
--   select public.set_admin_code('رمز-أطول-وأقوى');
insert into public.admin_secret (id, code_hash)
values (true, crypt('101112', gen_salt('bf', 10)))
on conflict (id) do nothing;

create or replace function public.set_admin_code(p_code text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if length(coalesce(p_code, '')) < 6 then raise exception 'code_too_short'; end if;
  insert into public.admin_secret (id, code_hash) values (true, crypt(p_code, gen_salt('bf', 10)))
  on conflict (id) do update set code_hash = excluded.code_hash;
end;
$$;
revoke all on function public.set_admin_code(text) from public, anon, authenticated;

create or replace function public.admin_unlock(p_code text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_hash text;
  v_user_fail integer;
  v_all_fail integer;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;

  select count(*) into v_user_fail from public.admin_unlock_attempts
    where user_id = v_uid and not ok and at > now() - interval '15 minutes';
  select count(*) into v_all_fail from public.admin_unlock_attempts
    where not ok and at > now() - interval '15 minutes';
  if v_user_fail >= 5 or v_all_fail >= 30 then
    return jsonb_build_object('ok', false, 'error', 'locked');
  end if;

  select code_hash into v_hash from public.admin_secret where id;
  if v_hash is null or p_code is null or crypt(p_code, v_hash) <> v_hash then
    insert into public.admin_unlock_attempts (user_id, ok) values (v_uid, false);
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;

  insert into public.admin_unlock_attempts (user_id, ok) values (v_uid, true);
  perform set_config('app.role_change_ok', '1', true);
  update public.profiles set role = 'admin' where id = v_uid;
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.admin_unlock(text) to authenticated;

-- ------------------------------------------------------------
-- 4) استعادة كلمة السر بالهاتف (بدون OTP حسب طلبك)
--    تحذير: من يعرف رقم شخص يستطيع تغيير كلمة سره. التخفيف:
--    حد 3 محاولات/ساعة لكل رقم، ولا تعمل على حسابات الإدارة/الموظفين،
--    وتُنهى الجلسات القديمة بعد التغيير.
-- ------------------------------------------------------------
create table if not exists public.password_reset_log (
  id bigserial primary key,
  phone text not null,
  ok boolean not null,
  at timestamptz not null default now()
);
alter table public.password_reset_log enable row level security;
revoke all on public.password_reset_log from anon, authenticated;

create or replace function public.reset_password_by_phone(p_phone text, p_new_password text)
returns jsonb language plpgsql security definer set search_path = public, extensions, auth as $$
declare
  v_digits text;
  v_uid uuid;
  v_role public.app_role;
begin
  v_digits := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if v_digits like '213%' then v_digits := substr(v_digits, 4); end if;
  v_digits := regexp_replace(v_digits, '^0+', '');
  if v_digits !~ '^[5-7][0-9]{8}$' then return jsonb_build_object('ok', false, 'error', 'phone_invalid'); end if;

  if length(coalesce(p_new_password, '')) < 8
     or p_new_password !~ '[0-9]'
     or p_new_password !~ '[A-Za-zء-ي]' then
    return jsonb_build_object('ok', false, 'error', 'password_weak');
  end if;

  if (select count(*) from public.password_reset_log where phone = v_digits and at > now() - interval '1 hour') >= 3
     or (select count(*) from public.password_reset_log where at > now() - interval '1 hour') >= 100 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  insert into public.password_reset_log (phone, ok) values (v_digits, false);

  select id into v_uid from auth.users where email = '213' || v_digits || '@phone.ersel.app';
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'account_not_found'); end if;

  select role into v_role from public.profiles where id = v_uid;
  if v_role in ('admin', 'employee') then
    return jsonb_build_object('ok', false, 'error', 'staff_not_allowed');
  end if;

  update auth.users set encrypted_password = crypt(p_new_password, gen_salt('bf')), updated_at = now()
    where id = v_uid;
  delete from auth.sessions where user_id = v_uid;
  update public.password_reset_log set ok = true
    where id = (select max(id) from public.password_reset_log where phone = v_digits);
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.reset_password_by_phone(text, text) to anon, authenticated;

-- ------------------------------------------------------------
-- 5) عروض السائقين (تفاوض السعر)
-- ------------------------------------------------------------
create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  courier_id uuid not null references public.profiles(id) on delete cascade,
  price_dzd integer not null check (price_dzd >= 100 and price_dzd <= 500000),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  unique (order_id, courier_id)
);
create index if not exists offers_order_idx on public.offers (order_id);
alter table public.offers enable row level security;

drop policy if exists "offers read" on public.offers;
create policy "offers read" on public.offers for select to authenticated using (
  courier_id = auth.uid()
  or exists (select 1 from public.orders o where o.id = offers.order_id and o.customer_id = auth.uid())
  or public.current_app_role() = 'admin'
);
-- لا سياسات كتابة: الكتابة عبر الدالتين أدناه فقط.

create or replace function public.place_offer(p_order_id uuid, p_price integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_status public.order_status;
  v_courier uuid;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  if p_price is null or p_price < 100 or p_price > 500000 then
    return jsonb_build_object('ok', false, 'error', 'price_invalid');
  end if;
  if not (
    exists (select 1 from public.courier_profiles where user_id = v_uid and is_verified)
    or public.current_app_role() in ('employee', 'admin')
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_verified');
  end if;

  select status, courier_id into v_status, v_courier from public.orders where id = p_order_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'order_not_found'); end if;
  if v_status <> 'pending' or v_courier is not null then
    return jsonb_build_object('ok', false, 'error', 'order_closed');
  end if;

  insert into public.offers (order_id, courier_id, price_dzd) values (p_order_id, v_uid, p_price)
  on conflict (order_id, courier_id) do update set price_dzd = excluded.price_dzd, status = 'pending', created_at = now();
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.place_offer(uuid, integer) to authenticated;

create or replace function public.accept_offer(p_offer_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_offer public.offers%rowtype;
  v_order public.orders%rowtype;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  select * into v_offer from public.offers where id = p_offer_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'offer_not_found'); end if;

  select * into v_order from public.orders where id = v_offer.order_id for update;
  if v_order.customer_id is distinct from v_uid then return jsonb_build_object('ok', false, 'error', 'not_owner'); end if;
  if v_order.status <> 'pending' or v_order.courier_id is not null then
    return jsonb_build_object('ok', false, 'error', 'order_closed');
  end if;

  update public.orders
    set courier_id = v_offer.courier_id, status = 'accepted', price_dzd = v_offer.price_dzd
    where id = v_order.id;
  update public.offers set status = case when id = p_offer_id then 'accepted' else 'rejected' end
    where order_id = v_order.id;
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.accept_offer(uuid) to authenticated;

-- تحديثات لحظية للعروض
do $$
begin
  alter publication supabase_realtime add table public.offers;
exception when duplicate_object or undefined_object then null;
end $$;
