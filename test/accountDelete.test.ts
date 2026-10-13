/**
 * Hesabı silme (v3.1c) — `supabase/migrations/0003_delete_account.sql`
 * PGlite'ta 0001 + 0002 ile birlikte (Supabase stub'ı: rls.test.ts).
 *
 * - Kişi yalnızca kendi hesabını siler; başkasınınkine dokunamaz.
 * - Silinen kullanıcının hiçbir tabloda satırı kalmaz.
 * - Salonun tek yöneticisi silemez; ikinci yönetici varsa silebilir.
 * - Giriş yapmamış (anon) çağıramaz.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite, type Transaction } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  grant usage on schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
`;

const U = {
  member: '00000000-0000-0000-0000-00000000000a',
  other: '00000000-0000-0000-0000-00000000000b',
  soleAdmin: '00000000-0000-0000-0000-00000000000c',
  coAdmin1: '00000000-0000-0000-0000-00000000000d',
  coAdmin2: '00000000-0000-0000-0000-00000000000e',
} as const;
const GYM_SOLE = '10000000-0000-0000-0000-00000000000a';
const GYM_CO = '10000000-0000-0000-0000-00000000000b';

let pg: PGlite;

async function as<T>(userId: string | null, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return pg.transaction(async (tx) => {
    if (userId) await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    await tx.exec(`set local role ${userId ? 'authenticated' : 'anon'}`);
    return fn(tx);
  });
}

const deleteAs = (userId: string | null) =>
  as(userId, (tx) => tx.query('select public.delete_my_account()'));

/** Kullanıcıya ait satır sayısı, her tabloda (süper kullanıcı, RLS'siz) */
async function rowsOf(userId: string): Promise<Record<string, number>> {
  const tables = [
    ['auth.users', 'id'],
    ['public.profiles', 'id'],
    ['public.gym_members', 'user_id'],
    ['public.gym_join_attempts', 'user_id'],
    ['public.routines', 'user_id'],
    ['public.routine_exercises', 'user_id'],
    ['public.workout_sessions', 'user_id'],
    ['public.session_exercises', 'user_id'],
    ['public.sets', 'user_id'],
    ['public.cardio_segments', 'user_id'],
  ] as const;
  const out: Record<string, number> = {};
  for (const [t, col] of tables) {
    const r = await pg.query<{ n: number }>(`select count(*)::int as n from ${t} where ${col} = $1`, [userId]);
    out[t] = r.rows[0].n;
  }
  return out;
}

async function pushSomeData(userId: string) {
  const at = new Date().toISOString();
  const changes = [
    { t: 'routines', id: 'r1', at, row: { name: 'R' } },
    { t: 'routine_exercises', id: 're1', at, row: { routine_id: 'r1', exercise_id: 'x', order_index: 0 } },
    { t: 'workout_sessions', id: 's1', at, row: { name: 'S', started_at: at, ended_at: at } },
    { t: 'session_exercises', id: 'se1', at, row: { session_id: 's1', exercise_id: 'x', order_index: 0 } },
    { t: 'sets', id: 'st1', at, row: { session_exercise_id: 'se1', set_number: 1, is_completed: true } },
    { t: 'cardio_segments', id: 'c1', at, row: { session_id: 's1', exercise_id: 'x', duration_seconds: 60 } },
  ];
  await as(userId, (tx) => tx.query('select public.sync_push($1::jsonb)', [JSON.stringify(changes)]));
}

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(SUPABASE_STUB);
  await pg.exec(read('supabase/migrations/0001_init.sql'));
  await pg.exec(read('supabase/migrations/0002_sync.sql'));
  await pg.exec(read('supabase/migrations/0003_delete_account.sql'));
}, 60_000);

afterAll(async () => {
  await pg?.close();
});

beforeEach(async () => {
  await pg.exec(`
    truncate public.routines, public.routine_exercises, public.workout_sessions,
             public.session_exercises, public.sets, public.cardio_segments;
    truncate public.gym_join_attempts, public.gym_members, public.gyms, public.profiles;
    delete from auth.users;
    insert into auth.users (id, email) values
      ('${U.member}', 'member@x'), ('${U.other}', 'other@x'), ('${U.soleAdmin}', 'sole@x'),
      ('${U.coAdmin1}', 'co1@x'), ('${U.coAdmin2}', 'co2@x');
    insert into public.gyms (id, name, join_code) values
      ('${GYM_SOLE}', 'Tek Yöneticili', 'SOLE01'), ('${GYM_CO}', 'İki Yöneticili', 'COAD01');
    insert into public.gym_members (gym_id, user_id, role) values
      ('${GYM_SOLE}', '${U.soleAdmin}', 'admin'),
      ('${GYM_SOLE}', '${U.member}', 'member'),
      ('${GYM_CO}', '${U.coAdmin1}', 'admin'),
      ('${GYM_CO}', '${U.coAdmin2}', 'admin');
    insert into public.gym_join_attempts (user_id) values ('${U.member}');
  `);
  await pushSomeData(U.member);
  await pushSomeData(U.other);
});

describe('delete_my_account', () => {
  it('silinen kullanıcının hiçbir tabloda satırı kalmıyor', async () => {
    const before = await rowsOf(U.member);
    expect(Object.values(before).every((n) => n > 0)).toBe(true);

    await deleteAs(U.member);

    expect(Object.values(await rowsOf(U.member)).every((n) => n === 0)).toBe(true);
  });

  it('başkasının hesabına ve verisine dokunmuyor', async () => {
    const before = await rowsOf(U.other);
    await deleteAs(U.member);
    expect(await rowsOf(U.other)).toEqual(before);
    // Salonun yöneticisi ve salon duruyor
    const gym = await pg.query(`select count(*)::int as n from public.gym_members where gym_id = '${GYM_SOLE}'`);
    expect(gym.rows).toEqual([{ n: 1 }]);
  });

  it('başkasını silmenin yolu yok: fonksiyon parametre almıyor, kimlik auth.uid()', async () => {
    await expect(
      as(U.member, (tx) => tx.query(`select public.delete_my_account('${U.other}'::uuid)`))
    ).rejects.toThrow(/does not exist/);
    await expect(
      as(U.member, (tx) => tx.query(`delete from auth.users where id = '${U.other}'`))
    ).rejects.toThrow(/permission denied/);
  });

  it('salonun tek yöneticisi silemiyor; hiçbir şey silinmiyor', async () => {
    const before = await rowsOf(U.soleAdmin);
    await expect(deleteAs(U.soleAdmin)).rejects.toThrow(/sole_admin/);
    expect(await rowsOf(U.soleAdmin)).toEqual(before);
  });

  it('ikinci yönetici varsa yönetici silebiliyor; salon öbür yöneticiyle kalıyor', async () => {
    await deleteAs(U.coAdmin1);
    expect(Object.values(await rowsOf(U.coAdmin1)).every((n) => n === 0)).toBe(true);
    const admins = await pg.query<{ user_id: string }>(
      `select user_id from public.gym_members where gym_id = '${GYM_CO}' and role = 'admin'`
    );
    expect(admins.rows.map((r) => r.user_id)).toEqual([U.coAdmin2]);
  });

  it('silinen kullanıcının süresi dolmamış eski token\'ı: kimseye zarar veremez, veri yazamaz', async () => {
    // Supabase JWT'si süresi dolana kadar (en fazla 1 saat) imzalı kalır;
    // auth.uid() silinmiş kullanıcının kimliğini verir.
    await deleteAs(U.member);
    const others = await rowsOf(U.other);

    await deleteAs(U.member); // tekrar: hata yok, kimse etkilenmiyor
    expect(await rowsOf(U.other)).toEqual(others);

    await expect(pushSomeData(U.member)).rejects.toThrow(/foreign key|violates/);
    expect(Object.values(await rowsOf(U.member)).every((n) => n === 0)).toBe(true);

    const seen = await as(U.member, async (tx) => (await tx.query('select id from public.routines')).rows);
    expect(seen).toEqual([]);
  });

  it('giriş yapmamış (anon) çağıramıyor', async () => {
    await expect(deleteAs(null)).rejects.toThrow(/permission denied/);
    expect(Object.values(await rowsOf(U.member)).every((n) => n > 0)).toBe(true);
  });
});
