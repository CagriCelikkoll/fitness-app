/**
 * İlerleme / rekor sorguları — gerçek SQLite.
 *
 * Yanlış seti saymak (ısınma, onaylanmamış set, bitmemiş seans) rekoru
 * sessizce şişirir; kullanıcı ekrandan fark etmez.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/db/client';
import {
  getExerciseSetHistory,
  getPreviousBestE1rm,
  getRecentExerciseRecords,
} from '@/lib/exerciseHistory';
import { epley } from '@/lib/exerciseProgress';
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

describe('getExerciseSetHistory', () => {
  it('ısınma seti, tamamlanmamış set ve bitmemiş seans sayılmıyor', async () => {
    const exerciseId = await seedExercise(db);
    const done = await createCompletedSession(db, {
      exerciseId,
      startedAt: '2026-09-10T10:00:00.000Z',
      setSeeds: [
        { reps: 10, weightKg: 40, setType: 'warmup' },
        { reps: 5, weightKg: 100 },
        { reps: 5, weightKg: 120, isCompleted: false },
      ],
    });
    await createSession(db, {
      exerciseId,
      startedAt: '2026-09-15T10:00:00.000Z',
      endedAt: null,
      setSeeds: [{ reps: 5, weightKg: 150 }],
    });

    const rows = await getExerciseSetHistory(db, exerciseId);

    expect(rows).toEqual([
      {
        sessionId: done.sessionId,
        date: '2026-09-10T10:00:00.000Z',
        weightKg: 100,
        reps: 5,
      },
    ]);
  });

  it('başka egzersizin setlerini getirmiyor', async () => {
    const bench = await seedExercise(db);
    const squat = await seedExercise(db, { name: 'Squat', nameTr: 'Squat' });
    await createCompletedSession(db, {
      exerciseId: squat,
      startedAt: '2026-09-10T10:00:00.000Z',
      setSeeds: [{ reps: 5, weightKg: 140 }],
    });

    expect(await getExerciseSetHistory(db, bench)).toEqual([]);
  });
});

describe('getPreviousBestE1rm', () => {
  it('mevcut seansı hariç tutuyor', async () => {
    const exerciseId = await seedExercise(db);
    await createCompletedSession(db, {
      exerciseId,
      startedAt: '2026-09-10T10:00:00.000Z',
      setSeeds: [{ reps: 5, weightKg: 100 }],
    });
    const current = await createCompletedSession(db, {
      exerciseId,
      startedAt: '2026-09-17T10:00:00.000Z',
      setSeeds: [{ reps: 5, weightKg: 110 }],
    });

    const excluding = await getPreviousBestE1rm(db, exerciseId, current.sessionId);
    const all = await getPreviousBestE1rm(db, exerciseId, null);

    expect(excluding).toBeCloseTo(epley(100, 5)!, 5);
    expect(all).toBeCloseTo(epley(110, 5)!, 5);
  });

  it('12 tekrar üstü setler e1RM\'e girmiyor', async () => {
    const exerciseId = await seedExercise(db);
    await createCompletedSession(db, {
      exerciseId,
      startedAt: '2026-09-10T10:00:00.000Z',
      setSeeds: [
        { reps: 8, weightKg: 60 },
        { reps: 20, weightKg: 70 },
      ],
    });

    expect(await getPreviousBestE1rm(db, exerciseId, null)).toBeCloseTo(
      epley(60, 8)!,
      5
    );
  });

  it('geçmiş yoksa null', async () => {
    const exerciseId = await seedExercise(db);
    expect(await getPreviousBestE1rm(db, exerciseId, null)).toBeNull();
  });

  it('vücut ağırlığı hareketi (weightKg null) çökmüyor, rekor null', async () => {
    const exerciseId = await seedExercise(db, {
      name: 'Pull-up',
      nameTr: 'Barfiks',
    });
    await createCompletedSession(db, {
      exerciseId,
      startedAt: '2026-09-10T10:00:00.000Z',
      setSeeds: [
        { reps: 10, weightKg: null },
        { reps: 8, weightKg: null },
      ],
    });

    expect(await getPreviousBestE1rm(db, exerciseId, null)).toBeNull();

    const [recent] = await getRecentExerciseRecords(db, 5);
    expect(recent?.exerciseId).toBe(exerciseId);
    expect(recent?.records).toEqual({ e1rm: null, topWeight: null, volume: null });
  });
});

describe('getRecentExerciseRecords', () => {
  it('en son çalışılanlar önce, limit uygulanıyor', async () => {
    const bench = await seedExercise(db, { name: 'Bench Press' });
    const squat = await seedExercise(db, { name: 'Squat', nameTr: 'Squat' });
    const row = await seedExercise(db, { name: 'Row', nameTr: 'Kürek' });

    await createCompletedSession(db, {
      exerciseId: squat,
      startedAt: '2026-09-01T10:00:00.000Z',
      setSeeds: [{ reps: 5, weightKg: 140 }],
    });
    await createCompletedSession(db, {
      exerciseId: bench,
      startedAt: '2026-09-10T10:00:00.000Z',
      setSeeds: [{ reps: 5, weightKg: 100 }],
    });
    await createCompletedSession(db, {
      exerciseId: row,
      startedAt: '2026-09-05T10:00:00.000Z',
      setSeeds: [{ reps: 8, weightKg: 70 }],
    });

    const recent = await getRecentExerciseRecords(db, 2);

    expect(recent.map((r) => r.exerciseId)).toEqual([bench, row]);
    expect(recent[0]!.lastDate).toBe('2026-09-10T10:00:00.000Z');
    expect(recent[1]!.nameTr).toBe('Kürek');
  });

  it('rekorları ve tarihlerini döndürüyor', async () => {
    const bench = await seedExercise(db);
    await createCompletedSession(db, {
      exerciseId: bench,
      startedAt: '2026-09-01T10:00:00.000Z',
      setSeeds: [{ reps: 5, weightKg: 100 }],
    });
    await createCompletedSession(db, {
      exerciseId: bench,
      startedAt: '2026-09-08T10:00:00.000Z',
      setSeeds: [{ reps: 3, weightKg: 90 }],
    });

    const [recent] = await getRecentExerciseRecords(db, 5);

    expect(recent?.lastDate).toBe('2026-09-08T10:00:00.000Z');
    expect(recent?.records.e1rm?.value).toBeCloseTo(epley(100, 5)!, 5);
    expect(recent?.records.e1rm?.date).toBe('2026-09-01T10:00:00.000Z');
  });

  it('yalnızca ısınma seti ya da bitmemiş seans varsa listeye girmiyor', async () => {
    const bench = await seedExercise(db);
    await createCompletedSession(db, {
      exerciseId: bench,
      startedAt: '2026-09-01T10:00:00.000Z',
      setSeeds: [{ reps: 10, weightKg: 40, setType: 'warmup' }],
    });
    await createSession(db, {
      exerciseId: bench,
      startedAt: '2026-09-02T10:00:00.000Z',
      endedAt: null,
      setSeeds: [{ reps: 5, weightKg: 100 }],
    });

    expect(await getRecentExerciseRecords(db, 5)).toEqual([]);
  });
});
