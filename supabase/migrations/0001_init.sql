-- =====================================================================
-- Dinç — v3.0 hesap ve salon temeli
--
-- Supabase SQL Editor'de baştan sona tek seferde çalıştırılır.
-- Tablolar: gyms, profiles, gym_members (+ gym_join_attempts, kaba
-- kuvvet sınırı için). Üç tabloda da RLS açık; varsayılan: hiçbir şey
-- görünmez. Politikalar gym_members'ı doğrudan sorgulamaz (sonsuz
-- özyineleme); bunun yerine security definer yardımcı fonksiyonlar.
--
-- test/rls.test.ts bu dosyayı PGlite'ta çalıştırıp politikaları
-- farklı kullanıcılar gibi deniyor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tablolar
-- ---------------------------------------------------------------------

create table public.gyms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  join_code text unique not null check (join_code ~ '^[A-Z0-9]{6,8}$'),
  primary_color text,
  logo_url text,
  created_at timestamptz default now()
);

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  created_at timestamptz default now()
);

create table public.gym_members (
  gym_id uuid references public.gyms on delete cascade,
  user_id uuid references auth.users on delete cascade,
  role text not null default 'member' check (role in ('member', 'trainer', 'admin')),
  membership_ends_on date,
  joined_at timestamptz default now(),
  primary key (gym_id, user_id)
);

create index gym_members_user_id_idx on public.gym_members (user_id);

-- Başarısız katılma / önizleme denemeleri (saatte en fazla 10)
create table public.gym_join_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  attempted_at timestamptz not null default now()
);

create index gym_join_attempts_user_time_idx
  on public.gym_join_attempts (user_id, attempted_at);

-- ---------------------------------------------------------------------
-- 2. Yeni kullanıcı → profiles satırı
-- ---------------------------------------------------------------------

create function public.handle_new_user()
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 3. Yardımcı fonksiyonlar (security definer, search_path sabit)
--    Politikalar bunları çağırıyor; RLS'ye takılmadan gym_members'a
--    bakabiliyorlar.
-- ---------------------------------------------------------------------

-- Çağıran bu salonun üyesi mi (her rol)
create function public.is_gym_member(p_gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.gym_members m
    where m.gym_id = p_gym_id and m.user_id = auth.uid()
  );
$$;

-- Çağıran bu salonda hoca ya da yönetici mi
create function public.is_gym_staff(p_gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.gym_members m
    where m.gym_id = p_gym_id
      and m.user_id = auth.uid()
      and m.role in ('trainer', 'admin')
  );
$$;

-- Çağıran bu salonda yönetici mi
create function public.is_gym_admin(p_gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.gym_members m
    where m.gym_id = p_gym_id
      and m.user_id = auth.uid()
      and m.role = 'admin'
  );
$$;

-- Çağıran, bu kullanıcının üye olduğu bir salonda hoca/yönetici mi
create function public.is_staff_of_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.gym_members staff
    join public.gym_members member on member.gym_id = staff.gym_id
    where staff.user_id = auth.uid()
      and staff.role in ('trainer', 'admin')
      and member.user_id = p_user_id
  );
$$;

-- Salondaki yönetici sayısı (son yönetici ayrılamasın)
create function public.gym_admin_count(p_gym_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.gym_members m
  where m.gym_id = p_gym_id and m.role = 'admin';
$$;

-- ---------------------------------------------------------------------
-- 4. Satır düzeyinde güvenlik
-- ---------------------------------------------------------------------

alter table public.gyms enable row level security;
alter table public.profiles enable row level security;
alter table public.gym_members enable row level security;
alter table public.gym_join_attempts enable row level security;

-- Supabase varsayılan olarak anon/authenticated'a tüm yetkileri verir.
-- Önce hepsini al, sonra yalnızca gerekenleri ver. Sütun düzeyindeki
-- update yetkisi, politikanın izin verdiği satırda bile başka sütunun
-- değişmesini engelliyor (ör. yönetici gym_id / user_id değiştiremez).
revoke all on table public.gyms, public.profiles, public.gym_members, public.gym_join_attempts
  from anon, authenticated;

grant select on table public.gyms to authenticated;
grant select on table public.profiles to authenticated;
grant update (display_name) on table public.profiles to authenticated;
grant select, delete on table public.gym_members to authenticated;
grant update (role, membership_ends_on) on table public.gym_members to authenticated;
-- gym_join_attempts: istemciye hiçbir yetki yok, yalnızca fonksiyonlar yazar

-- profiles ------------------------------------------------------------

create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_staff_of_user(id));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- gyms ----------------------------------------------------------------
-- Yalnızca okuma; oluşturma / güncelleme / silme politikası yok.

create policy gyms_select_member on public.gyms
  for select to authenticated
  using (public.is_gym_member(id));

-- gym_members ---------------------------------------------------------
-- Insert politikası yok: katılma yalnızca join_gym() ile.

create policy gym_members_select on public.gym_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_gym_staff(gym_id));

-- Yalnızca yönetici; kendi satırında rol 'admin' kalmak zorunda
create policy gym_members_update_admin on public.gym_members
  for update to authenticated
  using (public.is_gym_admin(gym_id))
  with check (
    public.is_gym_admin(gym_id)
    and (user_id <> auth.uid() or role = 'admin')
  );

-- Kişi kendi satırını siler (ayrılma) — salonun son yöneticisi hariç.
-- Yönetici başkasını çıkarabilir.
create policy gym_members_delete on public.gym_members
  for delete to authenticated
  using (
    (user_id = auth.uid() and (role <> 'admin' or public.gym_admin_count(gym_id) > 1))
    or (user_id <> auth.uid() and public.is_gym_admin(gym_id))
  );

-- ---------------------------------------------------------------------
-- 5. RPC: salona katılma ve önizleme
--
-- Geçersiz kodda hata FIRLATILMIYOR, boş sonuç dönüyor: hata, aynı
-- işlemdeki deneme kaydını geri alırdı ve kaba kuvvet sınırı hiç
-- dolmazdı. İstemci boş sonucu "invalid_code" olarak gösteriyor.
-- Sınır dolunca: hata 'too_many_attempts'.
-- ---------------------------------------------------------------------

create function public.normalize_join_code(code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

-- Sınır kontrolü; dolmuşsa hata fırlatır
create function public.check_join_rate_limit(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    select count(*) from public.gym_join_attempts a
    where a.user_id = p_user_id
      and a.attempted_at > now() - interval '1 hour'
  ) >= 10 then
    raise exception 'too_many_attempts' using errcode = 'P0001';
  end if;
end;
$$;

create function public.preview_gym(code text)
returns table (gym_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  perform public.check_join_rate_limit(v_uid);

  select g.name into v_name
  from public.gyms g
  where g.join_code = public.normalize_join_code(code);

  if v_name is null then
    insert into public.gym_join_attempts (user_id) values (v_uid);
    return;
  end if;

  gym_name := v_name;
  return next;
end;
$$;

create function public.join_gym(code text)
returns table (gym_id uuid, gym_name text, role text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_gym public.gyms%rowtype;
  v_role text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  perform public.check_join_rate_limit(v_uid);

  select * into v_gym
  from public.gyms g
  where g.join_code = public.normalize_join_code(code);

  if not found then
    insert into public.gym_join_attempts (user_id) values (v_uid);
    return;
  end if;

  insert into public.gym_members (gym_id, user_id, role)
  values (v_gym.id, v_uid, 'member')
  on conflict on constraint gym_members_pkey do nothing;

  select m.role into v_role
  from public.gym_members m
  where m.gym_id = v_gym.id and m.user_id = v_uid;

  gym_id := v_gym.id;
  gym_name := v_gym.name;
  role := v_role;
  return next;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Fonksiyon yetkileri
--    Varsayılan: herkes (public) çalıştırabilir. Yalnızca giriş yapmış
--    kullanıcıya aç. Politikaların çağırdığı yardımcılar da
--    authenticated'a açık olmalı.
-- ---------------------------------------------------------------------

revoke execute on function
  public.handle_new_user(),
  public.is_gym_member(uuid),
  public.is_gym_staff(uuid),
  public.is_gym_admin(uuid),
  public.is_staff_of_user(uuid),
  public.gym_admin_count(uuid),
  public.normalize_join_code(text),
  public.check_join_rate_limit(uuid),
  public.preview_gym(text),
  public.join_gym(text)
  from public, anon;

grant execute on function
  public.is_gym_member(uuid),
  public.is_gym_staff(uuid),
  public.is_gym_admin(uuid),
  public.is_staff_of_user(uuid),
  public.gym_admin_count(uuid),
  public.normalize_join_code(text),
  public.preview_gym(text),
  public.join_gym(text)
  to authenticated;
