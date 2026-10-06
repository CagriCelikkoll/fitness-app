/**
 * Not kaydetme: boş not boş string değil `null` saklanmalı, yoksa
 * "not var mı" kontrolleri boş 📝 gösterir.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { sessionExercises, workoutSessions } from '@/db/schema';
import {
  getExerciseSessionNotes,
  normalizeNote,
  saveSessionExerciseNote,
  saveSessionNote,
} from '@/lib/notes';
import {
  createCompletedSession,
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

async function exerciseNote(id: string) {
  const [row] = await db
    .select({ notes: sessionExercises.notes })
    .from(sessionExercises)
    .where(eq(sessionExercises.id, id));
  return row?.notes;
}

async function sessionNote(id: string) {
  const [row] = await db
    .select({ notes: workoutSessions.notes })
    .from(workoutSessions)
    .where(eq(workoutSessions.id, id));
  return row?.notes;
}

describe('normalizeNote', () => {
  it('boş ve yalnızca boşluk null', () => {
    expect(normalizeNote('')).toBeNull();
    expect(normalizeNote('   \n ')).toBeNull();
    expect(normalizeNote(null)).toBeNull();
  });

  it('kenar boşluklarını kırpıyor, içeriği koruyor', () => {
    expect(normalizeNote('  Makine doluydu\ndambılla yaptım  ')).toBe(
      'Makine doluydu\ndambılla yaptım'
    );
  });
});

describe('not kaydetme', () => {
  it('hareket notu yazılıyor, silinince null oluyor', async () => {
    const exerciseId = await seedExercise(db);
    const s = await createCompletedSession(db, {
      exerciseId,
      startedAt: '2026-09-10T10:00:00.000Z',
    });

    await saveSessionExerciseNote(db, s.sessionExerciseId, 'Sol omuz');
    expect(await exerciseNote(s.sessionExerciseId)).toBe('Sol omuz');

    await saveSessionExerciseNote(db, s.sessionExerciseId, '');
    expect(await exerciseNote(s.sessionExerciseId)).toBeNull();
  });

  it('antrenman notu: boş not null saklanıyor', async () => {
    const exerciseId = await seedExercise(db);
    const s = await createCompletedSession(db, {
      exerciseId,
      startedAt: '2026-09-10T10:00:00.000Z',
    });

    await saveSessionNote(db, s.sessionId, 'Bugün yorgundum');
    expect(await sessionNote(s.sessionId)).toBe('Bugün yorgundum');

    await saveSessionNote(db, s.sessionId, '   ');
    expect(await sessionNote(s.sessionId)).toBeNull();
  });
});

describe('getExerciseSessionNotes', () => {
  it('yalnızca not yazılmış seansları, o egzersiz için döndürüyor', async () => {
    const bench = await seedExercise(db, { name: 'Bench' });
    const squat = await seedExercise(db, { name: 'Squat' });
    const withNote = await createCompletedSession(db, {
      exerciseId: bench,
      startedAt: '2026-09-10T10:00:00.000Z',
    });
    await createCompletedSession(db, {
      exerciseId: bench,
      startedAt: '2026-09-12T10:00:00.000Z',
    });
    const otherExercise = await createCompletedSession(db, {
      exerciseId: squat,
      startedAt: '2026-09-11T10:00:00.000Z',
    });
    await saveSessionExerciseNote(db, withNote.sessionExerciseId, 'Ağır geldi');
    await saveSessionExerciseNote(db, otherExercise.sessionExerciseId, 'Diz');

    const notes = await getExerciseSessionNotes(db, bench);

    expect([...notes.entries()]).toEqual([[withNote.sessionId, 'Ağır geldi']]);
  });
});
