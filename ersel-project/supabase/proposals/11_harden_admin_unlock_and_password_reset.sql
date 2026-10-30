-- ============================================================
-- ERSEL — اقتراح 11: تقوية مساري دخول الإدارة واستعادة كلمة المرور
-- الحالة: غير منفَّذ. لا يُشغَّل تلقائيًا. راجعه ثم شغّله في SQL Editor.
-- يعتمد على: migrations 01..05 ثم supabase/ersel_v2.sql
-- ============================================================
--
-- لماذا هذا الملف؟
--
-- 1) public.admin_unlock(p_code) في ersel_v2.sql يقوم حرفيًا بـ:
--        update public.profiles set role = 'admin' where id = auth.uid();
--    أي أن أي حساب مسجَّل يعرف الرمز (101112 افتراضيًا) يصبح مديرًا.
--    هذا يخالف شرط المنتج: «لا يستطيع المستخدم منح نفسه دور المدير».
--    كما أن الواجهة تتحقق من الدور *بعد* استدعاء الدالة، فيكون الترقية قد
--    حدثت بالفعل قبل أن تظهر رسالة «هذا الحساب لا يملك دور المدير».
--
-- 2) public.reset_password_by_phone(p_phone, p_new_password) ممنوحة لـ anon،
--    وتغيّر كلمة سر أي حساب زبون بمجرد معرفة رقم هاتفه. هذا استيلاء كامل
--    على الحساب بلا أي إثبات ملكية.
--
-- ما يفعله هذا الملف:
--   أ) admin_unlock تصبح بوابة تحقق فقط: لا تغيّر أي دور. ترفض غير المدير
--      قبل فحص الرمز حتى لا يُكشف صلاح الرمز.
--   ب) reset_password_by_phone تعمل فقط للجلسة نفسها (رقمها = رقم الحساب)
--      أو لمدير يعيد تعيين كلمة سر زبون. تُسحب من anon.
--
-- ما لا يفعله:
--   - لا يرقّي أي حساب إلى admin. الترقية تبقى يدوية من SQL بموافقة المالك.
--   - لا يعيد تفعيل «نسيت كلمة المرور» من شاشة الدخول. ذلك يحتاج رمزًا
--     لمرة واحدة (OTP) عبر مزوّد رسائل، وهو قرار منفصل.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- أ) admin_unlock: تحقق فقط، بلا منح دور
-- ------------------------------------------------------------
create or replace function public.admin_unlock(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid      uuid := auth.uid();
  v_role     public.app_role;
  v_hash     text;
  v_user_fail integer;
  v_all_fail  integer;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  -- الترتيب مقصود: نرفض غير المدير قبل فحص الرمز، فلا يتسرّب أي معلومة
  -- عن صلاحية الرمز إلى حساب عادي.
  select role into v_role from public.profiles where id = v_uid;
  if v_role is distinct from 'admin'::public.app_role then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

  select count(*) into v_user_fail
    from public.admin_unlock_attempts
   where user_id = v_uid and not ok and at > now() - interval '15 minutes';
  select count(*) into v_all_fail
    from public.admin_unlock_attempts
   where not ok and at > now() - interval '15 minutes';
  if v_user_fail >= 5 or v_all_fail >= 30 then
    return jsonb_build_object('ok', false, 'error', 'locked');
  end if;

  select code_hash into v_hash from public.admin_secret where id;
  if v_hash is null or p_code is null or crypt(p_code, v_hash) <> v_hash then
    insert into public.admin_unlock_attempts (user_id, ok) values (v_uid, false);
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;

  insert into public.admin_unlock_attempts (user_id, ok) values (v_uid, true);
  -- لا set_config ولا update على profiles: الدور لا يُمنح من هنا إطلاقًا.
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_unlock(text) from public, anon;
grant execute on function public.admin_unlock(text) to authenticated;

-- ------------------------------------------------------------
-- ب) reset_password_by_phone: للجلسة نفسها أو لمدير فقط
-- ------------------------------------------------------------
create or replace function public.reset_password_by_phone(p_phone text, p_new_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, auth
as $$
declare
  v_uid       uuid := auth.uid();
  v_digits    text;
  v_target    uuid;
  v_my_phone  text;
  v_role      public.app_role;
  v_target_role public.app_role;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  v_digits := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if v_digits like '213%' then v_digits := substr(v_digits, 4); end if;
  v_digits := regexp_replace(v_digits, '^0+', '');
  if v_digits !~ '^[5-7][0-9]{8}$' then
    return jsonb_build_object('ok', false, 'error', 'phone_invalid');
  end if;

  if length(coalesce(p_new_password, '')) < 8
     or p_new_password !~ '[0-9]'
     or p_new_password !~ '[A-Za-zء-ي]' then
    return jsonb_build_object('ok', false, 'error', 'password_weak');
  end if;

  select role, phone into v_role, v_my_phone from public.profiles where id = v_uid;

  -- ملكية الرقم: إما رقم الجلسة نفسها، أو مدير يعيد تعيين كلمة سر زبون.
  if v_role is distinct from 'admin'::public.app_role then
    if v_my_phone is null
       or regexp_replace(regexp_replace(coalesce(v_my_phone, ''), '\D', '', 'g'), '^(213|0)+', '') <> v_digits then
      return jsonb_build_object('ok', false, 'error', 'not_owner');
    end if;
  end if;

  if (select count(*) from public.password_reset_log
       where phone = v_digits and at > now() - interval '1 hour') >= 3
     or (select count(*) from public.password_reset_log
          where at > now() - interval '1 hour') >= 100 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  insert into public.password_reset_log (phone, ok) values (v_digits, false);

  select id into v_target
    from auth.users
   where email = '213' || v_digits || '@phone.ersel.app';
  if v_target is null then
    return jsonb_build_object('ok', false, 'error', 'account_not_found');
  end if;

  select role into v_target_role from public.profiles where id = v_target;
  if v_target_role in ('admin'::public.app_role, 'employee'::public.app_role)
     and v_role is distinct from 'admin'::public.app_role then
    return jsonb_build_object('ok', false, 'error', 'staff_not_allowed');
  end if;

  update auth.users
     set encrypted_password = crypt(p_new_password, gen_salt('bf')),
         updated_at = now()
   where id = v_target;
  delete from auth.sessions where user_id = v_target;
  update public.password_reset_log set ok = true
   where id = (select max(id) from public.password_reset_log where phone = v_digits);

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.reset_password_by_phone(text, text) from public, anon;
grant execute on function public.reset_password_by_phone(text, text) to authenticated;

commit;

-- ============================================================
-- التحقق بعد التنفيذ (يدويًا):
--
--   -- 1) حساب زبون عادي لا يصبح مديرًا مهما أدخل الرمز:
--   select public.admin_unlock('101112');   -- يجب: {"ok": false, "error": "not_admin"}
--   select role from public.profiles where id = auth.uid();  -- يبقى customer
--
--   -- 2) لا استدعاء مجهول لاستعادة كلمة المرور:
--   --    من anon يجب أن يرجع permission denied.
--
--   -- 3) مدير معتمد ما زال يستطيع فتح اللوحة بالرمز:
--   select public.admin_unlock('<الرمز>');  -- {"ok": true}
--
-- ملاحظة: بعد تنفيذ هذا الملف تصبح «نسيت كلمة المرور» في شاشة الدخول
-- معطّلة للمستخدم غير المسجَّل. الواجهة تعرض رسالة واضحة بدل خطأ عام.
-- ============================================================
