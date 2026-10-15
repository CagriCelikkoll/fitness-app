-- =====================================================================
-- Dinç — v3.1c hesabı ve buluttaki verileri silme
--
-- Supabase SQL Editor'de 0001 ve 0002'den SONRA, baştan sona tek
-- seferde çalıştırılır.
--
-- KVKK silme hakkı ve App Store kuralı (uygulamada açılan hesap
-- uygulamadan silinebilmeli). Kullanıcı yalnızca KENDİ hesabını siler:
-- kimlik her zaman auth.uid(), parametre yok.
--
-- Yol: security definer fonksiyon auth.users satırını siliyor. Supabase'in
-- auth tabloları (oturumlar, kimlikler) ve bizim bütün tablolarımız
-- auth.users'a "on delete cascade" ile bağlı; yine de kendi tablolarımızı
-- açıkça siliyoruz (ileride cascade'siz bir tablo eklenirse de kalmasın).
-- Alternatif (Edge Function + service role ile auth.admin.deleteUser)
-- ayrı dağıtım ister; ayrıntı docs/sync-tasarim.md Ek C.
--
-- Salonun tek yöneticisi silemez (salon yöneticisiz kalmasın):
-- 'sole_admin' hatası, istemci açıklamasını gösteriyor.
--
-- test/accountDelete.test.ts bu dosyayı PGlite'ta deniyor.
-- =====================================================================

create function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.gym_members m
    where m.user_id = v_uid
      and m.role = 'admin'
      and public.gym_admin_count(m.gym_id) = 1
  ) then
    raise exception 'sole_admin' using errcode = 'P0001';
  end if;

  delete from public.sets where user_id = v_uid;
  delete from public.cardio_segments where user_id = v_uid;
  delete from public.session_exercises where user_id = v_uid;
  delete from public.workout_sessions where user_id = v_uid;
  delete from public.routine_exercises where user_id = v_uid;
  delete from public.routines where user_id = v_uid;
  delete from public.gym_join_attempts where user_id = v_uid;
  delete from public.gym_members where user_id = v_uid;
  delete from public.profiles where id = v_uid;
  delete from auth.users where id = v_uid;
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
