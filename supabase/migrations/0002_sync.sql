-- =====================================================================
-- Dinç — v3.1b antrenman eşitleme (sunucu)
--
-- Supabase SQL Editor'de 0001_init.sql'den SONRA, baştan sona tek
-- seferde çalıştırılır. Tasarım: docs/sync-tasarim.md (madde 5, 6).
--
-- - 6 tablo, telefondaki SQLite tablolarının kopyası. Anahtar
--   (user_id, id); id telefondaki UUID metni.
-- - Veri sütunları telefondakiyle aynı adda. Zaman damgaları METİN
--   olarak saklanıyor: telefona birebir aynı geri dönsün (timestamptz
--   biçimi değiştirirdi). Ondalıklar double precision (SQLite REAL).
--   Sunucunun kendi sütunları:
--     client_updated_at  çakışma kuralı (son yazan kazanır), istemci
--                        saati; en fazla now() + 5 dk
--     server_updated_at  çekme imleci, YALNIZCA sunucu saati
--     deleted_at         yumuşak silme (mezar taşı)
-- - Tablolar arası FK yok: sunucu bir kopya, bütünlüğü telefon koruyor.
-- - RLS: kişi yalnızca kendi satırlarını OKUR. Doğrudan yazma yetkisi
--   yok; yazma yalnızca sync_push ile, user_id her zaman auth.uid().
--
-- test/syncServer.test.ts bu dosyayı PGlite'ta çalıştırıp deniyor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tablolar
-- ---------------------------------------------------------------------

create table public.routines (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  name text,
  description text,
  color text,
  estimated_duration_min integer,
  is_archived boolean,
  created_at text,
  updated_at text,
  client_updated_at timestamptz not null,
  server_updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  primary key (user_id, id)
);
create index routines_pull_idx on public.routines (user_id, server_updated_at, id);

create table public.routine_exercises (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  routine_id text,
  exercise_id text,
  order_index integer,
  target_sets integer,
  target_reps text,
  target_weight_kg double precision,
  target_rir integer,
  target_duration_seconds integer,
  target_distance_km double precision,
  target_pace_seconds_per_km integer,
  rest_seconds integer,
  notes text,
  superset_group integer,
  client_updated_at timestamptz not null,
  server_updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  primary key (user_id, id)
);
create index routine_exercises_pull_idx on public.routine_exercises (user_id, server_updated_at, id);
create index routine_exercises_routine_id_idx on public.routine_exercises (user_id, routine_id);

create table public.workout_sessions (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  routine_id text,
  name text,
  started_at text,
  ended_at text,
  duration_seconds integer,
  notes text,
  bodyweight_kg double precision,
  perceived_difficulty integer,
  created_at text,
  client_updated_at timestamptz not null,
  server_updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  primary key (user_id, id)
);
create index workout_sessions_pull_idx on public.workout_sessions (user_id, server_updated_at, id);
create index workout_sessions_started_at_idx on public.workout_sessions (user_id, started_at desc);

create table public.session_exercises (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  session_id text,
  exercise_id text,
  order_index integer,
  superset_group integer,
  notes text,
  client_updated_at timestamptz not null,
  server_updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  primary key (user_id, id)
);
create index session_exercises_pull_idx on public.session_exercises (user_id, server_updated_at, id);
create index session_exercises_session_id_idx on public.session_exercises (user_id, session_id);

create table public.sets (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  session_exercise_id text,
  set_number integer,
  set_type text,
  reps integer,
  weight_kg double precision,
  rir integer,
  rpe double precision,
  is_completed boolean,
  rest_taken_seconds integer,
  notes text,
  completed_at text,
  client_updated_at timestamptz not null,
  server_updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  primary key (user_id, id)
);
create index sets_pull_idx on public.sets (user_id, server_updated_at, id);
create index sets_session_exercise_id_idx on public.sets (user_id, session_exercise_id);

create table public.cardio_segments (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  session_id text,
  exercise_id text,
  order_index integer,
  duration_seconds integer,
  distance_km double precision,
  avg_heart_rate integer,
  max_heart_rate integer,
  calories_kcal integer,
  avg_pace_seconds_per_km integer,
  elevation_gain_m double precision,
  cardio_type text,
  perceived_effort integer,
  external_source text,
  external_id text,
  route_polyline text,
  notes text,
  started_at text,
  completed_at text,
  created_at text,
  client_updated_at timestamptz not null,
  server_updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  primary key (user_id, id)
);
create index cardio_segments_pull_idx on public.cardio_segments (user_id, server_updated_at, id);
create index cardio_segments_session_id_idx on public.cardio_segments (user_id, session_id);

-- ---------------------------------------------------------------------
-- 2. Satır düzeyinde güvenlik: yalnızca kendi satırını okuma
-- ---------------------------------------------------------------------

alter table public.routines enable row level security;
alter table public.routine_exercises enable row level security;
alter table public.workout_sessions enable row level security;
alter table public.session_exercises enable row level security;
alter table public.sets enable row level security;
alter table public.cardio_segments enable row level security;

revoke all on table
  public.routines, public.routine_exercises, public.workout_sessions,
  public.session_exercises, public.sets, public.cardio_segments
  from anon, authenticated;

grant select on table
  public.routines, public.routine_exercises, public.workout_sessions,
  public.session_exercises, public.sets, public.cardio_segments
  to authenticated;

create policy routines_select_own on public.routines
  for select to authenticated using (user_id = (select auth.uid()));
create policy routine_exercises_select_own on public.routine_exercises
  for select to authenticated using (user_id = (select auth.uid()));
create policy workout_sessions_select_own on public.workout_sessions
  for select to authenticated using (user_id = (select auth.uid()));
create policy session_exercises_select_own on public.session_exercises
  for select to authenticated using (user_id = (select auth.uid()));
create policy sets_select_own on public.sets
  for select to authenticated using (user_id = (select auth.uid()));
create policy cardio_segments_select_own on public.cardio_segments
  for select to authenticated using (user_id = (select auth.uid()));

-- Faz 2 (YAZILMADI, yalnızca tarif): hoca, salonundaki üyenin
-- antrenmanlarını okuyabilecek. Her tabloya ek bir select politikası:
--
--   create policy <tablo>_select_staff on public.<tablo>
--     for select to authenticated
--     using (public.is_staff_of_user(user_id) and deleted_at is null);
--
-- is_staff_of_user 0001'de var. KVKK açısından üyenin açık onayı
-- gerekirse koşula gym_members'a eklenecek bir paylaşım sütunu da
-- girer. Hocanın yazma yetkisi olmayacak.

-- ---------------------------------------------------------------------
-- 3. RPC: gönderme (sync_push)
--
-- p_changes: [{ "t": tablo, "id": metin, "at": istemci zamanı (ISO),
--               "row": { sütun: değer, ... } | null }]
-- row nesneyse upsert, null/yoksa silme (mezar taşı).
--
-- - user_id her zaman auth.uid(); satırdaki user_id yok sayılır.
-- - Son yazan kazanır: yalnızca at >= mevcut client_updated_at ise
--   yazılır. at en fazla now() + 5 dk (ileri ayarlı saat satırları
--   kilitleyemesin).
-- - İdempotent: aynı parti iki kez gelirse çoğalmaz.
-- - Partide aynı id iki kez varsa en yeni olan alınır.
-- - Bilinmeyen id'nin silinmesi ve bilinmeyen tablo yok sayılır.
-- - Dönüş: yazılan (değişen) satır sayısı.
-- ---------------------------------------------------------------------

create function public.sync_push(p_changes jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_max timestamptz := now() + interval '5 minutes';
  v_count integer := 0;
  v_n integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    raise exception 'invalid_payload' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_changes) > 1000 then
    raise exception 'batch_too_large' using errcode = 'P0001';
  end if;

  -- routines
  with c as (
    select distinct on (e->>'id')
      e->>'id' as id,
      least((e->>'at')::timestamptz, v_max) as at,
      e->'row' as payload
    from jsonb_array_elements(p_changes) e
    where e->>'t' = 'routines' and coalesce(e->>'id', '') <> ''
    order by e->>'id', (e->>'at')::timestamptz desc
  ), up as (
    insert into public.routines as t (
      user_id, id, name, description, color, estimated_duration_min, is_archived, created_at, updated_at,
      client_updated_at, server_updated_at, deleted_at
    )
    select
      v_uid, c.id, r.name, r.description, r.color, r.estimated_duration_min, r.is_archived, r.created_at, r.updated_at,
      c.at, clock_timestamp(), null
    from c
    cross join lateral jsonb_populate_record(null::public.routines, c.payload) r
    where jsonb_typeof(c.payload) = 'object'
    on conflict (user_id, id) do update set
      name = excluded.name,
      description = excluded.description,
      color = excluded.color,
      estimated_duration_min = excluded.estimated_duration_min,
      is_archived = excluded.is_archived,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      client_updated_at = excluded.client_updated_at,
      server_updated_at = excluded.server_updated_at,
      deleted_at = null
    where excluded.client_updated_at >= t.client_updated_at
    returning 1
  ), del as (
    update public.routines t set
      deleted_at = clock_timestamp(),
      client_updated_at = c.at,
      server_updated_at = clock_timestamp()
    from c
    where coalesce(jsonb_typeof(c.payload), 'null') = 'null'
      and t.user_id = v_uid and t.id = c.id
      and t.deleted_at is null
      and c.at >= t.client_updated_at
    returning 1
  )
  select (select count(*) from up) + (select count(*) from del) into v_n;
  v_count := v_count + v_n;

  -- routine_exercises
  with c as (
    select distinct on (e->>'id')
      e->>'id' as id,
      least((e->>'at')::timestamptz, v_max) as at,
      e->'row' as payload
    from jsonb_array_elements(p_changes) e
    where e->>'t' = 'routine_exercises' and coalesce(e->>'id', '') <> ''
    order by e->>'id', (e->>'at')::timestamptz desc
  ), up as (
    insert into public.routine_exercises as t (
      user_id, id, routine_id, exercise_id, order_index, target_sets, target_reps, target_weight_kg, target_rir, target_duration_seconds, target_distance_km, target_pace_seconds_per_km, rest_seconds, notes, superset_group,
      client_updated_at, server_updated_at, deleted_at
    )
    select
      v_uid, c.id, r.routine_id, r.exercise_id, r.order_index, r.target_sets, r.target_reps, r.target_weight_kg, r.target_rir, r.target_duration_seconds, r.target_distance_km, r.target_pace_seconds_per_km, r.rest_seconds, r.notes, r.superset_group,
      c.at, clock_timestamp(), null
    from c
    cross join lateral jsonb_populate_record(null::public.routine_exercises, c.payload) r
    where jsonb_typeof(c.payload) = 'object'
    on conflict (user_id, id) do update set
      routine_id = excluded.routine_id,
      exercise_id = excluded.exercise_id,
      order_index = excluded.order_index,
      target_sets = excluded.target_sets,
      target_reps = excluded.target_reps,
      target_weight_kg = excluded.target_weight_kg,
      target_rir = excluded.target_rir,
      target_duration_seconds = excluded.target_duration_seconds,
      target_distance_km = excluded.target_distance_km,
      target_pace_seconds_per_km = excluded.target_pace_seconds_per_km,
      rest_seconds = excluded.rest_seconds,
      notes = excluded.notes,
      superset_group = excluded.superset_group,
      client_updated_at = excluded.client_updated_at,
      server_updated_at = excluded.server_updated_at,
      deleted_at = null
    where excluded.client_updated_at >= t.client_updated_at
    returning 1
  ), del as (
    update public.routine_exercises t set
      deleted_at = clock_timestamp(),
      client_updated_at = c.at,
      server_updated_at = clock_timestamp()
    from c
    where coalesce(jsonb_typeof(c.payload), 'null') = 'null'
      and t.user_id = v_uid and t.id = c.id
      and t.deleted_at is null
      and c.at >= t.client_updated_at
    returning 1
  )
  select (select count(*) from up) + (select count(*) from del) into v_n;
  v_count := v_count + v_n;

  -- workout_sessions
  with c as (
    select distinct on (e->>'id')
      e->>'id' as id,
      least((e->>'at')::timestamptz, v_max) as at,
      e->'row' as payload
    from jsonb_array_elements(p_changes) e
    where e->>'t' = 'workout_sessions' and coalesce(e->>'id', '') <> ''
    order by e->>'id', (e->>'at')::timestamptz desc
  ), up as (
    insert into public.workout_sessions as t (
      user_id, id, routine_id, name, started_at, ended_at, duration_seconds, notes, bodyweight_kg, perceived_difficulty, created_at,
      client_updated_at, server_updated_at, deleted_at
    )
    select
      v_uid, c.id, r.routine_id, r.name, r.started_at, r.ended_at, r.duration_seconds, r.notes, r.bodyweight_kg, r.perceived_difficulty, r.created_at,
      c.at, clock_timestamp(), null
    from c
    cross join lateral jsonb_populate_record(null::public.workout_sessions, c.payload) r
    where jsonb_typeof(c.payload) = 'object'
    on conflict (user_id, id) do update set
      routine_id = excluded.routine_id,
      name = excluded.name,
      started_at = excluded.started_at,
      ended_at = excluded.ended_at,
      duration_seconds = excluded.duration_seconds,
      notes = excluded.notes,
      bodyweight_kg = excluded.bodyweight_kg,
      perceived_difficulty = excluded.perceived_difficulty,
      created_at = excluded.created_at,
      client_updated_at = excluded.client_updated_at,
      server_updated_at = excluded.server_updated_at,
      deleted_at = null
    where excluded.client_updated_at >= t.client_updated_at
    returning 1
  ), del as (
    update public.workout_sessions t set
      deleted_at = clock_timestamp(),
      client_updated_at = c.at,
      server_updated_at = clock_timestamp()
    from c
    where coalesce(jsonb_typeof(c.payload), 'null') = 'null'
      and t.user_id = v_uid and t.id = c.id
      and t.deleted_at is null
      and c.at >= t.client_updated_at
    returning 1
  )
  select (select count(*) from up) + (select count(*) from del) into v_n;
  v_count := v_count + v_n;

  -- session_exercises
  with c as (
    select distinct on (e->>'id')
      e->>'id' as id,
      least((e->>'at')::timestamptz, v_max) as at,
      e->'row' as payload
    from jsonb_array_elements(p_changes) e
    where e->>'t' = 'session_exercises' and coalesce(e->>'id', '') <> ''
    order by e->>'id', (e->>'at')::timestamptz desc
  ), up as (
    insert into public.session_exercises as t (
      user_id, id, session_id, exercise_id, order_index, superset_group, notes,
      client_updated_at, server_updated_at, deleted_at
    )
    select
      v_uid, c.id, r.session_id, r.exercise_id, r.order_index, r.superset_group, r.notes,
      c.at, clock_timestamp(), null
    from c
    cross join lateral jsonb_populate_record(null::public.session_exercises, c.payload) r
    where jsonb_typeof(c.payload) = 'object'
    on conflict (user_id, id) do update set
      session_id = excluded.session_id,
      exercise_id = excluded.exercise_id,
      order_index = excluded.order_index,
      superset_group = excluded.superset_group,
      notes = excluded.notes,
      client_updated_at = excluded.client_updated_at,
      server_updated_at = excluded.server_updated_at,
      deleted_at = null
    where excluded.client_updated_at >= t.client_updated_at
    returning 1
  ), del as (
    update public.session_exercises t set
      deleted_at = clock_timestamp(),
      client_updated_at = c.at,
      server_updated_at = clock_timestamp()
    from c
    where coalesce(jsonb_typeof(c.payload), 'null') = 'null'
      and t.user_id = v_uid and t.id = c.id
      and t.deleted_at is null
      and c.at >= t.client_updated_at
    returning 1
  )
  select (select count(*) from up) + (select count(*) from del) into v_n;
  v_count := v_count + v_n;

  -- sets
  with c as (
    select distinct on (e->>'id')
      e->>'id' as id,
      least((e->>'at')::timestamptz, v_max) as at,
      e->'row' as payload
    from jsonb_array_elements(p_changes) e
    where e->>'t' = 'sets' and coalesce(e->>'id', '') <> ''
    order by e->>'id', (e->>'at')::timestamptz desc
  ), up as (
    insert into public.sets as t (
      user_id, id, session_exercise_id, set_number, set_type, reps, weight_kg, rir, rpe, is_completed, rest_taken_seconds, notes, completed_at,
      client_updated_at, server_updated_at, deleted_at
    )
    select
      v_uid, c.id, r.session_exercise_id, r.set_number, r.set_type, r.reps, r.weight_kg, r.rir, r.rpe, r.is_completed, r.rest_taken_seconds, r.notes, r.completed_at,
      c.at, clock_timestamp(), null
    from c
    cross join lateral jsonb_populate_record(null::public.sets, c.payload) r
    where jsonb_typeof(c.payload) = 'object'
    on conflict (user_id, id) do update set
      session_exercise_id = excluded.session_exercise_id,
      set_number = excluded.set_number,
      set_type = excluded.set_type,
      reps = excluded.reps,
      weight_kg = excluded.weight_kg,
      rir = excluded.rir,
      rpe = excluded.rpe,
      is_completed = excluded.is_completed,
      rest_taken_seconds = excluded.rest_taken_seconds,
      notes = excluded.notes,
      completed_at = excluded.completed_at,
      client_updated_at = excluded.client_updated_at,
      server_updated_at = excluded.server_updated_at,
      deleted_at = null
    where excluded.client_updated_at >= t.client_updated_at
    returning 1
  ), del as (
    update public.sets t set
      deleted_at = clock_timestamp(),
      client_updated_at = c.at,
      server_updated_at = clock_timestamp()
    from c
    where coalesce(jsonb_typeof(c.payload), 'null') = 'null'
      and t.user_id = v_uid and t.id = c.id
      and t.deleted_at is null
      and c.at >= t.client_updated_at
    returning 1
  )
  select (select count(*) from up) + (select count(*) from del) into v_n;
  v_count := v_count + v_n;

  -- cardio_segments
  with c as (
    select distinct on (e->>'id')
      e->>'id' as id,
      least((e->>'at')::timestamptz, v_max) as at,
      e->'row' as payload
    from jsonb_array_elements(p_changes) e
    where e->>'t' = 'cardio_segments' and coalesce(e->>'id', '') <> ''
    order by e->>'id', (e->>'at')::timestamptz desc
  ), up as (
    insert into public.cardio_segments as t (
      user_id, id, session_id, exercise_id, order_index, duration_seconds, distance_km, avg_heart_rate, max_heart_rate, calories_kcal, avg_pace_seconds_per_km, elevation_gain_m, cardio_type, perceived_effort, external_source, external_id, route_polyline, notes, started_at, completed_at, created_at,
      client_updated_at, server_updated_at, deleted_at
    )
    select
      v_uid, c.id, r.session_id, r.exercise_id, r.order_index, r.duration_seconds, r.distance_km, r.avg_heart_rate, r.max_heart_rate, r.calories_kcal, r.avg_pace_seconds_per_km, r.elevation_gain_m, r.cardio_type, r.perceived_effort, r.external_source, r.external_id, r.route_polyline, r.notes, r.started_at, r.completed_at, r.created_at,
      c.at, clock_timestamp(), null
    from c
    cross join lateral jsonb_populate_record(null::public.cardio_segments, c.payload) r
    where jsonb_typeof(c.payload) = 'object'
    on conflict (user_id, id) do update set
      session_id = excluded.session_id,
      exercise_id = excluded.exercise_id,
      order_index = excluded.order_index,
      duration_seconds = excluded.duration_seconds,
      distance_km = excluded.distance_km,
      avg_heart_rate = excluded.avg_heart_rate,
      max_heart_rate = excluded.max_heart_rate,
      calories_kcal = excluded.calories_kcal,
      avg_pace_seconds_per_km = excluded.avg_pace_seconds_per_km,
      elevation_gain_m = excluded.elevation_gain_m,
      cardio_type = excluded.cardio_type,
      perceived_effort = excluded.perceived_effort,
      external_source = excluded.external_source,
      external_id = excluded.external_id,
      route_polyline = excluded.route_polyline,
      notes = excluded.notes,
      started_at = excluded.started_at,
      completed_at = excluded.completed_at,
      created_at = excluded.created_at,
      client_updated_at = excluded.client_updated_at,
      server_updated_at = excluded.server_updated_at,
      deleted_at = null
    where excluded.client_updated_at >= t.client_updated_at
    returning 1
  ), del as (
    update public.cardio_segments t set
      deleted_at = clock_timestamp(),
      client_updated_at = c.at,
      server_updated_at = clock_timestamp()
    from c
    where coalesce(jsonb_typeof(c.payload), 'null') = 'null'
      and t.user_id = v_uid and t.id = c.id
      and t.deleted_at is null
      and c.at >= t.client_updated_at
    returning 1
  )
  select (select count(*) from up) + (select count(*) from del) into v_n;
  v_count := v_count + v_n;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. RPC: çekme
--
-- sync_server_time: çekmenin üst sınırı ("until"); imleç yalnızca
-- sunucu saatine dayanıyor, telefon saati onu bozamaz.
--
-- sync_pull: bir tablonun (server_updated_at, id) sırasıyla
-- (p_after_at, p_after_id)'den sonraki ve p_until'e kadarki satırları;
-- mezar taşları dahil (deleted = true). Sayfa en fazla 1000.
-- security invoker: RLS (yalnızca kendi satırı) aynen geçerli.
-- ---------------------------------------------------------------------

create function public.sync_server_time()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select clock_timestamp();
$$;

create function public.sync_pull(
  p_table text,
  p_after_at timestamptz,
  p_after_id text,
  p_until timestamptz,
  p_limit integer
)
returns table (id text, server_updated_at timestamptz, deleted boolean, data jsonb)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if p_table not in (
    'routines', 'routine_exercises', 'workout_sessions',
    'session_exercises', 'sets', 'cardio_segments'
  ) then
    raise exception 'invalid_table' using errcode = 'P0001';
  end if;

  return query execute format(
    'select t.id, t.server_updated_at, t.deleted_at is not null,
            to_jsonb(t) - ''user_id'' - ''client_updated_at'' - ''server_updated_at'' - ''deleted_at''
     from public.%I t
     where t.user_id = auth.uid()
       and t.server_updated_at <= $3
       and (t.server_updated_at, t.id) > ($1, $2)
     order by t.server_updated_at, t.id
     limit $4',
    p_table
  )
  using
    coalesce(p_after_at, '-infinity'::timestamptz),
    coalesce(p_after_id, ''),
    p_until,
    least(greatest(coalesce(p_limit, 1000), 1), 1000);
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Fonksiyon yetkileri: yalnızca giriş yapmış kullanıcı
-- ---------------------------------------------------------------------

revoke execute on function
  public.sync_push(jsonb),
  public.sync_server_time(),
  public.sync_pull(text, timestamptz, text, timestamptz, integer)
  from public, anon;

grant execute on function
  public.sync_push(jsonb),
  public.sync_server_time(),
  public.sync_pull(text, timestamptz, text, timestamptz, integer)
  to authenticated;
