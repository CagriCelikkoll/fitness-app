/**
 * Eşitleme durumu — yerel taraf (v3.1a). Ağ yok; motor v3.1b'de.
 *
 * Değişiklikler `drizzle/0001_sync.sql`'deki trigger'larla `sync_outbox`'a
 * yazılıyor. Trigger'lar yalnızca `sync_state.tracking = 1` ve
 * `suppress = 0` iken çalışıyor:
 *
 * - `tracking` varsayılan 0: eşitleme hiç açılmamış telefonda giden
 *   kutusu hep boş, davranış eskisiyle aynı.
 * - `suppress`: sıfırlama, geri yükleme ve (motorda) sunucudan gelen
 *   verinin uygulanması sırasında 1. Toplu silme buluta gitmesin, çekilen
 *   satırlar geri gönderilmesin (yankı).
 *
 * `suppress` yalnızca bir transaction içinde açılıyor: işlem hata verirse
 * rollback bayrağı da geri alıyor, açık kalamıyor.
 *
 * Ayrıntı: docs/sync-tasarim.md.
 */

import { eq, inArray, isNull } from 'drizzle-orm';

import type { Db } from '@/db/client';
import {
  cardioSegments,
  sessionExercises,
  sets,
  syncOutbox,
  syncState,
  workoutSessions,
  type SyncState,
} from '@/db/schema';

/** db.transaction'ın callback'ine verdiği işlem nesnesi */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const STATE_ID = 1;

export async function readSyncState(db: Db | Tx): Promise<SyncState | null> {
  const rows = await db.select().from(syncState).where(eq(syncState.id, STATE_ID)).limit(1);
  return rows[0] ?? null;
}

/**
 * `fn` süresince trigger'ları susturur. Transaction içinden çağrılmalı
 * (`tx`), bayrak işlemle birlikte geri alınabilsin.
 */
export async function withSyncSuppressed<T>(tx: Tx, fn: () => Promise<T>): Promise<T> {
  await tx.update(syncState).set({ suppress: true }).where(eq(syncState.id, STATE_ID));
  const result = await fn();
  await tx.update(syncState).set({ suppress: false }).where(eq(syncState.id, STATE_ID));
  return result;
}

/**
 * Yerel veri toptan değişti (geri yükleme, sıfırlama). Giden kutusu
 * boşaltılır: içindeki kayıtların satırları artık yok ya da başka, motor
 * bunları "silindi" diye buluta gönderirdi.
 *
 * Bunun yerine tam tarama ve tam çekme yeniden açılır:
 * - `initialUploadDone = false`: yerelde ne varsa (geri yüklenen yedek)
 *   tablolar taranarak yeniden yüklenir; buluttaki hiçbir şey silinmez.
 * - `pullCursor = null`: buluttaki her şey yeniden iner. Sonuç: yedek ile
 *   bulut birleşir.
 *
 * Sıfırlamada (`releaseOwner`) telefondaki verinin sahibi de bırakılır:
 * telefon boş, giren hesap ilk eşitlemeyle kendi verisini indirir.
 */
export async function resetAfterLocalReplace(
  tx: Tx,
  options: { releaseOwner: boolean }
): Promise<void> {
  await tx.delete(syncOutbox);
  await tx
    .update(syncState)
    .set({
      initialUploadDone: false,
      pullCursor: null,
      ...(options.releaseOwner ? { ownerUserId: null } : {}),
    })
    .where(eq(syncState.id, STATE_ID));
}

/**
 * Değişiklik takibini açar (motor ilk eşitlemede çağıracak; bu turda
 * yalnızca testler kullanıyor).
 *
 * Mevcut geçmiş giden kutusuna yazılmaz: ilk gönderim tabloları tarar
 * (`initialUploadDone = false`). Tek istisna o an yarım olan antrenman:
 * tarama onu atlıyor, satırları antrenman bitince giden kutusundan
 * gitmeli. Bu yüzden onun ağacı `session_id` ile kutuya konuyor; yarım
 * antrenman silinirse kayıtları da trigger ile atılıyor.
 */
export async function startTracking(db: Db, ownerUserId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(syncState)
      .set({ tracking: true, suppress: false, ownerUserId, initialUploadDone: false, pullCursor: null })
      .where(eq(syncState.id, STATE_ID));

    const open = await tx
      .select({ id: workoutSessions.id })
      .from(workoutSessions)
      .where(isNull(workoutSessions.endedAt));
    const sessionIds = open.map((s) => s.id);
    if (sessionIds.length === 0) return;

    const now = new Date().toISOString();
    const ses = await tx
      .select({ id: sessionExercises.id, sessionId: sessionExercises.sessionId })
      .from(sessionExercises)
      .where(inArray(sessionExercises.sessionId, sessionIds));
    const setRows =
      ses.length === 0
        ? []
        : await tx
            .select({ id: sets.id, sessionExerciseId: sets.sessionExerciseId })
            .from(sets)
            .where(
              inArray(
                sets.sessionExerciseId,
                ses.map((s) => s.id)
              )
            );
    const cardio = await tx
      .select({ id: cardioSegments.id, sessionId: cardioSegments.sessionId })
      .from(cardioSegments)
      .where(inArray(cardioSegments.sessionId, sessionIds));

    const sessionOf = new Map(ses.map((s) => [s.id, s.sessionId]));
    const entries = [
      ...sessionIds.map((id) => ({ tableName: 'workout_sessions', rowId: id, sessionId: id })),
      ...ses.map((s) => ({ tableName: 'session_exercises', rowId: s.id, sessionId: s.sessionId })),
      ...setRows.map((s) => ({
        tableName: 'sets',
        rowId: s.id,
        sessionId: sessionOf.get(s.sessionExerciseId) ?? null,
      })),
      ...cardio.map((c) => ({ tableName: 'cardio_segments', rowId: c.id, sessionId: c.sessionId })),
    ].map((e) => ({ ...e, changedAt: now }));

    // 4 sütun: 200'lük parti SQLite'ın parametre sınırının altında
    for (let i = 0; i < entries.length; i += 200) {
      await tx
        .insert(syncOutbox)
        .values(entries.slice(i, i + 200))
        .onConflictDoNothing();
    }
  });
}
