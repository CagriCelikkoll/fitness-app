/**
 * Kırılan rekorların geçmişi (v4.0a) — ana sayfa "Son rekor" ve İlerleme
 * "Rekor" kartı aynı kuralı kullanır.
 *
 * Seanslar kronolojik yürünür; her hareketin önceki seanslardaki en iyi
 * e1RM'i baz alınır (`findSessionRecordSetIds`, antrenman ekranındaki rozetle
 * aynı kural; hareketin ilk seansı rekor sayılmaz). Yalnızca bitmiş
 * antrenmanların tamamlanmış normal setleri.
 */

import { and, eq, isNotNull } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { exercises, sessionExercises, sets, workoutSessions } from '@/db/schema';
import { exerciseDisplayName } from '@/lib/exerciseCatalog';
import { epley, findSessionRecordSetIds, type SessionSet } from '@/lib/exerciseProgress';

export interface RecordHistoryRow extends SessionSet {
  exerciseId: string;
  exerciseName: string;
  sessionId: string;
  sessionStartedAt: string;
}

/** Rekor kıran bir set */
export interface RecordEvent {
  sessionId: string;
  /** Seans başlangıcı (ISO) */
  at: string;
  exerciseId: string;
  exerciseName: string;
  weightKg: number;
  reps: number;
  e1rm: number;
}

/** Seans sırasıyla, her seansta rekor kıran setler */
export function recordEvents(rows: readonly RecordHistoryRow[]): RecordEvent[] {
  const sessionsInOrder = new Map<string, { startedAt: string; byExercise: Map<string, RecordHistoryRow[]> }>();
  const sortedRows = [...rows].sort((a, b) =>
    a.sessionStartedAt === b.sessionStartedAt ? 0 : a.sessionStartedAt < b.sessionStartedAt ? -1 : 1
  );
  for (const r of sortedRows) {
    let s = sessionsInOrder.get(r.sessionId);
    if (!s) {
      s = { startedAt: r.sessionStartedAt, byExercise: new Map() };
      sessionsInOrder.set(r.sessionId, s);
    }
    const list = s.byExercise.get(r.exerciseId) ?? [];
    list.push(r);
    s.byExercise.set(r.exerciseId, list);
  }

  const best = new Map<string, number>();
  const events: RecordEvent[] = [];
  for (const [sessionId, s] of sessionsInOrder) {
    for (const [exerciseId, list] of s.byExercise) {
      const prev = best.get(exerciseId) ?? null;
      const ids = findSessionRecordSetIds(list, prev);
      for (const r of list) {
        if (!ids.has(r.id)) continue;
        events.push({
          sessionId,
          at: s.startedAt,
          exerciseId,
          exerciseName: r.exerciseName,
          weightKg: r.weightKg!,
          reps: r.reps!,
          e1rm: epley(r.weightKg, r.reps)!,
        });
      }
      let top = prev;
      for (const r of list) {
        if (!r.isCompleted || r.setType !== 'normal') continue;
        const e = epley(r.weightKg, r.reps);
        if (e != null && (top == null || e > top)) top = e;
      }
      if (top != null) best.set(exerciseId, top);
    }
  }
  return events;
}

/** Bütün bitmiş antrenmanların tamamlanmış normal setleri (Türkçe adla) */
export async function loadRecordHistory(db: Db): Promise<RecordHistoryRow[]> {
  const rows = await db
    .select({
      id: sets.id,
      setNumber: sets.setNumber,
      setType: sets.setType,
      weightKg: sets.weightKg,
      reps: sets.reps,
      isCompleted: sets.isCompleted,
      completedAt: sets.completedAt,
      exerciseId: exercises.id,
      name: exercises.name,
      nameTr: exercises.nameTr,
      sessionId: workoutSessions.id,
      sessionStartedAt: workoutSessions.startedAt,
    })
    .from(sets)
    .innerJoin(sessionExercises, eq(sets.sessionExerciseId, sessionExercises.id))
    .innerJoin(workoutSessions, eq(sessionExercises.sessionId, workoutSessions.id))
    .innerJoin(exercises, eq(sessionExercises.exerciseId, exercises.id))
    .where(and(isNotNull(workoutSessions.endedAt), eq(sets.isCompleted, true), eq(sets.setType, 'normal')));
  return rows.map(({ name, nameTr, ...r }) => ({
    ...r,
    exerciseName: exerciseDisplayName({ id: r.exerciseId, name, nameTr }),
  }));
}
