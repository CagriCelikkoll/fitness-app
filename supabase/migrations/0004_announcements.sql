-- =====================================================================
-- Dinç — v3.2b salon duyuruları
--
-- Supabase SQL Editor'de 0001–0003'ten SONRA, baştan sona tek seferde
-- çalıştırılır.
--
-- - Okuma: salonun üyesi olan herkes (her rol). Salondan ayrılan artık
--   göremez (üyelik satırı yok).
-- - Yazma: salonun yöneticisi ve hocaları. Yazar her zaman auth.uid()
--   (istemci başkası adına yazamaz).
-- - Düzenleme / silme: yazar kendi duyurusunu (hâlâ hoca/yöneticiyse);
--   yönetici salondaki her duyuruyu.
-- - Sabitleme: yalnızca yönetici (trigger; politika eski/yeni değeri
--   karşılaştıramıyor).
-- - Değiştirilebilen sütunlar yalnızca title, body, pinned (sütun
--   yetkisi): salon, yazar ve tarih istemciden değişmez.
-- - Zamanlar sunucu saati (trigger). Metin düz yazı; biçimlendirme yok.
--
-- test/integration/announcements.int.ts gerçek test projesinde deniyor.
-- =====================================================================

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms on delete cascade,
  author_id uuid default auth.uid() references auth.users on delete set null,
  title text not null
    check (char_length(title) between 1 and 80 and btrim(title) <> ''),
  body text not null
    check (char_length(body) between 1 and 1000 and btrim(body) <> ''),
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index announcements_gym_idx
  on public.announcements (gym_id, pinned desc, created_at desc);

-- ---------------------------------------------------------------------
-- Trigger: sunucu saati, yazar, sabitleme yetkisi
-- ---------------------------------------------------------------------

create function public.announcements_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    -- İstemciden gelen yazar yok sayılır; service role (auth.uid() null)
    -- tohumlarken verilen yazar kalır.
    if auth.uid() is not null then
      new.author_id := auth.uid();
    end if;
  else
    -- gym_id ve author_id'yi istemci zaten değiştiremez (sütun yetkisi).
    -- Burada geri yazılmıyor: yazarın hesabı silinince FK'nin
    -- "on delete set null" güncellemesi engellenirdi.
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();

  if auth.uid() is not null
     and new.pinned
     and (tg_op = 'INSERT' or not old.pinned)
     and not public.is_gym_admin(new.gym_id) then
    raise exception 'only_admin_can_pin' using errcode = 'P0001';
  end if;
  if auth.uid() is not null
     and tg_op = 'UPDATE'
     and old.pinned and not new.pinned
     and not public.is_gym_admin(new.gym_id) then
    raise exception 'only_admin_can_pin' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger announcements_before_write
  before insert or update on public.announcements
  for each row execute function public.announcements_before_write();

-- ---------------------------------------------------------------------
-- Satır düzeyinde güvenlik
-- ---------------------------------------------------------------------

alter table public.announcements enable row level security;

revoke all on table public.announcements from anon, authenticated;
grant select, delete on table public.announcements to authenticated;
grant insert (gym_id, title, body, pinned) on table public.announcements to authenticated;
grant update (title, body, pinned) on table public.announcements to authenticated;

create policy announcements_select_member on public.announcements
  for select to authenticated
  using (public.is_gym_member(gym_id));

create policy announcements_insert_staff on public.announcements
  for insert to authenticated
  with check (public.is_gym_staff(gym_id) and author_id = (select auth.uid()));

create policy announcements_update on public.announcements
  for update to authenticated
  using (
    public.is_gym_admin(gym_id)
    or (author_id = (select auth.uid()) and public.is_gym_staff(gym_id))
  )
  with check (
    public.is_gym_admin(gym_id)
    or (author_id = (select auth.uid()) and public.is_gym_staff(gym_id))
  );

create policy announcements_delete on public.announcements
  for delete to authenticated
  using (
    public.is_gym_admin(gym_id)
    or (author_id = (select auth.uid()) and public.is_gym_staff(gym_id))
  );

revoke execute on function public.announcements_before_write() from public, anon, authenticated;
