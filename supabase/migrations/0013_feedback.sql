-- =====================================================================
-- Dinç — v3.6d: salon geri bildirimi (öneri / şikâyet)
--
-- Supabase SQL Editor'de 0001–0012'den SONRA, baştan sona tek seferde
-- çalıştırılır. Storage bucket'ı (gym-feedback, özel) da burada kuruluyor.
--
-- - gym_feedback: üyenin salona yazdığı öneri / istek / şikâyet.
--   Kategori, metin (5–1000), isteğe bağlı fotoğraf, "İsmim gizli kalsın",
--   durum (new → in_progress → resolved), yönetimin yanıtı.
-- - Yazma yalnızca RPC: submit_feedback (üye, günde en fazla 5),
--   answer_feedback (yönetici: durum ve yanıt), delete_feedback (yazar ya
--   da yönetici).
-- - Okuma:
--   * Yazar kendi kayıtlarını tablodan okur (author_id = kendisi).
--   * Yönetici tabloyu HİÇ okuyamaz; salonun kayıtları feedback_list() ile
--     gelir ve anonim kayıtlarda yazar kimliği / adı dönmez.
--   * Hoca ve başka salon hiçbir şey görmez.
-- - Anonimlik sunucuda: anonim kaydın fotoğrafının Storage'daki yükleyen
--   bilgisi (owner / owner_id) gönderimde silinir; dosya adı rastgele,
--   kimlik içermez.
-- - Hesap silinince kayıt kalır, author_id null olur (salonun ekipman /
--   temizlik kaydı; kişiyle bağı kopar). Ad artık dönmez.
-- - Fotoğraf: gym-feedback/<salon>/<rastgele>.jpg, en fazla 1 MB, JPEG.
--   Yalnızca yazar ve o salonun yöneticisi okur. Kayıt silinmeden önce
--   uygulama dosyayı Storage API ile siler (SQL'den silme kapalı).
--
-- Bildirim (notify): gym_feedback INSERT → salonun yöneticilerine
-- ("Yeni geri bildirim: Ekipman.", metin yok); UPDATE yanıt yazıldı ya da
-- "Çözüldü" → yazara. Webhook: gym_feedback Insert + Update.
--
-- test/integration/feedback.int.ts gerçek test projesinde deniyor.
-- =====================================================================

create table public.gym_feedback (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms on delete cascade,
  author_id uuid references auth.users on delete set null,
  category text not null check (category in ('equipment', 'cleanliness', 'classes', 'staff', 'other')),
  body text not null check (char_length(btrim(body)) between 5 and 1000),
  photo_path text,
  anonymous boolean not null default false,
  status text not null default 'new' check (status in ('new', 'in_progress', 'resolved')),
  reply text check (reply is null or char_length(reply) <= 1000),
  replied_at timestamptz,
  replied_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index gym_feedback_gym_idx on public.gym_feedback (gym_id, created_at desc);
create index gym_feedback_author_idx on public.gym_feedback (author_id, created_at desc);

alter table public.gym_feedback enable row level security;
revoke all on table public.gym_feedback from anon, authenticated;
grant select on table public.gym_feedback to authenticated;

-- Yalnızca yazar. Yönetici bile tabloyu okuyamaz (anonim kayıtta
-- author_id görünürdü); onun yolu feedback_list().
create policy gym_feedback_select_author on public.gym_feedback
  for select to authenticated
  using (author_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- Durum geçişleri (src/lib/feedback.ts STATUS_NEXT ile aynı)
-- ---------------------------------------------------------------------

create function public.feedback_status_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_from = p_to
      or (p_from = 'new' and p_to in ('in_progress', 'resolved'))
      or (p_from = 'in_progress' and p_to in ('new', 'resolved'))
      or (p_from = 'resolved' and p_to = 'in_progress');
$$;

-- ---------------------------------------------------------------------
-- Storage: gym-feedback (özel)
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gym-feedback', 'gym-feedback', false, 1048576, array['image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- "<gym_id>/<rastgele>.jpg" ise salon kimliği, değilse null (yetki yok)
create function public.feedback_object_gym(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_-]{8,64}\.jpg$'
    then split_part(p_name, '/', 1)::uuid
  end;
$$;

-- Bu fotoğraf çağıranın bir geri bildirimine mi ait (yazarın okuması)
create function public.feedback_photo_is_mine(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.gym_feedback f
    where f.photo_path = p_name and f.author_id = auth.uid()
  );
$$;

revoke execute on function
  public.feedback_status_allowed(text, text),
  public.feedback_object_gym(text),
  public.feedback_photo_is_mine(text)
  from public, anon;
grant execute on function
  public.feedback_status_allowed(text, text),
  public.feedback_object_gym(text),
  public.feedback_photo_is_mine(text)
  to authenticated;

drop policy if exists gym_feedback_photo_insert on storage.objects;
drop policy if exists gym_feedback_photo_select on storage.objects;
drop policy if exists gym_feedback_photo_delete on storage.objects;

-- Yükleme: o salonun üyesi, kendi salonunun klasörüne
create policy gym_feedback_photo_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'gym-feedback'
    and public.is_gym_member(public.feedback_object_gym(name))
  );

-- Okuma ve silme: salonun yöneticisi, kaydın yazarı ya da (kayda
-- bağlanmadan önce) yükleyen
create policy gym_feedback_photo_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'gym-feedback'
    and (
      public.is_gym_admin(public.feedback_object_gym(name))
      or owner_id = (select auth.uid())::text
      or public.feedback_photo_is_mine(name)
    )
  );

create policy gym_feedback_photo_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'gym-feedback'
    and (
      public.is_gym_admin(public.feedback_object_gym(name))
      or owner_id = (select auth.uid())::text
      or public.feedback_photo_is_mine(name)
    )
  );

-- ---------------------------------------------------------------------
-- RPC'ler
-- ---------------------------------------------------------------------

-- Üye: geri bildirim gönder. Fotoğraf önce Storage'a yüklenir; burada
-- çağıranın yüklediği, bu salonun klasöründeki dosya olduğu doğrulanır.
-- Anonimse dosyanın yükleyen bilgisi silinir.
create function public.submit_feedback(
  p_gym_id uuid,
  p_category text,
  p_body text,
  p_anonymous boolean,
  p_photo_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_today timestamptz := date_trunc('day', now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul';
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if not public.is_gym_member(p_gym_id) then
    raise exception 'permission denied for feedback' using errcode = '42501';
  end if;
  if p_category is null
     or p_category not in ('equipment', 'cleanliness', 'classes', 'staff', 'other')
     or char_length(v_body) < 5 or char_length(v_body) > 1000 then
    raise exception 'feedback_invalid' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('feedback:' || v_uid::text, 0));
  if (
    select count(*) from public.gym_feedback f
    where f.author_id = v_uid and f.created_at >= v_today
  ) >= 5 then
    raise exception 'feedback_daily_limit' using errcode = 'P0001';
  end if;

  if p_photo_path is not null then
    if public.feedback_object_gym(p_photo_path) is distinct from p_gym_id
       or not exists (
         select 1 from storage.objects o
         where o.bucket_id = 'gym-feedback'
           and o.name = p_photo_path
           and o.owner_id = v_uid::text
       )
       or exists (select 1 from public.gym_feedback f where f.photo_path = p_photo_path) then
      raise exception 'feedback_invalid' using errcode = 'P0001';
    end if;
  end if;

  insert into public.gym_feedback (gym_id, author_id, category, body, photo_path, anonymous)
  values (p_gym_id, v_uid, p_category, v_body, p_photo_path, coalesce(p_anonymous, false))
  returning id into v_id;

  if p_photo_path is not null and coalesce(p_anonymous, false) then
    update storage.objects
    set owner = null, owner_id = null
    where bucket_id = 'gym-feedback' and name = p_photo_path;
  end if;
  return v_id;
end;
$$;

-- Yönetici: durum ve / veya yanıt. Boş yanıt yanıtı kaldırır.
create function public.answer_feedback(p_id uuid, p_status text, p_reply text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.gym_feedback;
  v_reply text := nullif(btrim(coalesce(p_reply, '')), '');
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  select * into v_row from public.gym_feedback f where f.id = p_id for update;
  if not found or not public.is_gym_admin(v_row.gym_id) then
    raise exception 'permission denied for feedback' using errcode = '42501';
  end if;
  if p_status is null
     or p_status not in ('new', 'in_progress', 'resolved')
     or not public.feedback_status_allowed(v_row.status, p_status)
     or char_length(coalesce(v_reply, '')) > 1000 then
    raise exception 'feedback_invalid' using errcode = 'P0001';
  end if;
  update public.gym_feedback
  set status = p_status,
      reply = v_reply,
      replied_at = case when v_reply is distinct from v_row.reply then
                     case when v_reply is null then null else now() end
                   else v_row.replied_at end,
      replied_by = case when v_reply is distinct from v_row.reply then
                     case when v_reply is null then null else auth.uid() end
                   else v_row.replied_by end,
      updated_at = now()
  where id = p_id;
end;
$$;

-- Yazar ya da yönetici siler. Döner: fotoğraf yolu (uygulama önce dosyayı
-- siler; SQL'den Storage silinemiyor).
create function public.delete_feedback(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.gym_feedback;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  select * into v_row from public.gym_feedback f where f.id = p_id for update;
  if not found or (v_row.author_id is distinct from auth.uid() and not public.is_gym_admin(v_row.gym_id)) then
    raise exception 'permission denied for feedback' using errcode = '42501';
  end if;
  delete from public.gym_feedback where id = p_id;
  return v_row.photo_path;
end;
$$;

-- Yönetici: salonun geri bildirimleri. Anonim kayıtta yazar kimliği ve
-- adı DÖNMEZ (null); author_known false.
create function public.feedback_list(p_gym_id uuid)
returns table (
  id uuid,
  gym_id uuid,
  category text,
  body text,
  photo_path text,
  anonymous boolean,
  author_id uuid,
  author_name text,
  status text,
  reply text,
  replied_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_gym_admin(p_gym_id) then
    raise exception 'permission denied for feedback' using errcode = '42501';
  end if;
  return query
    select f.id, f.gym_id, f.category, f.body, f.photo_path, f.anonymous,
           case when f.anonymous then null else f.author_id end,
           case when f.anonymous then null else p.display_name end,
           f.status, f.reply, f.replied_at, f.created_at, f.updated_at
    from public.gym_feedback f
    left join public.profiles p on p.id = f.author_id and not f.anonymous
    where f.gym_id = p_gym_id
    order by f.created_at desc
    limit 1000;
end;
$$;

revoke execute on function
  public.submit_feedback(uuid, text, text, boolean, text),
  public.answer_feedback(uuid, text, text),
  public.delete_feedback(uuid),
  public.feedback_list(uuid)
  from public, anon;
grant execute on function
  public.submit_feedback(uuid, text, text, boolean, text),
  public.answer_feedback(uuid, text, text),
  public.delete_feedback(uuid),
  public.feedback_list(uuid)
  to authenticated;
