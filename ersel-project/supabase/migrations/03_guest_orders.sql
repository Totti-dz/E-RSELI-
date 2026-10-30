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
