-- =====================================================================
-- Dinç — ad alanı (v3.2c sonrası)
--
-- Supabase SQL Editor'de 0001–0006'dan SONRA, baştan sona tek seferde
-- çalıştırılır.
--
-- profiles.display_name zaten var (0001) ama uygulama doldurmuyordu.
-- - Ad isteğe bağlı; varsa 2–40 karakter, baş / son boşluk ve kontrol
--   karakteri yok (sunucuda kısıt).
-- - Kayıtta verilen ad (auth kullanıcı verisi `display_name`) profile
--   yazılır; geçersizse yok sayılır, kayıt bozulmaz.
-- - Görünürlük değişmedi (0001 profiles_select): kişi kendisini, salonun
--   hoca ve yöneticisi o salonun üyelerini görür. Diğer üyeler görmez.
-- - İstisna: duyuru yazarının adı, duyuruyu görebilen üyelere
--   (announcement_author_names). Yazarlar hoca / yönetici.
--
-- test/integration/profile.int.ts gerçek test projesinde deniyor.
-- =====================================================================

-- Uygulama hiç yazmadığı için normalde boş; yine de kısıttan önce temizle
update public.profiles
set display_name = nullif(regexp_replace(btrim(display_name), '\s+', ' ', 'g'), '')
where display_name is not null;
update public.profiles
set display_name = null
where display_name is not null and char_length(display_name) not between 2 and 40;

alter table public.profiles
  add constraint profiles_display_name_check check (
    display_name is null
    or (
      char_length(display_name) between 2 and 40
      and display_name = btrim(display_name)
      and display_name !~ '[[:cntrl:]]'
    )
  );

-- Kayıtta verilen ad: kısıta uymuyorsa boş kalır (kayıt hata vermesin)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Yalnızca metin (sayı / nesne yok sayılır)
  v_name text := case
    when jsonb_typeof(new.raw_user_meta_data -> 'display_name') = 'string' then nullif(
      regexp_replace(btrim(new.raw_user_meta_data ->> 'display_name'), '\s+', ' ', 'g'),
      ''
    )
  end;
begin
  if v_name is not null and (char_length(v_name) not between 2 and 40 or v_name ~ '[[:cntrl:]]') then
    v_name := null;
  end if;
  insert into public.profiles (id, display_name) values (new.id, v_name);
  return new;
end;
$$;
-- (create or replace yetkileri korur; 0001'deki gibi kalır)

-- Duyuru yazarlarının adı: yalnızca o duyuruyu görebilene (salonun üyesi)
create function public.announcement_author_names()
returns table (announcement_id uuid, author_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, p.display_name
  from public.announcements a
  join public.profiles p on p.id = a.author_id
  where p.display_name is not null
    and public.is_gym_member(a.gym_id);
$$;

revoke execute on function public.announcement_author_names() from public, anon;
grant execute on function public.announcement_author_names() to authenticated;
