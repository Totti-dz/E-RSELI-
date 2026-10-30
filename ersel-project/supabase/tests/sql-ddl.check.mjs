// Validates supabase/ersel_all_in_one.sql against a real (WASM) PostgreSQL.
// Supabase-only objects (auth schema, supabase_realtime publication, pgcrypto
// functions) are stubbed so the DDL itself can be executed for real.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'

const sqlPath = process.argv[2] ??
  fileURLToPath(new URL('../ersel_all_in_one.sql', import.meta.url))

const db = new PGlite()

const bootstrap = `
create schema if not exists auth;

do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;

create table if not exists auth.users (
  id uuid primary key,
  email text unique,
  encrypted_password text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists auth.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid
);

create or replace function auth.uid() returns uuid
language sql stable as $$ select null::uuid $$;

create or replace function auth.role() returns text
language sql stable as $$ select 'authenticated'::text $$;

-- pgcrypto stand-ins (deterministic, only for DDL validation)
create or replace function public.gen_salt(text) returns text
language sql immutable as $$ select 'salt'::text $$;

create or replace function public.gen_salt(text, int) returns text
language sql immutable as $$ select 'salt'::text $$;

create or replace function public.crypt(text, text) returns text
language sql immutable as $$ select md5($1 || $2) $$;

create or replace function public.gen_random_bytes(int) returns bytea
language sql volatile as $$ select decode(repeat('ab', $1), 'hex') $$;

create or replace function public.digest(text, text) returns bytea
language sql immutable as $$ select decode(md5($1), 'hex') $$;

create publication supabase_realtime;
`

async function main() {
  await db.exec(bootstrap)
  const raw = readFileSync(sqlPath, 'utf8')
  // pglite ships without pgcrypto; the functions above stand in for it.
  const sql = raw.replace(/create extension if not exists pgcrypto;/gi, '-- [validation] pgcrypto stubbed')

  try {
    await db.exec(sql)
    console.log('PASS: whole file executed without error')
  } catch (error) {
    console.error('FAIL:', error.message)
    if (error.position) console.error('position:', error.position)
    process.exitCode = 1
    return
  }

  // Re-run to prove idempotency.
  try {
    await db.exec(sql)
    console.log('PASS: second run (idempotency) executed without error')
  } catch (error) {
    console.error('FAIL on second run:', error.message)
    process.exitCode = 1
    return
  }

  const tables = await db.query(`
    select table_name from information_schema.tables
    where table_schema = 'public' order by table_name`)
  console.log('tables:', tables.rows.map(r => r.table_name).join(', '))

  const fns = await db.query(`
    select p.proname, p.prosecdef from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' order by p.proname`)
  console.log('functions:', fns.rows.map(r => `${r.proname}${r.prosecdef ? '*' : ''}`).join(', '))

  const policies = await db.query(`
    select tablename, policyname from pg_policies
    where schemaname = 'public' order by tablename, policyname`)
  console.log('policies:', policies.rows.map(r => `${r.tablename}.${r.policyname}`).join(', '))

  const trigs = await db.query(`
    select tgname from pg_trigger where not tgisinternal order by tgname`)
  console.log('triggers:', trigs.rows.map(r => r.tgname).join(', '))
}

await main()
