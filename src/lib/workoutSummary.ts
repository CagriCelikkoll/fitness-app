import { asc, eq, getTableColumns } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { exercises as exercisesTable, sessionExercises, sets as setsTable, workoutSessions } from '@/db/schema';
import { exerciseDisplayName } from './exerciseCatalog';
import type { SessionSet } from './exerciseProgress';
import {
  bestsBeforeSession,
  compareRecords,
  findSetRecords,
  loadRecordHistory,
  recordPageFrom,
  topSetRecord,
  type ExerciseBest,
  type RecordPageData,
  type SetRecord,
} from './recordEvents';
import { effectiveDurationSql } from './sessionDuration';

/**
 * Antrenman özeti (v4.0a, antrenman bitince açılan ekran
 * `app/session/summary.tsx`). Saf hesap `summarizeWorkout`, okuma
 * `loadWorkoutSummary`.
 *
 * - Hacim: tamamlanmış normal setler (ısınma hariç; CLAUDE.md veri kuralı)
 * - Tamamlanan set: bütün tamamlanmış setler
 * - Rekor (0.13): `recordEvents.ts`'teki tek kural (`findSetRecords`; en
 *   ağır kilo ve tahmini 1RM). Önceki en iyiler bu seanstan önceki bitmiş
 *   antrenmanlardan (`bestsBeforeSession`); hareket başına asıl rekor.
 */

export interface SummaryExercise {
  exerciseId: string;
  name: string;
  sets: SessionSet[];
  /** Bu seanstan önceki en iyiler; null: hareketin ilk antrenmanı (rekor yok) */
  previous: ExerciseBest | null;
}

export interface SummaryRecord extends Omit<SetRecord, 'setId'> {
  exerciseName: string;
}

export interface WorkoutSummaryData {
  volumeKg: number;
  completedSets: number;
  /** Hareket başına asıl rekor; en büyüğü önce (`compareRecords`) */
  records: SummaryRecord[];
}

export function summarizeWorkout(exercises: readonly SummaryExercise[]): WorkoutSummaryData {
  let volumeKg = 0;
  let completedSets = 0;

  // Aynı hareket seansta iki kez eklenmişse setleri birlikte (geçmişteki gibi)
  const byExercise = new Map<string, { name: string; sets: SessionSet[]; previous: ExerciseBest | null }>();
  for (const ex of exercises) {
    for (const s of ex.sets) {
      if (!s.isCompleted) continue;
      completedSets += 1;
      if (s.setType === 'normal' && s.weightKg != null && s.reps != null) volumeKg += s.weightKg * s.reps;
    }
    const group = byExercise.get(ex.exerciseId);
    if (group) group.sets.push(...ex.sets);
    else byExercise.set(ex.exerciseId, { name: ex.name, sets: [...ex.sets], previous: ex.previous });
  }

  const records: SummaryRecord[] = [];
  for (const g of byExercise.values()) {
    const top = topSetRecord(findSetRecords(g.sets, g.previous));
    if (top) {
      const { setId: _setId, ...rest } = top;
      records.push({ ...rest, exerciseName: g.name });
    }
  }
  records.sort(compareRecords);
  return { volumeKg, completedSets, records };
}

/**
 * Rekor sayfası özetin rekorlarından: özet kartındaki "Yeni rekor" ile
 * sayfa aynı veriden çıkar. Rekor yoksa null.
 */
export function summaryRecordPage(records: readonly SummaryRecord[]): RecordPageData | null {
  return recordPageFrom(records);
}

/** "Bench press · 82,5 kg × 6"; birden çok rekorsa "+2 rekor daha" ayrı */
export function recordText(record: Pick<SummaryRecord, 'exerciseName' | 'weightKg' | 'reps'>): string {
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
  const session = (
    await db
      .select({ ...getTableColumns(workoutSessions), durationSeconds: effectiveDurationSql })
      .from(workoutSessions)
      .where(eq(workoutSessions.id, sessionId))
      .limit(1)
  )[0];
  if (!session) return null;

  const rows = await db
    .select({ se: sessionExercises, exercise: exercisesTable })
    .from(sessionExercises)
    .innerJoin(exercisesTable, eq(sessionExercises.exerciseId, exercisesTable.id))
    .where(eq(sessionExercises.sessionId, sessionId))
    .orderBy(asc(sessionExercises.orderIndex));

  const previous = bestsBeforeSession(await loadRecordHistory(db), sessionId);

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
      previous: previous.get(row.exercise.id) ?? null,
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
