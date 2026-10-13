-- =====================================================================
-- Dinç — v3.2c BÖLÜM 5: derse katılım (basit, cezasız)
--
-- Supabase SQL Editor'de 0005_classes.sql'den SONRA, baştan sona tek
-- seferde çalıştırılır. 0005'e dokunmaz.
--
-- - "Katılıyorum" zorunlu değil; gelen herkes derse girer. Ceza, gelmeme
--   sayacı, yoklama yok.
-- - class_templates.capacity: yumuşak sınır, yalnızca bilgi. Sunucu dolu
--   derse katılımı engellemez.
-- - class_rsvps: (ders, tarih, kişi) tekil. Üye yalnızca kendi
--   katılımını, yalnızca kendi salonunun dersine, ders başlamadan önce
--   ekler / siler. İptal edilmiş ya da programda olmayan derse eklenmez.
-- - Üye kimin geldiğini görmez, yalnızca sayıyı (class_rsvp_counts).
--   Hoca ve yönetici salonundaki katılımları (ve profilleri) görür.
-- - Saatler salonun yerel saati (Europe/Istanbul); "başladı mı" sunucu
--   saatiyle.
--
-- test/integration/classRsvps.int.ts gerçek test projesinde deniyor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Kapasite (isteğe bağlı, yumuşak)
-- ---------------------------------------------------------------------

alter table public.class_templates
  add column capacity smallint check (capacity is null or capacity between 1 and 500);

grant insert (capacity) on table public.class_templates to authenticated;
grant update (capacity) on table public.class_templates to authenticated;

-- ---------------------------------------------------------------------
-- Katılım
-- ---------------------------------------------------------------------

create table public.class_rsvps (
  template_id uuid not null references public.class_templates on delete cascade,
  date date not null,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  -- Şablondan kopyalanır (trigger); RLS ve sayım için
  gym_id uuid not null references public.gyms on delete cascade,
  created_at timestamptz not null default now(),
  primary key (template_id, date, user_id)
);

create index class_rsvps_gym_idx on public.class_rsvps (gym_id, date);
create index class_rsvps_user_idx on public.class_rsvps (user_id, date);

-- Dersin o tarihteki başlangıcı (değiştiyse yeni saat), salon saatiyle
create function public.class_starts_at(p_template_id uuid, p_date date)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select ((p_date + coalesce(e.start_time, t.start_time)) at time zone 'Europe/Istanbul')
  from public.class_templates t
  left join public.class_exceptions e
    on e.template_id = t.id and e.date = p_date and e.kind = 'changed'
  where t.id = p_template_id;
$$;

create function public.class_rsvps_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t_gym uuid;
  t_weekday smallint;
  t_active boolean;
begin
  select t.gym_id, t.weekday, t.active into t_gym, t_weekday, t_active
  from public.class_templates t
  where t.id = new.template_id;

  new.created_at := now();

  -- Service role (auth.uid() null) tohumlarken denetim yok
  if auth.uid() is null then
    if t_gym is null then
      raise exception 'class_template_not_found' using errcode = 'P0001';
    end if;
    new.gym_id := t_gym;
    return new;
  end if;

  -- Başkası adına katılım yok; başka salonun dersi hakkında bilgi yok
  new.user_id := auth.uid();
  if t_gym is null or not public.is_gym_member(t_gym) then
    raise exception 'permission denied for class_rsvps' using errcode = '42501';
  end if;
  new.gym_id := t_gym;

  if extract(isodow from new.date)::smallint <> t_weekday or not t_active then
    raise exception 'class_not_scheduled' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.class_exceptions e
    where e.template_id = new.template_id and e.date = new.date and e.kind = 'cancelled'
  ) then
    raise exception 'class_cancelled' using errcode = 'P0001';
  end if;
  if public.class_starts_at(new.template_id, new.date) <= now() then
    raise exception 'class_started' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger class_rsvps_before_insert
  before insert on public.class_rsvps
  for each row execute function public.class_rsvps_before_insert();

-- Ders başka güne taşınınca eski tarihlerin katılımları anlamsız
create function public.class_templates_rsvps_after_weekday_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.class_rsvps where template_id = new.id;
  return null;
end;
$$;

create trigger class_templates_rsvps_after_weekday_change
  after update of weekday on public.class_templates
  for each row
  when (old.weekday is distinct from new.weekday)
  execute function public.class_templates_rsvps_after_weekday_change();

-- Salondan ayrılan (ya da çıkarılan) üyenin katılımları gider
create function public.gym_members_rsvps_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.class_rsvps where gym_id = old.gym_id and user_id = old.user_id;
  return null;
end;
$$;

create trigger gym_members_rsvps_after_delete
  after delete on public.gym_members
  for each row execute function public.gym_members_rsvps_after_delete();

-- ---------------------------------------------------------------------
-- Kişi sayısı (üye adları görmez)
-- ---------------------------------------------------------------------

create function public.class_rsvp_counts(p_from date, p_to date)
returns table (template_id uuid, date date, count integer)
language sql
stable
security definer
set search_path = ''
as $$
  select r.template_id, r.date, count(*)::integer
  from public.class_rsvps r
  where r.date between p_from and p_to
    and (p_to - p_from) <= 120
    and public.is_gym_member(r.gym_id)
  group by r.template_id, r.date;
$$;

-- ---------------------------------------------------------------------
-- Satır düzeyinde güvenlik
-- ---------------------------------------------------------------------

alter table public.class_rsvps enable row level security;

revoke all on table public.class_rsvps from anon, authenticated;
grant select, delete on table public.class_rsvps to authenticated;
grant insert (template_id, date) on table public.class_rsvps to authenticated;

-- Kendi katılımı; hoca / yönetici salonundakileri
create policy class_rsvps_select on public.class_rsvps
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_gym_staff(gym_id));

create policy class_rsvps_insert_own on public.class_rsvps
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_gym_member(gym_id));

-- Yalnızca kendi katılımı, ders başlamadan önce
create policy class_rsvps_delete_own on public.class_rsvps
  for delete to authenticated
  using (user_id = (select auth.uid()) and public.class_starts_at(template_id, date) > now());

revoke execute on function
  public.class_rsvps_before_insert(),
  public.class_templates_rsvps_after_weekday_change(),
  public.gym_members_rsvps_after_delete()
  from public, anon, authenticated;
revoke execute on function
  public.class_starts_at(uuid, date),
  public.class_rsvp_counts(date, date)
  from public, anon;
grant execute on function
  public.class_starts_at(uuid, date),
  public.class_rsvp_counts(date, date)
  to authenticated;
