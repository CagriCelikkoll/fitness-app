-- =====================================================================
-- Dinç — v3.7 güvenlik: şifre kapalı, ad kuralı, aydınlatma onayı
--
-- Supabase SQL Editor'de 0001–0013'ten SONRA, baştan sona tek seferde
-- çalıştırılır. Önce raporun "okuma sorguları"na bak.
--
-- 1. DNC-09 (pentest, yüksek): hesabın sahibinden önce ele geçirilmesi.
--    Uygulama v3.7'den beri yalnızca e-posta koduyla (OTP) giriş yapıyor.
--    auth.users'a yazılan her şifre boşaltılıyor: şifreyle kayıt (signup),
--    yönetici API'si ve updateUser({ password }) dahil. Şifreyle giriş
--    (grant_type=password) böylece hiçbir hesapta çalışmaz; saldırganın
--    önceden açtığı hesabın şifresi de kalmaz.
--
--    Neden tetikleyici (Auth Hook değil):
--    - "Password Verification Attempt" hook'u ücretli planlarda (Team /
--      Enterprise).
--    - "Before User Created" hook'u ücretsiz ama yükte şifre yok, şifreli
--      kaydı koddan ayıramaz. GoTrue şifresiz kayıtta (OTP, generateLink
--      magiclink) da rastgele bir şifre üretip yazıyor; o yüzden "şifreli
--      kaydı reddet" yaklaşımı yeni hesap açmayı da bozardı. Boşaltmak
--      ikisinde de doğru çalışıyor.
--    - Boş şifre GoTrue'da "şifresi yok" demek (OTP kullanıcıları zaten
--      böyle): giriş "Invalid login credentials" ile reddedilir.
--    Supabase şemasına dokunan tek şey auth.users üzerindeki bu
--    tetikleyici (0001'deki on_auth_user_created gibi; Supabase'in
--    belgelediği yöntem). Tablo yapısı değişmiyor. Risk: ileride GoTrue
--    şifre sütununu taşırsa / adını değiştirirse tetikleyici sessizce
--    etkisiz kalır; bu yüzden test/integration/authHardening.int.ts her
--    turda şifreli girişin reddedildiğini deniyor.
--
-- 2. DNC-04 (düşük): görünen ad 1–40 karakter; harf (Türkçe dahil),
--    rakam, boşluk ve . - ' . "<", ">" ve kontrol karakterleri yasak.
--    Kayıtta gelen kullanıcı verisindeki ad artık profile yazılmıyor
--    (uygulama göndermiyor; şifreli kayıtla gelen ad saldırganın olabilir).
--
-- 3. KVKK aydınlatma onayı: profiles.privacy_version / privacy_ack_at.
--    Yalnızca ack_privacy_notice() yazar; okuma my_privacy_ack(). Salon
--    hocası / yöneticisi bu sütunları göremez (sütun yetkisi).
--
-- test/integration/authHardening.int.ts ve profile.int.ts gerçek test
-- projesinde deniyor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Şifre kapalı (DNC-09)
-- ---------------------------------------------------------------------

create function public.strip_auth_password()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.encrypted_password is not null and new.encrypted_password <> '' then
    new.encrypted_password := '';
  end if;
  return new;
end;
$$;

-- Tetikleyici fonksiyonu; istemci çağıramaz
revoke execute on function public.strip_auth_password() from public, anon, authenticated;

create trigger dinc_strip_password
  before insert or update of encrypted_password on auth.users
  for each row execute function public.strip_auth_password();

-- ---------------------------------------------------------------------
-- 2. Ad kuralı (DNC-04)
-- ---------------------------------------------------------------------

-- [[:alpha:]] veritabanının yerel ayarına bağlı. "C" yerel ayarında
-- Türkçe harfler harf sayılmaz; o durumda aşağıdaki temizlik adları
-- bozardı. Önce dene, değilse dur.
do $$
begin
  if not ('Çağrı Şükrü Öğüt İnce' ~ '^[[:alpha:][:digit:] .''-]+$') then
    raise exception 'Veritabani yerel ayari Turkce harfleri harf saymiyor; 0014 durduruldu, hicbir sey degismedi.';
  end if;
end;
$$;

-- Kurala uymayan adlar: izin verilmeyen karakterler atılır (akıllı
-- kesme işareti düz olur), boşluklar teklenir, 40'ta kesilir; boş
-- kalırsa null. Raporun okuma sorgusu etkilenecek satırları gösteriyor.
update public.profiles
set display_name = nullif(
  btrim(left(
    btrim(regexp_replace(
      regexp_replace(translate(display_name, U&'\2018\2019\02BC', ''''''''), '[^[:alpha:][:digit:] .''-]', '', 'g'),
      '\s+', ' ', 'g'
    )),
    40
  )),
  ''
)
where display_name is not null
  and not (
    char_length(display_name) between 1 and 40
    and display_name = btrim(display_name)
    and display_name ~ '^[[:alpha:][:digit:] .''-]+$'
  );

alter table public.profiles drop constraint profiles_display_name_check;

alter table public.profiles
  add constraint profiles_display_name_check check (
    display_name is null
    or (
      char_length(display_name) between 1 and 40
      and display_name = btrim(display_name)
      and display_name ~ '^[[:alpha:][:digit:] .''-]+$'
    )
  );

-- Kayıtta gelen kullanıcı verisi (raw_user_meta_data) artık okunmuyor:
-- profil adsız açılır, ad uygulamadan girilir.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Aydınlatma metni onayı
-- ---------------------------------------------------------------------

alter table public.profiles
  add column privacy_version text,
  add column privacy_ack_at timestamptz;

-- Sürüm metnin yürürlük tarihi (YYYY-AA-GG); uygulamada
-- PRIVACY_NOTICE_VERSION (src/content/legal.ts)
alter table public.profiles
  add constraint profiles_privacy_version_check check (
    privacy_version is null or privacy_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  );

-- Salonun hocası / yöneticisi üyenin profilini görebiliyor (0001
-- profiles_select); onay bilgisini görmesin. Tablo düzeyindeki select
-- yerine yalnızca eski sütunlar.
revoke select on table public.profiles from authenticated;
grant select (id, display_name, created_at) on table public.profiles to authenticated;

create function public.ack_privacy_notice(p_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_version is null or p_version !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'privacy_version_invalid' using errcode = '23514';
  end if;
  update public.profiles
  set privacy_version = p_version, privacy_ack_at = now()
  where id = v_uid;
  if not found then
    insert into public.profiles (id, privacy_version, privacy_ack_at)
    values (v_uid, p_version, now());
  end if;
end;
$$;

revoke execute on function public.ack_privacy_notice(text) from public, anon;
grant execute on function public.ack_privacy_notice(text) to authenticated;

-- Kendi onayın (sürüm + tarih); onay yoksa sütunlar null
create function public.my_privacy_ack()
returns table (privacy_version text, privacy_ack_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.privacy_version, p.privacy_ack_at
  from public.profiles p
  where p.id = auth.uid();
$$;

revoke execute on function public.my_privacy_ack() from public, anon;
grant execute on function public.my_privacy_ack() to authenticated;
