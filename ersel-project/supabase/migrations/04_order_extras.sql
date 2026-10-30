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
