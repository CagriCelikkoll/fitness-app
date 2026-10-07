/**
 * Yarım kalan antrenmanı kurtarma.
 *
 * Aktif seans id'si yalnızca `activeWorkoutStore`'da (bellekte) duruyor.
 * Kullanıcı dinlenirken telefonu kilitler, Android de arka plandaki
 * uygulamayı kapatırsa yeniden açılışta store boş gelir: "Devam eden
 * antrenman" bandı kaybolur, `endedAt`'i boş seans geçmişte de görünmez
 * (geçmiş yalnızca bitmiş seansları listeliyor). Seans veritabanında
 * duruyor ama ulaşılamıyor.
 *
 * Açılışta, store'da aktif seans yokken en son yarım seansa bakılıyor:
 * - son hareketten bu yana 12 saatten az geçtiyse sessizce geri yüklenir
 * - 12 saat ile 3 gün arasıysa kullanıcıya sorulur (Devam et / Bitir / Sil)
 * - daha eskiyse soru çıkmaz. Eski uygulamadan yedekle geçen kullanıcının
 *   haftalardır görünmez kalmış yarım seansları var; ilk açılışta onlar
 *   için soru çıkması kafa karıştırırdı. Hepsi Ayarlar'daki "Yarım kalan
 *   antrenmanlar" bölümünde listeleniyor.
 * Birden fazla yarım seans varsa yalnızca en yenisi ele alınır; eskilere
 * dokunulmaz.
 *
 * Hiç hareketi olmayan (kullanıcı verisi taşımayan) 12 saatten eski yarım
 * seanslar açılışta sessizce siliniyor.
 *
 * Dinlenme sayacı kv-store'da tutuluyor (seans id + başlangıç + süre);
 * sessiz geri yüklemede sayaç hâlâ sürüyorsa o da geri gelir.
 */

import { and, count, desc, eq, inArray, isNull, max, notExists, sql } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { cardioSegments, sessionExercises, sets, workoutSessions } from '@/db/schema';
import type { RemovableKeyValueStore } from '@/lib/weeklyGoal';

// ============================================================================
// Karar (saf)
// ============================================================================

/** Bu kadar yeni yarım seans sormadan geri yüklenir */
export const SILENT_RESUME_MAX_MS = 12 * 60 * 60 * 1000;

/** Bundan eski yarım seans için açılışta soru çıkmaz (yalnızca Ayarlar'da) */
export const ASK_MAX_MS = 3 * 24 * 60 * 60 * 1000;

export interface OpenSession {
  id: string;
  /** Rutin adı (seans başlarken kopyalanıyor) */
  name: string;
  startedAt: string;
  /** Son tamamlanan setin zamanı; hiç set tamamlanmadıysa null */
  lastSetAt: string | null;
  completedSetCount: number;
}

export type SessionRecoveryDecision =
  | { kind: 'none' }
  | { kind: 'resume'; sessionId: string }
  | { kind: 'ask'; session: OpenSession };

/** ISO metni ms'ye; okunamazsa null */
function parseMs(iso: string | null): number | null {
  if (iso == null) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Seansın son hareket zamanı: başlangıç ile son tamamlanan setin
 * büyüğü. Uzun süren bir antrenman başlangıcına göre "eski" sayılmasın.
 * İkisi de okunamazsa null.
 */
export function lastActivityMs(session: OpenSession): number | null {
  const started = parseMs(session.startedAt);
  const lastSet = parseMs(session.lastSetAt);
  if (started == null) return lastSet;
  if (lastSet == null) return started;
  return Math.max(started, lastSet);
}

/** En son hareket edilen seans önde; eşitlikte id sırası (kararlı) */
function newestFirst(sessions: OpenSession[]): OpenSession[] {
  return [...sessions].sort((a, b) => {
    const diff = (lastActivityMs(b) ?? -Infinity) - (lastActivityMs(a) ?? -Infinity);
    if (diff !== 0) return diff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Açılışta ne yapılacağı.
 *
 * - Store'da zaten aktif seans varsa (uygulama kapanmamış) dokunulmaz.
 * - Yarım seans yoksa bir şey yapılmaz.
 * - En yeni yarım seans 12 saatten yeniyse sessizce geri yüklenir.
 *   Saat ileri/geri alındıysa (son hareket gelecekte) yeni sayılır.
 * - 12 saat ile 3 gün arasıysa sorulur.
 * - Daha eskiyse ya da zamanı okunamıyorsa bir şey yapılmaz; Ayarlar'da
 *   listeleniyor. En yenisi eskiyse daha eskiler de eskidir.
 */
export function decideSessionRecovery(input: {
  activeSessionId: string | null;
  openSessions: OpenSession[];
  nowMs: number;
}): SessionRecoveryDecision {
  if (input.activeSessionId != null) return { kind: 'none' };

  const newest = newestFirst(input.openSessions)[0];
  if (!newest) return { kind: 'none' };

  const last = lastActivityMs(newest);
  if (last == null) return { kind: 'none' };
  const age = input.nowMs - last;
  if (age < SILENT_RESUME_MAX_MS) return { kind: 'resume', sessionId: newest.id };
  if (age < ASK_MAX_MS) return { kind: 'ask', session: newest };
  return { kind: 'none' };
}

/**
 * Bitirilebilir mi: hiç tamamlanmış seti olmayan seansı bitirmek geçmişe
 * boş bir antrenman ekler; onun yerine silme öneriliyor.
 */
export function canFinishOpenSession(session: OpenSession): boolean {
  return session.completedSetCount > 0;
}

/**
 * Kurtarılan seansın bitiş zamanı: son tamamlanan set. Set zamanı yoksa
 * (eski sürümlerden gelen veri) başlangıç; süre 0 olur ama günler sürmüş
 * görünmez.
 */
export function recoveryEndedAt(session: OpenSession): string {
  return session.lastSetAt ?? session.startedAt;
}

// ============================================================================
// Boş seanslar (saf karar)
// ============================================================================

export interface EmptySessionCandidate {
  id: string;
  startedAt: string;
  notes: string | null;
}

/**
 * Hareketsiz yarım seans silinebilir mi: notu yoksa ve 12 saatten
 * eskiyse. Başlangıcı okunamıyorsa ya da gelecekteyse silinmez —
 * emin olunamayan veri silinmiyor.
 */
export function isDisposableEmptySession(
  session: EmptySessionCandidate,
  nowMs: number
): boolean {
  if (session.notes != null && session.notes.trim() !== '') return false;
  const started = parseMs(session.startedAt);
  if (started == null) return false;
  return nowMs - started >= SILENT_RESUME_MAX_MS;
}

// ============================================================================
// Sorgular
// ============================================================================

/**
 * `endedAt`'i boş, en az bir hareketi olan seanslar.
 *
 * Hareketsiz seans kurtarılmıyor: aktif ekran onda "Bu seansta egzersiz
 * yok" deyip bitir düğmesi göstermiyor, kullanıcı içinde kalırdı. Böyle
 * seans ancak transaction'sız eski başlatmanın yarıda kalmasıyla oluşmuş
 * olabilir; `deleteStaleEmptySessions` temizliyor.
 *
 * En yeni başlangıç önde (Ayarlar'daki liste bu sırayla).
 */
export async function findOpenSessions(db: Db): Promise<OpenSession[]> {
  const rows = await db
    .select({
      id: workoutSessions.id,
      name: workoutSessions.name,
      startedAt: workoutSessions.startedAt,
      lastSetAt: max(sets.completedAt),
      // Join yalnızca tamamlanmış setleri alıyor; count(null) sayılmaz
      completedSetCount: count(sets.id),
    })
    .from(workoutSessions)
    .innerJoin(sessionExercises, eq(sessionExercises.sessionId, workoutSessions.id))
    .leftJoin(
      sets,
      and(eq(sets.sessionExerciseId, sessionExercises.id), eq(sets.isCompleted, true))
    )
    .where(isNull(workoutSessions.endedAt))
    .groupBy(workoutSessions.id)
    .orderBy(desc(workoutSessions.startedAt));

  return rows.map(({ id, name, startedAt, lastSetAt, completedSetCount }) => ({
    id,
    name,
    startedAt,
    lastSetAt: lastSetAt ?? null,
    completedSetCount,
  }));
}

/**
 * Yarım seansı siler. Hareketleri ve setleri cascade ile gidiyor
 * (geçmişteki "Antrenmanı Sil" ile aynı).
 */
export async function discardSession(db: Db, sessionId: string): Promise<void> {
  await db.delete(workoutSessions).where(eq(workoutSessions.id, sessionId));
}

/** Seansın hareketi de kardiyo bölümü de yok (alt sorgu koşulları) */
const hasNoContent = () =>
  and(
    notExists(
      sql`(select 1 from ${sessionExercises} where ${sessionExercises.sessionId} = ${workoutSessions.id})`
    ),
    notExists(
      sql`(select 1 from ${cardioSegments} where ${cardioSegments.sessionId} = ${workoutSessions.id})`
    )
  );

/**
 * Hareketsiz, kardiyosuz, notsuz ve 12 saatten eski yarım seansları siler
 * (bkz. `isDisposableEmptySession`). Kullanıcı verisi taşımıyorlar.
 * Bitmiş seanslara dokunulmuyor: onlar geçmişte ve takvimde görünüyor.
 * `keepSessionId` (aktif seans) hiçbir durumda silinmez.
 *
 * @returns silinen seans sayısı
 */
export async function deleteStaleEmptySessions(
  db: Db,
  nowMs: number,
  keepSessionId: string | null = null
): Promise<number> {
  const candidates = await db
    .select({
      id: workoutSessions.id,
      startedAt: workoutSessions.startedAt,
      notes: workoutSessions.notes,
    })
    .from(workoutSessions)
    .where(and(isNull(workoutSessions.endedAt), hasNoContent()));

  const ids = candidates
    .filter((c) => c.id !== keepSessionId && isDisposableEmptySession(c, nowMs))
    .map((c) => c.id);
  if (ids.length === 0) return 0;

  // Koşullar silmede de tekrar: arada hareket eklenmişse dokunulmasın
  const deleted = await db
    .delete(workoutSessions)
    .where(
      and(
        inArray(workoutSessions.id, ids),
        isNull(workoutSessions.endedAt),
        hasNoContent()
      )
    )
    .returning({ id: workoutSessions.id });
  return deleted.length;
}

// ============================================================================
// Dinlenme sayacının kalıcılığı (kv-store)
// ============================================================================

/** kv-store anahtarı. Değiştirme: kayıtlı sayaç okunamaz. */
export const SAVED_REST_TIMER_KEY = 'activeWorkout.restTimer';

export interface SavedRestTimer {
  sessionId: string;
  startedAt: number;
  durationSeconds: number;
}

export function parseSavedRestTimer(raw: string | null): SavedRestTimer | null {
  if (raw == null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value == null) return null;
    const { sessionId, startedAt, durationSeconds } = value as Record<string, unknown>;
    if (
      typeof sessionId !== 'string' ||
      typeof startedAt !== 'number' ||
      !Number.isFinite(startedAt) ||
      typeof durationSeconds !== 'number' ||
      !Number.isFinite(durationSeconds) ||
      durationSeconds <= 0
    ) {
      return null;
    }
    return { sessionId, startedAt, durationSeconds };
  } catch {
    return null;
  }
}

/**
 * Geri yüklenen seansın sayacı hâlâ sürüyor mu. Başka seansın sayacı,
 * bitmiş ya da en az 1 sn kalmamış sayaç geri gelmez (gelir gelmez
 * biten sayaç boşuna titreşir).
 */
export function restorableRestTimer(
  saved: SavedRestTimer | null,
  sessionId: string,
  nowMs: number
): { startedAt: number; durationSeconds: number } | null {
  if (saved == null || saved.sessionId !== sessionId) return null;
  if (saved.startedAt > nowMs) return null;
  const endMs = saved.startedAt + saved.durationSeconds * 1000;
  if (endMs - nowMs < 1000) return null;
  return { startedAt: saved.startedAt, durationSeconds: saved.durationSeconds };
}

interface WorkoutStoreLike {
  subscribe(
    listener: (
      state: {
        activeSessionId: string | null;
        restTimer: { startedAt: number; durationSeconds: number } | null;
      },
      prev: {
        activeSessionId: string | null;
        restTimer: { startedAt: number; durationSeconds: number } | null;
      }
    ) => void
  ): () => void;
}

/**
 * Sayaç her değişince kv-store'a yazar, kalkınca siler. Yazmalar sıraya
 * alınıyor: art arda başlat/durdur gelince eski değer sonradan yazılmasın.
 * Store'un action'larına dokunmaz; dönen fonksiyon aboneliği kaldırır.
 */
export function connectRestTimerPersistence(
  store: WorkoutStoreLike,
  kv: RemovableKeyValueStore,
  onError?: (err: unknown) => void
): () => void {
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (task: () => Promise<void>) => {
    queue = queue.then(task).catch((err) => onError?.(err));
  };

  return store.subscribe((state, prev) => {
    if (state.restTimer === prev.restTimer) return;
    const { activeSessionId, restTimer } = state;
    if (restTimer == null || activeSessionId == null) {
      enqueue(() => kv.removeItem(SAVED_REST_TIMER_KEY));
      return;
    }
    const saved: SavedRestTimer = {
      sessionId: activeSessionId,
      startedAt: restTimer.startedAt,
      durationSeconds: restTimer.durationSeconds,
    };
    enqueue(() => kv.setItem(SAVED_REST_TIMER_KEY, JSON.stringify(saved)));
  });
}
