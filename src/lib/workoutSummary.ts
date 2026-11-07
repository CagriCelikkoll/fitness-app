import { asc, eq } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { exercises as exercisesTable, sessionExercises, sets as setsTable, workoutSessions } from '@/db/schema';
import { exerciseDisplayName } from './exerciseCatalog';
import { getPreviousBestE1rm } from './exerciseHistory';
import { epley, findSessionRecordSetIds, type SessionSet } from './exerciseProgress';

/**
 * Antrenman özeti (v4.0a, antrenman bitince açılan ekran
 * `app/session/summary.tsx`). Saf hesap `summarizeWorkout`, okuma
 * `loadWorkoutSummary`.
 *
 * - Hacim: tamamlanmış normal setler (ısınma hariç; CLAUDE.md veri kuralı)
 * - Tamamlanan set: bütün tamamlanmış setler
 * - Rekor: aktif ekrandaki 🏆 rozetiyle aynı kural (`findSessionRecordSetIds`,
 *   önceki en iyi e1RM'i kesinlikle aşan set); hareket başına en iyisi
 */

export interface SummaryExercise {
  exerciseId: string;
  name: string;
  sets: SessionSet[];
  /** Bu seans hariç en iyi e1RM; geçmiş yoksa null (ilk seans rekor değil) */
  previousBest: number | null;
}

export interface SummaryRecord {
  exerciseName: string;
  weightKg: number;
  reps: number;
  e1rm: number;
}

export interface WorkoutSummaryData {
  volumeKg: number;
  completedSets: number;
  /** En büyük e1RM önce */
  records: SummaryRecord[];
}

export function summarizeWorkout(exercises: readonly SummaryExercise[]): WorkoutSummaryData {
  let volumeKg = 0;
  let completedSets = 0;
  const records: SummaryRecord[] = [];

  for (const ex of exercises) {
    for (const s of ex.sets) {
      if (!s.isCompleted) continue;
      completedSets += 1;
      if (s.setType === 'normal' && s.weightKg != null && s.reps != null) volumeKg += s.weightKg * s.reps;
    }
    const ids = findSessionRecordSetIds(ex.sets, ex.previousBest);
    let best: SummaryRecord | null = null;
    for (const s of ex.sets) {
      if (!ids.has(s.id) || s.weightKg == null || s.reps == null) continue;
      const e1rm = epley(s.weightKg, s.reps) ?? 0;
      if (!best || e1rm > best.e1rm) best = { exerciseName: ex.name, weightKg: s.weightKg, reps: s.reps, e1rm };
    }
    if (best) records.push(best);
  }

  records.sort((a, b) => b.e1rm - a.e1rm);
  return { volumeKg, completedSets, records };
}

/** "Bench press · 82,5 kg × 6"; birden çok rekorsa "+2 rekor daha" ayrı */
export function recordText(record: SummaryRecord): string {
  return `${record.exerciseName} · ${String(record.weightKg).replace('.', ',')} kg × ${record.reps}`;
}

/** "x / y": planlanan set bilinmiyorsa (ya da daha azsa) tamamlanan */
export function plannedSetCount(completed: number, planned: number | null | undefined): number {
  return planned != null && Number.isFinite(planned) && planned >= completed ? planned : completed;
}

export interface LoadedSummary extends WorkoutSummaryData {
  name: string;
  startedAt: string;
  durationSeconds: number | null;
  notes: string | null;
}

export async function loadWorkoutSummary(db: Db, sessionId: string): Promise<LoadedSummary | null> {
  const session = (await db.select().from(workoutSessions).where(eq(workoutSessions.id, sessionId)).limit(1))[0];
  if (!session) return null;

  const rows = await db
    .select({ se: sessionExercises, exercise: exercisesTable })
    .from(sessionExercises)
    .innerJoin(exercisesTable, eq(sessionExercises.exerciseId, exercisesTable.id))
    .where(eq(sessionExercises.sessionId, sessionId))
    .orderBy(asc(sessionExercises.orderIndex));

  const exercises: SummaryExercise[] = [];
  for (const row of rows) {
    const sets = await db
      .select()
      .from(setsTable)
      .where(eq(setsTable.sessionExerciseId, row.se.id))
      .orderBy(asc(setsTable.setNumber));
    exercises.push({
      exerciseId: row.exercise.id,
      name: exerciseDisplayName(row.exercise),
      sets,
      previousBest: await getPreviousBestE1rm(db, row.exercise.id, sessionId),
    });
  }

  return {
    ...summarizeWorkout(exercises),
    name: session.name,
    startedAt: session.startedAt,
    durationSeconds: session.durationSeconds,
    notes: session.notes,
  };
}
