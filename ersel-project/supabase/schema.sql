-- Erseli starter schema for Supabase/PostgreSQL.
-- Review and test all policies before production. Do not store passwords or payment card data here.

create extension if not exists pgcrypto;

create type public.app_role as enum ('customer', 'courier', 'admin');
create type public.delivery_service as enum ('food', 'parcel', 'shopping', 'business');
create type public.vehicle_type as enum ('motorcycle', 'car');
create type public.order_status as enum ('pending', 'accepted', 'picked_up', 'in_transit', 'delivered', 'cancelled');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text not null default '',
  role public.app_role not null default 'customer',
  created_at timestamptz not null default now()
);

create table public.courier_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  vehicle public.vehicle_type not null,
  city text not null,
  is_verified boolean not null default false,
  is_available boolean not null default false,
  license_storage_path text,
  identity_storage_path text,
  created_at timestamptz not null default now()
);

create table public.orders (
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

create index orders_created_at_idx on public.orders (created_at desc);
create index orders_status_idx on public.orders (status);
create index orders_customer_idx on public.orders (customer_id);
create index orders_courier_idx on public.orders (courier_id);

create function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger orders_set_updated_at before update on public.orders
for each row execute function public.set_updated_at();

create function public.current_app_role()
returns public.app_role
language sql stable security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

alter table public.profiles enable row level security;
alter table public.courier_profiles enable row level security;
alter table public.orders enable row level security;

-- Profiles: a user may read/update their own basic profile. Role assignment must be server/admin controlled.
create policy "profiles read self or admin" on public.profiles for select to authenticated
using (id = auth.uid() or public.current_app_role() = 'admin');
create policy "profiles update self" on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());
create policy "admin update profiles" on public.profiles for update to authenticated
using (public.current_app_role() = 'admin')
with check (public.current_app_role() = 'admin');

-- Prevent users from promoting themselves or changing their own role.
create function public.protect_profile_role()
returns trigger language plpgsql security definer
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

create trigger profiles_protect_role
before update on public.profiles
for each row execute function public.protect_profile_role();

-- Couriers: own profile and admin review only. Verification fields should be changed by trusted admin/server only.
create policy "courier profile read self or admin" on public.courier_profiles for select to authenticated
using (user_id = auth.uid() or public.current_app_role() = 'admin');
create policy "courier profile create self" on public.courier_profiles for insert to authenticated
with check (user_id = auth.uid());
create policy "courier profile update self limited" on public.courier_profiles for update to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Orders: customers see their own; assigned couriers see their own assigned jobs; admins can manage all.
create policy "orders read related or admin" on public.orders for select to authenticated
using (
  customer_id = auth.uid()
  or courier_id = auth.uid()
  or public.current_app_role() = 'admin'
);
create policy "customers create own order" on public.orders for insert to authenticated
with check (customer_id = auth.uid() and public.current_app_role() = 'customer');
create policy "courier update assigned order" on public.orders for update to authenticated
using (courier_id = auth.uid() or public.current_app_role() = 'admin')
with check (courier_id = auth.uid() or public.current_app_role() = 'admin');
create policy "admin delete orders" on public.orders for delete to authenticated
using (public.current_app_role() = 'admin');

-- IMPORTANT:
-- 1) The demo frontend insert currently does not attach customer_id, so it is intentionally blocked by these production RLS rules.
-- 2) Add an Auth-backed order creation flow that sets customer_id = auth.uid().
-- 3) Never allow users to self-promote role, or to set is_verified = true.
-- 4) Admin status changes and courier assignment should ideally use server-side functions with authorization.
