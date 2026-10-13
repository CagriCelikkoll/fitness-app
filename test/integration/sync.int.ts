/**
 * Gerçek sunucu — eşitleme (v3.2a). İki yerel SQLite = iki telefon
 * (gerçek migration'lar, uygulamanın motoru), aynı hesap, gerçek Supabase
 * RPC'leri (supabaseTransport). Her testten önce hesabın buluttaki
 * eşitleme verisi silinir.
 */

import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { bodyMetrics, routines, sessionExercises, sets, workoutSessions } from '@/db/schema';
import { saveSessionNote } from '@/lib/notes';
import { finishSessionRecord } from '@/lib/finishSession';
import { wipeUserData } from '@/lib/backup';
import { newId } from '@/lib/id';
import { DELETE_CONFIRM_LIMIT, getSyncStatus, runSync } from '@/lib/sync/engine';
import { supabaseTransport } from '@/lib/sync/supabaseTransport';
import type { SyncChange } from '@/lib/sync/types';
import type { TestDb } from '../helpers/testDb';
import { closePhones, newRoutine, outboxCount, phone, synced, workout } from '../helpers/syncPhones';

import {
  admin,
  createUser,
  deleteCreatedUsers,
  signedIn,
  stopAppClients,
  type AppClient,
  type TestUser,
} from './support';

const SYNC_TABLES = [
  'sets',
  'cardio_segments',
  'session_exercises',
  'workout_sessions',
  'routine_exercises',
  'routines',
] as const;

let user: TestUser;
let other: TestUser;
let appA: AppClient;
let appB: AppClient;
let appOther: AppClient;

beforeAll(async () => {
  user = await createUser('sync');
  other = await createUser('syncdiger');
  appA = await signedIn(user); // telefon A
  appB = await signedIn(user); // telefon B, aynı hesap
  appOther = await signedIn(other);
});

afterAll(async () => {
  await stopAppClients();
  await deleteCreatedUsers();
});

beforeEach(async () => {
  for (const t of SYNC_TABLES) await admin.from(t).delete().eq('user_id', user.id);
});
afterEach(closePhones);

const sync = (p: TestDb, app: AppClient, opts: { userId?: string; confirmDeletes?: boolean; pullPageSize?: number } = {}) =>
  runSync({
    db: p.db,
    transport: supabaseTransport(app.client),
    userId: opts.userId ?? user.id,
    confirmDeletes: opts.confirmDeletes,
    pullPageSize: opts.pullPageSize,
  });

async function ok(p: ReturnType<typeof sync>) {
  const r = await p;
  expect(r).toMatchObject({ status: 'ok' });
  return r as Extract<Awaited<typeof p>, { status: 'ok' }>;
}

const serverCount = async (table: (typeof SYNC_TABLES)[number], onlyLive = true) => {
  let q = admin.from(table).select('*', { count: 'exact', head: true }).eq('user_id', user.id);
  if (onlyLive) q = q.is('deleted_at', null);
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return count ?? 0;
};

describe('Eşitleme: iki telefon, gerçek sunucu', () => {
  it('A gönderir, B çeker: B’de aynı veri; vücut ölçüleri gitmiyor', async () => {
    const a = await phone();
    const b = await phone();
    const r = await newRoutine(a.db);
    await workout(a.db, r);
    await workout(a.db, r);
    await a.db.insert(bodyMetrics).values({ id: newId(), date: '2026-10-01', weightKg: 80 });

    await ok(sync(a, appA));
    await ok(sync(b, appB));
    expect(await synced(b.db)).toEqual(await synced(a.db));
    expect(await b.db.select().from(bodyMetrics)).toEqual([]);
    expect(await outboxCount(b.db)).toBe(0);
  });

  it('düzenleme ve silme iki yönde yayılıyor (cascade dahil)', async () => {
    const a = await phone();
    const b = await phone();
    const r1 = await newRoutine(a.db, 'Bir');
    const r2 = await newRoutine(a.db, 'İki');
    const s1 = await workout(a.db, r1);
    await workout(a.db, r2);
    await ok(sync(a, appA));
    await ok(sync(b, appB));

    await saveSessionNote(b.db, s1, 'B yazdı');
    await b.db.delete(routines).where(eq(routines.id, r2));
    await ok(sync(b, appB));
    await ok(sync(a, appA));
    expect(await synced(a.db)).toEqual(await synced(b.db));
    expect((await a.db.select().from(workoutSessions).where(eq(workoutSessions.id, s1)))[0].notes).toBe('B yazdı');

    await a.db.delete(workoutSessions).where(eq(workoutSessions.id, s1));
    await ok(sync(a, appA));
    await ok(sync(b, appB));
    expect(await synced(b.db)).toEqual(await synced(a.db));
    expect(await b.db.select().from(sessionExercises).where(eq(sessionExercises.sessionId, s1))).toEqual([]);
  });

  it('yarım antrenman gitmiyor; bitince hepsi gidiyor', async () => {
    const a = await phone();
    const r = await newRoutine(a.db);
    await ok(sync(a, appA));
    const s = await workout(a.db, r, false);
    await ok(sync(a, appA));
    expect(await serverCount('workout_sessions')).toBe(0);
    expect(await serverCount('sets')).toBe(0);

    const ses = await a.db.select().from(sessionExercises).where(eq(sessionExercises.sessionId, s));
    await finishSessionRecord(a.db, {
      sessionId: s,
      sessionExerciseIds: ses.map((x) => x.id),
      pendingFilledIds: [],
      mode: 'delete',
    });
    await ok(sync(a, appA));
    expect(await serverCount('workout_sessions')).toBe(1);
    expect(await serverCount('sets')).toBe((await a.db.select().from(sets)).length);
  });

  it('sıfırla → bulutta silme yok, veri bir sonraki eşitlemede geri geliyor', async () => {
    const a = await phone();
    const r = await newRoutine(a.db);
    await workout(a.db, r);
    await ok(sync(a, appA));
    const before = await synced(a.db);
    const serverSets = await serverCount('sets');

    await wipeUserData(a.db);
    expect(await outboxCount(a.db)).toBe(0);
    await ok(sync(a, appA));
    expect(await serverCount('sets')).toBe(serverSets);
    expect(await synced(a.db)).toEqual(before);
  });

  it('hesap uyuşmazlığında hiçbir istek gitmiyor', async () => {
    const a = await phone();
    await newRoutine(a.db);
    await ok(sync(a, appA));
    const callsBefore = appOther.calls.length;
    const r = await sync(a, appOther, { userId: other.id });
    expect(r).toMatchObject({ status: 'blocked', issue: { kind: 'owner_mismatch' } });
    expect(appOther.calls.length).toBe(callsBefore);
  });
});

describe('Eşitleme: silme korumaları (gerçek sunucu)', () => {
  async function phoneWithSessions(n: number) {
    const a = await phone();
    const r = await newRoutine(a.db, 'R', 1);
    const now = new Date().toISOString();
    for (let i = 0; i < n; i++) {
      await a.db.insert(workoutSessions).values({
        id: newId(),
        routineId: r,
        name: `S${i}`,
        startedAt: now,
        endedAt: now,
      });
    }
    await ok(sync(a, appA));
    return a;
  }

  it(`gönderme yönü: ${DELETE_CONFIRM_LIMIT + 1} silme → onay bekliyor, hiçbir şey gitmiyor`, async () => {
    const a = await phoneWithSessions(DELETE_CONFIRM_LIMIT + 1);
    await a.db.delete(workoutSessions);
    const callsBefore = appA.calls.length;
    const r = await sync(a, appA);
    expect(r).toMatchObject({ status: 'blocked', issue: { kind: 'needs_confirmation', direction: 'push', sessions: 51 } });
    expect(appA.calls.length).toBe(callsBefore);
    expect(await serverCount('workout_sessions')).toBe(51);
  });

  it(`çekme yönü: buluttan ${DELETE_CONFIRM_LIMIT + 1} silme → onay bekliyor, telefonda hiçbir şey silinmiyor`, async () => {
    const a = await phoneWithSessions(DELETE_CONFIRM_LIMIT + 1);
    const b = await phone();
    await ok(sync(b, appB));
    await a.db.delete(workoutSessions);
    await ok(sync(a, appA, { confirmDeletes: true }));
    expect(await serverCount('workout_sessions')).toBe(0);

    const r = await sync(b, appB);
    expect(r).toMatchObject({ status: 'blocked', issue: { kind: 'needs_confirmation', direction: 'pull', sessions: 51 } });
    expect(await b.db.select().from(workoutSessions)).toHaveLength(51);
  });
});

describe('Eşitleme: ebeveyni sonra gelen satır', () => {
  it('çocuk ebeveyninden önce gelirse bekletiliyor, ebeveyn gelince ekleniyor (sayfa boyutu 2)', async () => {
    const b = await phone();
    await ok(sync(b, appB, { pullPageSize: 2 }));
    const transport = supabaseTransport(appA.client);
    const at = new Date().toISOString();
    const sessionId = newId();
    const seId = newId();
    const setId = newId();
    const children: SyncChange[] = [
      {
        t: 'session_exercises',
        id: seId,
        at,
        row: { id: seId, session_id: sessionId, exercise_id: 'Barbell_Squat', order_index: 0, superset_group: null, notes: null },
      },
      {
        t: 'sets',
        id: setId,
        at,
        row: {
          id: setId,
          session_exercise_id: seId,
          set_number: 1,
          set_type: 'normal',
          reps: 5,
          weight_kg: 100,
          rir: null,
          rpe: null,
          is_completed: true,
          rest_taken_seconds: null,
          notes: null,
          completed_at: at,
        },
      },
    ];
    await transport.push(children);
    const first = await ok(sync(b, appB, { pullPageSize: 2 }));
    expect(first).toMatchObject({ waiting: 2, dropped: 0 });
    expect(await b.db.select().from(sets)).toEqual([]);
    expect(await getSyncStatus(b.db)).toMatchObject({ waiting: 2 });

    await transport.push([
      {
        t: 'workout_sessions',
        id: sessionId,
        at,
        row: {
          id: sessionId,
          routine_id: null,
          name: 'Geç gelen',
          started_at: at,
          ended_at: at,
          duration_seconds: 60,
          notes: null,
          bodyweight_kg: null,
          perceived_difficulty: null,
          created_at: '2026-10-13 10:00:00',
        },
      },
    ]);
    const second = await ok(sync(b, appB, { pullPageSize: 2 }));
    expect(second).toMatchObject({ waiting: 0, dropped: 0 });
    expect((await b.db.select().from(sets)).map((s) => s.id)).toEqual([setId]);
  });

  it('çok sayfalı çekme (sayfa boyutu 2) eksiksiz', async () => {
    const a = await phone();
    const b = await phone();
    const r = await newRoutine(a.db, 'R', 2);
    for (let i = 0; i < 3; i++) await workout(a.db, r);
    await ok(sync(a, appA));
    await ok(sync(b, appB, { pullPageSize: 2 }));
    expect(await synced(b.db)).toEqual(await synced(a.db));
  });
});
