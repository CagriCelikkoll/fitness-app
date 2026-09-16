/**
 * Foreign key davranışı.
 *
 * `PRAGMA foreign_keys` kapalıyken cascade hiç çalışmıyordu ve bu bug
 * aylarca fark edilmedi (bkz. commit d530df6). Bu dosya hem pragmanın
 * açık olduğunu hem de şemadaki cascade / restrict / set null kurallarının
 * gerçekten uygulandığını doğruluyor.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import type { Db } from '@/db/client';
import {
  cardioSegments,
  exercises,
  routineExercises,
  routines,
  sessionExercises,
  sets,
  workoutSessions,
} from '@/db/schema';
import {
  countRows,
  createCardioSegment,
  createCompletedSession,
  createRoutine,
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

describe('test ortamı', () => {
  it('foreign_keys pragma açık', () => {
    expect(testDb.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  });
});

describe('seans silme', () => {
  it('session_exercises, sets ve cardio_segments de siliniyor', async () => {
    const exerciseId = await seedExercise(db);
    const { sessionId } = await createCompletedSession(db, {
      exerciseId,
      startedAt: '2026-09-10T10:00:00.000Z',
      setSeeds: [{ reps: 10 }, { reps: 8 }, { reps: 6 }],
    });
    await createCardioSegment(db, { sessionId, exerciseId });

    expect(await countRows(db, sessionExercises)).toBe(1);
    expect(await countRows(db, sets)).toBe(3);
    expect(await countRows(db, cardioSegments)).toBe(1);

    await db.delete(workoutSessions).where(eq(workoutSessions.id, sessionId));

    expect(await countRows(db, workoutSessions)).toBe(0);
    expect(await countRows(db, sessionExercises)).toBe(0);
    expect(await countRows(db, sets)).toBe(0);
    expect(await countRows(db, cardioSegments)).toBe(0);
  });

  it('başka seansın verisine dokunmuyor', async () => {
    const exerciseId = await seedExercise(db);
    const a = await createCompletedSession(db, {
      exerciseId,
      startedAt: '2026-09-10T10:00:00.000Z',
      setSeeds: [{ reps: 10 }],
    });
    await createCompletedSession(db, {
      exerciseId,
      startedAt: '2026-09-12T10:00:00.000Z',
      setSeeds: [{ reps: 8 }, { reps: 8 }],
    });

    await db.delete(workoutSessions).where(eq(workoutSessions.id, a.sessionId));

    expect(await countRows(db, workoutSessions)).toBe(1);
    expect(await countRows(db, sets)).toBe(2);
  });
});

describe('rutin silme', () => {
  it('routine_exercises siliniyor', async () => {
    const exerciseId = await seedExercise(db);
    const { routineId } = await createRoutine(db, { exerciseIds: [exerciseId] });

    expect(await countRows(db, routineExercises)).toBe(1);

    await db.delete(routines).where(eq(routines.id, routineId));

    expect(await countRows(db, routineExercises)).toBe(0);
  });

  it('geçmiş antrenman silinmiyor, routine_id NULL oluyor', async () => {
    const exerciseId = await seedExercise(db);
    const { routineId } = await createRoutine(db, { exerciseIds: [exerciseId] });
    const { sessionId } = await createCompletedSession(db, {
      exerciseId,
      routineId,
      startedAt: '2026-09-10T10:00:00.000Z',
      setSeeds: [{ reps: 10 }],
    });

    await db.delete(routines).where(eq(routines.id, routineId));

    const rows = await db
      .select()
      .from(workoutSessions)
      .where(eq(workoutSessions.id, sessionId));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.routineId).toBeNull();
    // Setler de duruyor — geçmiş kaybolmamalı
    expect(await countRows(db, sets)).toBe(1);
  });
});

describe('egzersiz silme (RESTRICT)', () => {
  it('rutinde kullanılan egzersiz silinemiyor', async () => {
    const exerciseId = await seedExercise(db);
    await createRoutine(db, { exerciseIds: [exerciseId] });

    await expect(
      db.delete(exercises).where(eq(exercises.id, exerciseId))
    ).rejects.toThrow(/FOREIGN KEY constraint failed/i);

    expect(await countRows(db, exercises)).toBe(1);
  });

  it('geçmiş antrenmanda kullanılan egzersiz silinemiyor', async () => {
    const exerciseId = await seedExercise(db);
    await createCompletedSession(db, {
      exerciseId,
      startedAt: '2026-09-10T10:00:00.000Z',
      setSeeds: [{ reps: 10 }],
    });

    await expect(
      db.delete(exercises).where(eq(exercises.id, exerciseId))
    ).rejects.toThrow(/FOREIGN KEY constraint failed/i);
  });

  it('hiçbir yerde kullanılmayan egzersiz silinebiliyor', async () => {
    const exerciseId = await seedExercise(db);

    await db.delete(exercises).where(eq(exercises.id, exerciseId));

    expect(await countRows(db, exercises)).toBe(0);
  });
});
