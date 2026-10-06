/**
 * Antrenman ve hareket notları.
 *
 * - `workout_sessions.notes`: antrenmanın genel notu (seans detayında)
 * - `session_exercises.notes`: o antrenmanda o hareketin notu (aktif
 *   antrenmanda yazılıyor, sonraki antrenmanda "Son antrenman"da çıkıyor)
 *
 * Boş ya da yalnızca boşluktan oluşan not `null` saklanıyor, boş string
 * değil — "not var mı" kontrolleri tek koşulla yapılabilsin.
 */

import { and, eq, isNotNull } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { sessionExercises, workoutSessions } from '@/db/schema';

/** Kenar boşlukları kırpılmış not; boşsa null */
export function normalizeNote(text: string | null | undefined): string | null {
  const trimmed = (text ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function saveSessionExerciseNote(
  db: Db,
  sessionExerciseId: string,
  text: string
): Promise<void> {
  await db
    .update(sessionExercises)
    .set({ notes: normalizeNote(text) })
    .where(eq(sessionExercises.id, sessionExerciseId));
}

export async function saveSessionNote(
  db: Db,
  sessionId: string,
  text: string
): Promise<void> {
  await db
    .update(workoutSessions)
    .set({ notes: normalizeNote(text) })
    .where(eq(workoutSessions.id, sessionId));
}

/**
 * Bir egzersizin not yazılmış seansları: sessionId → not. Aynı harekete
 * bir seansta birden fazla kez yer verildiyse notlar alt alta birleşiyor.
 */
export async function getExerciseSessionNotes(
  db: Db,
  exerciseId: string
): Promise<Map<string, string>> {
  const rows = await db
    .select({
      sessionId: sessionExercises.sessionId,
      notes: sessionExercises.notes,
    })
    .from(sessionExercises)
    .where(
      and(
        eq(sessionExercises.exerciseId, exerciseId),
        isNotNull(sessionExercises.notes)
      )
    )
    .orderBy(sessionExercises.orderIndex);

  const result = new Map<string, string>();
  for (const row of rows) {
    const note = normalizeNote(row.notes);
    if (!note) continue;
    const existing = result.get(row.sessionId);
    result.set(row.sessionId, existing ? `${existing}\n${note}` : note);
  }
  return result;
}
