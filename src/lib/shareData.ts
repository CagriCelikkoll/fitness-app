/**
 * Paylaşım kartının okunması (0.13 Bölüm 3): antrenman özeti + kardiyo
 * bölümleri + hareketlerin kasları (bağlam ışığı). Kart verisi
 * `shareCard.ts`'te (saf).
 */

import { and, eq, sql } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { cardioSegments, exercises, sessionExercises, sets } from '@/db/schema';
import type { ContextExercise } from '@/lib/contextColor';
import { workoutShareCard, type WorkoutShareCard } from '@/lib/shareCard';
import { loadWorkoutSummary } from '@/lib/workoutSummary';

/** Antrenman kartı; seans yoksa null */
export async function loadWorkoutShareCard(db: Db, sessionId: string): Promise<WorkoutShareCard | null> {
  const summary = await loadWorkoutSummary(db, sessionId);
  if (!summary) return null;

  const [cardio] = await db
    .select({
      seconds: sql<number>`coalesce(sum(${cardioSegments.durationSeconds}), 0)`,
      km: sql<number>`coalesce(sum(${cardioSegments.distanceKm}), 0)`,
    })
    .from(cardioSegments)
    .where(eq(cardioSegments.sessionId, sessionId));

  const moves = await db
    .select({
      primaryMuscles: exercises.primaryMuscles,
      category: exercises.category,
      sets: sql<number>`count(${sets.id})`,
    })
    .from(sessionExercises)
    .innerJoin(exercises, eq(sessionExercises.exerciseId, exercises.id))
    .leftJoin(sets, and(eq(sets.sessionExerciseId, sessionExercises.id), eq(sets.isCompleted, true)))
    .where(eq(sessionExercises.sessionId, sessionId))
    .groupBy(sessionExercises.id);

  const contextExercises: ContextExercise[] = moves.map((m) => ({
    primaryMuscles: m.primaryMuscles,
    category: m.category,
    sets: Number(m.sets) || 0,
  }));

  return workoutShareCard({
    name: summary.name,
    durationSeconds: summary.durationSeconds,
    volumeKg: summary.volumeKg,
    completedSets: summary.completedSets,
    records: summary.records,
    cardioSeconds: Number(cardio?.seconds) || 0,
    cardioDistanceKm: Number(cardio?.km) || 0,
    exercises: contextExercises,
  });
}
