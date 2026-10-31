/*
 * ERSEL — إعدادات التشغيل (تُقرأ عند فتح الموقع، لا تحتاج إعادة بناء).
 *
 * يمكنك تعديل هذا الملف مباشرة على الاستضافة (htdocs/config.js) ثم تحديث الصفحة.
 * المفتاح هنا هو anon العام فقط — مصمَّم ليكون ظاهرًا في المتصفح، والحماية الفعلية
 * في سياسات RLS داخل قاعدة البيانات. لا تضع هنا service_role أبدًا.
 */
window.ERSEL_CONFIG = {
  supabaseUrl: "https://lkqmgidmxgjppsszwlvv.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxrcW1naWRteGdqcHBzc3p3bHZ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxNzk1NDYsImV4cCI6MjEwNzc1NTU0Nn0.tm74fTPMs2a35A8LdZWt2GiVD9TtqeDc-tUGD2CWe2U",
  // نطاق البريد الوهمي المشتق من رقم الهاتف. لا تغيّره بعد وجود مستخدمين،
  // وإلا لن يتعرّف التطبيق على الحسابات القديمة.
  emailDomain: "phone.ersel.app"
};
