/**
 * "Bir önceki antrenmanın ağırlıkları" — auto-fill mantığı.
 *
 * Bir egzersizde yeni set'leri loglarken, kullanıcının en son aynı
 * egzersizi yaptığı seanstaki setleri otomatik doldurulmuş olarak
 * gösterir. Bu, progresif overload takibinin temeli.
 */

import { and, desc, eq, isNotNull, ne } from 'drizzle-orm';
import type { Db } from '@/db/client';
import {
  sessionExercises,
  sets,
  workoutSessions,
  type WorkoutSet,
} from '@/db/schema';

export interface LastSessionData {
  sessionId: string;
  sessionDate: string;
  sets: WorkoutSet[];
}

/**
 * Belirli bir egzersiz için, mevcut seans hariç en son tamamlanmış
 * seanstaki normal setleri döndürür.
 *
 * @param db - Drizzle client
 * @param exerciseId - Egzersizin id'si
 * @param excludeSessionId - Hariç tutulacak (genelde aktif) session id
 */
export async function getLastSessionForExercise(
  db: Db,
  exerciseId: string,
  excludeSessionId: string | null
): Promise<LastSessionData | null> {
  // En son seansı bul (bu egzersizi içeren, bitmiş, mevcut hariç)
  const sessionCondition = excludeSessionId
    ? and(
        ne(workoutSessions.id, excludeSessionId),
        isNotNull(workoutSessions.endedAt)
      )
    : isNotNull(workoutSessions.endedAt);

  const lastSessionRows = await db
    .select({
      sessionId: workoutSessions.id,
      startedAt: workoutSessions.startedAt,
    })
    .from(workoutSessions)
    .innerJoin(
      sessionExercises,
      eq(sessionExercises.sessionId, workoutSessions.id)
    )
    .where(and(eq(sessionExercises.exerciseId, exerciseId), sessionCondition))
    .orderBy(desc(workoutSessions.startedAt))
    .limit(1);

  const lastSession = lastSessionRows[0];
  if (!lastSession) return null;

  // O seansın o egzersizdeki setlerini çek
  const lastSets = await db
    .select({ sets: sets })
    .from(sets)
    .innerJoin(
      sessionExercises,
      eq(sets.sessionExerciseId, sessionExercises.id)
    )
    .where(
      and(
        eq(sessionExercises.sessionId, lastSession.sessionId),
        eq(sessionExercises.exerciseId, exerciseId),
        eq(sets.isCompleted, true),
        eq(sets.setType, 'normal')
      )
    )
    .orderBy(sets.setNumber);

  return {
    sessionId: lastSession.sessionId,
    sessionDate: lastSession.startedAt,
    sets: lastSets.map((r) => r.sets),
  };
}
