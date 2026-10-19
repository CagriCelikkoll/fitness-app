-- =====================================================================
-- Dinç — v3.6b: hoca ve salon programları
--
-- Supabase SQL Editor'de 0001–0010'dan SONRA, baştan sona tek seferde
-- çalıştırılır.
--
-- - gym_programs: salonda hazırlanan program. visibility:
--   gym (salonun bütün üyeleri okur; üye verisi yok, rıza gerekmez) ya da
--   students (yalnızca atanmış AKTİF öğrenciler okur). Gün ve egzersizler
--   payload jsonb'de; şeması sunucuda denetleniyor
--   (program_payload_valid). version her içerik değişikliğinde +1.
-- - program_assignments: programın bir öğrenciye atanması. Kaldırılınca
--   removed_at dolar (silinmez). Bağ (trainer_students, v3.6a) bitince
--   atama öğrenciye görünmez olur, satır kalır.
-- - Yazma yalnızca RPC'lerle (istemcinin yazma yetkisi yok):
--   save_program (hoca / yönetici; hoca yalnızca kendi programını,
--   yönetici salondaki bütün programları düzenler), set_program_archived,
--   assign_program (yazar ya da yönetici; yalnızca programın yazarının
--   aktif öğrencilerine), unassign_program.
-- - Okuma: yönetici ve yazar her şeyi; üye arşivlenmemiş salon
--   programlarını; öğrenci kendisine atanmış (bağı aktif) programları.
--   Başka salon hiçbir şey görmez. program_list: adlarla liste (öğrenci
--   hocanın profilini okuyamıyor).
-- - Hesap silinince: yazarın programları kalır (author_id null), öğrencinin
--   atamaları cascade ile silinir.
--
-- Bildirim (notify Edge Function): program_assignments INSERT → öğrenciye
-- "program atandı"; gym_programs UPDATE (version arttı) → atanmış aktif
-- öğrencilere "programını güncelledi". Yeni salon programı bildirilmez.
--
-- test/integration/programs.int.ts gerçek test projesinde deniyor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Payload şeması (src/lib/programs.ts PROGRAM_LIMITS ile aynı sınırlar)
--
-- { "schema": 1, "days": [ { "name": "A", "exercises": [ { "exercise_id":
--   "Barbell_Squat", "sets": 3, "reps_min": 8, "reps_max": 10,
--   "rest_sec": 90, "notes": null } ] } ] }
-- ---------------------------------------------------------------------

create function public.program_int_ok(p_value jsonb, p_min integer, p_max integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  -- case: dönüşüm yalnızca sayıysa denensin (and'in sırası garanti değil)
  select case
    when coalesce(jsonb_typeof(p_value), '') <> 'number' then false
    else (p_value #>> '{}')::numeric = trunc((p_value #>> '{}')::numeric)
      and (p_value #>> '{}')::numeric between p_min and p_max
  end;
$$;

create function public.program_payload_valid(p jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_day jsonb;
  v_ex jsonb;
  v_n integer;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return false; end if;
  if octet_length(p::text) > 60000 then return false; end if;
  if p -> 'schema' is distinct from '1'::jsonb then return false; end if;
  if coalesce(jsonb_typeof(p -> 'days'), '') <> 'array' then return false; end if;
  v_n := jsonb_array_length(p -> 'days');
  if v_n < 1 or v_n > 7 then return false; end if;

  for v_day in select value from jsonb_array_elements(p -> 'days') loop
    if jsonb_typeof(v_day) <> 'object'
       or coalesce(jsonb_typeof(v_day -> 'name'), '') <> 'string'
       or char_length(btrim(v_day ->> 'name')) < 1
       or char_length(v_day ->> 'name') > 40 then
      return false;
    end if;
    if coalesce(jsonb_typeof(v_day -> 'exercises'), '') <> 'array' then return false; end if;
    v_n := jsonb_array_length(v_day -> 'exercises');
    if v_n < 1 or v_n > 20 then return false; end if;

    for v_ex in select value from jsonb_array_elements(v_day -> 'exercises') loop
      if jsonb_typeof(v_ex) <> 'object'
         or coalesce(jsonb_typeof(v_ex -> 'exercise_id'), '') <> 'string'
         or char_length(v_ex ->> 'exercise_id') < 1
         or char_length(v_ex ->> 'exercise_id') > 120
         or not public.program_int_ok(v_ex -> 'sets', 1, 10)
         or not public.program_int_ok(v_ex -> 'reps_min', 1, 100)
         or not public.program_int_ok(v_ex -> 'reps_max', 1, 100)
         or not public.program_int_ok(v_ex -> 'rest_sec', 0, 600) then
        return false;
      end if;
      -- Ayrı adım: sayı oldukları yukarıda kesinleşti
      if (v_ex ->> 'reps_max')::integer < (v_ex ->> 'reps_min')::integer then
        return false;
      end if;
      if v_ex -> 'notes' is not null and jsonb_typeof(v_ex -> 'notes') <> 'null' then
        if jsonb_typeof(v_ex -> 'notes') <> 'string' or char_length(v_ex ->> 'notes') > 200 then
          return false;
        end if;
      end if;
    end loop;
  end loop;
  return true;
end;
$$;

-- ---------------------------------------------------------------------
-- Tablolar
-- ---------------------------------------------------------------------

create table public.gym_programs (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms on delete cascade,
  author_id uuid references auth.users on delete set null,
  name text not null
    constraint gym_programs_name_len check (char_length(btrim(name)) >= 1 and char_length(name) <= 60),
  description text not null default ''
    constraint gym_programs_description_len check (char_length(description) <= 500),
  visibility text not null check (visibility in ('gym', 'students')),
  payload jsonb not null
    constraint gym_programs_payload_valid check (public.program_payload_valid(payload)),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index gym_programs_gym_idx on public.gym_programs (gym_id);
create index gym_programs_author_idx on public.gym_programs (author_id);

create table public.program_assignments (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.gym_programs on delete cascade,
  student_id uuid not null references auth.users on delete cascade,
  assigned_by uuid references auth.users on delete set null,
  assigned_at timestamptz not null default now(),
  removed_at timestamptz
);

-- Aynı programın aynı öğrenciye aynı anda tek açık ataması
create unique index program_assignments_open
  on public.program_assignments (program_id, student_id)
  where removed_at is null;

create index program_assignments_student_idx on public.program_assignments (student_id);

-- ---------------------------------------------------------------------
-- Yetki yardımcıları (security definer: politikalar birbirini
-- çağırmasın, RLS özyinelemesi olmasın)
-- ---------------------------------------------------------------------

-- Öğrenci bu salonda bu hocanın aktif öğrencisi mi (v3.6a bağı)
create function public.is_active_student(p_gym_id uuid, p_trainer_id uuid, p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.trainer_students t
    where t.gym_id = p_gym_id
      and t.trainer_id = p_trainer_id
      and t.student_id = p_student_id
      and t.status = 'active'
  );
$$;

-- Çağıran bu programı yönetebilir mi: salonun yöneticisi ya da (hâlâ
-- hoca olan) yazarı
create function public.can_manage_program(p_gym_id uuid, p_author_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_gym_admin(p_gym_id)
      or (p_author_id = auth.uid() and public.is_gym_staff(p_gym_id));
$$;

-- Çağıran bu programı okuyabilir mi
create function public.can_read_program(
  p_id uuid, p_gym_id uuid, p_author_id uuid, p_visibility text, p_archived_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_manage_program(p_gym_id, p_author_id)
      or (
        p_archived_at is null
        and (
          (p_visibility = 'gym' and public.is_gym_member(p_gym_id))
          or (
            public.is_active_student(p_gym_id, p_author_id, auth.uid())
            and exists (
              select 1 from public.program_assignments a
              where a.program_id = p_id
                and a.student_id = auth.uid()
                and a.removed_at is null
            )
          )
        )
      );
$$;

-- Atama satırını kim görür: yönetici / yazar hepsini, öğrenci kendi açık
-- atamasını (bağı aktifken)
create function public.can_see_assignment(p_program_id uuid, p_student_id uuid, p_removed_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.gym_programs p
    where p.id = p_program_id
      and (
        public.can_manage_program(p.gym_id, p.author_id)
        or (
          p_student_id = auth.uid()
          and p_removed_at is null
          and p.archived_at is null
          and public.is_active_student(p.gym_id, p.author_id, p_student_id)
        )
      )
  );
$$;

revoke execute on function
  public.program_int_ok(jsonb, integer, integer),
  public.program_payload_valid(jsonb),
  public.is_active_student(uuid, uuid, uuid),
  public.can_manage_program(uuid, uuid),
  public.can_read_program(uuid, uuid, uuid, text, timestamptz),
  public.can_see_assignment(uuid, uuid, timestamptz)
  from public, anon;
grant execute on function
  public.program_int_ok(jsonb, integer, integer),
  public.program_payload_valid(jsonb),
  public.is_active_student(uuid, uuid, uuid),
  public.can_manage_program(uuid, uuid),
  public.can_read_program(uuid, uuid, uuid, text, timestamptz),
  public.can_see_assignment(uuid, uuid, timestamptz)
  to authenticated;

-- ---------------------------------------------------------------------
-- RLS: yalnızca okuma; yazma RPC'lerle
-- ---------------------------------------------------------------------

alter table public.gym_programs enable row level security;
alter table public.program_assignments enable row level security;

revoke all on table public.gym_programs from anon, authenticated;
revoke all on table public.program_assignments from anon, authenticated;
grant select on table public.gym_programs to authenticated;
grant select on table public.program_assignments to authenticated;

create policy gym_programs_select on public.gym_programs
  for select to authenticated
  using (public.can_read_program(id, gym_id, author_id, visibility, archived_at));

create policy program_assignments_select on public.program_assignments
  for select to authenticated
  using (public.can_see_assignment(program_id, student_id, removed_at));

-- ---------------------------------------------------------------------
-- RPC'ler
-- ---------------------------------------------------------------------

-- Yeni program (p_id null) ya da düzenleme. Döner: programın kimliği.
-- İçerik değişmediyse sürüm artmaz (boşuna "güncelledi" bildirimi gitmesin).
create function public.save_program(
  p_id uuid,
  p_gym_id uuid,
  p_name text,
  p_description text,
  p_visibility text,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.gym_programs;
  v_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_description text := btrim(coalesce(p_description, ''));
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 60
     or char_length(v_description) > 500
     or p_visibility is null or p_visibility not in ('gym', 'students')
     or not public.program_payload_valid(p_payload) then
    raise exception 'program_invalid' using errcode = 'P0001';
  end if;

  if p_id is null then
    if not public.is_gym_staff(p_gym_id) then
      raise exception 'permission denied for program' using errcode = '42501';
    end if;
    insert into public.gym_programs (gym_id, author_id, name, description, visibility, payload)
    values (p_gym_id, v_uid, v_name, v_description, p_visibility, p_payload)
    returning id into v_id;
    return v_id;
  end if;

  select * into v_row from public.gym_programs p where p.id = p_id for update;
  if not found or not public.can_manage_program(v_row.gym_id, v_row.author_id) then
    raise exception 'permission denied for program' using errcode = '42501';
  end if;
  if v_row.name = v_name
     and v_row.description = v_description
     and v_row.visibility = p_visibility
     and v_row.payload = p_payload then
    return v_row.id;
  end if;
  update public.gym_programs
  set name = v_name,
      description = v_description,
      visibility = p_visibility,
      payload = p_payload,
      version = v_row.version + 1,
      updated_at = now()
  where id = p_id;
  return p_id;
end;
$$;

create function public.set_program_archived(p_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.gym_programs;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  select * into v_row from public.gym_programs p where p.id = p_id for update;
  if not found or not public.can_manage_program(v_row.gym_id, v_row.author_id) then
    raise exception 'permission denied for program' using errcode = '42501';
  end if;
  update public.gym_programs
  set archived_at = case when p_archived then coalesce(archived_at, now()) else null end
  where id = p_id;
end;
$$;

-- Programı öğrencilere ata. Hepsi programın yazarının aktif öğrencisi
-- olmalı; biri değilse hiçbiri atanmaz. Zaten atanmış olan atlanır.
-- Döner: yeni atanan sayısı.
create function public.assign_program(p_program_id uuid, p_student_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.gym_programs;
  v_student uuid;
  v_count integer := 0;
  v_one integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  select * into v_row from public.gym_programs p where p.id = p_program_id for update;
  if not found or not public.can_manage_program(v_row.gym_id, v_row.author_id) then
    raise exception 'permission denied for program' using errcode = '42501';
  end if;
  if v_row.archived_at is not null then
    raise exception 'program_archived' using errcode = 'P0001';
  end if;
  if p_student_ids is null or cardinality(p_student_ids) = 0 or cardinality(p_student_ids) > 500 then
    raise exception 'program_invalid' using errcode = 'P0001';
  end if;

  foreach v_student in array p_student_ids loop
    if v_row.author_id is null or not public.is_active_student(v_row.gym_id, v_row.author_id, v_student) then
      raise exception 'student_not_active' using errcode = 'P0001';
    end if;
    insert into public.program_assignments (program_id, student_id, assigned_by)
    values (p_program_id, v_student, v_uid)
    on conflict (program_id, student_id) where removed_at is null do nothing;
    get diagnostics v_one = row_count;
    v_count := v_count + v_one;
  end loop;
  return v_count;
end;
$$;

create function public.unassign_program(p_program_id uuid, p_student_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.gym_programs;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  select * into v_row from public.gym_programs p where p.id = p_program_id;
  if not found or not public.can_manage_program(v_row.gym_id, v_row.author_id) then
    raise exception 'permission denied for program' using errcode = '42501';
  end if;
  update public.program_assignments
  set removed_at = now()
  where program_id = p_program_id and student_id = p_student_id and removed_at is null;
end;
$$;

-- Görebildiğim programlar, yazarın adıyla. assigned_at: bana açık bir
-- atama varsa (bağ aktif) zamanı, yoksa null ("Hocamın programları").
-- p_gym_id null ise bütün salonlar. Görünürlük tablo politikasıyla aynı.
create function public.program_list(p_gym_id uuid default null)
returns table (
  id uuid,
  gym_id uuid,
  author_id uuid,
  author_name text,
  name text,
  description text,
  visibility text,
  payload jsonb,
  version integer,
  created_at timestamptz,
  updated_at timestamptz,
  archived_at timestamptz,
  assigned_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.gym_id, p.author_id, pr.display_name, p.name, p.description, p.visibility,
         p.payload, p.version, p.created_at, p.updated_at, p.archived_at,
         (
           select max(a.assigned_at) from public.program_assignments a
           where a.program_id = p.id
             and a.student_id = auth.uid()
             and a.removed_at is null
             and p.archived_at is null
             and public.is_active_student(p.gym_id, p.author_id, auth.uid())
         )
  from public.gym_programs p
  left join public.profiles pr on pr.id = p.author_id
  where (p_gym_id is null or p.gym_id = p_gym_id)
    and public.can_read_program(p.id, p.gym_id, p.author_id, p.visibility, p.archived_at)
  order by p.updated_at desc
  limit 500;
$$;

revoke execute on function
  public.save_program(uuid, uuid, text, text, text, jsonb),
  public.set_program_archived(uuid, boolean),
  public.assign_program(uuid, uuid[]),
  public.unassign_program(uuid, uuid),
  public.program_list(uuid)
  from public, anon;
grant execute on function
  public.save_program(uuid, uuid, text, text, text, jsonb),
  public.set_program_archived(uuid, boolean),
  public.assign_program(uuid, uuid[]),
  public.unassign_program(uuid, uuid),
  public.program_list(uuid)
  to authenticated;
