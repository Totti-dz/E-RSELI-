// Builds supabase/ersel_all_in_one.sql from the individual SQL files.
// Run: node supabase/build-all-in-one.mjs
//
// Order matters: base schema -> foundation -> guest orders -> extras ->
// staff desk -> security review (supersedes 06) -> admin stats -> v2 ->
// hardening (supersedes admin_unlock/reset) -> founder promotion last.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

const PARTS = [
  { file: 'migrations/00_base_schema.sql', title: 'المخطط الأساسي: الأنواع والجداول والفهارس وسياسات RLS' },
  { file: 'migrations/01_foundation.sql', title: 'الأساس الآمن: profiles + الأدوار + محفّز إنشاء الملف الشخصي' },
  { file: 'migrations/03_guest_orders.sql', title: 'طلبات الضيف: مناطق الخدمة + رمز التتبع + حدود المعدّل' },
  { file: 'migrations/04_order_extras.sql', title: 'حقول إضافية للطلب: notes + السعر + وسيلة النقل للضيف' },
  { file: 'migrations/05_staff_desk.sql', title: 'لوحة الموظف: قراءة الطلبات المتاحة + المطالبة + تقدم الحالة' },
  { file: 'proposals/07_security_review_courier_and_staff.sql', title: 'المراجعة الأمنية: مطالبة ذرّية + طلبات الانضمام + إخفاء بيانات الزبون (يشمل 06 المصحّح)' },
  { file: 'proposals/10_admin_stats_and_reassign_fix.sql', title: 'إحصائيات لوحة الإدارة + إعادة إسناد الطلب' },
  { file: 'ersel_v2.sql', title: 'v2: الحد الأدنى للسعر + عروض الموصّلين + دخول الإدارة + استعادة كلمة المرور' },
  { file: 'proposals/11_harden_admin_unlock_and_password_reset.sql', title: 'التقوية: منع ترقية الدور عبر الرمز + تقييد استعادة كلمة المرور' },
  { file: 'migrations/12_code_desk_and_customer_tools.sql', title: 'لوحة القراءة بالرمز + إلغاء الزبون لطلبه + رمز أقوى' },
  { file: 'migrations/13_device_tokens.sql', title: 'رموز أجهزة الإشعارات (FCM) + تسجيل الرمز من التطبيق' },
  { file: 'migrations/14_delivery_chat_rating_profiles.sql', title: 'التسليم الثنائي + التقييم + الدردشة + بثّ الإشعارات + لوحة الأسبوع + صور الحسابات' },
  { file: 'migrations/15_push_and_rating_lock.sql', title: 'قفل التقييم لمرة واحدة + إشعار تأكيد الاستلام + Realtime للطلبات' },
  { file: 'migrations/02_promote_admin.sql', title: 'ترقية حساب المؤسس إلى مدير (آخر خطوة، تتطلب وجود الحساب)' }
]

const EXCLUDED = [
  ['schema.sql', 'يُستبدل بـ 00_base_schema.sql لأنه يفشل عند إعادة التشغيل.'],
  ['proposals/06_courier_applications.sql', 'مضمّن مصحّحًا داخل 07 (جدول + محفّزات + دالتا الإرسال والمراجعة).'],
  ['proposals/08_admin_desk_accounts.sql', 'غير جاهز: is_disabled بلا حراسة مصادقة، و admin_cancel_order يتعارض مع 07.'],
  ['proposals/09_admin_desk_stats_and_reassign.sql', 'مسودة؛ 10 هو البديل المصحّح.']
]

function clean(text) {
  return text
    .replace(/\r\n/g, '\n')
    // 11 wraps itself in begin/commit; the merged script must not commit midway.
    .split('\n')
    .filter(line => !/^\s*(begin|commit)\s*;\s*$/i.test(line))
    .join('\n')
    .trimEnd()
}

const header = `-- ============================================================
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
${PARTS.map((part, index) => `--   ${String(index + 1).padStart(2, '0')}. ${part.title}`).join('\n')}
--
-- مستبعد من هذا الملف (موجود في مجلد المشروع للرجوع إليه فقط):
${EXCLUDED.map(([file, why]) => `--   - ${file} — ${why}`).join('\n')}
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

`

const body = PARTS.map((part, index) => {
  const raw = readFileSync(join(here, part.file), 'utf8')
  const number = String(index + 1).padStart(2, '0')
  const banner = `-- ############################################################################
-- ## القسم ${number}: ${part.title}
-- ## المصدر: supabase/${part.file}
-- ############################################################################`
  return `${banner}\n\n${clean(raw)}\n`
}).join('\n\n')

const footer = `
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
    'admin_reassign_order', 'admin_unlock', 'reset_password_by_phone',
    'courier_confirm_delivery', 'customer_confirm_delivery', 'rate_courier',
    'send_order_message', 'courier_dashboard', 'update_my_profile',
    'customer_my_orders', 'mark_notifications_read'
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
`

writeFileSync(join(here, 'ersel_all_in_one.sql'), header + body + footer, 'utf8')
console.log('wrote supabase/ersel_all_in_one.sql')
