-- =====================================================================
-- Dinç — v3.6c: salon girişi (QR), ziyaretler ve doluluk
--
-- Supabase SQL Editor'de 0001–0011'den SONRA, baştan sona tek seferde
-- çalıştırılır.
--
-- - gym_checkin_keys: salonun QR afişindeki gizli anahtar (salon başına
--   bir tane). İstemci tabloyu okuyamaz; yönetici checkin_key /
--   rotate_checkin_key ile alır / yeniler. Yenileyince eski afiş geçersiz.
-- - gym_visits: bir üyenin salona bir gelişi. Giriş saati sunucu saati.
--   source: qr (üye okuttu), manual (yönetici elle ekledi), turnstile /
--   import (ileride turnike kayıtları; (gym_id, external_id) tekil).
-- - Yazma yalnızca RPC'lerle: check_in, check_out, link_workout_to_visit,
--   manual_visit. Doluluk gym_occupancy (yalnızca sayı).
-- - Kurallar (okumada hesaplanır, zamanlanmış iş yok):
--   * "Salonda": çıkış yapmamış ve son 3 saatte girmiş.
--   * 3 saat içinde ikinci okutma yeni ziyaret açmaz, açık olanı döner.
--   * Çıkışsız ziyaret 4 saatten eskiyse kapalı sayılır, süresi
--     bilinmiyor: gün sayısına girer, ortalamaya girmez.
-- - Okuma: üye kendi ziyaretlerini; hoca yalnızca AKTİF öğrencilerinin
--   (v3.6a bağı, rıza); yönetici salondaki hepsini. Başka salon hiçbir
--   şey görmez. Hesap silinince ziyaretler cascade ile silinir.
--
-- Webhook yok. test/integration/visits.int.ts gerçek test projesinde
-- deniyor.
-- =====================================================================

create table public.gym_checkin_keys (
  gym_id uuid primary key references public.gyms on delete cascade,
  secret text not null,
  rotated_at timestamptz not null default now()
);

alter table public.gym_checkin_keys enable row level security;
revoke all on table public.gym_checkin_keys from anon, authenticated;

create table public.gym_visits (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  checked_in_at timestamptz not null default now(),
  checked_out_at timestamptz,
  source text not null default 'qr' check (source in ('qr', 'manual', 'turnstile', 'import')),
  external_id text,
  workout_client_id text,
  created_by uuid references auth.users on delete set null,
  constraint gym_visits_out_after_in check (checked_out_at is null or checked_out_at >= checked_in_at),
  constraint gym_visits_external_unique unique (gym_id, external_id)
);

create index gym_visits_gym_time_idx on public.gym_visits (gym_id, checked_in_at desc);
create index gym_visits_user_time_idx on public.gym_visits (user_id, checked_in_at desc);

alter table public.gym_visits enable row level security;
revoke all on table public.gym_visits from anon, authenticated;
grant select on table public.gym_visits to authenticated;

-- is_active_student(gym, hoca, öğrenci): 0011_programs.sql
create policy gym_visits_select on public.gym_visits
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_gym_admin(gym_id)
    or public.is_active_student(gym_id, (select auth.uid()), user_id)
  );

-- ---------------------------------------------------------------------
-- Gizli anahtar: 122 bit rastgele (gen_random_uuid), base64url, 22 karakter
-- ---------------------------------------------------------------------

create function public.new_checkin_secret()
returns text
language sql
volatile
set search_path = ''
as $$
  select rtrim(
    translate(encode(decode(replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), '+/', '-_'),
    '='
  );
$$;

-- Yönetici: salonun anahtarı (yoksa oluşturulur)
create function public.checkin_key(p_gym_id uuid)
returns table (secret text, rotated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_gym_admin(p_gym_id) then
    raise exception 'permission denied for checkin key' using errcode = '42501';
  end if;
  insert into public.gym_checkin_keys (gym_id, secret)
  values (p_gym_id, public.new_checkin_secret())
  on conflict (gym_id) do nothing;
  return query
    select k.secret, k.rotated_at from public.gym_checkin_keys k where k.gym_id = p_gym_id;
end;
$$;

-- Yönetici: yeni anahtar; eski afiş artık çalışmaz
create function public.rotate_checkin_key(p_gym_id uuid)
returns table (secret text, rotated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_gym_admin(p_gym_id) then
    raise exception 'permission denied for checkin key' using errcode = '42501';
  end if;
  insert into public.gym_checkin_keys (gym_id, secret, rotated_at)
  values (p_gym_id, public.new_checkin_secret(), now())
  on conflict (gym_id) do update
    set secret = excluded.secret, rotated_at = excluded.rotated_at;
  return query
    select k.secret, k.rotated_at from public.gym_checkin_keys k where k.gym_id = p_gym_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Giriş / çıkış
-- ---------------------------------------------------------------------

-- QR ile giriş. Son 3 saatte açık ziyaret varsa yenisi açılmaz, o döner.
create function public.check_in(p_gym_id uuid, p_secret text)
returns table (id uuid, checked_in_at timestamptz, reused boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_at timestamptz;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.gym_checkin_keys k
    where k.gym_id = p_gym_id and k.secret = p_secret
  ) then
    raise exception 'checkin_key_invalid' using errcode = 'P0001';
  end if;
  if not public.is_gym_member(p_gym_id) then
    raise exception 'checkin_not_member' using errcode = 'P0001';
  end if;

  -- Aynı kişinin aynı anda iki okutması tek ziyaret olsun
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || p_gym_id::text, 0));

  select v.id, v.checked_in_at into v_id, v_at
  from public.gym_visits v
  where v.gym_id = p_gym_id
    and v.user_id = v_uid
    and v.checked_out_at is null
    and v.checked_in_at > now() - interval '3 hours'
  order by v.checked_in_at desc
  limit 1;
  if found then
    return query select v_id, v_at, true;
    return;
  end if;

  insert into public.gym_visits (gym_id, user_id, source, created_by)
  values (p_gym_id, v_uid, 'qr', v_uid)
  returning gym_visits.id, gym_visits.checked_in_at into v_id, v_at;
  return query select v_id, v_at, false;
end;
$$;

-- Çıkış (yalnızca sahibi). Açık ve 4 saatten yeni değilse dokunmaz
-- (süre bilinmiyor kalır). Döner: çıkış yazıldı mı.
create function public.check_out(p_visit_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.gym_visits;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  select * into v_row from public.gym_visits v where v.id = p_visit_id for update;
  if not found or v_row.user_id <> auth.uid() then
    raise exception 'permission denied for visit' using errcode = '42501';
  end if;
  if v_row.checked_out_at is not null or v_row.checked_in_at <= now() - interval '4 hours' then
    return false;
  end if;
  update public.gym_visits set checked_out_at = now() where id = p_visit_id;
  return true;
end;
$$;

-- Antrenman bitince (yalnızca sahibi): ziyaret açıksa ve antrenman
-- ziyaretin içinde (giriş ile giriş + 4 saat arası, gelecekte değil)
-- bittiyse bitiş saati çıkış olur. Döner: çıkış yazıldı mı.
create function public.link_workout_to_visit(p_visit_id uuid, p_workout_client_id text, p_ended_at timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.gym_visits;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  select * into v_row from public.gym_visits v where v.id = p_visit_id for update;
  if not found or v_row.user_id <> auth.uid() then
    raise exception 'permission denied for visit' using errcode = '42501';
  end if;
  if v_row.checked_out_at is not null
     or p_ended_at is null
     or p_ended_at < v_row.checked_in_at
     or p_ended_at > v_row.checked_in_at + interval '4 hours'
     or p_ended_at > now() + interval '5 minutes'
     or char_length(coalesce(p_workout_client_id, '')) not between 1 and 64 then
    return false;
  end if;
  update public.gym_visits
  set checked_out_at = least(p_ended_at, now()), workout_client_id = p_workout_client_id
  where id = p_visit_id;
  return true;
end;
$$;

-- Yönetici: QR okutmayı unutan üye için elle giriş
create function public.manual_visit(
  p_gym_id uuid,
  p_user_id uuid,
  p_checked_in_at timestamptz,
  p_checked_out_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_gym_admin(p_gym_id) then
    raise exception 'permission denied for visit' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.gym_members m where m.gym_id = p_gym_id and m.user_id = p_user_id
  ) then
    raise exception 'student_not_member' using errcode = 'P0001';
  end if;
  if p_checked_in_at is null
     or p_checked_in_at > now() + interval '5 minutes'
     or p_checked_in_at < now() - interval '60 days'
     or (p_checked_out_at is not null
         and (p_checked_out_at < p_checked_in_at or p_checked_out_at > p_checked_in_at + interval '12 hours')) then
    raise exception 'visit_invalid' using errcode = 'P0001';
  end if;
  insert into public.gym_visits (gym_id, user_id, checked_in_at, checked_out_at, source, created_by)
  values (p_gym_id, p_user_id, p_checked_in_at, p_checked_out_at, 'manual', auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Şu an salonda kaç kişi (son 3 saatte girmiş, çıkmamış). Kim olduğu
-- dönmez. Salonun her üyesi çağırabilir.
create function public.gym_occupancy(p_gym_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_gym_member(p_gym_id) then
    raise exception 'permission denied for occupancy' using errcode = '42501';
  end if;
  return (
    select count(distinct v.user_id)::integer
    from public.gym_visits v
    where v.gym_id = p_gym_id
      and v.checked_out_at is null
      and v.checked_in_at > now() - interval '3 hours'
  );
end;
$$;

revoke execute on function
  public.new_checkin_secret(),
  public.checkin_key(uuid),
  public.rotate_checkin_key(uuid),
  public.check_in(uuid, text),
  public.check_out(uuid),
  public.link_workout_to_visit(uuid, text, timestamptz),
  public.manual_visit(uuid, uuid, timestamptz, timestamptz),
  public.gym_occupancy(uuid)
  from public, anon;
revoke execute on function public.new_checkin_secret() from authenticated;
grant execute on function
  public.checkin_key(uuid),
  public.rotate_checkin_key(uuid),
  public.check_in(uuid, text),
  public.check_out(uuid),
  public.link_workout_to_visit(uuid, text, timestamptz),
  public.manual_visit(uuid, uuid, timestamptz, timestamptz),
  public.gym_occupancy(uuid)
  to authenticated;
