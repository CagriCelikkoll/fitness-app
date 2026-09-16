/**
 * Auto-fill: "bir önceki antrenmanın ağırlıkları".
 *
 * Yanlış seansı seçmek kullanıcıya sessizce hatalı sayı gösterir —
 * ekrandan fark etmek zor, testten kolay.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/db/client';
import { getLastSessionForExercise } from '@/lib/lastSession';
import {
  createCompletedSession,
  createSession,
  createTestDb,
  seedExercise,
  type TestDb,
} from './helpers/testDb';

let testDb: TestDb;
let db: Db;

beforeEach(() => {
  testDb = createTestDb();
  db = testDb.db;
});

afterEach(() => {
  testDb.close();
});

describe('getLastSessionForExercise', () => {
  it('son tamamlanmış seansın setlerini döndürüyor', async () => {
    const exerciseId = await seedExercise(db);
    const { sessionId } = await createCompletedSession(db, {
      exerciseId,
      startedAt: '2026-09-10T10:00:00.000Z',
      setSeeds: [
        { reps: 10, weightKg: 60 },
        { reps: 8, weightKg: 65 },
      ],
    });

    const result = await getLastSessionForExercise(db, exerciseId, null);

    expect(result).not.toBeNull();
    expect(result?.sessionId).toBe(sessionId);
    expect(result?.sessionDate).toBe('2026-09-10T10:00:00.000Z');
    expect(result?.sets.map((s) => [s.weightKg, s.reps])).toEqual([
      [60, 10],
      [65, 8],
    ]);
  });

  it('setler setNumber sırasında geliyor', async () => {
    const exerciseId = await seedExercise(db);
    await createCompletedSession(db, {
      exerciseId,
      startedAt: '2026-09-10T10:00:00.000Z',
      setSeeds: [{ reps: 12 }, { reps: 10 }, { reps: 8 }],
    });

    const result = await getLastSessionForExercise(db, exerciseId, null);

    expect(result?.sets.map((s) => s.setNumber)).toEqual([1, 2, 3]);
  });

  it('bitmemiş seansı (endedAt null) yok sayıyor', async () => {
    const exerciseId = await seedExercise(db);
    const finished = await createCompletedSession(db, {
      exerciseId,
      startedAt: '2026-09-10T10:00:00.000Z',
      setSeeds: [{ reps: 10, weightKg: 60 }],
    });
    // Daha yeni ama bitmemiş seans
    await createSession(db, {
      exerciseId,
      startedAt: '2026-09-15T10:00:00.000Z',
      endedAt: null,
      setSeeds: [{ reps: 5, weightKg: 100 }],
    });

    const result = await getLastSessionForExercise(db, exerciseId, null);

    expect(result?.sessionId).toBe(finished.sessionId);
    expect(result?.sets[0]?.weightKg).toBe(60);
  });

  it('mevcut seansı hariç tutuyor', async () => {
    const exerciseId = await seedExercise(db);
    const older = await createCompletedSession(db, {
      exerciseId,
      startedAt: '2026-09-10T10:00:00.000Z',
      setSeeds: [{ reps: 10, weightKg: 60 }],
    });
    const current = await createCompletedSession(db, {
      exerciseId,
      startedAt: '2026-09-14T10:00:00.000Z',
      setSeeds: [{ reps: 8, weightKg: 70 }],
    });

    const result = await getLastSessionForExercise(
      db,
      exerciseId,
      current.sessionId
    );

    expect(result?.sessionId).toBe(older.sessionId);
    expect(result?.sets[0]?.weightKg).toBe(60);
  });

  it('tamamlanmamış setleri getirmiyor', async () => {
    const exerciseId = await seedExercise(db);
    await createCompletedSession(db, {
      exerciseId,
      startedAt: '2026-09-10T10:00:00.000Z',
      setSeeds: [
        { reps: 10, weightKg: 60, isCompleted: true },
        { reps: 8, weightKg: 65, isCompleted: false },
      ],
    });

    const result = await getLastSessionForExercise(db, exerciseId, null);

    expect(result?.sets).toHaveLength(1);
    expect(result?.sets[0]?.weightKg).toBe(60);
  });

  it('warmup/dropset gibi normal olmayan setleri getirmiyor', async () => {
    const exerciseId = await seedExercise(db);
    await createCompletedSession(db, {
      exerciseId,
      startedAt: '2026-09-10T10:00:00.000Z',
      setSeeds: [
        { reps: 15, weightKg: 20, setType: 'warmup' },
        { reps: 10, weightKg: 60, setType: 'normal' },
      ],
    });

    const result = await getLastSessionForExercise(db, exerciseId, null);

    expect(result?.sets).toHaveLength(1);
    expect(result?.sets[0]?.setType).toBe('normal');
  });

  it('hiç geçmiş yoksa null', async () => {
    const exerciseId = await seedExercise(db);

    expect(await getLastSessionForExercise(db, exerciseId, null)).toBeNull();
  });

  it('yalnızca bitmemiş seans varsa null', async () => {
    const exerciseId = await seedExercise(db);
    await createSession(db, {
      exerciseId,
      startedAt: '2026-09-15T10:00:00.000Z',
      endedAt: null,
      setSeeds: [{ reps: 5 }],
    });

    expect(await getLastSessionForExercise(db, exerciseId, null)).toBeNull();
  });

  it('birden fazla geçmiş seans varsa en yenisini seçiyor', async () => {
    const exerciseId = await seedExercise(db);
    await createCompletedSession(db, {
      exerciseId,
      startedAt: '2026-08-01T10:00:00.000Z',
      setSeeds: [{ reps: 10, weightKg: 50 }],
    });
    const newest = await createCompletedSession(db, {
      exerciseId,
      startedAt: '2026-09-12T10:00:00.000Z',
      setSeeds: [{ reps: 10, weightKg: 70 }],
    });
    await createCompletedSession(db, {
      exerciseId,
      startedAt: '2026-09-01T10:00:00.000Z',
      setSeeds: [{ reps: 10, weightKg: 60 }],
    });

    const result = await getLastSessionForExercise(db, exerciseId, null);

    expect(result?.sessionId).toBe(newest.sessionId);
    expect(result?.sets[0]?.weightKg).toBe(70);
  });

  it('başka egzersizin setlerini karıştırmıyor', async () => {
    const bench = await seedExercise(db, { name: 'Bench' });
    const squat = await seedExercise(db, { name: 'Squat' });
    await createCompletedSession(db, {
      exerciseId: squat,
      startedAt: '2026-09-14T10:00:00.000Z',
      setSeeds: [{ reps: 5, weightKg: 120 }],
    });
    await createCompletedSession(db, {
      exerciseId: bench,
      startedAt: '2026-09-10T10:00:00.000Z',
      setSeeds: [{ reps: 10, weightKg: 60 }],
    });

    const result = await getLastSessionForExercise(db, bench, null);

    expect(result?.sets).toHaveLength(1);
    expect(result?.sets[0]?.weightKg).toBe(60);
  });
});
