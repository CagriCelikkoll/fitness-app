/**
 * Rutinden antrenman başlatma (`createSessionFromRoutine`) — gerçek SQLite.
 * Odak: süperset gruplarının `session_exercises`'a aktarılması.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';

import type { Db } from '@/db/client';
import {
  routineExercises,
  sessionExercises,
  sets,
  workoutSessions,
} from '@/db/schema';
import { createSessionFromRoutine } from '@/lib/startSession';
import { createRoutine, createTestDb, seedExercise, type TestDb } from './helpers/testDb';

let t: TestDb;
let db: Db;

beforeEach(() => {
  t = createTestDb();
  db = t.db;
});

afterEach(() => t.close());

async function routineWithGroups(groups: (number | null)[]) {
  const exerciseIds: string[] = [];
  for (let i = 0; i < groups.length; i += 1) {
    exerciseIds.push(await seedExercise(db, { name: `Hareket ${i}` }));
  }
  const { routineId, routineExerciseIds } = await createRoutine(db, { exerciseIds });
  for (let i = 0; i < groups.length; i += 1) {
    await db
      .update(routineExercises)
      .set({ supersetGroup: groups[i] })
      .where(eq(routineExercises.id, routineExerciseIds[i]!));
  }
  return routineId;
}

describe('createSessionFromRoutine', () => {
  it('süperset grupları session_exercises\'a geçiyor', async () => {
    const routineId = await routineWithGroups([1, 1, null, 2, 2]);

    const sessionId = await createSessionFromRoutine(db, { id: routineId, name: 'Push' });
    expect(sessionId).not.toBeNull();

    const rows = await db
      .select({ group: sessionExercises.supersetGroup })
      .from(sessionExercises)
      .where(eq(sessionExercises.sessionId, sessionId!))
      .orderBy(asc(sessionExercises.orderIndex));
    expect(rows.map((r) => r.group)).toEqual([1, 1, null, 2, 2]);
  });

  it('seans ve hedef set sayısı kadar boş set oluşuyor', async () => {
    const routineId = await routineWithGroups([null, null]);
    const sessionId = await createSessionFromRoutine(db, { id: routineId, name: 'Push' });

    const session = await db
      .select()
      .from(workoutSessions)
      .where(eq(workoutSessions.id, sessionId!));
    expect(session[0]).toMatchObject({ routineId, name: 'Push', endedAt: null });

    const allSets = await db.select().from(sets);
    // createRoutine hedefi 3 set
    expect(allSets).toHaveLength(6);
    expect(allSets.every((s) => !s.isCompleted && s.setType === 'normal')).toBe(true);
  });

  it('boş rutinde seans oluşmuyor', async () => {
    const { routineId } = await createRoutine(db);
    expect(await createSessionFromRoutine(db, { id: routineId, name: 'Boş' })).toBeNull();
    expect(await db.select().from(workoutSessions)).toHaveLength(0);
  });
});
