-- =====================================================================
-- Dinç — v3.3: push bildirim token'ları, bildirim tercihleri, salon logosu
--
-- Supabase SQL Editor'de 0001–0008'den SONRA, baştan sona tek seferde
-- çalıştırılır. Tekrar çalıştırılırsa Storage kısmı (bucket, politikalar)
-- hata vermez; tablo kısmı "already exists" der.
--
-- - push_tokens: Expo push token'ları. Herkes yalnızca kendi token'ını
--   görür ve siler; ekleme register_push_token ile (kimlik auth.uid()).
--   Token tekil: telefonda başka hesapla giriş yapılınca token yeni
--   hesaba geçer, eski hesabın bildirimleri o telefona gitmez.
-- - notification_prefs: "Salon duyuruları" / "Ders iptalleri ve
--   değişiklikleri" (satır yoksa ikisi de açık). Yalnızca sahibi okur ve
--   yazar.
-- - Gönderim Edge Function'da (supabase/functions/notify), service role
--   ile; uygulama bu tabloları başkası adına okuyamaz.
-- - gym-logos bucket'ı: herkese açık okuma (logo gizli değil; kalıcı
--   adres önbelleğe uygun, imzalı adres süresi dolunca önbellek boşa
--   gider). Yazma / silme yalnızca o salonun yöneticisi, yalnızca
--   "<gym_id>/<ad>.jpg|png|webp" yoluna, en fazla 512 KB.
-- - gyms.logo_url: yalnızca yönetici, yalnızca kendi salonunun
--   gym-logos klasöründeki bir dosyaya (*.supabase.co) işaret edebilir;
--   dış adres yok (üyelerin telefonu başka sunucuya istek atmasın).
--
-- Hesap silinince (0003) token'lar ve tercihler auth.users cascade ile
-- gider.
--
-- test/integration/push.int.ts gerçek test projesinde deniyor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Push token'ları
-- ---------------------------------------------------------------------

create table public.push_tokens (
  token text primary key
    check (token ~ '^Expo(nent)?PushToken\[[^]\s]{1,200}\]$'),
  user_id uuid not null references auth.users on delete cascade,
  platform text not null check (platform in ('android', 'ios')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index push_tokens_user_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

revoke all on table public.push_tokens from anon, authenticated;
grant select, delete on table public.push_tokens to authenticated;

create policy push_tokens_select_own on public.push_tokens
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy push_tokens_delete_own on public.push_tokens
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- Kaydet / tazele. Token başka hesaptaysa bu hesaba geçer. Kullanıcı
-- başına en çok 10 cihaz (en son görülenler kalır).
create function public.register_push_token(p_token text, p_platform text)
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

  insert into public.push_tokens (token, user_id, platform)
  values (p_token, v_uid, p_platform)
  on conflict (token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        created_at = case
          when public.push_tokens.user_id = excluded.user_id then public.push_tokens.created_at
          else now()
        end,
        last_seen_at = now();

  delete from public.push_tokens t
  where t.user_id = v_uid
    and t.token not in (
      select k.token from public.push_tokens k
      where k.user_id = v_uid
      order by k.last_seen_at desc
      limit 10
    );
end;
$$;

revoke execute on function public.register_push_token(text, text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Bildirim tercihleri (satır yoksa hepsi açık)
-- ---------------------------------------------------------------------

create table public.notification_prefs (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  notify_announcements boolean not null default true,
  notify_class_changes boolean not null default true,
  updated_at timestamptz not null default now()
);

create function public.notification_prefs_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger notification_prefs_before_write
  before insert or update on public.notification_prefs
  for each row execute function public.notification_prefs_before_write();

alter table public.notification_prefs enable row level security;

revoke all on table public.notification_prefs from anon, authenticated;
grant select on table public.notification_prefs to authenticated;
grant insert (user_id, notify_announcements, notify_class_changes)
  on table public.notification_prefs to authenticated;
-- user_id: upsert (on conflict do update) sütunu da yazıyor; politika
-- başkasınınkine çevirmeyi engelliyor
grant update (user_id, notify_announcements, notify_class_changes)
  on table public.notification_prefs to authenticated;

create policy notification_prefs_select_own on public.notification_prefs
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy notification_prefs_insert_own on public.notification_prefs
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy notification_prefs_update_own on public.notification_prefs
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke execute on function public.notification_prefs_before_write() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Salon logosu: gyms.logo_url (yalnızca yönetici, yalnızca kendi klasörü)
-- ---------------------------------------------------------------------

alter table public.gyms
  add constraint gyms_logo_url_check check (
    logo_url is null
    or logo_url ~ ('^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/gym-logos/'
                   || id::text || '/[A-Za-z0-9_-]{1,64}\.(jpg|png|webp)$')
  ) not valid;

grant update (logo_url) on table public.gyms to authenticated;
-- gyms_update_admin (0008) yalnızca yöneticiye izin veriyor

-- ---------------------------------------------------------------------
-- Storage: gym-logos
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gym-logos', 'gym-logos', true, 524288, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- "<gym_id>/<ad>.<uzantı>" ise salon kimliği, değilse null (yetki yok)
create function public.gym_logo_object_gym(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_-]{1,64}\.(jpg|png|webp)$'
    then split_part(p_name, '/', 1)::uuid
  end;
$$;

revoke execute on function public.gym_logo_object_gym(text) from public, anon;
grant execute on function public.gym_logo_object_gym(text) to authenticated;

drop policy if exists gym_logos_select_admin on storage.objects;
drop policy if exists gym_logos_insert_admin on storage.objects;
drop policy if exists gym_logos_update_admin on storage.objects;
drop policy if exists gym_logos_delete_admin on storage.objects;

-- Herkese açık adres politikasız da okunur; bu yalnızca yöneticinin
-- kendi klasörünü listelemesi / silmesi için.
create policy gym_logos_select_admin on storage.objects
  for select to authenticated
  using (bucket_id = 'gym-logos' and public.is_gym_admin(public.gym_logo_object_gym(name)));

create policy gym_logos_insert_admin on storage.objects
  for insert to authenticated
  with check (bucket_id = 'gym-logos' and public.is_gym_admin(public.gym_logo_object_gym(name)));

create policy gym_logos_update_admin on storage.objects
  for update to authenticated
  using (bucket_id = 'gym-logos' and public.is_gym_admin(public.gym_logo_object_gym(name)))
  with check (bucket_id = 'gym-logos' and public.is_gym_admin(public.gym_logo_object_gym(name)));

create policy gym_logos_delete_admin on storage.objects
  for delete to authenticated
  using (bucket_id = 'gym-logos' and public.is_gym_admin(public.gym_logo_object_gym(name)));
