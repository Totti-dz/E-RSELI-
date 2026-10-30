-- ============================================================
-- ERSEL — 13: رموز الأجهزة للإشعارات (FCM)
-- يُنفَّذ بعد 12. آمن للتشغيل أكثر من مرة.
--
-- الغرض: يحتفظ التطبيق على أندرويد برمز FCM لكل جهاز، ويُربطه بالحساب.
-- إرسال الإشعارات نفسه يتم من دالة Edge (supabase/functions/notify-order)
-- تقرأ هذا الجدول — لا يوجد أي مفتاح سري في التطبيق.
-- ============================================================

create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null,
  platform text not null default 'android',
  app_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint device_tokens_token_unique unique (token)
);

create index if not exists device_tokens_user_idx on public.device_tokens (user_id);

alter table public.device_tokens enable row level security;

-- صاحب الجهاز يرى رموزه ويحذفها؛ لا أحد يعدّل صفوف غيره.
drop policy if exists "device tokens owner read" on public.device_tokens;
create policy "device tokens owner read" on public.device_tokens
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "device tokens owner delete" on public.device_tokens;
create policy "device tokens owner delete" on public.device_tokens
  for delete to authenticated
  using (user_id = auth.uid());

-- لا سياسة insert: التسجيل يمر عبر الدالة أدناه فقط، لأنها تتحقق من
-- شكل الرمز وتمنع سرقة رمز جهاز مستخدم آخر (on conflict do update).
drop policy if exists "device tokens owner insert" on public.device_tokens;

create or replace function public.register_device_token(
  p_token text,
  p_platform text default 'android',
  p_app_version text default null
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_token text := btrim(coalesce(p_token, ''));
  v_platform text := lower(btrim(coalesce(p_platform, 'android')));
begin
  if v_uid is null then
    return json_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if length(v_token) < 20 or length(v_token) > 4096 then
    return json_build_object('ok', false, 'error', 'invalid_token');
  end if;

  if v_platform not in ('android', 'ios', 'web') then
    v_platform := 'android';
  end if;

  insert into public.device_tokens (user_id, token, platform, app_version)
  values (v_uid, v_token, v_platform, nullif(btrim(coalesce(p_app_version, '')), ''))
  on conflict (token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        app_version = excluded.app_version,
        updated_at = now();

  return json_build_object('ok', true);
exception
  when others then
    return json_build_object('ok', false, 'error', 'server_error');
end;
$$;

create or replace function public.unregister_device_token(p_token text)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return json_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  delete from public.device_tokens
   where token = btrim(coalesce(p_token, ''))
     and user_id = v_uid;

  return json_build_object('ok', true);
end;
$$;

revoke all on function public.register_device_token(text, text, text) from public;
revoke all on function public.unregister_device_token(text) from public;
grant execute on function public.register_device_token(text, text, text) to authenticated;
grant execute on function public.unregister_device_token(text) to authenticated;
