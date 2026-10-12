/**
 * Eşitleme sunucusu (v3.1b) — `supabase/migrations/0002_sync.sql`
 * PGlite'ta (0001 ile birlikte, Supabase stub'ıyla; bkz. rls.test.ts).
 *
 * - RLS: başkasının satırını okuyamaz; doğrudan yazma yok.
 * - sync_push: user_id sahteciliği işe yaramaz, aynı parti iki kez
 *   gelince çoğalmaz, son yazan kazanır, ileri tarihli saat sınırlanır,
 *   mezar taşı.
 * - sync_pull: imleç, sayfalama, üst sınır.
 * - Sözleşme: aynı senaryo sahte sunucuda (motor testlerinin kullandığı)
 *   aynı sonucu veriyor.
 * - Sunucu sütunları yerel şemayla birebir (sütun eklenip sunucu
 *   unutulursa burası kırılır).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite, type Transaction } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { SYNC_TABLES } from '@/lib/sync/tables';
import type { PulledRow, SyncChange, SyncTableName, SyncTransport } from '@/lib/sync/types';

import { FakeSyncServer } from './helpers/fakeSyncServer';

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

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';

let pg: PGlite;

async function as<T>(userId: string | null, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return pg.transaction(async (tx) => {
    if (userId) await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    await tx.exec(`set local role ${userId ? 'authenticated' : 'anon'}`);
    return fn(tx);
  });
}

/** Gerçek SQL'e karşı SyncTransport (PostgREST'in JSON biçimiyle) */
function pgTransport(userId: string): SyncTransport {
  return {
    serverTime: () =>
      as(userId, async (tx) => {
        const r = await tx.query<{ t: string }>(`select to_json(public.sync_server_time()) #>> '{}' as t`);
        return r.rows[0].t;
      }),
    push: (changes) =>
      as(userId, async (tx) => {
        await tx.query('select public.sync_push($1::jsonb)', [JSON.stringify(changes)]);
      }),
    pull: (req) =>
      as(userId, async (tx) => {
        const r = await tx.query<{ id: string; at: string; deleted: boolean; data: Record<string, unknown> }>(
          `select id, to_json(server_updated_at) #>> '{}' as at, deleted, data
           from public.sync_pull($1, $2::timestamptz, $3, $4::timestamptz, $5)`,
          [req.table, req.afterAt, req.afterId, req.until, req.limit]
        );
        return r.rows.map(
          (x): PulledRow => ({ id: x.id, serverUpdatedAt: x.at, deleted: x.deleted, row: x.data })
        );
      }),
  };
}

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(SUPABASE_STUB);
  await pg.exec(read('supabase/migrations/0001_init.sql'));
  await pg.exec(read('supabase/migrations/0002_sync.sql'));
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
    insert into auth.users (id, email) values ('${A}', 'a@x'), ('${B}', 'b@x');
  `);
});

const routine = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  description: null,
  color: null,
  estimated_duration_min: null,
  is_archived: false,
  created_at: '2026-10-01 09:00:00',
  updated_at: '2026-10-01T09:00:00.000Z',
  ...extra,
});

const change = (id: string, at: string, row: Record<string, unknown> | null, t: SyncTableName = 'routines'): SyncChange => ({
  t,
  id,
  at,
  row,
});

async function pullAll(tr: SyncTransport, table: SyncTableName, limit = 1000): Promise<PulledRow[]> {
  const until = await tr.serverTime();
  const out: PulledRow[] = [];
  let afterAt: string | null = null;
  let afterId = '';
  for (;;) {
    const page = await tr.pull({ table, afterAt, afterId, until, limit });
    out.push(...page);
    if (page.length < limit) return out;
    afterAt = page[page.length - 1].serverUpdatedAt;
    afterId = page[page.length - 1].id;
  }
}

const iso = (ms: number) => new Date(ms).toISOString();

// ============================================================================
// Sözleşme: gerçek SQL ve sahte sunucu aynı davranıyor
// ============================================================================

describe.each([
  ['PGlite (gerçek SQL)', () => ({ a: pgTransport(A), b: pgTransport(B), tick: async () => {} })],
  [
    'sahte sunucu',
    () => {
      const s = new FakeSyncServer();
      return { a: s.transport(A), b: s.transport(B), tick: async () => s.advance(1) };
    },
  ],
])('sözleşme — %s', (_name, make) => {
  it('gönderilen satır yalnızca sahibine iner; aynı parti iki kez gelince çoğalmaz', async () => {
    const { a, b } = make();
    const t0 = Date.parse(await a.serverTime());
    const batch = [change('r1', iso(t0), routine('r1', 'İtme')), change('r2', iso(t0), routine('r2', 'Çekme'))];
    await a.push(batch);
    await a.push(batch);

    const mine = await pullAll(a, 'routines');
    expect(mine.map((r) => r.id).sort()).toEqual(['r1', 'r2']);
    expect(mine.find((r) => r.id === 'r1')!.row).toMatchObject({ id: 'r1', name: 'İtme', is_archived: false });
    expect(mine[0].row).not.toHaveProperty('user_id');
    expect(await pullAll(b, 'routines')).toEqual([]);
  });

  it('satırdaki user_id yok sayılıyor (sahtecilik işe yaramaz)', async () => {
    const { a, b } = make();
    const t0 = Date.parse(await a.serverTime());
    await a.push([change('r1', iso(t0), { ...routine('r1', 'Sahte'), user_id: B })]);
    expect(await pullAll(b, 'routines')).toEqual([]);
    expect((await pullAll(a, 'routines')).map((r) => r.id)).toEqual(['r1']);
  });

  it('son yazan kazanır; eski zamanlı yazma yok sayılıyor', async () => {
    const { a, tick } = make();
    const t0 = Date.parse(await a.serverTime());
    await a.push([change('r1', iso(t0), routine('r1', 'v1'))]);
    await tick();
    await a.push([change('r1', iso(t0 - 60_000), routine('r1', 'eski'))]);
    await tick();
    await a.push([change('r1', iso(t0 + 1000), routine('r1', 'v2'))]);
    const [r] = await pullAll(a, 'routines');
    expect(r.row.name).toBe('v2');
  });

  it('partide aynı id iki kez: en yenisi', async () => {
    const { a } = make();
    const t0 = Date.parse(await a.serverTime());
    await a.push([
      change('r1', iso(t0 + 1000), routine('r1', 'yeni')),
      change('r1', iso(t0), routine('r1', 'eski')),
    ]);
    const rows = await pullAll(a, 'routines');
    expect(rows).toHaveLength(1);
    expect(rows[0].row.name).toBe('yeni');
  });

  it('mezar taşı: silme iner; daha eski yazma diriltmez, daha yenisi diriltir; bilinmeyen id sessiz', async () => {
    const { a, tick } = make();
    const t0 = Date.parse(await a.serverTime());
    await a.push([change('r1', iso(t0), routine('r1', 'v1'))]);
    await tick();
    await a.push([change('r1', iso(t0 + 1000), null), change('yok', iso(t0), null)]);
    let [r] = await pullAll(a, 'routines');
    expect(r).toMatchObject({ id: 'r1', deleted: true });
    expect(await pullAll(a, 'routines')).toHaveLength(1);

    await tick();
    await a.push([change('r1', iso(t0 + 500), routine('r1', 'geç kalan'))]);
    [r] = await pullAll(a, 'routines');
    expect(r.deleted).toBe(true);

    await tick();
    await a.push([change('r1', iso(t0 + 2000), routine('r1', 'yeniden'))]);
    [r] = await pullAll(a, 'routines');
    expect(r).toMatchObject({ deleted: false, row: { name: 'yeniden' } });
  });

  it('ileri tarihli istemci saati en fazla now + 5 dk sayılıyor', async () => {
    const { a, tick } = make();
    const t0 = Date.parse(await a.serverTime());
    // Saati bir gün ileri telefon
    await a.push([change('r1', iso(t0 + 24 * 3600_000), routine('r1', 'ileri saat'))]);
    await tick();
    // 10 dk sonrası damgalı normal düzenleme kazanmalı (sınır olmasa bir gün kilitlerdi)
    await a.push([change('r1', iso(t0 + 10 * 60_000), routine('r1', 'normal'))]);
    const [r] = await pullAll(a, 'routines');
    expect(r.row.name).toBe('normal');
  });

  it('sayfalama: imleçle her satır bir kez', async () => {
    const { a, tick } = make();
    const t0 = Date.parse(await a.serverTime());
    for (let i = 0; i < 5; i++) {
      await a.push([change(`r${i}`, iso(t0), routine(`r${i}`, `R${i}`))]);
      await tick();
    }
    const rows = await pullAll(a, 'routines', 2);
    expect(rows.map((r) => r.id).sort()).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
  });

  it('çekme üst sınırı: "until"dan sonra yazılan satır o çekmede yok', async () => {
    const { a, tick } = make();
    const t0 = Date.parse(await a.serverTime());
    await a.push([change('r1', iso(t0), routine('r1', 'önce'))]);
    await tick();
    const until = await a.serverTime();
    await tick();
    await a.push([change('r2', iso(t0), routine('r2', 'sonra'))]);
    const rows = await a.pull({ table: 'routines', afterAt: null, afterId: '', until, limit: 100 });
    expect(rows.map((r) => r.id)).toEqual(['r1']);
  });
});

// ============================================================================
// Yalnızca gerçek SQL: yetkiler
// ============================================================================

describe('RLS ve yetkiler', () => {
  beforeEach(async () => {
    const t0 = Date.parse(await pgTransport(A).serverTime());
    await pgTransport(A).push([change('ra', iso(t0), routine('ra', 'A rutini'))]);
    await pgTransport(B).push([change('rb', iso(t0), routine('rb', 'B rutini'))]);
  });

  it('kişi doğrudan sorguda yalnızca kendi satırlarını görür', async () => {
    const seen = await as(A, async (tx) => (await tx.query<{ id: string }>('select id from public.routines')).rows);
    expect(seen.map((r) => r.id)).toEqual(['ra']);
  });

  it('başkasının satırı çekmede de görünmüyor', async () => {
    expect((await pullAll(pgTransport(A), 'routines')).map((r) => r.id)).toEqual(['ra']);
  });

  it('doğrudan insert / update / delete yok (yalnızca sync_push)', async () => {
    for (const q of [
      `insert into public.routines (user_id, id, name, client_updated_at) values ('${A}', 'x', 'x', now())`,
      `update public.routines set name = 'değişti' where id = 'ra'`,
      `delete from public.routines where id = 'ra'`,
    ]) {
      await expect(as(A, (tx) => tx.query(q))).rejects.toThrow(/permission denied/);
    }
  });

  it('başkasının satırını sync_push ile ezemez: aynı id kendi hesabına ayrı satır olur', async () => {
    const t0 = Date.parse(await pgTransport(A).serverTime());
    await pgTransport(A).push([change('rb', iso(t0 + 1000), routine('rb', 'A ezmeye çalıştı'))]);
    const [b] = await pullAll(pgTransport(B), 'routines');
    expect(b.row.name).toBe('B rutini');
    const owners = await pg.query<{ user_id: string }>(`select user_id from public.routines where id = 'rb' order by user_id`);
    expect(owners.rows.map((r) => r.user_id)).toEqual([A, B]);
  });

  it('başkasının satırını silemez', async () => {
    const t0 = Date.parse(await pgTransport(A).serverTime());
    await pgTransport(A).push([change('rb', iso(t0 + 1000), null)]);
    const [b] = await pullAll(pgTransport(B), 'routines');
    expect(b.deleted).toBe(false);
  });

  it('giriş yapmamış (anon) RPC çağıramaz, tabloyu okuyamaz', async () => {
    await expect(as(null, (tx) => tx.query(`select public.sync_push('[]'::jsonb)`))).rejects.toThrow(
      /permission denied/
    );
    await expect(as(null, (tx) => tx.query(`select public.sync_server_time()`))).rejects.toThrow(/permission denied/);
    await expect(as(null, (tx) => tx.query('select * from public.routines'))).rejects.toThrow(/permission denied/);
  });

  it('geçersiz yük, büyük parti ve bilinmeyen tablo reddediliyor', async () => {
    await expect(as(A, (tx) => tx.query(`select public.sync_push('{}'::jsonb)`))).rejects.toThrow(/invalid_payload/);
    const big = JSON.stringify(Array.from({ length: 1001 }, (_, i) => change(`x${i}`, iso(0), null)));
    await expect(as(A, (tx) => tx.query('select public.sync_push($1::jsonb)', [big]))).rejects.toThrow(
      /batch_too_large/
    );
    await expect(
      as(A, (tx) => tx.query(`select * from public.sync_pull('profiles', null, '', now(), 10)`))
    ).rejects.toThrow(/invalid_table/);
  });

  it('bilinmeyen tablo adlı değişiklik yok sayılıyor', async () => {
    const t0 = Date.parse(await pgTransport(A).serverTime());
    await as(A, (tx) =>
      tx.query('select public.sync_push($1::jsonb)', [
        JSON.stringify([{ t: 'gyms', id: 'g', at: iso(t0), row: { name: 'x' } }]),
      ])
    );
    const gyms = await pg.query('select count(*)::int as n from public.gyms');
    expect(gyms.rows).toEqual([{ n: 0 }]);
  });
});

// ============================================================================
// Sunucu sütunları = yerel şema
// ============================================================================

describe('sunucu şeması', () => {
  it('her eşitlenen tabloda yerel sütunların hepsi aynı adla var', async () => {
    for (const t of SYNC_TABLES) {
      const cols = await pg.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema = 'public' and table_name = $1`,
        [t.name]
      );
      const server = new Set(cols.rows.map((r) => r.column_name));
      const local = Object.values(t.columns).map((c) => c.name);
      expect({ table: t.name, missing: local.filter((c) => !server.has(c)) }).toEqual({
        table: t.name,
        missing: [],
      });
      const extra = [...server].filter(
        (c) => !local.includes(c) && !['user_id', 'client_updated_at', 'server_updated_at', 'deleted_at'].includes(c)
      );
      expect({ table: t.name, extra }).toEqual({ table: t.name, extra: [] });
    }
  });

  it('her tablo için bütün sütunlarıyla gidip gelen satır aynı', async () => {
    const tr = pgTransport(A);
    const t0 = Date.parse(await tr.serverTime());
    const row = {
      id: 's1',
      session_exercise_id: 'se1',
      set_number: 2,
      set_type: 'normal',
      reps: 8,
      weight_kg: 82.5,
      rir: 1,
      rpe: 8.5,
      is_completed: true,
      rest_taken_seconds: null,
      notes: 'Ağır',
      completed_at: '2026-10-11T10:00:00.123Z',
    };
    await tr.push([change('s1', iso(t0), row, 'sets')]);
    const [back] = await pullAll(tr, 'sets');
    expect(back.row).toEqual(row);
  });
});
