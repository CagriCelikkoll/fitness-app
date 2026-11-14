/**
 * Antrenman süresi: ekranlarda gösterilen / toplanan "gerçek" süre.
 *
 * Kayıtlı `durationSeconds` bitiş anı − başlangıç. Kullanıcı son setten
 * sonra "Bitir"e basmayı unutursa (uygulama 12 saat içinde sessizce geri
 * yükleniyor, ertesi sabah bitiriliyor) ya da eski sürümden / yedekten
 * gelen seanslarda bu değer saatlerce, günlerce olabiliyor. İlerleme'deki
 * yıllık süre bu yüzden "345 sa" görünüyordu.
 *
 * Kural (okumada uygulanır, kayıtlı veri değişmez; bitişte de aynı kural
 * yazılır):
 * - Kayıtlı süre yoksa: yok.
 * - Son tamamlanan setin zamanı biliniyorsa süre en fazla
 *   (son set − başlangıç) + 10 dk (soğuma, son set sonrası) + kardiyo
 *   süreleri toplamı.
 * - Her durumda en fazla 4 saat.
 * - Negatif olmaz.
 */

import { sql } from 'drizzle-orm';

import { workoutSessions } from '@/db/schema';

/** Son tamamlanan setten sonra süreye eklenen pay */
export const FINISH_GRACE_SECONDS = 10 * 60;

/** Tek antrenmanın üst sınırı */
export const MAX_SESSION_SECONDS = 4 * 60 * 60;

export interface DurationInput {
  startedAt: string;
  /** Kayıtlı süre (bitiş − başlangıç) */
  durationSeconds: number | null;
  /** Son tamamlanan setin zamanı; yoksa null */
  lastSetAt: string | null;
  /** Kardiyo bölümlerinin toplam süresi (saniye) */
  cardioSeconds?: number | null;
}

/** Saf: gösterilecek süre (saniye) ya da null */
export function effectiveDurationSeconds(input: DurationInput): number | null {
  const stored = input.durationSeconds;
  if (stored == null || !Number.isFinite(stored)) return null;
  let cap = MAX_SESSION_SECONDS;
  const start = new Date(input.startedAt).getTime();
  const last = input.lastSetAt != null ? new Date(input.lastSetAt).getTime() : NaN;
  if (Number.isFinite(start) && Number.isFinite(last) && last >= start) {
    const bySets = Math.round((last - start) / 1000) + FINISH_GRACE_SECONDS + (input.cardioSeconds ?? 0);
    cap = Math.min(cap, bySets);
  }
  return Math.max(0, Math.min(Math.round(stored), cap));
}

/**
 * Aynı kural SQL'de: `workout_sessions` satırını seçen sorguya sütun olarak
 * eklenir (`durationSeconds: effectiveDurationSql`). Alt sorgular join
 * değil; `useLiveQuery` ana tabloyu dinlemeye devam eder.
 */
const lastSetSeconds = sql`(
  select (julianday(max(s.completed_at)) - julianday(${workoutSessions.startedAt})) * 86400
  from sets s
  inner join session_exercises se on se.id = s.session_exercise_id
  where se.session_id = ${workoutSessions.id}
    and s.is_completed = 1
    and s.completed_at is not null
)`;

const cardioSecondsSql = sql`coalesce((
  select sum(c.duration_seconds) from cardio_segments c where c.session_id = ${workoutSessions.id}
), 0)`;

export const effectiveDurationSql = sql<number | null>`(case
  when ${workoutSessions.durationSeconds} is null then null
  else max(0, min(
    ${workoutSessions.durationSeconds},
    ${MAX_SESSION_SECONDS},
    coalesce(
      case when ${lastSetSeconds} >= 0
        then cast(round(${lastSetSeconds}) as integer) + ${FINISH_GRACE_SECONDS} + ${cardioSecondsSql}
      end,
      ${MAX_SESSION_SECONDS}
    )
  ))
end)`.mapWith((v) => (v == null ? null : Number(v)));
