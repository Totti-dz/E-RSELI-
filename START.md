# ERSEL — ابدأ من هنا

```bash
npm install
npm run dev
```

## رابط تحميل APK (ثابت — لا يتغيّر)

```
https://github.com/<USER>/<REPO>/releases/latest/download/ersel.apk
```

1. أنشئ مستودعًا على GitHub وارفع هذا المجلد — 106 ملفات، على دفعتين (الحدّ 100).
2. إن لم يُرفع `.github/workflows/build-apk.yml` مع المجلد، أنشئه يدويًا:
   **Add file ← Create new file** واسمه `.github/workflows/build-apk.yml` ثم الصق محتواه.
3. **Settings ← Secrets and variables ← Actions ← Variables**:
   `VITE_SUPABASE_URL` و `VITE_SUPABASE_ANON_KEY`.
4. قبل أول استخدام: شغّل `supabase/ersel_all_in_one.sql` في Supabase SQL Editor.

كل push يبني التطبيق تلقائيًا (تبويب **Actions**) وينشر APK في **Releases**.
الرابط أعلاه ثابت ويشير دائمًا لآخر نسخة — ضعه في أي مكان مرة واحدة فقط.

داخل التطبيق: **لوحة التثبيت ← التحديثات ← تحقّق من التحديث** يخبرك إن كان
هناك بناء أحدث مع زر تحميله مباشرة.

## نسختان من نفس الكود — لا تخلط بينهما

| النسخة | ما ترفعه | ماذا يحدث |
|---|---|---|
| **الموقع المستضاف** (Netlify / Vercel / cPanel) | محتوى `dist/` فقط | المضيف يخدم ملفات جاهزة، بلا بناء |
| **تطبيق GitHub** | المصدر كاملًا + `build-apk.yml` | GitHub يبني `dist/` ثم يلفّه في APK |

المستضاف لا يحتاج `package.json` ولا `src/` — فقط ناتج البناء. وقبل بناء الموقع
عرّفه على مستودعك مرة واحدة:

```bash
npm run set-repo -- اسم_المستخدم/اسم_المستودع
npm run build
# ارفع محتوى dist/ إلى المضيف
```

بدون هذه الخطوة يعمل الموقع كاملًا لكن زر «تحميل APK» يبقى مخفيًا (لا رابط ميّت).

## النشر على InfinityFree

الاستضافة لا تبني شيئًا — ترفع الناتج فقط (27 ملفًا). الترتيب:

```bash
cp .env.example .env.local        # املأ مفاتيح Supabase
npm run set-repo -- user/repo      # ليربط زر تحميل APK
npm run build                      # ينتج dist/
```

ثم File Manager ← ارفع `ersel-hosting.zip` ← Extract ← انقل المحتوى إلى جذر
`htdocs` (لا داخل مجلد فرعي). فعّل شهادة SSL المجانية من لوحة التحكم، وإلا
لم يعمل «تثبيت التطبيق» ولا الإشعارات في المتصفح (الموقع نفسه يعمل).

> لا تحتاج قاعدة بيانات في InfinityFree: ERSEL يتصل بـ Supabase من المتصفح
> مباشرة، والحماية كلها في سياسات RLS.

## آيفون

iOS لا يقبل APK. افتح الموقع في **Safari** ← مشاركة ← **«إضافة إلى الشاشة الرئيسية»**.

## لا ترفع هذه الملفات

`.env.local` · `*.keystore` · `*.jks` · `google-services.json` · `dist/` — كلها في `.gitignore`.

## التفاصيل الكاملة

[ANDROID.md](ANDROID.md) — البناء، التوقيع، الإشعارات، FCM، وحلّ المشاكل.
