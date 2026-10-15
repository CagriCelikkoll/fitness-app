-- =====================================================================
-- Dinç — v3.2c grup ders programı (Aşama 1: program, rezervasyon yok)
--
-- Supabase SQL Editor'de 0001–0004'ten SONRA, baştan sona tek seferde
-- çalıştırılır.
--
-- İki katman:
-- - class_templates: her hafta tekrarlayan ders (gün + yerel saat).
-- - class_exceptions: tek bir tarihe ait iptal ya da değişiklik. Aynı
--   şablon + tarih için tek satır (unique). Aşama 2'de "ders oturumu"
--   da (şablon, tarih) ile tanımlanacak; bkz. docs/ders-programi-asama2.md.
--
-- Saat dilimi: start_time ve date salonun yerel saati (Europe/Istanbul).
-- Sunucu dönüştürmüyor; uygulama telefonun dilimine bakmadan gösteriyor.
--
-- Yetki:
-- - Okuma: salonun her üyesi. Başka salonun programı görünmez.
-- - Yazma / düzenleme / silme: yalnızca salon yöneticisi.
-- - İstisnanın salonu şablondan gelir (trigger); istemci veremez.
-- - Zamanlar sunucu saati (trigger).
--
-- test/integration/classes.int.ts gerçek test projesinde deniyor.
-- =====================================================================

create table public.class_templates (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms on delete cascade,
  -- 1 = Pazartesi … 7 = Pazar (ISO)
  weekday smallint not null check (weekday between 1 and 7),
  start_time time not null,
  duration_min smallint not null default 60 check (duration_min between 5 and 480),
  name text not null
    check (char_length(name) between 1 and 40 and btrim(name) <> ''),
  instructor_name text not null
    check (char_length(instructor_name) between 1 and 40 and btrim(instructor_name) <> ''),
  tagline text
    check (tagline is null or (char_length(tagline) between 1 and 60 and btrim(tagline) <> '')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index class_templates_gym_idx
  on public.class_templates (gym_id, weekday, start_time);

create table public.class_exceptions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.class_templates on delete cascade,
  -- Şablondan kopyalanır (trigger); RLS ve sorgular için
  gym_id uuid not null references public.gyms on delete cascade,
  -- Dersin o haftaki tarihi (salonun yerel takvimi)
  date date not null,
  kind text not null check (kind in ('cancelled', 'changed')),
  -- 'changed' için: null olan alan değişmedi demek
  start_time time,
  instructor_name text
    check (instructor_name is null or (char_length(instructor_name) between 1 and 40 and btrim(instructor_name) <> '')),
  note text
    check (note is null or (char_length(note) between 1 and 120 and btrim(note) <> '')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (template_id, date),
  check (kind = 'cancelled' or start_time is not null or instructor_name is not null or note is not null)
);

create index class_exceptions_gym_idx
  on public.class_exceptions (gym_id, date);

-- ---------------------------------------------------------------------
-- Trigger'lar: sunucu saati, istisnanın salonu ve günü
-- ---------------------------------------------------------------------

create function public.class_templates_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger class_templates_before_write
  before insert or update on public.class_templates
  for each row execute function public.class_templates_before_write();

-- Ders başka güne taşınınca eski günün tarihlerine bağlı istisnalar
-- anlamını yitirir: silinir.
create function public.class_templates_after_weekday_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.class_exceptions where template_id = new.id;
  return null;
end;
$$;

create trigger class_templates_after_weekday_change
  after update of weekday on public.class_templates
  for each row
  when (old.weekday is distinct from new.weekday)
  execute function public.class_templates_after_weekday_change();

create function public.class_exceptions_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t_gym uuid;
  t_weekday smallint;
begin
  select t.gym_id, t.weekday into t_gym, t_weekday
  from public.class_templates t
  where t.id = new.template_id;
  -- Yönetici olmayan başka salonun şablonu hakkında bilgi almasın:
  -- gün denetiminden önce yetki (service role'de auth.uid() null)
  if t_gym is null
     or (auth.uid() is not null and not public.is_gym_admin(t_gym)) then
    raise exception 'permission denied for class_exceptions' using errcode = '42501';
  end if;
  if extract(isodow from new.date)::smallint <> t_weekday then
    raise exception 'class_date_weekday_mismatch' using errcode = '23514';
  end if;
  new.gym_id := t_gym;

  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger class_exceptions_before_write
  before insert or update on public.class_exceptions
  for each row execute function public.class_exceptions_before_write();

-- ---------------------------------------------------------------------
-- Satır düzeyinde güvenlik
-- ---------------------------------------------------------------------

alter table public.class_templates enable row level security;
alter table public.class_exceptions enable row level security;

revoke all on table public.class_templates from anon, authenticated;
grant select, delete on table public.class_templates to authenticated;
grant insert (gym_id, weekday, start_time, duration_min, name, instructor_name, tagline, active)
  on table public.class_templates to authenticated;
grant update (weekday, start_time, duration_min, name, instructor_name, tagline, active)
  on table public.class_templates to authenticated;

revoke all on table public.class_exceptions from anon, authenticated;
grant select, delete on table public.class_exceptions to authenticated;
grant insert (template_id, date, kind, start_time, instructor_name, note)
  on table public.class_exceptions to authenticated;
grant update (kind, start_time, instructor_name, note)
  on table public.class_exceptions to authenticated;

create policy class_templates_select_member on public.class_templates
  for select to authenticated
  using (public.is_gym_member(gym_id));

create policy class_templates_insert_admin on public.class_templates
  for insert to authenticated
  with check (public.is_gym_admin(gym_id));

create policy class_templates_update_admin on public.class_templates
  for update to authenticated
  using (public.is_gym_admin(gym_id))
  with check (public.is_gym_admin(gym_id));

create policy class_templates_delete_admin on public.class_templates
  for delete to authenticated
  using (public.is_gym_admin(gym_id));

create policy class_exceptions_select_member on public.class_exceptions
  for select to authenticated
  using (public.is_gym_member(gym_id));

create policy class_exceptions_insert_admin on public.class_exceptions
  for insert to authenticated
  with check (public.is_gym_admin(gym_id));

create policy class_exceptions_update_admin on public.class_exceptions
  for update to authenticated
  using (public.is_gym_admin(gym_id))
  with check (public.is_gym_admin(gym_id));

create policy class_exceptions_delete_admin on public.class_exceptions
  for delete to authenticated
  using (public.is_gym_admin(gym_id));

revoke execute on function
  public.class_templates_before_write(),
  public.class_templates_after_weekday_change(),
  public.class_exceptions_before_write()
  from public, anon, authenticated;
