/**
 * Set yazımları (v4.0a, `active.tsx`'ten ayrıldı) ve antrenman özeti —
 * gerçek SQLite. RIR seçiminin kaydı dahil.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { sets } from '@/db/schema';
import {
  completeSetRecord,
  parseSetInput,
  saveSetReps,
  saveSetRir,
  saveSetWeight,
  uncompleteSetRecord,
} from '@/lib/setCompletion';
import { loadWorkoutSummary, plannedSetCount, recordText, summarizeWorkout } from '@/lib/workoutSummary';
import { createCompletedSession, createSession, createTestDb, seedExercise, type TestDb } from './helpers/testDb';

let t: TestDb;
let db: Db;

beforeEach(() => {
  t = createTestDb();
  db = t.db;
});

afterEach(() => t.close());

async function readSet(id: string) {
  return (await db.select().from(sets).where(eq(sets.id, id)))[0]!;
}

describe('set yazımları', () => {
  it('girdi: ağırlık ve tekrar sayı olmalı (virgül de olur)', () => {
    expect(parseSetInput('72,5', '8')).toEqual({ weightKg: 72.5, reps: 8 });
    expect(parseSetInput('', '8')).toBeNull();
    expect(parseSetInput('70', '')).toBeNull();
  });

  it('tamamla → değerler ve zaman yazılır; geri al → değerler kalır', async () => {
    const exerciseId = await seedExercise(db);
    const { setIds } = await createSession(db, {
      exerciseId,
      startedAt: '2026-11-07T10:00:00.000Z',
      setSeeds: [{ isCompleted: false, reps: undefined, weightKg: null }],
    });
    const id = setIds[0]!;
    await completeSetRecord(db, id, { weightKg: 70, reps: 8 }, '2026-11-07T10:05:00.000Z');
    expect(await readSet(id)).toMatchObject({
      weightKg: 70,
      reps: 8,
      isCompleted: true,
      completedAt: '2026-11-07T10:05:00.000Z',
    });
    await uncompleteSetRecord(db, id);
    expect(await readSet(id)).toMatchObject({ weightKg: 70, reps: 8, isCompleted: false, completedAt: null });
  });

  it('yazarken: boş / geçersiz → null', async () => {
    const exerciseId = await seedExercise(db);
    const { setIds } = await createSession(db, {
      exerciseId,
      startedAt: '2026-11-07T10:00:00.000Z',
      setSeeds: [{ isCompleted: false }],
    });
    const id = setIds[0]!;
    await saveSetWeight(db, id, '82,5');
    await saveSetReps(db, id, '6');
    expect(await readSet(id)).toMatchObject({ weightKg: 82.5, reps: 6 });
    await saveSetWeight(db, id, '');
    await saveSetReps(db, id, '');
    expect(await readSet(id)).toMatchObject({ weightKg: null, reps: null });
  });

  it('RIR seçimi kaydedilir, ikinci dokunuşla kalkar (isteğe bağlı)', async () => {
    const exerciseId = await seedExercise(db);
    const { setIds } = await createSession(db, {
      exerciseId,
      startedAt: '2026-11-07T10:00:00.000Z',
      setSeeds: [{}],
    });
    const id = setIds[0]!;
    expect((await readSet(id)).rir).toBeNull();
    await saveSetRir(db, id, 2);
    expect((await readSet(id)).rir).toBe(2);
    await saveSetRir(db, id, 4);
    expect((await readSet(id)).rir).toBe(4);
    await saveSetRir(db, id, null);
    expect((await readSet(id)).rir).toBeNull();
  });
});

describe('antrenman özeti', () => {
  const s = (id: string, weightKg: number, reps: number, extra: Partial<{ isCompleted: boolean; setType: string; completedAt: string }> = {}) => ({
    id,
    setNumber: Number(id.replace(/\D/g, '')) || 1,
    setType: 'normal',
    weightKg,
    reps,
    isCompleted: true,
    completedAt: `2026-11-07T10:0${Number(id.replace(/\D/g, '')) || 1}:00.000Z`,
    ...extra,
  });

  it('hacim (ısınma hariç), tamamlanan set, rekor (önceki en iyiyi aşan)', () => {
    const data = summarizeWorkout([
      {
        exerciseId: 'bench',
        name: 'Bench press',
        previousBest: 90, // 80 × 6 ≈ 96 > 90 → rekor
        sets: [s('b1', 80, 6), s('b2', 40, 10, { setType: 'warmup' }), s('b3', 80, 4, { isCompleted: false })],
      },
      { exerciseId: 'row', name: 'Barbell row', previousBest: null, sets: [s('r1', 70, 8)] },
    ]);
    expect(data.volumeKg).toBe(80 * 6 + 70 * 8);
    expect(data.completedSets).toBe(3);
    expect(data.records).toHaveLength(1);
    expect(data.records[0]).toMatchObject({ exerciseName: 'Bench press', weightKg: 80, reps: 6 });
    expect(recordText(data.records[0]!)).toBe('Bench press · 80 kg × 6');
  });

  it('rekor yoksa liste boş (kart çıkmaz); ilk seans rekor sayılmaz', () => {
    expect(summarizeWorkout([{ exerciseId: 'x', name: 'X', previousBest: null, sets: [s('x1', 100, 5)] }]).records).toEqual([]);
    expect(summarizeWorkout([{ exerciseId: 'x', name: 'X', previousBest: 200, sets: [s('x1', 100, 5)] }]).records).toEqual([]);
  });

  it('x / y: planlanan set bilinmiyorsa tamamlanan', () => {
    expect(plannedSetCount(9, 12)).toBe(12);
    expect(plannedSetCount(9, null)).toBe(9);
    expect(plannedSetCount(9, 5)).toBe(9);
  });

  it('veritabanından: önceki seansa göre rekor', async () => {
    const exerciseId = await seedExercise(db, { name: 'Bench Press', nameTr: 'Bench press' });
    await createCompletedSession(db, {
      exerciseId,
      startedAt: '2026-11-01T10:00:00.000Z',
      setSeeds: [{ weightKg: 70, reps: 8 }],
    });
    const { sessionId } = await createCompletedSession(db, {
      exerciseId,
      startedAt: '2026-11-07T10:00:00.000Z',
      setSeeds: [{ weightKg: 75, reps: 8 }, { weightKg: 70, reps: 8 }],
    });
    const summary = await loadWorkoutSummary(db, sessionId);
    expect(summary).toMatchObject({ name: 'Antrenman', completedSets: 2, volumeKg: 75 * 8 + 70 * 8 });
    expect(summary!.records.map(recordText)).toEqual(['Bench press · 75 kg × 8']);
    expect(await loadWorkoutSummary(db, 'yok')).toBeNull();
  });
});
