# ERSEL — طبقة الطلبات الاجتماعية (تسليم ثنائي، تقييم، دردشة، إشعارات، ملفات)

هذا الملف يوثّق الإضافة الأخيرة فوق مشروع ERSEL القائم. لم يُحذف أي جدول أو عمود أو دالة سابقة، ولم تُعدَّ تسمية أي شيء مستخدم حاليًا.

---

## 1) ما أُضيف

| الميزة | كيف تعمل |
|---|---|
| تأكيد تسليم من الطرفين | عمودان `courier_confirmed_at` و`customer_confirmed_at`، و`completed_at` يُضبط تلقائيًا بمُشغِّل عند اجتماع التأكيدين. الحالة `delivered` بقيت كما هي ولم تُستبدل. |
| تقييم الموصّل | جدول `order_ratings` + دالة `rate_courier`. تقييم واحد لكل طلب، وفقط بعد تأكيد الزبون للاستلام. |
| بثّ الطلب الجديد لكل الموظفين | جدول `notifications` + مُشغِّل `ersel_broadcast_new_order` يكتب صفًّا لكل موظف/موصّل معتمد. |
| قبول ذري لأول موصّل | بقيت `staff_claim_order` كما هي (تحديث شرطي داخل معاملة). من يقبل أولًا يفوز، والبقية يحصلون على `already_taken`، والطلب يختفي من قائمة «متاحة» لأن `staff_list_jobs` لا يعرض إلا `pending` بلا موصّل. |
| التفاوض على السعر | أُعيد استخدام `offers` و`place_offer` و`accept_offer` الموجودة. الواجهة تعرض العروض للزبون وتقبل عرضًا واحدًا، وتُغلق البقية. العرض مرفوض بعد الإسناد (`order_closed`). |
| دردشة كتابية | جدول `order_messages` + `send_order_message` + `mark_order_messages_read`، وسياسة RLS تُظهر المحادثة لطرفي الطلب فقط. |
| لوحة أسبوعية لكل موظف | دالة `courier_dashboard` تحسب الناجحة/قيد التنفيذ/المؤكَّدة/الملغاة/الدخل لكل أسبوع (الاثنين ← الأحد). |
| ملف شخصي وصورة | `profiles.avatar_url` + دلو `avatars` + سياسات تخزين + `update_my_profile` (يتجاهل أي محاولة لتغيير `role`). |
| تأكيد استلام طلب الضيف | دالة `guest_confirm_delivery(p_token)` تعمل برمز التتبّع المُهشَّر فقط، ولا تُقبل برقم الطلب. |

---

## 2) ملفات SQL

- **جديد:** `supabase/migrations/14_delivery_chat_rating_profiles.sql`
- **مُحدَّث:** `supabase/build-all-in-one.mjs` (يضمّن 14)
- **مُعاد توليده:** `supabase/ersel_all_in_one.sql`

### التشغيل على قاعدة موجودة

افتح Supabase ← SQL Editor ← الصق `supabase/ersel_all_in_one.sql` ← Run.

الملف آمن للتشغيل أكثر من مرة: كل شيء `if not exists` / `create or replace`، ولا يوجد `drop table` ولا `delete`. أعمدة التأكيد تُضاف بـ `add column if not exists`، والبيانات القديمة تبقى كما هي (الطلبات القديمة بحالة `delivered` تبقى `delivered` وتظهر بـ «بانتظار تأكيد» فقط إن لم يكن لها طوابع تأكيد).

### الكائنات الجديدة

| النوع | الاسم |
|---|---|
| أعمدة | `profiles.avatar_url` · `orders.courier_confirmed_at` · `orders.customer_confirmed_at` · `orders.completed_at` |
| جداول | `order_messages` · `order_ratings` · `notifications` |
| دوال | `courier_confirm_delivery` · `customer_confirm_delivery` · `guest_confirm_delivery` · `rate_courier` · `send_order_message` · `mark_order_messages_read` · `courier_dashboard` · `update_my_profile` · `mark_notifications_read` · `unread_notification_count` · `is_order_participant` · `orders_mark_completed` (trigger) |
| مُشغِّلات | `orders_broadcast_new` · `orders_notify_status` · `order_messages_notify` · `orders_mark_completed` |
| تخزين | دلو `avatars` (قراءة عامة، كتابة لصاحب المجلد `<user-id>/` فقط) |
| مُستبدَلة بتوافق | `staff_list_jobs` · `staff_advance_order` · `customer_my_orders` · `get_guest_order` (نفس التوقيع، حقول إضافية فقط) |

---

## 3) الإعدادات الخارجية التي يجب أن تنفّذها بنفسك

1. **تشغيل SQL**: `supabase/ersel_all_in_one.sql` في SQL Editor.
2. **دلو الصور**: يُنشأ تلقائيًا من الملف. تحقّق من Storage ← `avatars` (Public = true). إن كان الدلو موجودًا مسبقًا بصلاحيات مختلفة، راجع سياساته.
3. **Realtime (اختياري لكن مُستحسن)**: Database ← Replication ← أضف `order_messages` و`notifications` إن أردت التحديث اللحظي بدل التحديث الدوري. الواجهة تعمل بدونه (تحديث كل 6 ثوانٍ للمحادثة و20 ثانية للإشعارات).
4. **إشعارات الخلفية (Push)**: تحتاج مفتاح Firebase خاص بك:
   - `google-services.json` في `android/app/` (يُنشأ في CI إن وضعت السرّ).
   - متغيّر بناء `VITE_PUSH_ENABLED=true`.
   - أسرار GitHub: `GOOGLE_SERVICES_JSON` (محتوى الملف base64 أو نصًّا).
   - لا تضع `service_role` ولا مفتاح Firebase في `VITE_*` أو في الواجهة.
   بدون ذلك: الإشعارات تعمل والتطبيق مفتوح (in-app + إشعار محلي بصوت)، ولا تصل عندما يكون مغلقًا.
5. **الويب**: إشعارات المتصفح تعمل على HTTPS فقط (شرط Service Worker وNotification API). InfinityFree يوفّر شهادة مجانية — فعّل HTTPS.
6. **المتغيّرات المطلوبة للبناء**: `VITE_SUPABASE_URL` و`VITE_SUPABASE_ANON_KEY` في GitHub Variables.

---

## 4) نتائج الاختبارات الفعلية

نُفِّذت فعليًا على PostgreSQL (WASM/PGlite) وNode:

```
npm run typecheck          → نجح بلا أخطاء
npm test                   → 5 ملفات، 29 اختبارًا ناجحًا
npm run test:sql           → كل الملفات ناجحة
  sql-ddl.check.mjs        → PASS (تنفيذ كامل + إعادة تنفيذ idempotent)
  sql-behavior.check.mjs   → 42 passed, 0 failed
  sql-social.check.mjs     → 62 passed, 0 failed
  sql-legacy.check.mjs     → PASS (قاعدة قديمة بأعمدة text أُصلحت)
npm run build              → نجح، dist/ جاهز
```

اختبارات SQL تغطي الحالات المطلوبة صراحةً:

- طلب جديد يصل إشعاره لكل الموصّلين المعتمدين.
- موصّلان يحاولان القبول: الأول ينجح، الثاني `already_taken`.
- اختفاء الطلب من قائمة «متاحة» بعد الإسناد.
- عرض سعر مقبول، وعرض مرفوض بعد الإسناد (`order_closed`).
- الدردشة بين طرفي الطلب فقط، وRLS يخفيها عن الغير.
- لا يكتمل الطلب قبل تأكيد الطرفين.
- التقييم بعد التأكيد فقط، ومرة واحدة.
- الإحصائيات الأسبوعية من بيانات حقيقية.
- تغيير الصورة والاسم، والدور لا يتغيّر من الواجهة.
- تأكيد ضيف برمز التتبّع فقط: رمز خاطئ/قصير → `not_found`، قبل الإسناد → `no_courier_yet`، والتكرار لا يغيّر النتيجة.

**ما لم يُختبر حيًا:** الاتصال بمشروع Supabase حقيقي (لا توجد مفاتيح في هذه البيئة)، وبناء APK (لا يوجد Android SDK محليًا؛ البناء يحدث في GitHub Actions). كل ما يخص Supabase هنا مُتحقَّق منه على PostgreSQL فعلي عبر PGlite مع محاكاة `auth.uid()`.

---

## 5) الملفات المعدّلة والمضافة

**SQL**
- `supabase/migrations/14_delivery_chat_rating_profiles.sql` (جديد)
- `supabase/build-all-in-one.mjs`
- `supabase/ersel_all_in_one.sql` (مُعاد توليده)
- `supabase/tests/sql-social.check.mjs` (جديد)

**مكتبات الواجهة**
- `src/lib/rpc.ts` (جديد) — مساعدات أخطاء RPC
- `src/lib/delivery.ts` (جديد) — تأكيد الطرفين + تقييم + تأكيد الضيف
- `src/lib/chat.ts` (جديد)
- `src/lib/staffStats.ts` (جديد)
- `src/lib/profile.ts` (جديد) — ضغط الصورة ورفعها
- `src/lib/notifications.ts` — صندوق إشعارات + بثّ + نقر
- `src/lib/staffOrders.ts` — حقول التأكيد/العروض/الرسائل + `placeOffer` + `courierStep`
- `src/lib/myOrders.ts` — عروض + تقييمي + موصّل + `acceptOffer` + `canChat`
- `src/lib/auth.ts` — `avatar_url` في `Profile`
- `src/lib/orders.ts` — حقول التأكيد في تتبّع الضيف
- `src/lib/roles.ts` — صفحة `profile`
- `src/hooks/useAuth.ts` — تحميل `avatar_url` مع رجوع آمن لقاعدة قديمة
- `src/hooks/useOrderNotifications.ts` — ربط صندوق الإشعارات

**واجهة**
- `src/pages/Profile.tsx` (جديد)
- `src/pages/MyOrders.tsx` — تأكيد الاستلام، تقييم، دردشة، عروض، حالة التأكيدين
- `src/pages/TrackOrder.tsx` — تأكيد استلام الضيف برمز التتبّع
- `src/components/EmployeeDesk.tsx` — عرض سعر، تأكيد التسليم، دردشة، لوحة أسبوعية، جرس إشعارات
- `src/components/OrderChat.tsx` (جديد)
- `src/components/RatingStars.tsx` (جديد)
- `src/components/WeeklyStats.tsx` (جديد)
- `src/components/NotificationBell.tsx` (جديد)
- `src/App.tsx` — تنقّل للملف الشخصي، جرس، فتح الطلب من الإشعار
- `src/styles.css` — تنسيقات المكوّنات الجديدة
- `src/lib/__tests__/social.test.ts` (جديد)
- `package.json` — `test:sql` يضمّ اختبار الطبقة الاجتماعية

---

## 6) سلوك متوقّع عند نقص الإعداد

- **قاعدة لم تُحدَّث**: الشاشات تعمل، والميزات الجديدة تُظهر رسالة «هذه الميزة غير مفعّلة على الخادم بعد. شغّل ملف SQL الموحّد». لا انهيار.
- **دلو `avatars` غير موجود**: رسالة واضحة عند رفع الصورة، وباقي الملف الشخصي يعمل.
- **إشعارات مرفوضة من النظام**: لا يظهر تنبيه، ويبقى صندوق الإشعارات داخل التطبيق يعمل.
- **انقطاع الشبكة**: رسائل عربية واضحة بدل أخطاء خام، ولا فقدان بيانات محفوظة.
