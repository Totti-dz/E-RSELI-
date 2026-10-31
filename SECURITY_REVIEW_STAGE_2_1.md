# مراجعة أمان المرحلة 2.1 — طلبات الموصّل ولوحة الموظف

الحالة: مراجعة مكتوبة. لم يُنفَّذ أي SQL. الملف التنفيذي المقترح هو `supabase/proposals/07_security_review_courier_and_staff.sql` فقط بعد موافقة صريحة.

المشروع الحي: `lkqmgidmxgjppsszwlvv`. الواجهة تستخدم anon key. لا `service_role`.

## ما هو حي مقابل ما هو ملف فقط

| الكائن | حي (سُبر سابقاً) | ملف 05 | ملف 06 | مقترح 07 |
|---|---|---|---|---|
| `staff_claim_order` | موجود (`P0001 not_authenticated` مجهولاً) | يعرّفه | لا | يستبدله ببوابة `is_verified` + مطالبة ذرية |
| `staff_advance_order` | موجود | يعرّفه | لا | يستبدله بنفس بوابة التحقق |
| سياسة `"staff read pool or assigned"` | غير مؤكدة في هذا المرسى | تنشئها (PII قبل الإسناد) | لا | تسقطها |
| سياسة `"staff read assigned only"` | غير موجودة | لا | لا | تنشئها |
| `staff_list_jobs` | غير موجودة | لا | لا | تنشئها (إخفاء الهاتف/الاسم/`customer_id`/`notes`) |
| `staff_list_orders` | غير موجودة | لا | لا | لا |
| `courier_applications` | غير موجودة | لا | تنشئها | تعيد إنشاءها متوافقة |
| `submit_courier_application` | غير موجودة | لا | تنشئها مع `current_setting` | تعيد إنشاءها بلا تجاوز جلسة |
| `review_courier_application` | غير موجودة | لا | تنشئها | تعيد إنشاءها بمفاتيح خطأ أوضح |
| `protect_courier_profile` (+ insert) | غير مؤكد | لا | ينشئهما | يعيد إنشاءهما مع `search_path` أضيق |

ملفات 05 و06 **لم تُستبدل**. 07 هو رقعة أمنية تعمل بعدهما، أو على قاعدة فيها دوال `staff_*` فقط.

`supabase/schema.sql` قديم (`app_role` بلا `employee`) ولا يُعتمد مصدراً حياً.

`supabase/migrations/02_promote_admin.sql` خارج النطاق. لا تشغيله.

## فروقات 05 → 07 (لوحة الموظف)

### 1) مطالبة الطلب `staff_claim_order`

05:

- أي `employee` / `courier` / `admin` يطالب.
- `SELECT … FOR UPDATE` ثم `UPDATE` بلا شرط `courier_id IS NULL` في جملة التحديث.
- لا يفحص `courier_profiles.is_verified`.

07:

- `courier` يحتاج صفاً في `courier_profiles` بـ `is_verified = true` وإلا `not_verified`.
- `employee` يبقى دور مكتب داخلي (لا signup ذاتي) ويحق له المطالبة دون أن يُمنح دور `courier`.
- `admin` تجاوز تشغيلي مسموح.
- مطالبة ذرية: `UPDATE … WHERE status = 'pending' AND courier_id IS NULL`.
- `REVOKE` من `public` و`anon` ثم `GRANT EXECUTE` لـ `authenticated`.

أثر حي حالياً: استدعاء RPC مباشر من موصّل غير معتمد يتجاوز تعطيل الواجهة في `EmployeeDesk`.

### 2) تقدم الحالة `staff_advance_order`

05: نفس أدوار المكتب بلا تحقق.

07: نفس بوابة `not_verified` للموصّل. سلسلة الحالات دون تغيير. `admin` ما زال يتجاوز السلسلة. الإسناد: غير المدير يحتاج `courier_id = auth.uid()`.

### 3) قراءة الطلبات (PII)

05 سياسة `"staff read pool or assigned"`:

- كل `employee`/`courier` يقرأ الطلبات `pending` غير المسندة **كاملة** (هاتف، اسم، `customer_id`، ملاحظات).
- هذا هو التسريب الأساسي قبل الإسناد.

07:

- `DROP POLICY IF EXISTS "staff read pool or assigned"`.
- سياسة جديدة `"staff read assigned only"`: الصفوف التي `courier_id = auth.uid()` لأدوار الموظف/الموصّل فقط.
- المدير يبقى على سياسة `"orders read related or admin"` الموجودة.
- القائمة غير المسندة عبر `staff_list_jobs()` فقط، مع إفراغ `phone` / `customer_name` / `customer_id` / `notes` ما لم يكن الصف مسنداً للمستدعي أو كان المستدعي `admin`.
- موصّل غير معتمد: `{ ok: true, verified: false, orders: [] }` بلا خطأ يمنع التشخيص، وبلا PII.

لا يُعاد إنشاء سياسة 05 عند التراجع: إعادة القراءة الواسعة تعيد تسريب PII.

## فروقات 06 → 07 (طلبات انضمام الموصّل)

لم يُستبدل ملف 06. 07 يعيد إنشاء نفس الكائنات بشكل أضيق.

### 1) حذف تجاوز الجلسة

06 في `protect_courier_application`:

```sql
if current_setting('ersel.bypass_application_guard', true) = 'on' then
  return new;
end if;
```

و`submit_courier_application` يستدعي `set_config('ersel.bypass_application_guard', 'on', true)`.

أي جلسة قادرة على `set_config` يمكنها تجاوز حراسة الحالة. 07 يحذف هذا المسار بالكامل.

### 2) محرّك الحماية

| | 06 | 07 |
|---|---|---|
| أحداث المحفّز | `UPDATE` فقط | `INSERT OR UPDATE` |
| الإدراج | لا يفرض `pending` على غير المدير | غير المدير: `status=pending` ومسح حقول المراجعة و`user_id=auth.uid()` |
| إعادة التقديم بعد الرفض | يعتمد على التجاوز داخل RPC | مسموح فقط `rejected → pending` مع تفريغ `reviewed_*` و`rejection_reason` |
| `search_path` | `public` في الحماية | `public, pg_temp` |

### 3) الصلاحيات على الجدول

06: `GRANT select, insert, update ON courier_applications TO authenticated` رغم عدم وجود سياسات كتابة. منح الكتابة بلا سياسة INSERT/UPDATE يعتمد على أن RLS يمنع، لكنه أوسع من اللازم.

07: `REVOKE ALL` من `public, anon, authenticated` ثم `GRANT SELECT` فقط. الكتابة عبر RPC (`SECURITY DEFINER`) حصراً.

### 4) `submit_courier_application`

06 يحدّث صف الرفض بدون `AND status = 'rejected'`.

07 يعيد التقديم بـ `WHERE status = 'rejected'` ويرفع `already_pending` إن تغيّرت الحالة بين القراءة والتحديث.

### 5) `review_courier_application`

| | 06 | 07 |
|---|---|---|
| طلب غير موجود | `order_not_found` | `application_not_found` |
| سبق المراجعة | `already_taken` | `already_reviewed` |
| شرط التحديث | `WHERE user_id = …` | `WHERE user_id = … AND status = 'pending'` |

مسار الاعتماد نفسه: المدير فقط يضع `profiles.role = courier` و`courier_profiles.is_verified = true`. المتصفح لا يكتب هذين الحقلين.

### 6) حماية `courier_profiles`

المنطق متطابق تقريباً (منع تغيير `is_verified` ومسارات الوثائق و`user_id` لغير المدير؛ الإدراج غير الإداري يصفّر التحقق والإتاحة والمسارات). 07 يضبط `search_path = public, pg_temp`.

الجدول الحي ما زال يسمح بتحديث `is_verified` إلى أن يُطبَّق 07 (أو 06 ثم 07). لذلك لا يُستخدم `courier_profiles` كنموذج انضمام.

## ماذا تفعل الواجهة بعد هذه المراجعة (كود فقط)

- `src/lib/staffOrders.ts` يستدعي `staff_list_jobs` أولاً. إن لم تكن الدالة حيّة (`PGRST202` / schema cache) يعود إلى `SELECT` الحالي حتى الموافقة على SQL.
- أخطاء RPC تشمل `not_verified`.
- `EmployeeDesk` لا يعرض هاتفاً/اسماً/ملاحظات فارغة على أنها بيانات حقيقية؛ للنماذج غير المسندة تظهر عبارة «يظهر بعد قبول الطلب».
- تعطيل القبول في الواجهة للموصّل غير المعتمد يبقى قائماً، وهو **ليس** بديلاً عن بوابة الخادم.

## اختبارات مطلوبة بعد الموافقة على 07 (لا تُنفَّذ الآن)

مسموح:

1. زبون `submit_courier_application` → `pending`
2. مرفوض يعيد الإرسال → `pending`
3. مدير يعتمد → `role=courier` و`is_verified=true`
4. مدير يرفض → الدور دون تغيير
5. موصّل معتمد يطالب طلباً معلّقاً غير مسند → `accepted`
6. مطالبة متزامنة ثانية → `already_taken`
7. `employee` داخلي يطالب
8. المسند يرى الهاتف؛ غير المسند في `staff_list_jobs` بلا هاتف/اسم

ممنوع:

9. موصّل غير معتمد `staff_claim_order` → `not_verified`
10. زبون `staff_claim_order` → `not_staff`
11. زبون `review_courier_application` → `permission_denied`
12. زبون يحدّث `applications.status` إلى `approved` → RLS / محفّز
13. زبون يحدّث `courier_profiles.is_verified` → `permission_denied`
14. زبون يقرأ طلب انضمام غيره → 0 صفوف
15. `anon` يقرأ `courier_applications` أو PII الطلبات → 0 صفوف
16. إرسال ثانٍ أثناء `pending` → `already_pending`

## قرار المؤسس المطلوب

نُفِّذ 07 على المشروع الحي (سُبر بعد الموافقة): `courier_applications` و`staff_list_jobs` و`submit_courier_application` و`review_courier_application` موجودة؛ `anon` يُرفض بـ `42501` كما يجب. `order_offers` / `messages` / `complaints` ما زالت غير موجودة.

لا SQL إضافي في هذه الدفعة. لوحة الإدارة تستخدم `review_courier_application` و`staff_list_jobs` / `staff_advance_order` فقط.

رفع وثائق الهوية/الرخصة مؤجّل حتى سياسات Storage آمنة. `02_promote_admin.sql` يبقى موقوفاً.
