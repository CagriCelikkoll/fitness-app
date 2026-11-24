/**
 * Rekor sayfası uçtan uca (gerçek SQLite): antrenman ekranındaki gibi set
 * tamamla → `finishSessionRecord` → özet ekranının okuduğu
 * `loadSessionRecordPage`. Önce bir antrenman, sonra aynı harekette daha
 * ağır bir antrenman → rekor sayfası çıkmalı.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { sets, workoutSessions } from '@/db/schema';
import { finishSessionRecord } from '@/lib/finishSession';
import { loadSessionRecordPage } from '@/lib/recordEvents';
import { loadWorkoutSummary, summaryRecordPage } from '@/lib/workoutSummary';
import { createSession, createTestDb, seedExercise, type TestDb } from './helpers/testDb';

let t: TestDb;
let db: Db;

beforeEach(() => {
  t = createTestDb();
  db = t.db;
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
  t.close();
});

/**
 * Antrenman ekranındaki akış: seans açık başlar, setler ✓ ile tamamlanır
 * (completedAt yazılır), son ✓'den sonra "Bitir".
 */
async function workout(
  exerciseId: string,
  startedAt: string,
  setSeeds: { weightKg: number; reps: number; confirmed?: boolean }[]
) {
  vi.setSystemTime(new Date(startedAt));
  const h = await createSession(db, {
    exerciseId,
    startedAt,
    setSeeds: setSeeds.map((s) => ({ weightKg: s.weightKg, reps: s.reps, isCompleted: false })),
  });
  const base = new Date(startedAt).getTime();
  const pending: string[] = [];
  for (let i = 0; i < h.setIds.length; i += 1) {
    if (setSeeds[i]!.confirmed === false) {
      pending.push(h.setIds[i]!);
      continue;
    }
    await db
      .update(sets)
      .set({ isCompleted: true, completedAt: new Date(base + (i + 1) * 5 * 60_000).toISOString() })
      .where(eq(sets.id, h.setIds[i]!));
  }
  vi.setSystemTime(new Date(base + 45 * 60_000));
  await finishSessionRecord(db, {
    sessionId: h.sessionId,
    sessionExerciseIds: [h.sessionExerciseId],
    pendingFilledIds: pending,
    mode: 'complete',
  });
  return h.sessionId;
}

describe('Bitir → özet → rekor sayfası', () => {
  it('aynı harekette daha ağır antrenman → rekor sayfası açılır', async () => {
    const bench = await seedExercise(db, { name: 'Bench Press', nameTr: 'Göğüs Presi' });
    await workout(bench, '2026-10-06T10:00:00.000Z', [
      { weightKg: 80, reps: 5 },
      { weightKg: 80, reps: 5 },
    ]);
    const second = await workout(bench, '2026-10-08T10:00:00.000Z', [
      { weightKg: 80, reps: 5 },
      { weightKg: 85, reps: 5 },
    ]);

    const [row] = await db.select().from(workoutSessions).where(eq(workoutSessions.id, second));
    expect(row?.endedAt).not.toBeNull();

    const page = await loadSessionRecordPage(db, second);
    expect(page).not.toBeNull();
    expect(page).toMatchObject({ exerciseName: 'Göğüs Presi', weightKg: 85, reps: 5, kinds: ['weight', 'e1rm'], previousE1rm: { weightKg: 80, reps: 5 }, previousWeight: { weightKg: 80, reps: 5 } });

    // Özet ekranı sayfayı önce özetin kendi rekorlarından kuruyor; iki
    // kaynak aynı sayfayı vermeli
    const summary = await loadWorkoutSummary(db, second);
    expect(summary?.records.length).toBeGreaterThan(0);
    expect(summaryRecordPage(summary!.records)).toEqual(page);
  });

  it('birden fazla harekette rekor: en büyüğü + "N rekor daha"', async () => {
    const bench = await seedExercise(db, { name: 'Bench Press', nameTr: 'Göğüs Presi' });
    const squat = await seedExercise(db, { name: 'Squat', nameTr: 'Squat' });
    await workout(bench, '2026-10-06T10:00:00.000Z', [{ weightKg: 80, reps: 5 }]);
    await workout(squat, '2026-10-06T12:00:00.000Z', [{ weightKg: 100, reps: 5 }]);
    vi.setSystemTime(new Date('2026-10-08T10:00:00.000Z'));
    const h = await createSession(db, {
      exerciseId: bench,
      startedAt: '2026-10-08T10:00:00.000Z',
      setSeeds: [{ weightKg: 82.5, reps: 5 }],
    });
    // İkinci hareket aynı seansta
    const { sessionExercises } = await import('@/db/schema');
    await db.insert(sessionExercises).values({ id: 'se-squat', sessionId: h.sessionId, exerciseId: squat, orderIndex: 1 });
    await db.insert(sets).values({
      id: 'set-squat',
      sessionExerciseId: 'se-squat',
      setNumber: 1,
      reps: 5,
      weightKg: 110,
      isCompleted: true,
      completedAt: '2026-10-08T10:20:00.000Z',
    });
    await db.update(sets).set({ completedAt: '2026-10-08T10:10:00.000Z' }).where(eq(sets.id, h.setIds[0]!));
    vi.setSystemTime(new Date('2026-10-08T10:40:00.000Z'));
    await finishSessionRecord(db, {
      sessionId: h.sessionId,
      sessionExerciseIds: [h.sessionExerciseId, 'se-squat'],
      pendingFilledIds: [],
      mode: 'delete',
    });

    const page = await loadSessionRecordPage(db, h.sessionId);
    expect(page).toMatchObject({ exerciseName: 'Squat', weightKg: 110, moreCount: 1 });
    expect(summaryRecordPage((await loadWorkoutSummary(db, h.sessionId))!.records)).toEqual(page);
  });

  it('"Tamamlanmış say" ile onaylanan ağır set de rekor', async () => {
    const bench = await seedExercise(db);
    await workout(bench, '2026-10-06T10:00:00.000Z', [{ weightKg: 80, reps: 5 }]);
    const second = await workout(bench, '2026-10-08T10:00:00.000Z', [
      { weightKg: 80, reps: 5 },
      { weightKg: 90, reps: 5, confirmed: false },
    ]);
    expect(await loadSessionRecordPage(db, second)).toMatchObject({ weightKg: 90 });
  });

  it('ilk antrenman ve eşitleme rekor sayfası açmaz', async () => {
    const bench = await seedExercise(db);
    const first = await workout(bench, '2026-10-06T10:00:00.000Z', [{ weightKg: 80, reps: 5 }]);
    expect(await loadSessionRecordPage(db, first)).toBeNull();
    const same = await workout(bench, '2026-10-08T10:00:00.000Z', [{ weightKg: 80, reps: 5 }]);
    expect(await loadSessionRecordPage(db, same)).toBeNull();
    expect(summaryRecordPage((await loadWorkoutSummary(db, first))!.records)).toBeNull();
    expect(summaryRecordPage((await loadWorkoutSummary(db, same))!.records)).toBeNull();
  });
});
