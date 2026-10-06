import { asc, eq } from 'drizzle-orm';

import type { Db } from '@/db/client';
import {
  routineExercises,
  sessionExercises,
  sets,
  workoutSessions,
} from '@/db/schema';
import { newId } from '@/lib/id';

/**
 * Rutinden yeni antrenman oluşturur: seans satırı, hareketlerin
 * `session_exercises` snapshot'ı (süperset grupları dahil) ve her hareket
 * için hedef set sayısı kadar boş normal set.
 *
 * `app/(tabs)/workout.tsx`'ten test edilebilsin diye çıkarıldı; adımlar
 * ve sıraları aynı.
 *
 * @returns yeni seans id'si; rutinde hareket yoksa null (seans oluşmaz)
 */
export async function createSessionFromRoutine(
  db: Db,
  routine: { id: string; name: string }
): Promise<string | null> {
  // Rutindeki egzersizleri çek
  const exercisesInRoutine = await db
    .select()
    .from(routineExercises)
    .where(eq(routineExercises.routineId, routine.id))
    .orderBy(asc(routineExercises.orderIndex));

  if (exercisesInRoutine.length === 0) return null;

  // Yeni session oluştur
  const sessionId = newId();
  await db.insert(workoutSessions).values({
    id: sessionId,
    routineId: routine.id,
    name: routine.name,
    startedAt: new Date().toISOString(),
  });

  // Rutindeki egzersizleri session_exercises'e snapshot et
  const sessionExerciseRows = exercisesInRoutine.map((re, idx) => ({
    id: newId(),
    sessionId,
    exerciseId: re.exerciseId,
    orderIndex: idx,
    supersetGroup: re.supersetGroup,
  }));
  await db.insert(sessionExercises).values(sessionExerciseRows);

  // Her egzersiz için target_sets kadar boş "normal" set oluştur (kullanıcı doldurur)
  const allSets: (typeof sets.$inferInsert)[] = [];
  exercisesInRoutine.forEach((re, exIdx) => {
    const targetSets = re.targetSets ?? 3;
    for (let i = 0; i < targetSets; i++) {
      allSets.push({
        id: newId(),
        sessionExerciseId: sessionExerciseRows[exIdx].id,
        setNumber: i + 1,
        setType: 'normal',
        weightKg: re.targetWeightKg,
        reps: null,
        isCompleted: false,
      });
    }
  });
  if (allSets.length > 0) {
    await db.insert(sets).values(allSets);
  }

  return sessionId;
}
