/**
 * Seansı bitirme (`finishSessionRecord`) — gerçek SQLite.
 *
 * Odak: `endedAt` verilmeyen çağrı ("Antrenmanı Bitir") eski davranışın
 * birebir aynısı; verilen çağrı (yalnızca kurtarma yolu) bitişi ve süreyi
 * o zamana göre yazıyor.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { sets, workoutSessions } from '@/db/schema';
import { finishSessionRecord } from '@/lib/finishSession';
import { createSession, createTestDb, seedExercise, type TestDb } from './helpers/testDb';

let t: TestDb;
let db: Db;

const STARTED = '2026-10-08T10:00:00.000Z';
const NOW = '2026-10-08T11:15:30.000Z'; // başlangıçtan 4530 sn sonra

beforeEach(() => {
  t = createTestDb();
  db = t.db;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
  t.close();
});

/** 1 onaylı, 1 değer girilmiş ama onaysız, 1 boş set */
async function sessionWithSets() {
  const exerciseId = await seedExercise(db);
  const handles = await createSession(db, {
    exerciseId,
    startedAt: STARTED,
    setSeeds: [{ isCompleted: true }, { isCompleted: false }, { isCompleted: false }],
  });
  const [done, pending, empty] = handles.setIds as [string, string, string];
  await db.update(sets).set({ completedAt: '2026-10-08T10:30:00.000Z' }).where(eq(sets.id, done));
  await db.update(sets).set({ reps: null }).where(eq(sets.id, empty));
  return { ...handles, done, pending, empty };
}

async function sessionRow(id: string) {
  const [row] = await db.select().from(workoutSessions).where(eq(workoutSessions.id, id));
  return row!;
}

async function setRows() {
  return db.select({ id: sets.id, isCompleted: sets.isCompleted, completedAt: sets.completedAt }).from(sets);
}

describe('finishSessionRecord — parametresiz (normal "Antrenmanı Bitir")', () => {
  it('bitiş şimdi, süre şimdi − başlangıç; onaysızlar silinir', async () => {
    const s = await sessionWithSets();

    await finishSessionRecord(db, {
      sessionId: s.sessionId,
      sessionExerciseIds: [s.sessionExerciseId],
      pendingFilledIds: [s.pending],
      mode: 'delete',
    });

    expect(await sessionRow(s.sessionId)).toMatchObject({
      endedAt: NOW,
      durationSeconds: 4530,
    });
    expect(await setRows()).toEqual([
      { id: s.done, isCompleted: true, completedAt: '2026-10-08T10:30:00.000Z' },
    ]);
  });

  it('"Tamamlanmış say": bekleyen setler şimdiki zamanla onaylanır, boş set silinir', async () => {
    const s = await sessionWithSets();

    await finishSessionRecord(db, {
      sessionId: s.sessionId,
      sessionExerciseIds: [s.sessionExerciseId],
      pendingFilledIds: [s.pending],
      mode: 'complete',
    });

    expect(await sessionRow(s.sessionId)).toMatchObject({ endedAt: NOW, durationSeconds: 4530 });
    const rows = await setRows();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === s.pending)).toEqual({
      id: s.pending,
      isCompleted: true,
      completedAt: NOW,
    });
    expect(rows.some((r) => r.id === s.empty)).toBe(false);
  });

  it('endedAt: undefined açıkça verilse de aynı davranış', async () => {
    const s = await sessionWithSets();
    await finishSessionRecord(db, {
      sessionId: s.sessionId,
      sessionExerciseIds: [s.sessionExerciseId],
      pendingFilledIds: [],
      mode: 'delete',
      endedAt: undefined,
    });
    expect(await sessionRow(s.sessionId)).toMatchObject({ endedAt: NOW, durationSeconds: 4530 });
  });
});

describe('finishSessionRecord — endedAt verilince (kurtarma yolu)', () => {
  const LAST_SET = '2026-10-08T10:30:00.000Z'; // başlangıçtan 1800 sn sonra

  it('bitiş ve süre verilen zamana göre; günler sonra kapatılsa da', async () => {
    vi.setSystemTime(new Date('2026-10-11T09:00:00.000Z'));
    const s = await sessionWithSets();

    await finishSessionRecord(db, {
      sessionId: s.sessionId,
      sessionExerciseIds: [s.sessionExerciseId],
      pendingFilledIds: [s.pending],
      mode: 'delete',
      endedAt: LAST_SET,
    });

    expect(await sessionRow(s.sessionId)).toMatchObject({
      endedAt: LAST_SET,
      durationSeconds: 1800,
    });
    expect((await setRows()).map((r) => r.id)).toEqual([s.done]);
  });

  it('"Tamamlanmış say" setlerinin zamanı da verilen bitiş', async () => {
    const s = await sessionWithSets();
    await finishSessionRecord(db, {
      sessionId: s.sessionId,
      sessionExerciseIds: [s.sessionExerciseId],
      pendingFilledIds: [s.pending],
      mode: 'complete',
      endedAt: LAST_SET,
    });
    expect((await setRows()).find((r) => r.id === s.pending)?.completedAt).toBe(LAST_SET);
  });

  it('bitiş başlangıçtan önceyse süre 0', async () => {
    const s = await sessionWithSets();
    await finishSessionRecord(db, {
      sessionId: s.sessionId,
      sessionExerciseIds: [s.sessionExerciseId],
      pendingFilledIds: [],
      mode: 'delete',
      endedAt: '2026-10-08T09:00:00.000Z',
    });
    expect((await sessionRow(s.sessionId)).durationSeconds).toBe(0);
  });
});
