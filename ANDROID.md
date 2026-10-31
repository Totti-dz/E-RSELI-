# تطبيق ERSEL للأندرويد

**لا تحتاج Android Studio، ولا Java، ولا جهازًا.** GitHub يبني الـ APK نيابةً عنك
من ملف واحد: `.github/workflows/build-apk.yml`.

المشروع **لا يحتوي مجلد `android/`** إطلاقًا. المجلد يُولَّد داخل التشغيل عبر
`scripts/android-init.mjs`، الذي ينفّذ `cap add android` ثم يضيف الأيقونة والصوت
و`android-overlay/` (خمسة ملفات نخصّصها: البيان، الألوان، الاسم، أيقونة الحالة،
وGradle). لذلك ما ترفعه إلى المستودع يبقى صغيرًا وقابلًا للقراءة.

---

## 1) ارفع المشروع إلى GitHub

من صفحة المستودع: **Add file ← Upload files**، ثم اسحب المجلدات. الحدّ الأقصى
100 ملف في المرة، والمشروع 106 ملفًا — لذا ارفعه على دفعتين:

| الدفعة | ما فيها | العدد |
|---|---|---|
| الأولى | `src/` · `public/` · `scripts/` · `android-overlay/` | 66 |
| الثانية | `supabase/` + ملفات الجذر (`package.json`, `package-lock.json`, `index.html`, `vite.config.ts`, `tsconfig*.json`, `capacitor.config.ts`, `.env.example`, `.gitignore`) | 40 |

ثم **Commit changes** بعد كل دفعة.

> `package-lock.json` ضروري: بدونه يفشل `npm ci` في السير عمل.

## 2) أضف ملف السير عمل

**Add file ← Create new file**، واسم الملف بالضبط:

```
.github/workflows/build-apk.yml
```

الصق محتوى `.github/workflows/build-apk.yml` من المشروع ← **Commit changes**.
(كتابة `/` في اسم الملف تُنشئ المجلدات تلقائيًا.)

## 3) اضبط متغيّرين

**Settings ← Secrets and variables ← Actions ← Variables ← New variable**:

| الاسم | القيمة |
|---|---|
| `VITE_SUPABASE_URL` | `https://xxxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | مفتاح `anon` العام |

مفتاح `anon` ليس سرًا — يُشحن داخل كل نسخة من الواجهة، والحماية الحقيقية في
سياسات RLS. **لا تضع `service_role` في أي متغيّر أبدًا.**

## 4) البناء يبدأ تلقائيًا

بمجرد وصول أول commit إلى المستودع يبدأ التشغيل. راقبه في **Actions ← Build APK**.
~6 دقائق، ثم:

- **Releases** ← إصدار باسم «ERSEL — أحدث نسخة» ← `ersel.apk` جاهز للتحميل.
- أو **Artifacts** في صفحة التشغيل ← `ersel-apk-<رقم>` (نسخة مؤقتة 30 يومًا).

بعد ذلك **كل push** يعيد البناء ويستبدل الملف في نفس الإصدار.

## 5) الرابط الثابت

```
https://github.com/<USER>/<REPO>/releases/latest/download/ersel.apk
```

هذا الرابط لا يتغيّر أبدًا ويشير دائمًا لآخر نسخة. ضعه في أي مكان (واتساب،
فيسبوك، ملصق QR) — يبقى صالحًا بعد كل تحديث.

السير عمل يحقن نفس الرابط داخل التطبيق تلقائيًا (`VITE_ANDROID_APK_URL`)،
فيصبح زر «تحميل APK» في الموقع حيًّا دون تعديل أي ملف.

### التحديثات داخل التطبيق

كل بناء يحمل رقمه (`VITE_APP_BUILD` = رقم تشغيل GitHub) ويُطبع في ترويسة لوحة
التثبيت: «الإصدار 0.1.0 · بناء 12». زر **«تحقّق من التحديث»** يسأل GitHub عن آخر
إصدار ويقارن الرقمين:

- **أحدث** → يظهر زر «تحميل بناء N» مباشرة.
- **أنت على أحدث نسخة** → رسالة تأكيد.
- **تعذّر التحقّق** → رسالة صريحة، ولا يدّعي أن النسخة حديثة.

هذا مهم لأن APK خارج المتجر لا يُحدَّث تلقائيًا: المستخدم لا يعرف أن هناك نسخة
أجدد إلا إن أخبره التطبيق.

## 6) التثبيت على الهاتف

**أندرويد**

1. افتح الرابط في متصفح الهاتف، واسمح بالتثبيت من هذا المصدر مرة واحدة.
2. ثبّت، افتح التطبيق، سجّل الدخول بنفس حسابك.
3. من لوحة التثبيت اضغط «تشغيل الإشعارات» ثم «تجربة الصوت» لتسمع النغمة.

**آيفون**

iOS لا يقبل APK. افتح الموقع في **Safari** ← زر المشاركة ←
**«إضافة إلى الشاشة الرئيسية»** — تحصل على أيقونة وتطبيق بملء الشاشة،
لكن بدون إشعارات فورية (iOS يمنعها لمواقع الويب غير المدفوعة عبر APNs).

## 7) الإشعارات مع الصوت

### أ) محلية — تعمل بلا أي إعداد

`src/lib/notifications.ts` يراقب طلباتك كل 25 ثانية أثناء تشغيل التطبيق، وعند
تغيّر الحالة يُطلق إشعارًا على قناة `ersel_orders` بصوت `ersel_chime`.

- الصوت: `android/app/src/main/res/raw/ersel_chime.wav` — يُولَّد بـ
  `scripts/make-sound.mjs` (نغمتان صاعدتان، 1.15 ثانية، PCM 16-bit، بلا حقوق).
- القناة: `importance 5` (heads-up) + اهتزاز.
- الأيقونة: `drawable/ic_stat_ersel.xml` (قبعة بيضاء شفافة).
- من Android 8 لا يمكن تغيير صوت القناة بعد إنشائها؛ لتغيير النغمة غيّر اسم
  الملف أو معرّف القناة.

### ب) فورية عبر FCM — عندما يكون التطبيق مغلقًا (اختياري)

1. أنشئ تطبيق أندرويد في [Firebase](https://console.firebase.google.com) بالحزمة
   `app.ersel.dz`، ونزّل `google-services.json`، وضعه في `android/app/` محليًا،
   أو أضفه كـ Secret باسم `GOOGLE_SERVICES_JSON` وأضف خطوة كتابته قبل «بناء APK».
2. انشر دالة الإرسال:
   ```bash
   supabase functions deploy notify-order --no-verify-jwt
   supabase secrets set FCM_SERVICE_ACCOUNT="$(cat service-account.json)"
   supabase secrets set FCM_PROJECT_ID="<project-id>"
   ```
3. Supabase ← Database ← Webhooks: Webhook على `orders`، حدث `UPDATE`،
   الهدف `https://<PROJECT>.supabase.co/functions/v1/notify-order`.
4. أعد التشغيل مع `VITE_PUSH_ENABLED=true` كمتغيّر.

**بدون هذه الخطوات:** التطبيق يُبنى ويعمل، والإشعارات المحلية تعمل أثناء تشغيله.
لا كسر ولا رسالة خطأ.

## 8) البناء محليًا (اختياري)

يحتاج JDK 21 + Android SDK — أي Android Studio. بدونهما استخدم GitHub فقط.

```bash
npm install
npm run android:init     # يولّد android/ + الأيقونة + الصوت
npm run android:apk      # الناتج: android/app/build/outputs/apk/release/
```

على macOS/Linux استبدل السطر الأخير بـ `cd android && ./gradlew assembleRelease`.

### للنشر على استضافة (InfinityFree / Netlify / Vercel / cPanel)

الاستضافة **لا تبني شيئًا**: ترفع الناتج فقط. كل استضافة واعية تقبل ملفات ثابتة.

InfinityFree تحديدًا (حسب موقعه الرسمي): PHP 8.4 · MySQL 8 · FTP + File
Manager · دعم كامل لـ `.htaccess` · شهادة SSL مجانية · 5 GB · نطاق فرعي مجاني
· **بلا إعلانات على موقعك**. لا يدعم Node.js، ولا تشغيل بناء داخل الخادم —
وهذا غير مشكلة لأن بناءً واحدًا عندك يكفي.

**الخطوة 1 — جهّز المفاتيح (مرة واحدة):**
```bash
cp .env.example .env.local
# املأ VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY
```

**الخطوة 2 — ابدأ رابط APK (مرة واحدة):**
```bash
npm run set-repo -- اسم_المستخدم/اسم_المستودع   # يكتب REPO_OVERRIDE في src/lib/release.ts
```
> في GitHub Actions لا تحتاج هذا أبدًا — السير عمل يضبط `VITE_GITHUB_REPO` بنفسه.

**الخطوة 3 — ابنِ:**
```bash
npm run build
```

**الخطوة 4 — ارفع إلى `htdocs`:**
- الأسهل: File Manager ← رفع `ersel-hosting.zip` ← Extract ← نقل المحتوى إلى
  جذر `htdocs` (وليس داخل مجلد فرعي).
- أو FTP إلى `ftp://<حساب>.ftp.infinityfree.com` — المجلد `htdocs`.

**ماذا يُرفع بالضبط (27 ملفًا):**
```
.htaccess            ← MIME + تخزين مؤقت + مسار احتياطي
index.html           ← الصفحة الوحيدة التي يحتاجها المتصفح
assets/              ← 13 ملف JS/CSS مبنيّ (بصمة في الاسم)
brand/               ← 8 صور (شعار، أيقونات، خلفية)
icon.svg
manifest.webmanifest ← يفعّل «تثبيت التطبيق» في المتصفح
sw.js                ← التخزين المؤقت للعمل دون اتصال
```

**الخطوة 5 — فعّل HTTPS** من لوحة تحكم InfinityFree (قسم SSL، شهادة مجانية)،
ثم أزل علامة `#` عن سطر `Redirect permanent` في `.htaccess`.

### ثلاث حقائق عن InfinityFree يجب أن تعرفها

1. **Service Worker والإشعارات في المتصفح تحتاج HTTPS.** على HTTP يعمل الموقع
   كاملًا، لكن «تثبيت التطبيق» والتخزين المؤقت والإشعارات لا تعمل. تطبيق
   الأندرويد (APK) لا يتأثر — إشعاراته عبر قناة أندرويد لا عبر الويب.
2. **الحساب المجاني يحتاج زيارات.** موقعهم ينصّ على أن الموقع «يجب أن يتلقّى بضعة
   زيارات شهريًا» كي يبقى نشطًا. تطبيق توصيل يجلب زيارات بطبيعة الحال، لكن إن
   توقّف الموقع فترة طويلة فكّر في استضافة مدفوعة.
3. **قاعدة البيانات ليست MySQL.** ERSEL يستعمل Supabase من المتصفح مباشرة
   (لا PHP ولا استعلامات خادم)، لذلك لا تحتاج إنشاء قاعدة بيانات في InfinityFree
   ولا أي سكربت PHP. مفاتيح `anon` آمنة هنا لأن الحماية كلها في سياسات RLS.

## 9) الملفات المعنية

| الملف | الدور |
|---|---|
| `.github/workflows/build-apk.yml` | البناء والتوقيع والنشر — الملف الوحيد المطلوب من GitHub |
| `scripts/android-init.mjs` | يولّد مشروع أندرويد ويطبّق التخصيصات (idempotent) |
| `android-overlay/` | الملفات الخمسة التي نخصّصها فوق قالب Capacitor |
| `capacitor.config.ts` | معرّف التطبيق `app.ersel.dz`، شاشة البداية، قناة الإشعار |
| `scripts/make-icons.mjs` | الأيقونة من `public/brand/logo-mark.png` |
| `scripts/make-sound.mjs` | نغمة الإشعار (WAV مُولَّد برمجيًا) |
| `src/lib/notifications.ts` | المراقبة + القناة + الإشعار + ربط FCM |
| `src/components/AndroidInstall.tsx` | لوحة التثبيت داخل التطبيق |
| `supabase/migrations/13_device_tokens.sql` | جدول رموز الأجهزة + دالتا التسجيل |
| `supabase/functions/notify-order/index.ts` | إرسال FCM عند تغيّر حالة الطلب |

## 10) التوقيع الرسمي (اختياري لكن مُستحسن قبل النشر الواسع)

بدون keystore يُوقَّع الـ APK بمفتاح debug: يُثبَّت ويعمل، لكنه لا يصلح للتحديث
فوق نسخة موقّعة بمفتاح آخر. لإنشاء مفتاح دائم:

```bash
keytool -genkeypair -v -keystore ersel-release.jks \
  -alias ersel -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 ersel-release.jks     # الصق الناتج في ERSEL_KEYSTORE_BASE64
```

أضف الأسرار: `ERSEL_KEYSTORE_BASE64`, `ERSEL_KEYSTORE_PASSWORD`,
`ERSEL_KEY_ALIAS`, `ERSEL_KEY_PASSWORD`.
**احتفظ بالملف وكلماته**: فقدانه يعني عدم القدرة على تحديث التطبيق مستقبلًا.

## 11) حدود معروفة

- **لم يُبنَ APK على جهازك هنا**: لا Android SDK في بيئة العمل. البناء يحدث في
  GitHub Actions، و`android/` يُولَّد من قالب Capacitor 8 المثبّت في
  `package-lock.json` — أي أنه قابل للتكرار.
- **FCM لم يُختبر على جهاز حقيقي** لعدم وجود مشروع Firebase. المسار المضمون هو
  الإشعارات المحلية + الصوت.
- التطبيق يعرض نفس الموقع؛ لا شاشات أصلية إضافية.
- `minSdk 24` = أندرويد 7.0 وأحدث.
