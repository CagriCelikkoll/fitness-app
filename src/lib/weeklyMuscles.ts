/**
 * "Bu hafta neyi ne kadar çalıştırdım?" — İlerleme sekmesindeki kas
 * haritasının verisi.
 */

import { and, eq, gte, isNotNull } from 'drizzle-orm';
import type { Db } from '@/db/client';
import {
  exercises,
  sessionExercises,
  sets,
  workoutSessions,
} from '@/db/schema';
import { parseMuscles } from '@/lib/exerciseTaxonomy';

export const WEEKLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Pencerenin başlangıcı (ISO) — `endedAt` ile metin olarak karşılaştırılıyor */
export function weeklyWindowStart(now: Date): string {
  return new Date(now.getTime() - WEEKLY_WINDOW_MS).toISOString();
}

/**
 * `since` sonrasında biten seansların tamamlanmış normal setleri, her
 * satır bir set. Isınma/drop gibi setler ve bitmemiş seanslar hacme
 * girmiyor.
 */
export function weeklyMuscleSetsQuery(db: Db, since: string) {
  return db
    .select({
      primaryMuscles: exercises.primaryMuscles,
      secondaryMuscles: exercises.secondaryMuscles,
    })
    .from(sets)
    .innerJoin(sessionExercises, eq(sets.sessionExerciseId, sessionExercises.id))
    .innerJoin(workoutSessions, eq(sessionExercises.sessionId, workoutSessions.id))
    .innerJoin(exercises, eq(sessionExercises.exerciseId, exercises.id))
    .where(
      and(
        isNotNull(workoutSessions.endedAt),
        gte(workoutSessions.endedAt, since),
        eq(sets.isCompleted, true),
        eq(sets.setType, 'normal')
      )
    );
}

/** Sorgu satırlarındaki JSON kas metinlerini `muscleVolume` girdisine çevirir */
export function toMuscleSets(
  rows: { primaryMuscles: string; secondaryMuscles: string | null }[]
): { primaryMuscles: string[]; secondaryMuscles: string[] }[] {
  return rows.map((r) => ({
    primaryMuscles: parseMuscles(r.primaryMuscles),
    secondaryMuscles: parseMuscles(r.secondaryMuscles),
  }));
}
