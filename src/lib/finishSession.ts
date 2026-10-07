import { and, eq, inArray } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { sets as setsTable, workoutSessions } from '@/db/schema';

/**
 * Seansı kapatır. Tek transaction: onaylanmamış setlerin akıbeti,
 * boş setlerin silinmesi ve session'ın bitirilmesi ya hep ya hiç.
 *
 * `app/session/active.tsx`'teki bitirme akışından test edilebilsin diye
 * çıkarıldı; adımlar ve sıraları aynı.
 *
 * pendingFilledIds: değer girilmiş ama ✓ ile onaylanmamış setler.
 * mode 'complete' ise bunlar tamamlanmış sayılır, 'delete' ise
 * diğer boş setlerle birlikte silinir.
 *
 * endedAt: verilmezse "şimdi" — normal "Antrenmanı Bitir" (kullanıcı
 * hemen bitiriyor, soğuma da süreye dahil). Yalnızca yarım kalan
 * antrenmanı kurtarma yolu veriyor: bitiş ve süre son tamamlanan sete
 * göre, yoksa günler sonra kapatılan seans günler sürmüş görünür.
 * "Tamamlanmış say" denen setlerin zamanı da bu bitiş oluyor.
 */
export async function finishSessionRecord(
  db: Db,
  args: {
    sessionId: string;
    sessionExerciseIds: string[];
    pendingFilledIds: string[];
    mode: 'complete' | 'delete';
    endedAt?: string;
  }
): Promise<void> {
  const { sessionId, sessionExerciseIds, pendingFilledIds, mode } = args;
  const now = args.endedAt ?? new Date().toISOString();
  const endMs = args.endedAt != null ? new Date(args.endedAt).getTime() : null;

  await db.transaction(async (tx) => {
    const session = await tx
      .select()
      .from(workoutSessions)
      .where(eq(workoutSessions.id, sessionId))
      .limit(1);
    const startedAt = session[0]?.startedAt;
    const durationSeconds = startedAt
      ? endMs != null
        ? Math.max(0, Math.floor((endMs - new Date(startedAt).getTime()) / 1000))
        : Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
      : null;

    // Kullanıcı "tamamlanmış say" dediyse önce bunları onayla ki
    // aşağıdaki silme onlara dokunmasın.
    if (mode === 'complete' && pendingFilledIds.length > 0) {
      await tx
        .update(setsTable)
        .set({ isCompleted: true, completedAt: now })
        .where(inArray(setsTable.id, pendingFilledIds));
    }

    // Geriye kalan onaylanmamış setleri sil (gereksiz kayıt olmasın)
    if (sessionExerciseIds.length > 0) {
      await tx
        .delete(setsTable)
        .where(
          and(
            inArray(setsTable.sessionExerciseId, sessionExerciseIds),
            eq(setsTable.isCompleted, false)
          )
        );
    }

    await tx
      .update(workoutSessions)
      .set({ endedAt: now, durationSeconds })
      .where(eq(workoutSessions.id, sessionId));
  });
}
