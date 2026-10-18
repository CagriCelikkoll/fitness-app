-- =====================================================================
-- Dinç — v3.6a: hoca–öğrenci bağı ve açık rıza
--
-- Supabase SQL Editor'de 0001–0009'dan SONRA, baştan sona tek seferde
-- çalıştırılır.
--
-- - trainer_students: bir salonda hoca (trainer / admin) ile üye
--   arasındaki bağ. Durum: pending (istek) → active (öğrenci izin verdi)
--   ya da declined (reddetti); pending / active → ended (hoca ya da
--   öğrenci bitirdi, üye salondan ayrıldı / çıkarıldı, hoca rolü kalktı).
-- - Aynı hoca–öğrenci çifti için aynı anda tek bir pending / active kayıt.
-- - Bağ yalnızca RPC'lerle değişir (istemcinin yazma yetkisi yok):
--   request_student (hoca / yönetici), respond_trainer_request (yalnızca
--   öğrenci; kabulde rıza metni sürümü ve zamanı yazılır),
--   end_trainer_link (hoca ya da öğrenci). Yönetici bağ kuramaz: rıza
--   üyede.
-- - Okuma: hoca kendi bağlarını, öğrenci kendi bağlarını, yönetici
--   salonundaki bağları görür. Başka salon hiçbir şey görmez.
--   trainer_links: adlarla liste (öğrenci hocanın adını profiles'tan
--   okuyamıyor; fonksiyon yalnızca görebildiği bağların adlarını verir).
-- - Hesap silinince bağlar auth.users cascade ile silinir.
--
-- Bildirim (notify Edge Function): yeni istek → öğrenciye, kabul →
-- hocaya. Webhook: trainer_students Insert + Update.
--
-- test/integration/trainers.int.ts gerçek test projesinde deniyor.
-- =====================================================================

create table public.trainer_students (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms on delete cascade,
  trainer_id uuid not null references auth.users on delete cascade,
  student_id uuid not null references auth.users on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'ended', 'declined')),
  requested_at timestamptz not null default now(),
  responded_at timestamptz,
  ended_at timestamptz,
  ended_by uuid references auth.users on delete set null,
  consent_version text,
  consented_at timestamptz,
  constraint trainer_students_not_self check (trainer_id <> student_id),
  -- Etkin bağ yalnızca rızayla
  constraint trainer_students_active_consent check (
    status <> 'active' or (consent_version is not null and consented_at is not null)
  )
);

create unique index trainer_students_open_pair
  on public.trainer_students (trainer_id, student_id)
  where status in ('pending', 'active');

create index trainer_students_student_idx on public.trainer_students (student_id);
create index trainer_students_gym_idx on public.trainer_students (gym_id);

alter table public.trainer_students enable row level security;

revoke all on table public.trainer_students from anon, authenticated;
grant select on table public.trainer_students to authenticated;

create policy trainer_students_select on public.trainer_students
  for select to authenticated
  using (
    trainer_id = (select auth.uid())
    or student_id = (select auth.uid())
    or public.is_gym_admin(gym_id)
  );

-- ---------------------------------------------------------------------
-- Rıza metninin sürümü. Metin değişirse burası ve uygulamadaki
-- TRAINER_CONSENT_VERSION (src/lib/trainers.ts) birlikte değişir; eski
-- metinle verilen onay kabul edilmez.
-- ---------------------------------------------------------------------

create function public.trainer_consent_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '2026-10'::text;
$$;

-- ---------------------------------------------------------------------
-- RPC'ler
-- ---------------------------------------------------------------------

create function public.request_student(p_gym_id uuid, p_student_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if not public.is_gym_staff(p_gym_id) then
    raise exception 'permission denied for trainer request' using errcode = '42501';
  end if;
  if p_student_id = v_uid then
    raise exception 'trainer_self' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.gym_members m
    where m.gym_id = p_gym_id and m.user_id = p_student_id
  ) then
    raise exception 'student_not_member' using errcode = 'P0001';
  end if;

  begin
    insert into public.trainer_students (gym_id, trainer_id, student_id)
    values (p_gym_id, v_uid, p_student_id)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'trainer_already_linked' using errcode = 'P0001';
  end;
  return v_id;
end;
$$;

create function public.respond_trainer_request(p_id uuid, p_accept boolean, p_consent_version text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  select t.status into v_status
  from public.trainer_students t
  where t.id = p_id and t.student_id = v_uid
  for update;
  if not found then
    raise exception 'permission denied for trainer request' using errcode = '42501';
  end if;
  if v_status <> 'pending' then
    raise exception 'trainer_link_closed' using errcode = 'P0001';
  end if;

  if p_accept then
    if p_consent_version is distinct from public.trainer_consent_version() then
      raise exception 'consent_outdated' using errcode = 'P0001';
    end if;
    update public.trainer_students
    set status = 'active', responded_at = now(),
        consent_version = p_consent_version, consented_at = now()
    where id = p_id;
  else
    update public.trainer_students
    set status = 'declined', responded_at = now()
    where id = p_id;
  end if;
end;
$$;

create function public.end_trainer_link(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  select t.status into v_status
  from public.trainer_students t
  where t.id = p_id and (t.trainer_id = v_uid or t.student_id = v_uid)
  for update;
  if not found then
    raise exception 'permission denied for trainer link' using errcode = '42501';
  end if;
  if v_status not in ('pending', 'active') then
    raise exception 'trainer_link_closed' using errcode = 'P0001';
  end if;
  update public.trainer_students
  set status = 'ended', ended_at = now(), ended_by = v_uid
  where id = p_id;
end;
$$;

-- Açık (pending / active) bağlar, adlarla. p_gym_id null ise bütün
-- salonlar. Görünürlük tablo politikasıyla aynı.
create function public.trainer_links(p_gym_id uuid default null)
returns table (
  id uuid,
  gym_id uuid,
  gym_name text,
  trainer_id uuid,
  trainer_name text,
  student_id uuid,
  student_name text,
  status text,
  requested_at timestamptz,
  responded_at timestamptz,
  consented_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.gym_id, g.name, t.trainer_id, tp.display_name, t.student_id, sp.display_name,
         t.status, t.requested_at, t.responded_at, t.consented_at
  from public.trainer_students t
  join public.gyms g on g.id = t.gym_id
  left join public.profiles tp on tp.id = t.trainer_id
  left join public.profiles sp on sp.id = t.student_id
  where t.status in ('pending', 'active')
    and (p_gym_id is null or t.gym_id = p_gym_id)
    and (
      t.trainer_id = auth.uid()
      or t.student_id = auth.uid()
      or public.is_gym_admin(t.gym_id)
    )
  order by t.requested_at desc
  limit 2000;
$$;

revoke execute on function
  public.trainer_consent_version(),
  public.request_student(uuid, uuid),
  public.respond_trainer_request(uuid, boolean, text),
  public.end_trainer_link(uuid),
  public.trainer_links(uuid)
  from public, anon;
grant execute on function
  public.trainer_consent_version(),
  public.request_student(uuid, uuid),
  public.respond_trainer_request(uuid, boolean, text),
  public.end_trainer_link(uuid),
  public.trainer_links(uuid)
  to authenticated;

-- ---------------------------------------------------------------------
-- Üyelik değişince bağlar biter
-- ---------------------------------------------------------------------

-- Üye salondan ayrıldı / çıkarıldı (hoca da olabilir öğrenci de)
create function public.end_links_on_member_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.trainer_students t
  set status = 'ended', ended_at = now(), ended_by = auth.uid()
  where t.gym_id = old.gym_id
    and (t.trainer_id = old.user_id or t.student_id = old.user_id)
    and t.status in ('pending', 'active');
  return old;
end;
$$;

create trigger gym_members_end_trainer_links
  after delete on public.gym_members
  for each row execute function public.end_links_on_member_delete();

-- Hoca rolü kalktı (trainer / admin → member): hocalık bağları biter,
-- kendi hocasıyla bağı (öğrenci olarak) sürer
create function public.end_links_on_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role in ('trainer', 'admin') and new.role = 'member' then
    update public.trainer_students t
    set status = 'ended', ended_at = now(), ended_by = auth.uid()
    where t.gym_id = new.gym_id
      and t.trainer_id = new.user_id
      and t.status in ('pending', 'active');
  end if;
  return new;
end;
$$;

create trigger gym_members_role_end_trainer_links
  after update of role on public.gym_members
  for each row execute function public.end_links_on_role_change();

revoke execute on function
  public.end_links_on_member_delete(),
  public.end_links_on_role_change()
  from public, anon, authenticated;
