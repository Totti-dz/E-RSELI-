// Regression test for legacy databases.
//
// A database that was created by an older version of the project can have
// `profiles.role` / `orders.status` / `courier_applications.status` as TEXT
// instead of the enums. Because the file uses `create table if not exists`,
// it would skip those tables and then fail on the first enum comparison:
//
//   ERROR 42883: operator does not exist: text = order_status
//
// The file must repair those columns in place and still run twice.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'

const sqlPath = process.argv[2] ??
  fileURLToPath(new URL('../ersel_all_in_one.sql', import.meta.url))

let failed = 0
function report(label, ok, detail = '') {
  if (ok) {
    console.log(`  PASS  ${label}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${label}${detail ? ' → ' + detail : ''}`)
  }
}

const db = new PGlite()

const bootstrap = `
create schema if not exists auth;

do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;

create table if not exists auth.users (
  id uuid primary key,
  email text unique,
  encrypted_password text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;

create or replace function public.gen_salt(text) returns text language sql immutable as $$ select 'salt'::text $$;
create or replace function public.gen_salt(text, int) returns text language sql immutable as $$ select 'salt'::text $$;
create or replace function public.crypt(text, text) returns text language sql immutable as $$ select md5($1 || $2) $$;
create or replace function public.gen_random_bytes(int) returns bytea language sql volatile as $$ select decode(repeat('ab', $1), 'hex') $$;
create or replace function public.digest(text, text) returns bytea language sql immutable as $$ select decode(md5($1), 'hex') $$;

create publication supabase_realtime;
`

// A database as an older release left it: enums exist, but the columns that
// hold them were declared as text.
const legacy = `
do $$ begin create type public.app_role as enum ('customer','courier','employee','admin'); exception when duplicate_object then null; end $$;
do $$ begin create type public.delivery_service as enum ('food','parcel','shopping','business'); exception when duplicate_object then null; end $$;
do $$ begin create type public.vehicle_type as enum ('motorcycle','car'); exception when duplicate_object then null; end $$;
do $$ begin create type public.order_status as enum ('pending','accepted','picked_up','in_transit','delivered','cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.courier_application_status as enum ('pending','approved','rejected'); exception when duplicate_object then null; end $$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text not null default '',
  role text not null default 'customer',
  created_at timestamptz not null default now()
);

create table public.courier_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  vehicle text not null default 'motorcycle',
  city text not null default '',
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
  service text not null default 'parcel',
  customer_name text not null default '',
  phone text not null default '',
  pickup text not null default '',
  dropoff text not null default '',
  details text not null default '',
  vehicle text not null default 'motorcycle',
  status text not null default 'pending',
  price_dzd integer not null default 0,
  courier_fee_dzd integer not null default 0,
  city text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.courier_applications (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  phone text not null default '',
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- a real row so the conversion has data to carry over
insert into auth.users (id) values ('11111111-1111-1111-1111-111111111111');
insert into public.profiles (id, full_name, role)
  values ('11111111-1111-1111-1111-111111111111', 'زبون قديم', 'customer');
insert into public.orders (customer_id, service, status, vehicle, customer_name, phone, pickup, dropoff)
  values ('11111111-1111-1111-1111-111111111111', 'food', 'delivered', 'car', 'زبون قديم', '+213551234567', 'أ', 'ب');
`

async function columnType(table, column) {
  const { rows } = await db.query(
    `select udt_name from information_schema.columns
      where table_schema = 'public' and table_name = $1 and column_name = $2`,
    [table, column]
  )
  return rows[0]?.udt_name ?? null
}

const raw = readFileSync(sqlPath, 'utf8')
const sql = raw.replace(/create extension if not exists pgcrypto;/gi, '-- [validation] pgcrypto stubbed')

await db.exec(bootstrap)
await db.exec(legacy)

console.log('\n[legacy] قاعدة قديمة: أعمدة نصية بدل الأنواع')

try {
  await db.exec(sql)
  report('الملف يُنفَّذ على قاعدة قديمة بلا خطأ', true)
} catch (error) {
  report('الملف يُنفَّذ على قاعدة قديمة بلا خطأ', false, error.message)
}

report('orders.status صار order_status', await columnType('orders', 'status') === 'order_status',
  String(await columnType('orders', 'status')))
report('profiles.role صار app_role', await columnType('profiles', 'role') === 'app_role',
  String(await columnType('profiles', 'role')))
report('orders.service صار delivery_service', await columnType('orders', 'service') === 'delivery_service',
  String(await columnType('orders', 'service')))
report('courier_profiles.vehicle صار vehicle_type', await columnType('courier_profiles', 'vehicle') === 'vehicle_type',
  String(await columnType('courier_profiles', 'vehicle')))
report('courier_applications.status صار courier_application_status',
  await columnType('courier_applications', 'status') === 'courier_application_status',
  String(await columnType('courier_applications', 'status')))

const { rows: kept } = await db.query(
  `select status::text as status, service::text as service from public.orders`
)
report('البيانات القديمة بقيت سليمة', kept[0]?.status === 'delivered' && kept[0]?.service === 'food',
  JSON.stringify(kept[0]))

try {
  await db.exec(sql)
  report('التشغيل الثاني على القاعدة المُصلَحة ينجح', true)
} catch (error) {
  report('التشغيل الثاني على القاعدة المُصلَحة ينجح', false, error.message)
}

console.log(failed === 0 ? '\nPASS: legacy database repaired' : `\nFAIL: ${failed} check(s) failed`)
if (failed > 0) process.exitCode = 1
