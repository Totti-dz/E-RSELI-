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
