-- ============================================================
-- ERSEL / إرسلي — كل كودات SQL في ملف واحد
-- يُنشئ قاعدة كاملة من الصفر على مشروع Supabase جديد.
-- مبني آليًا من ملفات supabase/ عبر: node supabase/build-all-in-one.mjs
-- لا تُحرّره يدويًا: عدّل الملفات الأصلية ثم أعد البناء.
--
-- طريقة التشغيل:
--   1) Supabase → SQL Editor → New query
--   2) الصق الملف كاملًا ثم Run (قد يستغرق بضع ثوانٍ)
--   3) نفّذ قسم التحقق في آخر الملف
--
-- آمن للتشغيل أكثر من مرة: كل الأقسام idempotent (if not exists /
-- create or replace / drop policy before create). لا يحذف أي جدول أو صف.
--
-- الترتيب:
--   01. المخطط الأساسي: الأنواع والجداول والفهارس وسياسات RLS
--   02. الأساس الآمن: profiles + الأدوار + محفّز إنشاء الملف الشخصي
--   03. طلبات الضيف: مناطق الخدمة + رمز التتبع + حدود المعدّل
--   04. حقول إضافية للطلب: notes + السعر + وسيلة النقل للضيف
--   05. لوحة الموظف: قراءة الطلبات المتاحة + المطالبة + تقدم الحالة
--   06. المراجعة الأمنية: مطالبة ذرّية + طلبات الانضمام + إخفاء بيانات الزبون (يشمل 06 المصحّح)
--   07. إحصائيات لوحة الإدارة + إعادة إسناد الطلب
--   08. v2: الحد الأدنى للسعر + عروض الموصّلين + دخول الإدارة + استعادة كلمة المرور
--   09. التقوية: منع ترقية الدور عبر الرمز + تقييد استعادة كلمة المرور
--   10. لوحة القراءة بالرمز + إلغاء الزبون لطلبه + رمز أقوى
--   11. رموز أجهزة الإشعارات (FCM) + تسجيل الرمز من التطبيق
--   12. ترقية حساب المؤسس إلى مدير (آخر خطوة، تتطلب وجود الحساب)
--
-- مستبعد من هذا الملف (موجود في مجلد المشروع للرجوع إليه فقط):
--   - schema.sql — يُستبدل بـ 00_base_schema.sql لأنه يفشل عند إعادة التشغيل.
--   - proposals/06_courier_applications.sql — مضمّن مصحّحًا داخل 07 (جدول + محفّزات + دالتا الإرسال والمراجعة).
--   - proposals/08_admin_desk_accounts.sql — غير جاهز: is_disabled بلا حراسة مصادقة، و admin_cancel_order يتعارض مع 07.
--   - proposals/09_admin_desk_stats_and_reassign.sql — مسودة؛ 10 هو البديل المصحّح.
--
-- تنبيهات قبل الإنتاج:
--   * الرمز الافتراضي 101112 مرفوض في لوحة القراءة بالرمز (القسم 11) حتى
--     تُغيّره إلى 10 محارف على الأقل:
--       select public.set_admin_code('ERSEL-2026-ADMIN');
--   * ترقية حساب المؤسس في القسم الأخير تحتاج أن يكون الحساب مسجَّلًا
--     بنفس البريد؛ إن سجّل لاحقًا فأعد تشغيل القسم الأخير وحده.
--   * «نسيت كلمة المرور» من شاشة الدخول تبقى معطّلة بعد القسم 09 حتى
--     يُضاف رمز لمرة واحدة (OTP) عبر مزوّد رسائل.
--
-- إن فشل التشغيل على قاعدة قديمة (سبق إنشاء جداولها بنسخة أقدم):
--   * "operator does not exist: text = order_status" أو ما يشبهه من
--     مقارنة نص بـ enum → القسم 01 يصلحه تلقائيًا: يحوّل أعمدة
--     profiles.role و orders.status/service/vehicle و courier_profiles.vehicle
--     و courier_applications.status إلى أنواعها الصحيحة قبل أي مقارنة.
--     أعد تشغيل الملف فقط.
--   * "legacy_value_not_in_enum" → يوجد صف بقيمة غير معروفة، والرسالة تعرض
--     القيم نفسها. صحّحها ثم أعد التشغيل، مثال:
--       update public.orders set status = 'pending' where status not in
--         ('pending','accepted','picked_up','in_transit','delivered','cancelled');
--   * للبدء من الصفر بلا بيانات (يحذف كل جداول public — تحذير):
--       drop schema public cascade; create schema public;
--       grant usage on schema public to anon, authenticated, service_role;
-- ============================================================

-- ############################################################################
-- ## القسم 01: المخطط الأساسي: الأنواع والجداول والفهارس وسياسات RLS
-- ## المصدر: supabase/migrations/00_base_schema.sql
-- ############################################################################

-- ============================================================
-- ERSEL — 00: المخطط الأساسي (بديل idempotent لـ schema.sql)
-- يُنشئ الأنواع والجداول والفهارس والمحفّزات والسياسات الأساسية.
-- آمن للتشغيل أكثر من مرة: لا يحذف جدولاً ولا صفًا.
--
-- هذا الملف هو نفس محتوى supabase/schema.sql لكنه:
--   * يستعمل if not exists على الأنواع والجداول والفهارس
--   * يسقط السياسات والمحفّزات قبل إعادة إنشائها
-- لأن schema.sql الأصلي يفشل عند تشغيله مرتين.
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1) الأنواع (enums)
-- ------------------------------------------------------------
do $$
begin
  create type public.app_role as enum ('customer', 'courier', 'employee', 'admin');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.delivery_service as enum ('food', 'parcel', 'shopping', 'business');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.vehicle_type as enum ('motorcycle', 'car');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.order_status as enum ('pending', 'accepted', 'picked_up', 'in_transit', 'delivered', 'cancelled');
exception when duplicate_object then null;
end $$;

-- ------------------------------------------------------------
-- 1.b) إصلاح قواعد قديمة: أعمدة أُنشئت كـ text بدل الأنواع (enums)
--
-- لماذا: قاعدة سبق أن أُنشئ فيها الجدول بـ orders.status من نوع text
-- (نسخة أقدم من المشروع أو محاولة سابقة) تجعل `create table if not exists`
-- يتجاوز الجدول، ثم تفشل أول مقارنة مع الـ enum بالخطأ:
--     operator does not exist: text = order_status
-- هذه الدالة تحوّل العمود إلى النوع الصحيح مرة واحدة، ولا تفعل شيئًا
-- إذا كان النوع صحيحًا أصلًا أو الجدول غير موجود.
-- ------------------------------------------------------------
create or replace function public.ersel_fix_column_type(
  p_table text,
  p_column text,
  p_enum text,
  p_default text default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_udt text;
  v_bad text;
begin
  select c.udt_name into v_udt
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name = p_table
     and c.column_name = p_column;

  if v_udt is null then
    return 'missing';            -- الجدول/العمود غير موجود: لا شيء نفعله
  end if;
  if v_udt not in ('text', 'varchar', 'bpchar') then
    return 'ok';                 -- النوع صحيح أصلًا
  end if;
  if to_regtype('public.' || p_enum) is null then
    return 'no_enum';            -- النوع لم يُنشأ بعد
  end if;

  -- قيم لا توجد في الـ enum تُفشل التحويل؛ نكتشفها برسالة واضحة أولًا.
  execute format(
    'select string_agg(distinct %1$I::text, '', '') from public.%2$I
      where %1$I::text not in (select unnest(enum_range(null::public.%3$I))::text)',
    p_column, p_table, p_enum
  ) into v_bad;

  if v_bad is not null then
    raise exception 'legacy_value_not_in_enum: public.%.% يحتوي قيمًا غير معروفة (%). صحّحها ثم أعد التشغيل.',
      p_table, p_column, v_bad;
  end if;

  execute format('alter table public.%I alter column %I drop default', p_table, p_column);
  execute format(
    'alter table public.%I alter column %I type public.%I using %I::text::public.%I',
    p_table, p_column, p_enum, p_column, p_enum
  );
  if p_default is not null then
    execute format('alter table public.%I alter column %I set default %L', p_table, p_column, p_default);
  end if;
  return 'converted';
end;
$$;

create or replace function public.ersel_normalize_legacy_types()
returns table (target text, result text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
    select 'profiles.role'::text, public.ersel_fix_column_type('profiles', 'role', 'app_role', 'customer')
    union all
    select 'orders.status', public.ersel_fix_column_type('orders', 'status', 'order_status', 'pending')
    union all
    select 'orders.service', public.ersel_fix_column_type('orders', 'service', 'delivery_service', 'parcel')
    union all
    select 'orders.vehicle', public.ersel_fix_column_type('orders', 'vehicle', 'vehicle_type', 'motorcycle')
    union all
    select 'courier_profiles.vehicle', public.ersel_fix_column_type('courier_profiles', 'vehicle', 'vehicle_type', 'motorcycle')
    union all
    select 'courier_applications.status', public.ersel_fix_column_type('courier_applications', 'status', 'courier_application_status', 'pending');
end;
$$;

select * from public.ersel_normalize_legacy_types();

-- ------------------------------------------------------------
-- 2) الجداول
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text not null default '',
  role public.app_role not null default 'customer',
  created_at timestamptz not null default now()
);

create table if not exists public.courier_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  vehicle public.vehicle_type not null,
  city text not null,
  is_verified boolean not null default false,
  is_available boolean not null default false,
  license_storage_path text,
  identity_storage_path text,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.profiles(id) on delete set null,
  courier_id uuid references public.profiles(id) on delete set null,
  service public.delivery_service not null,
  customer_name text not null,
  phone text not null,
  pickup text not null,
  dropoff text not null,
  details text not null default '',
  vehicle public.vehicle_type not null default 'motorcycle',
  status public.order_status not null default 'pending',
  price_dzd integer not null default 0 check (price_dzd >= 0),
  courier_fee_dzd integer not null default 0 check (courier_fee_dzd >= 0),
  city text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists orders_status_idx on public.orders (status);
create index if not exists orders_customer_idx on public.orders (customer_id);
create index if not exists orders_courier_idx on public.orders (courier_id);

-- ------------------------------------------------------------
-- 3) updated_at + دور المستخدم الحالي
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- ------------------------------------------------------------
-- 4) RLS الأساسي
-- ------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.courier_profiles enable row level security;
alter table public.orders enable row level security;

drop policy if exists "profiles read self or admin" on public.profiles;
create policy "profiles read self or admin"
  on public.profiles for select to authenticated
  using (id = auth.uid() or public.current_app_role() = 'admin');

drop policy if exists "profiles update self" on public.profiles;
create policy "profiles update self"
  on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "admin update profiles" on public.profiles;
create policy "admin update profiles"
  on public.profiles for update to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

drop policy if exists "courier profile read self or admin" on public.courier_profiles;
create policy "courier profile read self or admin"
  on public.courier_profiles for select to authenticated
  using (user_id = auth.uid() or public.current_app_role() = 'admin');

drop policy if exists "courier profile create self" on public.courier_profiles;
create policy "courier profile create self"
  on public.courier_profiles for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "courier profile update self limited" on public.courier_profiles;
create policy "courier profile update self limited"
  on public.courier_profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "orders read related or admin" on public.orders;
create policy "orders read related or admin"
  on public.orders for select to authenticated
  using (
    customer_id = auth.uid()
    or courier_id = auth.uid()
    or public.current_app_role() = 'admin'
  );

drop policy if exists "customers create own order" on public.orders;
create policy "customers create own order"
  on public.orders for insert to authenticated
  with check (customer_id = auth.uid() and public.current_app_role() = 'customer');

drop policy if exists "courier update assigned order" on public.orders;
create policy "courier update assigned order"
  on public.orders for update to authenticated
  using (courier_id = auth.uid() or public.current_app_role() = 'admin')
  with check (courier_id = auth.uid() or public.current_app_role() = 'admin');

drop policy if exists "admin delete orders" on public.orders;
create policy "admin delete orders"
  on public.orders for delete to authenticated
  using (public.current_app_role() = 'admin');


-- ############################################################################
-- ## القسم 02: الأساس الآمن: profiles + الأدوار + محفّز إنشاء الملف الشخصي
-- ## المصدر: supabase/migrations/01_foundation.sql
-- ############################################################################

-- ============================================================
-- ERSEL — Migration 01: Secure foundation (profiles + roles + RLS)
-- Project: lkqmgidmxgjppsszwlvv (independent, NOT the old project)
-- Safe to re-run. It does NOT drop any table, data or column.
-- It only: strengthens profiles, adds an auto-profile trigger,
-- and (re)ensures RLS + role-protection policies.
-- REVIEW BEFORE RUNNING. Do not run without explicit approval.
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1) Ensure the app_role enum has the values we need.
--    (adds 'employee' used later for staff accounts)
-- ------------------------------------------------------------
alter type public.app_role add value if not exists 'employee';

-- ------------------------------------------------------------
-- 2) Ensure required columns exist on public.profiles.
--    add column if not exists => never overwrites existing data.
-- ------------------------------------------------------------
alter table public.profiles add column if not exists full_name  text        not null default '';
alter table public.profiles add column if not exists phone      text        not null default '';
alter table public.profiles add column if not exists role       public.app_role not null default 'customer';
alter table public.profiles add column if not exists created_at timestamptz not null default now();

-- One account per phone number (empty phone values are ignored).
create unique index if not exists profiles_phone_unique
  on public.profiles (phone) where phone <> '';

-- ------------------------------------------------------------
-- 3) Auto-create a profile row when a new auth user signs up.
--    Role is ALWAYS 'customer' here. Users can never choose it.
--    SECURITY DEFINER lets this run on auth.users insert.
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone, role)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), ''),
    coalesce(nullif(new.raw_user_meta_data->>'phone', ''), ''),
    'customer'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Recreate the trigger idempotently (trigger only; no data touched).
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- 4) Helper: current user's role (used by RLS policies).
-- ------------------------------------------------------------
create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- ------------------------------------------------------------
-- 5) Block role changes unless performed by an admin.
--    (fires on UPDATE so a user can never promote themselves)
-- ------------------------------------------------------------
create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and public.current_app_role() is distinct from 'admin'::public.app_role then
    raise exception 'Only an administrator may change account roles';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role
  before update on public.profiles
  for each row execute function public.protect_profile_role();

-- ------------------------------------------------------------
-- 6) Enable RLS on profiles and define self-only access.
--    (recreated with fixed names to guarantee correct rules)
-- ------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists "profiles read self or admin" on public.profiles;
create policy "profiles read self or admin"
  on public.profiles for select to authenticated
  using (id = auth.uid() or public.current_app_role() = 'admin');

drop policy if exists "profiles update self" on public.profiles;
create policy "profiles update self"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists "admin update profiles" on public.profiles;
create policy "admin update profiles"
  on public.profiles for update to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

-- NOTE: no INSERT policy is granted to users on purpose.
-- Profiles are created only by the SECURITY DEFINER trigger above,
-- so a user cannot insert a row with role = 'admin'.

-- ------------------------------------------------------------
-- 7) Verify (read-only) — run separately if you like
-- ------------------------------------------------------------
-- select policyname, cmd, roles from pg_policies where schemaname='public' and tablename='profiles';
-- select tgname from pg_trigger where tgrelid = 'public.profiles'::regclass and not tgisinternal;


-- ############################################################################
-- ## القسم 03: طلبات الضيف: مناطق الخدمة + رمز التتبع + حدود المعدّل
-- ## المصدر: supabase/migrations/03_guest_orders.sql
-- ############################################################################

-- ============================================================
-- ERSEL — Migration 03: Guest (no-account) quick orders
-- Project: lkqmgidmxgjppsszwlvv
--
-- PURPOSE
--   Allow a customer to place one delivery order without creating a
--   permanent Auth account. The order is created by a SECURITY DEFINER
--   function (never by direct table access), and is retrievable ONLY
--   with a random tracking token. The phone number is contact data,
--   NOT an identity or access credential.
--
-- SAFETY
--   * Additive only: adds columns, tables, indexes, functions.
--   * No table, row, or existing policy is dropped or altered.
--   * Safe to re-run (IF NOT EXISTS / CREATE OR REPLACE).
--   * Does NOT touch profiles / auth.users / existing orders policies.
--
-- ROLLBACK (see bottom of file) — additive, no data loss required.
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1) Service areas — acceptance zones, separate from the map view.
--    A zone is active/inactive and has its own center + radius.
-- ------------------------------------------------------------
create table if not exists public.service_areas (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name_ar     text not null,
  wilaya      text not null,
  center_lat  numeric(9,6) not null,
  center_lng  numeric(9,6) not null,
  radius_m    integer not null default 8000 check (radius_m between 500 and 100000),
  is_active   boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Seed: Sougueur, Tiaret (coords resolved from a real geocode lookup).
insert into public.service_areas (code, name_ar, wilaya, center_lat, center_lng, radius_m, is_active)
values ('sougueur-tiaret', 'السوقر', 'تيارت', 35.185674, 1.496093, 8000, true)
on conflict (code) do nothing;

-- ------------------------------------------------------------
-- 2) Private config — server-side secrets (pepper for hashing).
--    No policies are created. API roles are explicitly revoked.
-- ------------------------------------------------------------
create table if not exists public.private_config (
  key        text primary key,
  value      text not null,
  created_at timestamptz not null default now()
);

insert into public.private_config (key, value)
values ('guest_phone_pepper', encode(gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

alter table public.private_config enable row level security;
revoke all on table public.private_config from public, anon, authenticated;

-- ------------------------------------------------------------
-- 3) Throttle table — best-effort abuse protection per phone.
--    Limits: 3 per hour, 8 per day. No public access.
-- ------------------------------------------------------------
create table if not exists public.guest_order_throttle (
  phone_hash  text primary key,
  hour_window timestamptz not null default now(),
  hour_count  integer not null default 0,
  day_window  date not null default (now() at time zone 'utc')::date,
  day_count   integer not null default 0,
  updated_at  timestamptz not null default now()
);

alter table public.guest_order_throttle enable row level security;
revoke all on table public.guest_order_throttle from public, anon, authenticated;

-- ------------------------------------------------------------
-- 4) Extra columns on orders (all nullable / defaulted).
--    customer_id stays NULL for guest orders, so the existing
--    "orders read related or admin" policy keeps them invisible
--    to every authenticated customer.
-- ------------------------------------------------------------
alter table public.orders add column if not exists pickup_lat  numeric(9,6);
alter table public.orders add column if not exists pickup_lng  numeric(9,6);
alter table public.orders add column if not exists dropoff_lat numeric(9,6);
alter table public.orders add column if not exists dropoff_lng numeric(9,6);
alter table public.orders add column if not exists area_id     uuid;
alter table public.orders add column if not exists is_guest    boolean not null default false;
alter table public.orders add column if not exists contact_verified boolean not null default false;
alter table public.orders add column if not exists order_code  text;
alter table public.orders add column if not exists tracking_token_hash text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_area_id_fkey'
  ) then
    alter table public.orders
      add constraint orders_area_id_fkey
      foreign key (area_id) references public.service_areas(id) on delete set null;
  end if;
end $$;

create unique index if not exists orders_order_code_unique
  on public.orders (order_code) where order_code is not null;

create index if not exists orders_tracking_token_idx
  on public.orders (tracking_token_hash) where tracking_token_hash is not null;

create index if not exists orders_area_idx on public.orders (area_id);

-- ------------------------------------------------------------
-- 5) Helpers
-- ------------------------------------------------------------

-- Normalize an Algerian phone to E.164 (+213XXXXXXXXX). NULL if invalid.
create or replace function public.guest_normalize_phone(p_raw text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  s text;
begin
  if p_raw is null then return null; end if;
  s := regexp_replace(p_raw, '[^0-9+]', '', 'g');
  if s like '+%' then s := substr(s, 2); end if;
  if s like '00%' then s := substr(s, 3); end if;
  if s like '213%' then s := substr(s, 4); end if;
  s := regexp_replace(s, '^0+', '');
  if s !~ '^[5-7][0-9]{8}$' then return null; end if;
  return '+213' || s;
end;
$$;

-- Salted hash of the normalised phone (never store the raw phone twice).
create or replace function public.guest_phone_hash(p_phone text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_pepper text;
begin
  select value into v_pepper from public.private_config where key = 'guest_phone_pepper';
  if v_pepper is null then
    raise exception 'guest tracking is not configured';
  end if;
  return encode(digest(p_phone || v_pepper, 'sha256'), 'hex');
end;
$$;

-- Haversine distance in metres between two coordinates.
create or replace function public.geo_distance_m(
  p_lat1 numeric, p_lng1 numeric, p_lat2 numeric, p_lng2 numeric
)
returns double precision
language sql
immutable
as $$
  select 6371000 * 2 * asin(sqrt(
    power(sin(radians(p_lat2 - p_lat1) / 2), 2) +
    cos(radians(p_lat1)) * cos(radians(p_lat2)) *
    power(sin(radians(p_lng2 - p_lng1) / 2), 2)
  ));
$$;

-- Internal helpers must not be callable from the API.
revoke all on function public.guest_normalize_phone(text) from public, anon, authenticated;
revoke all on function public.guest_phone_hash(text) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 6) Create a guest order. The ONLY write path for anonymous users.
--    Validates phone, service, text lengths, coordinates, service
--    area, and per-phone rate limits. Returns a one-time token.
-- ------------------------------------------------------------
create or replace function public.create_guest_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phone         text;
  v_phone_norm    text;
  v_phone_hash    text;
  v_service       public.delivery_service;
  v_details       text;
  v_pickup_text   text;
  v_dropoff_text  text;
  v_plat          numeric;
  v_plng          numeric;
  v_dlat          numeric;
  v_dlng          numeric;
  v_area          public.service_areas%rowtype;
  v_token         text;
  v_token_hash    text;
  v_order_code    text;
  v_order_id      uuid;
  v_attempt       integer := 0;
  v_hour_count    integer;
  v_day_count     integer;
begin
  -- ---- phone ----
  v_phone := btrim(coalesce(payload->>'phone', ''));
  if v_phone = '' then
    raise exception 'phone_required' using errcode = 'P0001';
  end if;
  v_phone_norm := public.guest_normalize_phone(v_phone);
  if v_phone_norm is null then
    raise exception 'phone_invalid' using errcode = 'P0001';
  end if;
  v_phone_hash := public.guest_phone_hash(v_phone_norm);

  -- ---- service ----
  begin
    v_service := (payload->>'service')::public.delivery_service;
  exception when others then
    raise exception 'service_invalid' using errcode = 'P0001';
  end;
  if v_service not in ('food', 'parcel', 'shopping', 'business') then
    raise exception 'service_invalid' using errcode = 'P0001';
  end if;

  -- ---- text fields ----
  v_pickup_text  := btrim(coalesce(payload->>'pickup_text', ''));
  v_dropoff_text := btrim(coalesce(payload->>'dropoff_text', ''));
  v_details      := btrim(coalesce(payload->>'details', ''));

  if char_length(v_pickup_text) < 3 or char_length(v_pickup_text) > 300 then
    raise exception 'pickup_text_invalid' using errcode = 'P0001';
  end if;
  if char_length(v_dropoff_text) < 3 or char_length(v_dropoff_text) > 300 then
    raise exception 'dropoff_text_invalid' using errcode = 'P0001';
  end if;
  if char_length(v_details) > 1000 then
    raise exception 'details_too_long' using errcode = 'P0001';
  end if;

  -- ---- coordinates ----
  begin
    v_plat  := (payload->>'pickup_lat')::numeric;
    v_plng  := (payload->>'pickup_lng')::numeric;
    v_dlat  := (payload->>'dropoff_lat')::numeric;
    v_dlng  := (payload->>'dropoff_lng')::numeric;
  exception when others then
    raise exception 'coordinates_invalid' using errcode = 'P0001';
  end;
  if v_plat is null or v_plng is null or v_dlat is null or v_dlng is null then
    raise exception 'coordinates_required' using errcode = 'P0001';
  end if;
  if v_plat not between -90 and 90 or v_dlat not between -90 and 90
     or v_plng not between -180 and 180 or v_dlng not between -180 and 180 then
    raise exception 'coordinates_invalid' using errcode = 'P0001';
  end if;

  -- ---- rate limit (best effort; see note below) ----
  select hour_count, day_count into v_hour_count, v_day_count
  from public.guest_order_throttle
  where phone_hash = v_phone_hash
    and hour_window = date_trunc('hour', now())
    and day_window = (now() at time zone 'utc')::date;

  if coalesce(v_hour_count, 0) >= 3 then
    raise exception 'rate_limited_hour' using errcode = 'P0001';
  end if;
  if coalesce(v_day_count, 0) >= 8 then
    raise exception 'rate_limited_day' using errcode = 'P0001';
  end if;

  insert into public.guest_order_throttle as t
    (phone_hash, hour_window, hour_count, day_window, day_count, updated_at)
  values (v_phone_hash, date_trunc('hour', now()), 1,
          (now() at time zone 'utc')::date, 1, now())
  on conflict (phone_hash) do update set
    hour_count = case when t.hour_window = date_trunc('hour', now())
                      then t.hour_count + 1 else 1 end,
    hour_window = date_trunc('hour', now()),
    day_count = case when t.day_window = (now() at time zone 'utc')::date
                     then t.day_count + 1 else 1 end,
    day_window = (now() at time zone 'utc')::date,
    updated_at = now();

  -- ---- resolve the active service area for the pickup point ----
  select * into v_area
  from public.service_areas
  where is_active
    and public.geo_distance_m(v_plat, v_plng, center_lat, center_lng) <= radius_m
  order by public.geo_distance_m(v_plat, v_plng, center_lat, center_lng) asc
  limit 1;

  if not found then
    raise exception 'outside_service_area' using errcode = 'P0001';
  end if;

  -- Dropoff must also be inside the same zone.
  if public.geo_distance_m(v_dlat, v_dlng, v_area.center_lat, v_area.center_lng) > v_area.radius_m then
    raise exception 'dropoff_outside_service_area' using errcode = 'P0001';
  end if;

  -- ---- tracking token (shown once to the customer) ----
  v_token := encode(gen_random_bytes(32), 'hex');
  v_token_hash := encode(digest(v_token || (select value from public.private_config
                                            where key = 'guest_phone_pepper'), 'sha256'), 'hex');

  -- ---- insert, with a short human-readable code ----
  loop
    v_attempt := v_attempt + 1;
    v_order_code := 'ER' || upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6));
    begin
      insert into public.orders (
        customer_id, courier_id, service, customer_name, phone,
        pickup, dropoff, details, vehicle, status, price_dzd, courier_fee_dzd,
        city, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
        area_id, is_guest, contact_verified, order_code, tracking_token_hash
      ) values (
        null, null, v_service, '', v_phone_norm,
        v_pickup_text, v_dropoff_text, v_details, 'motorcycle', 'pending', 0, 0,
        v_area.name_ar, v_plat, v_plng, v_dlat, v_dlng,
        v_area.id, true, false, v_order_code, v_token_hash
      )
      returning id into v_order_id;
      exit;
    exception when unique_violation then
      if v_attempt >= 5 then
        raise exception 'order_code_conflict' using errcode = 'P0001';
      end if;
    end;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order_id,
    'order_code', v_order_code,
    'tracking_token', v_token,
    'status', 'pending',
    'area', v_area.name_ar
  );
end;
$$;

revoke all on function public.create_guest_order(jsonb) from public;
grant execute on function public.create_guest_order(jsonb) to anon, authenticated;

-- ------------------------------------------------------------
-- 7) Track a guest order. Status only — no phone, no addresses.
--    The token is the sole credential.
-- ------------------------------------------------------------
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

  select order_code, service, status, created_at, updated_at
    into v_row
  from public.orders
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
    'updated_at', v_row.updated_at
  );
end;
$$;

revoke all on function public.get_guest_order(text) from public;
grant execute on function public.get_guest_order(text) to anon, authenticated;

-- ------------------------------------------------------------
-- 8) Verification queries (read-only; safe to run after migration)
-- ------------------------------------------------------------
-- select code, name_ar, wilaya, radius_m, is_active from public.service_areas;
-- select relname, relrowsecurity from pg_class
--   where relname in ('private_config','guest_order_throttle','service_areas');
-- select proname, prosecdef from pg_proc
--   where proname in ('create_guest_order','get_guest_order','guest_phone_hash');

-- ============================================================
-- ROLLBACK PLAN (run only if you decide to undo this migration).
-- It removes ONLY objects created here. No order data is deleted
-- unless you explicitly run the final DELETE.
--
--   drop function if exists public.get_guest_order(text);
--   drop function if exists public.create_guest_order(jsonb);
--   drop function if exists public.guest_phone_hash(text);
--   drop function if exists public.guest_normalize_phone(text);
--   drop function if exists public.geo_distance_m(numeric,numeric,numeric,numeric);
--   drop table if exists public.guest_order_throttle;
--   drop table if exists public.private_config;
--   alter table public.orders drop constraint if exists orders_area_id_fkey;
--   drop index if exists public.orders_tracking_token_idx;
--   drop index if exists public.orders_order_code_unique;
--   drop index if exists public.orders_area_idx;
--   alter table public.orders
--     drop column if exists pickup_lat,
--     drop column if exists pickup_lng,
--     drop column if exists dropoff_lat,
--     drop column if exists dropoff_lng,
--     drop column if exists area_id,
--     drop column if exists is_guest,
--     drop column if exists contact_verified,
--     drop column if exists order_code,
--     drop column if exists tracking_token_hash;
--   drop table if exists public.service_areas;
--
--   -- Optional, destructive, only if you also want to remove guest orders:
--   -- delete from public.orders where is_guest = true;
-- ============================================================


-- ############################################################################
-- ## القسم 04: حقول إضافية للطلب: notes + السعر + وسيلة النقل للضيف
-- ## المصدر: supabase/migrations/04_order_extras.sql
-- ############################################################################

-- ============================================================
-- ERSEL — Migration 04 (PROPOSAL ONLY — do not run until approved)
-- Project: lkqmgidmxgjppsszwlvv
-- Depends on: 03_guest_orders.sql
--
-- PURPOSE
--   Persist the extra fields the new delivery form already collects:
--     * proposed price (orders.price_dzd — existing column, meaning unchanged)
--     * optional staff notes (new nullable column)
--     * preferred vehicle on guest orders
--   Guest orders currently hard-code price_dzd = 0 and vehicle = motorcycle
--   inside create_guest_order. This replaces that function only.
--
-- SAFETY
--   * Additive: one nullable column, one CREATE OR REPLACE function.
--   * No table, row, policy, or existing order is dropped.
--   * Safe to re-run.
--   * Does NOT change RLS. Phone remains on orders.phone and is only
--     readable by the related customer, assigned courier, or admin.
--
-- ROLLBACK (bottom of file).
-- ============================================================

-- Optional free-text notes for the staff. Empty string when unused.
alter table public.orders
  add column if not exists notes text not null default '';

-- Recreate guest-order writer so it stores price, notes, and vehicle.
-- Signature stays create_guest_order(payload jsonb) — no API break.
create or replace function public.create_guest_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phone         text;
  v_phone_norm    text;
  v_phone_hash    text;
  v_service       public.delivery_service;
  v_details       text;
  v_notes         text;
  v_pickup_text   text;
  v_dropoff_text  text;
  v_vehicle       public.vehicle_type;
  v_price         integer;
  v_plat          numeric;
  v_plng          numeric;
  v_dlat          numeric;
  v_dlng          numeric;
  v_area          public.service_areas%rowtype;
  v_token         text;
  v_token_hash    text;
  v_order_code    text;
  v_order_id      uuid;
  v_attempt       integer := 0;
  v_hour_count    integer;
  v_day_count     integer;
begin
  v_phone := btrim(coalesce(payload->>'phone', ''));
  if v_phone = '' then
    raise exception 'phone_required' using errcode = 'P0001';
  end if;
  v_phone_norm := public.guest_normalize_phone(v_phone);
  if v_phone_norm is null then
    raise exception 'phone_invalid' using errcode = 'P0001';
  end if;
  v_phone_hash := public.guest_phone_hash(v_phone_norm);

  begin
    v_service := (payload->>'service')::public.delivery_service;
  exception when others then
    raise exception 'service_invalid' using errcode = 'P0001';
  end;

  v_pickup_text  := btrim(coalesce(payload->>'pickup_text', ''));
  v_dropoff_text := btrim(coalesce(payload->>'dropoff_text', ''));
  v_details      := btrim(coalesce(payload->>'details', ''));
  v_notes        := btrim(coalesce(payload->>'notes', ''));

  if char_length(v_pickup_text) < 3 or char_length(v_pickup_text) > 300 then
    raise exception 'pickup_text_invalid' using errcode = 'P0001';
  end if;
  if char_length(v_dropoff_text) < 3 or char_length(v_dropoff_text) > 300 then
    raise exception 'dropoff_text_invalid' using errcode = 'P0001';
  end if;
  if char_length(v_details) > 1000 then
    raise exception 'details_too_long' using errcode = 'P0001';
  end if;
  if char_length(v_notes) > 500 then
    raise exception 'notes_too_long' using errcode = 'P0001';
  end if;

  begin
    v_vehicle := coalesce(nullif(payload->>'vehicle', ''), 'motorcycle')::public.vehicle_type;
  exception when others then
    v_vehicle := 'motorcycle';
  end;

  begin
    v_price := coalesce((payload->>'price_dzd')::integer, 0);
  exception when others then
    raise exception 'price_invalid' using errcode = 'P0001';
  end;
  if v_price < 0 or v_price > 500000 then
    raise exception 'price_invalid' using errcode = 'P0001';
  end if;

  begin
    v_plat  := (payload->>'pickup_lat')::numeric;
    v_plng  := (payload->>'pickup_lng')::numeric;
    v_dlat  := (payload->>'dropoff_lat')::numeric;
    v_dlng  := (payload->>'dropoff_lng')::numeric;
  exception when others then
    raise exception 'coordinates_invalid' using errcode = 'P0001';
  end;
  if v_plat is null or v_plng is null or v_dlat is null or v_dlng is null then
    raise exception 'coordinates_required' using errcode = 'P0001';
  end if;
  if v_plat not between -90 and 90 or v_dlat not between -90 and 90
     or v_plng not between -180 and 180 or v_dlng not between -180 and 180 then
    raise exception 'coordinates_invalid' using errcode = 'P0001';
  end if;

  select hour_count, day_count into v_hour_count, v_day_count
  from public.guest_order_throttle
  where phone_hash = v_phone_hash
    and hour_window = date_trunc('hour', now())
    and day_window = (now() at time zone 'utc')::date;

  if coalesce(v_hour_count, 0) >= 3 then
    raise exception 'rate_limited_hour' using errcode = 'P0001';
  end if;
  if coalesce(v_day_count, 0) >= 8 then
    raise exception 'rate_limited_day' using errcode = 'P0001';
  end if;

  insert into public.guest_order_throttle as t
    (phone_hash, hour_window, hour_count, day_window, day_count, updated_at)
  values (v_phone_hash, date_trunc('hour', now()), 1,
          (now() at time zone 'utc')::date, 1, now())
  on conflict (phone_hash) do update set
    hour_count = case when t.hour_window = date_trunc('hour', now())
                      then t.hour_count + 1 else 1 end,
    hour_window = date_trunc('hour', now()),
    day_count = case when t.day_window = (now() at time zone 'utc')::date
                     then t.day_count + 1 else 1 end,
    day_window = (now() at time zone 'utc')::date,
    updated_at = now();

  select * into v_area
  from public.service_areas
  where is_active
    and public.geo_distance_m(v_plat, v_plng, center_lat, center_lng) <= radius_m
  order by public.geo_distance_m(v_plat, v_plng, center_lat, center_lng) asc
  limit 1;

  if not found then
    raise exception 'outside_service_area' using errcode = 'P0001';
  end if;

  if public.geo_distance_m(v_dlat, v_dlng, v_area.center_lat, v_area.center_lng) > v_area.radius_m then
    raise exception 'dropoff_outside_service_area' using errcode = 'P0001';
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_token_hash := encode(digest(v_token || (select value from public.private_config
                                            where key = 'guest_phone_pepper'), 'sha256'), 'hex');

  loop
    v_attempt := v_attempt + 1;
    v_order_code := 'ER' || upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6));
    begin
      insert into public.orders (
        customer_id, courier_id, service, customer_name, phone,
        pickup, dropoff, details, notes, vehicle, status, price_dzd, courier_fee_dzd,
        city, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
        area_id, is_guest, contact_verified, order_code, tracking_token_hash
      ) values (
        null, null, v_service, '', v_phone_norm,
        v_pickup_text, v_dropoff_text, v_details, v_notes, v_vehicle, 'pending', v_price, 0,
        v_area.name_ar, v_plat, v_plng, v_dlat, v_dlng,
        v_area.id, true, false, v_order_code, v_token_hash
      )
      returning id into v_order_id;
      exit;
    exception when unique_violation then
      if v_attempt >= 5 then
        raise exception 'order_code_conflict' using errcode = 'P0001';
      end if;
    end;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order_id,
    'order_code', v_order_code,
    'tracking_token', v_token,
    'status', 'pending',
    'area', v_area.name_ar
  );
end;
$$;

revoke all on function public.create_guest_order(jsonb) from public;
grant execute on function public.create_guest_order(jsonb) to anon, authenticated;

-- Verification (read-only):
-- select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'orders' and column_name = 'notes';
-- select pg_get_functiondef('public.create_guest_order(jsonb)'::regprocedure);

-- ROLLBACK
--   alter table public.orders drop column if exists notes;
--   -- then re-run the create_guest_order body from 03_guest_orders.sql


-- ############################################################################
-- ## القسم 05: لوحة الموظف: قراءة الطلبات المتاحة + المطالبة + تقدم الحالة
-- ## المصدر: supabase/migrations/05_staff_desk.sql
-- ############################################################################

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


-- ############################################################################
-- ## القسم 06: المراجعة الأمنية: مطالبة ذرّية + طلبات الانضمام + إخفاء بيانات الزبون (يشمل 06 المصحّح)
-- ## المصدر: supabase/proposals/07_security_review_courier_and_staff.sql
-- ############################################################################

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


-- ############################################################################
-- ## القسم 07: إحصائيات لوحة الإدارة + إعادة إسناد الطلب
-- ## المصدر: supabase/proposals/10_admin_stats_and_reassign_fix.sql
-- ############################################################################

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


-- ############################################################################
-- ## القسم 08: v2: الحد الأدنى للسعر + عروض الموصّلين + دخول الإدارة + استعادة كلمة المرور
-- ## المصدر: supabase/ersel_v2.sql
-- ############################################################################

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


-- ############################################################################
-- ## القسم 09: التقوية: منع ترقية الدور عبر الرمز + تقييد استعادة كلمة المرور
-- ## المصدر: supabase/proposals/11_harden_admin_unlock_and_password_reset.sql
-- ############################################################################

-- ============================================================
-- ERSEL — اقتراح 11: تقوية مساري دخول الإدارة واستعادة كلمة المرور
-- الحالة: غير منفَّذ. لا يُشغَّل تلقائيًا. راجعه ثم شغّله في SQL Editor.
-- يعتمد على: migrations 01..05 ثم supabase/ersel_v2.sql
-- ============================================================
--
-- لماذا هذا الملف؟
--
-- 1) public.admin_unlock(p_code) في ersel_v2.sql يقوم حرفيًا بـ:
--        update public.profiles set role = 'admin' where id = auth.uid();
--    أي أن أي حساب مسجَّل يعرف الرمز (101112 افتراضيًا) يصبح مديرًا.
--    هذا يخالف شرط المنتج: «لا يستطيع المستخدم منح نفسه دور المدير».
--    كما أن الواجهة تتحقق من الدور *بعد* استدعاء الدالة، فيكون الترقية قد
--    حدثت بالفعل قبل أن تظهر رسالة «هذا الحساب لا يملك دور المدير».
--
-- 2) public.reset_password_by_phone(p_phone, p_new_password) ممنوحة لـ anon،
--    وتغيّر كلمة سر أي حساب زبون بمجرد معرفة رقم هاتفه. هذا استيلاء كامل
--    على الحساب بلا أي إثبات ملكية.
--
-- ما يفعله هذا الملف:
--   أ) admin_unlock تصبح بوابة تحقق فقط: لا تغيّر أي دور. ترفض غير المدير
--      قبل فحص الرمز حتى لا يُكشف صلاح الرمز.
--   ب) reset_password_by_phone تعمل فقط للجلسة نفسها (رقمها = رقم الحساب)
--      أو لمدير يعيد تعيين كلمة سر زبون. تُسحب من anon.
--
-- ما لا يفعله:
--   - لا يرقّي أي حساب إلى admin. الترقية تبقى يدوية من SQL بموافقة المالك.
--   - لا يعيد تفعيل «نسيت كلمة المرور» من شاشة الدخول. ذلك يحتاج رمزًا
--     لمرة واحدة (OTP) عبر مزوّد رسائل، وهو قرار منفصل.
-- ============================================================


-- ------------------------------------------------------------
-- أ) admin_unlock: تحقق فقط، بلا منح دور
-- ------------------------------------------------------------
create or replace function public.admin_unlock(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid      uuid := auth.uid();
  v_role     public.app_role;
  v_hash     text;
  v_user_fail integer;
  v_all_fail  integer;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  -- الترتيب مقصود: نرفض غير المدير قبل فحص الرمز، فلا يتسرّب أي معلومة
  -- عن صلاحية الرمز إلى حساب عادي.
  select role into v_role from public.profiles where id = v_uid;
  if v_role is distinct from 'admin'::public.app_role then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

  select count(*) into v_user_fail
    from public.admin_unlock_attempts
   where user_id = v_uid and not ok and at > now() - interval '15 minutes';
  select count(*) into v_all_fail
    from public.admin_unlock_attempts
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
  -- لا set_config ولا update على profiles: الدور لا يُمنح من هنا إطلاقًا.
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_unlock(text) from public, anon;
grant execute on function public.admin_unlock(text) to authenticated;

-- ------------------------------------------------------------
-- ب) reset_password_by_phone: للجلسة نفسها أو لمدير فقط
-- ------------------------------------------------------------
create or replace function public.reset_password_by_phone(p_phone text, p_new_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, auth
as $$
declare
  v_uid       uuid := auth.uid();
  v_digits    text;
  v_target    uuid;
  v_my_phone  text;
  v_role      public.app_role;
  v_target_role public.app_role;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  v_digits := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if v_digits like '213%' then v_digits := substr(v_digits, 4); end if;
  v_digits := regexp_replace(v_digits, '^0+', '');
  if v_digits !~ '^[5-7][0-9]{8}$' then
    return jsonb_build_object('ok', false, 'error', 'phone_invalid');
  end if;

  if length(coalesce(p_new_password, '')) < 8
     or p_new_password !~ '[0-9]'
     or p_new_password !~ '[A-Za-zء-ي]' then
    return jsonb_build_object('ok', false, 'error', 'password_weak');
  end if;

  select role, phone into v_role, v_my_phone from public.profiles where id = v_uid;

  -- ملكية الرقم: إما رقم الجلسة نفسها، أو مدير يعيد تعيين كلمة سر زبون.
  if v_role is distinct from 'admin'::public.app_role then
    if v_my_phone is null
       or regexp_replace(regexp_replace(coalesce(v_my_phone, ''), '\D', '', 'g'), '^(213|0)+', '') <> v_digits then
      return jsonb_build_object('ok', false, 'error', 'not_owner');
    end if;
  end if;

  if (select count(*) from public.password_reset_log
       where phone = v_digits and at > now() - interval '1 hour') >= 3
     or (select count(*) from public.password_reset_log
          where at > now() - interval '1 hour') >= 100 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  insert into public.password_reset_log (phone, ok) values (v_digits, false);

  select id into v_target
    from auth.users
   where email = '213' || v_digits || '@phone.ersel.app';
  if v_target is null then
    return jsonb_build_object('ok', false, 'error', 'account_not_found');
  end if;

  select role into v_target_role from public.profiles where id = v_target;
  if v_target_role in ('admin'::public.app_role, 'employee'::public.app_role)
     and v_role is distinct from 'admin'::public.app_role then
    return jsonb_build_object('ok', false, 'error', 'staff_not_allowed');
  end if;

  update auth.users
     set encrypted_password = crypt(p_new_password, gen_salt('bf')),
         updated_at = now()
   where id = v_target;
  delete from auth.sessions where user_id = v_target;
  update public.password_reset_log set ok = true
   where id = (select max(id) from public.password_reset_log where phone = v_digits);

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.reset_password_by_phone(text, text) from public, anon;
grant execute on function public.reset_password_by_phone(text, text) to authenticated;


-- ============================================================
-- التحقق بعد التنفيذ (يدويًا):
--
--   -- 1) حساب زبون عادي لا يصبح مديرًا مهما أدخل الرمز:
--   select public.admin_unlock('101112');   -- يجب: {"ok": false, "error": "not_admin"}
--   select role from public.profiles where id = auth.uid();  -- يبقى customer
--
--   -- 2) لا استدعاء مجهول لاستعادة كلمة المرور:
--   --    من anon يجب أن يرجع permission denied.
--
--   -- 3) مدير معتمد ما زال يستطيع فتح اللوحة بالرمز:
--   select public.admin_unlock('<الرمز>');  -- {"ok": true}
--
-- ملاحظة: بعد تنفيذ هذا الملف تصبح «نسيت كلمة المرور» في شاشة الدخول
-- معطّلة للمستخدم غير المسجَّل. الواجهة تعرض رسالة واضحة بدل خطأ عام.
-- ============================================================


-- ############################################################################
-- ## القسم 10: لوحة القراءة بالرمز + إلغاء الزبون لطلبه + رمز أقوى
-- ## المصدر: supabase/migrations/12_code_desk_and_customer_tools.sql
-- ############################################################################

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


-- ############################################################################
-- ## القسم 11: رموز أجهزة الإشعارات (FCM) + تسجيل الرمز من التطبيق
-- ## المصدر: supabase/migrations/13_device_tokens.sql
-- ############################################################################

-- ============================================================
-- ERSEL — 13: رموز الأجهزة للإشعارات (FCM)
-- يُنفَّذ بعد 12. آمن للتشغيل أكثر من مرة.
--
-- الغرض: يحتفظ التطبيق على أندرويد برمز FCM لكل جهاز، ويُربطه بالحساب.
-- إرسال الإشعارات نفسه يتم من دالة Edge (supabase/functions/notify-order)
-- تقرأ هذا الجدول — لا يوجد أي مفتاح سري في التطبيق.
-- ============================================================

create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null,
  platform text not null default 'android',
  app_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint device_tokens_token_unique unique (token)
);

create index if not exists device_tokens_user_idx on public.device_tokens (user_id);

alter table public.device_tokens enable row level security;

-- صاحب الجهاز يرى رموزه ويحذفها؛ لا أحد يعدّل صفوف غيره.
drop policy if exists "device tokens owner read" on public.device_tokens;
create policy "device tokens owner read" on public.device_tokens
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "device tokens owner delete" on public.device_tokens;
create policy "device tokens owner delete" on public.device_tokens
  for delete to authenticated
  using (user_id = auth.uid());

-- لا سياسة insert: التسجيل يمر عبر الدالة أدناه فقط، لأنها تتحقق من
-- شكل الرمز وتمنع سرقة رمز جهاز مستخدم آخر (on conflict do update).
drop policy if exists "device tokens owner insert" on public.device_tokens;

create or replace function public.register_device_token(
  p_token text,
  p_platform text default 'android',
  p_app_version text default null
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_token text := btrim(coalesce(p_token, ''));
  v_platform text := lower(btrim(coalesce(p_platform, 'android')));
begin
  if v_uid is null then
    return json_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if length(v_token) < 20 or length(v_token) > 4096 then
    return json_build_object('ok', false, 'error', 'invalid_token');
  end if;

  if v_platform not in ('android', 'ios', 'web') then
    v_platform := 'android';
  end if;

  insert into public.device_tokens (user_id, token, platform, app_version)
  values (v_uid, v_token, v_platform, nullif(btrim(coalesce(p_app_version, '')), ''))
  on conflict (token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        app_version = excluded.app_version,
        updated_at = now();

  return json_build_object('ok', true);
exception
  when others then
    return json_build_object('ok', false, 'error', 'server_error');
end;
$$;

create or replace function public.unregister_device_token(p_token text)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return json_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  delete from public.device_tokens
   where token = btrim(coalesce(p_token, ''))
     and user_id = v_uid;

  return json_build_object('ok', true);
end;
$$;

revoke all on function public.register_device_token(text, text, text) from public;
revoke all on function public.unregister_device_token(text) from public;
grant execute on function public.register_device_token(text, text, text) to authenticated;
grant execute on function public.unregister_device_token(text) to authenticated;


-- ############################################################################
-- ## القسم 12: ترقية حساب المؤسس إلى مدير (آخر خطوة، تتطلب وجود الحساب)
-- ## المصدر: supabase/migrations/02_promote_admin.sql
-- ############################################################################

-- ============================================================
-- ERSEL — Migration 02: Grant admin role to the founder account
-- Project: lkqmgidmxgjppsszwlvv
-- Safe to re-run. No data is deleted.
--
-- PART A fixes the role-protection trigger so trusted server-side
-- operations (SQL Editor / service role, where auth.uid() is NULL)
-- can change roles, while logged-in normal users still cannot
-- promote themselves.
--
-- PART B promotes ONE account (matched by its email) to admin.
--
-- REVIEW BEFORE RUNNING. Do not run without explicit approval.
-- ============================================================

-- ---------- PART A: restrict only end-user (session) context
create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null
     and public.current_app_role() is distinct from 'admin'::public.app_role then
    raise exception 'Only an administrator may change account roles';
  end if;
  return new;
end;
$$;

-- ---------- PART B: promote the founder account to admin
-- Creates the profile row if missing, otherwise updates the role.
-- Role is set only from a trusted SQL context (never from the browser).
insert into public.profiles (id, full_name, phone, role)
select
  u.id,
  coalesce(nullif(u.raw_user_meta_data->>'full_name', ''), ''),
  coalesce(nullif(u.raw_user_meta_data->>'phone', ''), ''),
  'admin'::public.app_role
from auth.users u
where lower(u.email) = lower('condorplum9@gmail.com')
on conflict (id) do update set role = 'admin'::public.app_role;

-- ---------- VERIFY (read-only result; run and check output)
select p.id, p.full_name, p.phone, p.role, u.email
from public.profiles p
join auth.users u on u.id = p.id
where lower(u.email) = lower('condorplum9@gmail.com');

-- ############################################################################
-- ## التحقق بعد التشغيل (اقرأ فقط)
-- ############################################################################

-- 1) الجداول الموجودة
select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;

-- 2) الدوال الحساسة وخصائصها الأمنية
select p.proname,
       p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'create_guest_order', 'get_guest_order', 'staff_claim_order',
    'staff_advance_order', 'staff_list_jobs', 'submit_courier_application',
    'review_courier_application', 'admin_dashboard_stats',
    'admin_reassign_order', 'admin_unlock', 'reset_password_by_phone'
  )
order by p.proname;

-- 3) RLS مفعّل على الجداول العامة
select c.relname, c.relrowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;

-- 4) منطقة الخدمة المزروعة
select code, name_ar, wilaya, radius_m, is_active from public.service_areas;

-- 5) حساب المدير
select p.id, p.full_name, p.role, u.email
from public.profiles p
join auth.users u on u.id = p.id
where p.role = 'admin';

-- 6) فحص سلبي: الرمز لا يرقّي حسابًا عاديًا (يجب أن يرجع not_admin)
--    نفّذه من جلسة حساب زبون، لا من SQL Editor:
-- select public.admin_unlock('101112');
