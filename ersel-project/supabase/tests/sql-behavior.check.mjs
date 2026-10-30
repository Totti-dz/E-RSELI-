// Functional tests for supabase/ersel_all_in_one.sql, executed against a real
// (WASM) PostgreSQL with Supabase's auth schema stubbed.
// This is the closest thing to a live database test without Supabase keys.
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
grant usage on schema auth to authenticated, anon;

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

create table if not exists auth._current_uid (uid uuid);
insert into auth._current_uid values (null);
grant select on auth._current_uid to authenticated, anon;
create or replace function auth.uid() returns uuid
language sql stable as $$ select uid from auth._current_uid limit 1 $$;

-- pgcrypto stand-ins: crypt(p, stored) must reproduce the stored value.
create or replace function public.gen_salt(text) returns text
language sql immutable as $$ select 'salt'::text $$;
create or replace function public.gen_salt(text, int) returns text
language sql immutable as $$ select 'salt'::text $$;
create or replace function public.crypt(text, text) returns text
language sql immutable as $$ select 'h:' || md5($1) $$;
create or replace function public.gen_random_bytes(int) returns bytea
language sql volatile as $$ select decode(repeat('ab', $1), 'hex') $$;
create or replace function public.digest(text, text) returns bytea
language sql immutable as $$ select decode(md5($1), 'hex') $$;

create publication supabase_realtime;
`

const CUSTOMER = '11111111-1111-1111-1111-111111111111'
const ADMIN = '22222222-2222-2222-2222-222222222222'
const COURIER = '33333333-3333-3333-3333-333333333333'
const COURIER2 = '44444444-4444-4444-4444-444444444444'

let passed = 0
let failed = 0

function report(name, ok, detail = '') {
  if (ok) {
    passed += 1
    console.log(`  PASS  ${name}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`)
  }
}

async function call(fn, params = []) {
  const placeholders = params.map((_, i) => `$${i + 1}`).join(', ')
  const { rows } = await db.query(`select public.${fn}(${placeholders}) as r`, params)
  return rows[0].r
}

async function asUser(uid) {
  await db.query('update auth._current_uid set uid = $1', [uid])
}

async function expectError(fn, params, expectedKey, name) {
  try {
    const result = await call(fn, params)
    if (result && result.ok === false && result.error === expectedKey) {
      report(name, true)
      return
    }
    report(name, false, `returned ${JSON.stringify(result)}`)
  } catch (error) {
    const message = String(error.message || '')
    report(name, message.includes(expectedKey), `threw "${message}"`)
  }
}

async function main() {
  await db.exec(bootstrap)
  const raw = readFileSync(sqlPath, 'utf8')
  const sql = raw.replace(/create extension if not exists pgcrypto;/gi, '-- stubbed')
  await db.exec(sql)
  // Supabase grants table privileges to the API roles by default; mirror that
  // so the RLS test measures policies rather than missing GRANTs.
  await db.exec('grant select on all tables in schema public to authenticated, anon;')

  // ---- fixtures ----
  // The on_auth_user_created trigger already creates the profile rows,
  // so we insert auth users first and then adjust the profiles.
  await db.exec(`
    insert into auth.users (id, email, encrypted_password) values
      ('${CUSTOMER}', '213551111111@phone.ersel.app', 'h:x'),
      ('${ADMIN}', '213552222222@phone.ersel.app', 'h:x'),
      ('${COURIER}', '213553333333@phone.ersel.app', 'h:x'),
      ('${COURIER2}', '213554444444@phone.ersel.app', 'h:x');

    update public.profiles set full_name = 'زبون تجريبي', phone = '+213551111111' where id = '${CUSTOMER}';
    update public.profiles set full_name = 'مدير تجريبي', phone = '+213552222222', role = 'admin' where id = '${ADMIN}';
    update public.profiles set full_name = 'موصّل معتمد', phone = '+213553333333', role = 'courier' where id = '${COURIER}';
    update public.profiles set full_name = 'موصّل غير معتمد', phone = '+213554444444', role = 'courier' where id = '${COURIER2}';

  `)

  // courier_profiles insert trigger forces is_verified = false unless an admin
  // does the insert, so seed these rows with the admin identity.
  await asUser(ADMIN)
  await db.exec(`
    insert into public.courier_profiles (user_id, vehicle, city, is_verified, is_available) values
      ('${COURIER}', 'motorcycle', 'السوقر', true, true),
      ('${COURIER2}', 'car', 'السوقر', false, false);
  `)
  await asUser(null)

  console.log('\n[1] admin_unlock لا يرقّي حسابًا عاديًا')
  await asUser(CUSTOMER)
  await expectError('admin_unlock', ['101112'], 'not_admin', 'زبون + الرمز الصحيح → not_admin')
  const { rows: roleAfter } = await db.query('select role from public.profiles where id = $1', [CUSTOMER])
  report('دور الزبون لم يتغيّر', roleAfter[0].role === 'customer', `role=${roleAfter[0].role}`)

  await asUser(ADMIN)
  const adminOk = await call('admin_unlock', ['101112'])
  report('مدير معتمد + الرمز الصحيح → ok', adminOk && adminOk.ok === true, JSON.stringify(adminOk))
  const adminBad = await call('admin_unlock', ['000000'])
  report('مدير + رمز خطأ → invalid_code', adminBad && adminBad.error === 'invalid_code', JSON.stringify(adminBad))

  console.log('\n[2] استعادة كلمة المرور')
  await db.exec('update auth._current_uid set uid = null')
  let anonBlocked = false
  try {
    await db.exec(`set role anon; select public.reset_password_by_phone('+213551111111', 'NewPass2026');`)
  } catch (error) {
    anonBlocked = /permission denied/i.test(String(error.message))
  } finally {
    await db.exec('reset role')
  }
  report('anon لا يستطيع استدعاء الاستعادة', anonBlocked)

  await asUser(CUSTOMER)
  await expectError('reset_password_by_phone', ['+213553333333', 'NewPass2026'], 'not_owner', 'زبون لا يغيّر رقم غيره')
  const ownReset = await call('reset_password_by_phone', ['+213551111111', 'NewPass2026'])
  report('زبون يغيّر رقمه هو → ok', ownReset && ownReset.ok === true, JSON.stringify(ownReset))

  console.log('\n[3] طلب الضيف ورمز التتبع')
  const guest = await call('create_guest_order', [JSON.stringify({
    phone: '0551111111',
    service: 'parcel',
    pickup_text: 'وسط السوقر',
    dropoff_text: 'حي 200 مسكن',
    details: 'طرد صغير',
    notes: 'الطابق الثاني',
    price_dzd: 150,
    pickup_lat: 35.185674,
    pickup_lng: 1.496093,
    dropoff_lat: 35.19,
    dropoff_lng: 1.5
  })])
  report('إنشاء طلب ضيف → ok', guest && guest.ok === true, JSON.stringify(guest))
  const tracked = guest && guest.tracking_token
    ? await call('get_guest_order', [guest.tracking_token])
    : null
  report('تتبع الطلب برمز التتبع → ok', tracked && tracked.ok === true, JSON.stringify(tracked))
  const badToken = await call('get_guest_order', ['x'.repeat(64)])
  report('رمز تتبع غير معروف → not_found', badToken && badToken.error === 'not_found', JSON.stringify(badToken))

  await expectError('create_guest_order', [JSON.stringify({
    phone: '0551111112', service: 'parcel',
    pickup_text: 'خارج النطاق', dropoff_text: 'خارج النطاق', details: 'x',
    price_dzd: 150,
    pickup_lat: 36.7, pickup_lng: 3.05, dropoff_lat: 36.7, dropoff_lng: 3.05
  })], 'outside_service_area', 'نقطة خارج السوقر → outside_service_area')

  console.log('\n[4] المطالبة بالطلب وتقدّم الحالة')
  await asUser(COURIER2)
  await expectError('staff_claim_order', [guest.order_id], 'not_verified', 'موصّل غير معتمد لا يطالب')

  await asUser(COURIER)
  const claimed = await call('staff_claim_order', [guest.order_id])
  report('موصّل معتمد يطالب → ok', claimed && claimed.ok === true, JSON.stringify(claimed))
  await expectError('staff_claim_order', [guest.order_id], 'already_taken', 'مطالبة ثانية → already_taken')

  await expectError('staff_advance_order', [guest.order_id, 'delivered'], 'invalid_transition',
    'قفز من accepted إلى delivered → invalid_transition')

  const step1 = await call('staff_advance_order', [guest.order_id, 'picked_up'])
  const step2 = await call('staff_advance_order', [guest.order_id, 'in_transit'])
  const step3 = await call('staff_advance_order', [guest.order_id, 'delivered'])
  report('السلسلة accepted→picked_up→in_transit→delivered',
    step1?.ok && step2?.ok && step3?.ok, JSON.stringify([step1, step2, step3]))

  await asUser(CUSTOMER)
  await expectError('staff_advance_order', [guest.order_id, 'cancelled'], 'not_staff', 'زبون لا يغيّر حالة الطلب')

  console.log('\n[5] لوحة الإدارة')
  await expectError('admin_dashboard_stats', [], 'permission_denied', 'زبون لا يقرأ الإحصائيات')
  await asUser(ADMIN)
  const stats = await call('admin_dashboard_stats', [])
  report('مدير يقرأ الإحصائيات → ok', stats && stats.ok === true, JSON.stringify(stats))
  report('الإحصائيات فيها admins = 1', stats && Number(stats.admins) === 1, JSON.stringify(stats?.admins))
  report('الإحصائيات تعرض طلبًا مكتملًا', stats && Number(stats.orders_delivered) === 1, JSON.stringify(stats?.orders_delivered))

  await expectError('admin_reassign_order', [guest.order_id, CUSTOMER], 'not_staff',
    'إعادة إسناد إلى زبون → not_staff')

  console.log('\n[6] RLS: زبون لا يرى طلبات غيره')
  await db.exec(`
    insert into public.orders (customer_id, service, customer_name, phone, pickup, dropoff, status, price_dzd, city)
    values ('${CUSTOMER}', 'food', 'زبون أ', '+213551111111', 'أ', 'ب', 'pending', 150, 'السوقر');
    insert into public.orders (customer_id, service, customer_name, phone, pickup, dropoff, status, price_dzd, city)
    values ('${ADMIN}', 'food', 'زبون ب', '+213552222222', 'ج', 'د', 'pending', 150, 'السوقر');
  `)
  await asUser(CUSTOMER)
  await db.exec('set role authenticated')
  const { rows: visible } = await db.query('select customer_name from public.orders')
  await db.exec('reset role')
  report('الزبون يرى طلباته فقط',
    visible.length === 1 && visible.every(r => r.customer_name === 'زبون أ'),
    `saw ${visible.length}: ${visible.map(r => r.customer_name).join('|')}`)

  console.log('\n[7] لوحة القراءة بالرمز')
  await asUser(null)
  const weak = await call('admin_code_view', ['101112'])
  report('الرمز الافتراضي مرفوض → weak_code', weak && weak.error === 'weak_code', JSON.stringify(weak))

  let tooShort = false
  try {
    await db.exec(`select public.set_admin_code('123456')`)
  } catch (error) {
    tooShort = /code_too_short/.test(String(error.message))
  }
  report('set_admin_code يرفض أقل من 10 محارف', tooShort)

  await db.exec(`select public.set_admin_code('ERSEL-2026-ADMIN')`)
  const good = await call('admin_code_view', ['ERSEL-2026-ADMIN'])
  report('الرمز القوي يفتح اللوحة → ok', good && good.ok === true, JSON.stringify(good && Object.keys(good)))
  report('اللوحة قراءة فقط', good && good.read_only === true, JSON.stringify(good?.read_only))
  report('اللوحة ترجع الطلبات', good && Array.isArray(good.orders) && good.orders.length >= 3,
    `orders=${good?.orders?.length}`)
  report('اللوحة ترجع الحسابات', good && Array.isArray(good.accounts) && good.accounts.length === 4,
    `accounts=${good?.accounts?.length}`)
  report('إحصائيات اللوحة فيها الجارية والمكتملة',
    good && Number(good.stats.active) >= 2 && Number(good.stats.delivered) === 1,
    JSON.stringify(good?.stats))
  report('الطلب المكتمل يظهر باسم الموصّل',
    good && good.orders.some(o => o.status === 'delivered' && o.courier_name === 'موصّل معتمد'),
    JSON.stringify(good?.orders?.find(o => o.status === 'delivered')))

  report('اللوحة تعرض حالة توفر الموصّل',
    good && Number(good.stats.available_couriers) === 1
      && good.accounts.some(a => a.role === 'courier' && a.available === true)
      && good.accounts.some(a => a.role === 'courier' && a.available === false),
    JSON.stringify({ stat: good?.stats?.available_couriers, accounts: good?.accounts?.filter(a => a.role === 'courier') }))

  const wrong = await call('admin_code_view', ['not-the-code'])
  report('رمز خطأ → invalid_code', wrong && wrong.error === 'invalid_code', JSON.stringify(wrong))

  console.log('\n[8] إلغاء الزبون لطلبه')
  const { rows: mine } = await db.query(
    `select id from public.orders where customer_id = $1 and status = 'pending' limit 1`, [CUSTOMER])
  const myOrderId = mine[0]?.id

  await asUser(ADMIN)
  const cancelOther = await call('customer_cancel_order', [myOrderId])
  report('غير المالك لا يلغي الطلب → not_owner',
    cancelOther && cancelOther.error === 'not_owner', JSON.stringify(cancelOther))

  await asUser(CUSTOMER)
  const cancelMine = await call('customer_cancel_order', [myOrderId])
  report('المالك يلغي طلبه → ok', cancelMine && cancelMine.ok === true, JSON.stringify(cancelMine))

  const cancelAgain = await call('customer_cancel_order', [myOrderId])
  report('إلغاء طلب ملغي → invalid_transition',
    cancelAgain && cancelAgain.error === 'invalid_transition', JSON.stringify(cancelAgain))

  console.log('\n[9] رموز أجهزة الإشعارات')
  await asUser(CUSTOMER)
  const shortToken = await call('register_device_token', ['short'])
  report('رمز جهاز قصير مرفوض → invalid_token',
    shortToken && shortToken.error === 'invalid_token', JSON.stringify(shortToken))

  const goodToken = 'fcm-token-abcdefghijklmnopqrstuvwxyz-0123456789'
  const registered = await call('register_device_token', [goodToken, 'android', '0.1.0'])
  report('تسجيل رمز جهاز → ok', registered && registered.ok === true, JSON.stringify(registered))

  const { rows: stored } = await db.query(
    'select user_id, platform from public.device_tokens where token = $1', [goodToken])
  report('الرمز مرتبط بالحساب الحالي',
    stored.length === 1 && stored[0].user_id === CUSTOMER && stored[0].platform === 'android',
    JSON.stringify(stored))

  const again = await call('register_device_token', [goodToken, 'android', '0.1.1'])
  const { rows: afterSecond } = await db.query(
    'select count(*)::int as n from public.device_tokens where token = $1', [goodToken])
  report('إعادة التسجيل تُحدّث ولا تُكرّر',
    again && again.ok === true && afterSecond[0].n === 1, JSON.stringify(afterSecond))

  await asUser(ADMIN)
  const unregistered = await call('unregister_device_token', [goodToken])
  const { rows: remaining } = await db.query(
    'select count(*)::int as n from public.device_tokens where token = $1', [goodToken])
  report('حساب آخر لا يحذف رمز غيره',
    unregistered && unregistered.ok === true && remaining[0].n === 1, JSON.stringify(remaining))

  await asUser(CUSTOMER)
  await call('unregister_device_token', [goodToken])
  const { rows: gone } = await db.query(
    'select count(*)::int as n from public.device_tokens where token = $1', [goodToken])
  report('صاحب الجهاز يحذف رمزه', gone[0].n === 0, JSON.stringify(gone))

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

await main()
