/**
 * Egzersiz ilerlemesi — tahmini 1RM, seans metrikleri, kişisel rekorlar.
 *
 * Saf hesaplamalar; React ve veritabanı bilmiyor. Satırları
 * `src/lib/exerciseHistory.ts` getiriyor, hangi setlerin sayıldığı
 * (tamamlanmış, normal, bitmiş seans) orada süzülüyor.
 */

/** Bu tekrar sayısının üstündeki setler e1RM'e girmez (hacme girer) */
export const E1RM_MAX_REPS = 12;

/**
 * Epley: ağırlık × (1 + tekrar / 30). 1 tekrarlık setin e1RM'i ağırlığın
 * kendisi. Yüksek tekrarda formül şiştiği için 1–12 tekrar dışı ve
 * ağırlığı olmayan (vücut ağırlığı) setlerde null.
 */
export function epley(
  weightKg: number | null | undefined,
  reps: number | null | undefined
): number | null {
  if (weightKg == null || !(weightKg > 0)) return null;
  if (reps == null || !Number.isInteger(reps)) return null;
  if (reps < 1 || reps > E1RM_MAX_REPS) return null;
  if (reps === 1) return weightKg;
  return weightKg * (1 + reps / 30);
}

/** Geçmiş sorgusunun tek satırı: bir set ve ait olduğu seans */
export interface SetRow {
  sessionId: string;
  /** Seansın başlangıcı (ISO) */
  date: string;
  weightKg: number | null;
  reps: number | null;
}

export interface SessionPoint {
  sessionId: string;
  date: string; // ISO
  e1rm: number | null;
  topWeight: number | null;
  volume: number;
  /** Seansın en iyi seti (en yüksek e1RM, yoksa en ağır / en çok tekrar) */
  bestSet: { weightKg: number | null; reps: number | null } | null;
}

/** Aynı seanstaki iki setten hangisi "en iyi set" olarak gösterilecek */
function isBetterSet(a: SetRow, b: SetRow): boolean {
  const ea = epley(a.weightKg, a.reps) ?? -1;
  const eb = epley(b.weightKg, b.reps) ?? -1;
  if (ea !== eb) return ea > eb;
  const wa = a.weightKg ?? 0;
  const wb = b.weightKg ?? 0;
  if (wa !== wb) return wa > wb;
  return (a.reps ?? 0) > (b.reps ?? 0);
}

/** Ham set listesinden seans başına metrik noktaları üretir (tarihe göre artan) */
export function buildSessionPoints(rows: SetRow[]): SessionPoint[] {
  const bySession = new Map<string, SessionPoint & { best: SetRow | null }>();

  for (const row of rows) {
    let point = bySession.get(row.sessionId);
    if (!point) {
      point = {
        sessionId: row.sessionId,
        date: row.date,
        e1rm: null,
        topWeight: null,
        volume: 0,
        bestSet: null,
        best: null,
      };
      bySession.set(row.sessionId, point);
    }

    const e1rm = epley(row.weightKg, row.reps);
    if (e1rm != null && (point.e1rm == null || e1rm > point.e1rm)) {
      point.e1rm = e1rm;
    }

    const weight = row.weightKg;
    if (weight != null && weight > 0) {
      if (point.topWeight == null || weight > point.topWeight) {
        point.topWeight = weight;
      }
      if (row.reps != null && row.reps > 0) {
        point.volume += row.reps * weight;
      }
    }

    if (!point.best || isBetterSet(row, point.best)) point.best = row;
  }

  return [...bySession.values()]
    .map(({ best, ...point }) => ({
      ...point,
      bestSet: best ? { weightKg: best.weightKg, reps: best.reps } : null,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export interface RecordValue {
  value: number;
  date: string;
}

export interface PersonalRecords {
  e1rm: RecordValue | null;
  topWeight: RecordValue | null;
  volume: RecordValue | null;
}

/**
 * Tüm zamanların en iyileri. Eşitlikte ilk ulaşılan tarih kalır (rekor
 * o gün kırıldı). Hacmi 0 olan seanslar (vücut ağırlığı) rekor sayılmaz.
 */
export function computeRecords(points: SessionPoint[]): PersonalRecords {
  const sorted = [...points].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0
  );

  const best = (pick: (p: SessionPoint) => number | null): RecordValue | null => {
    let result: RecordValue | null = null;
    for (const p of sorted) {
      const value = pick(p);
      if (value == null || !(value > 0)) continue;
      if (result == null || value > result.value) {
        result = { value, date: p.date };
      }
    }
    return result;
  };

  return {
    e1rm: best((p) => p.e1rm),
    topWeight: best((p) => p.topWeight),
    volume: best((p) => p.volume),
  };
}

/**
 * Bu set önceki en iyi e1RM'i kesinlikle aşıyor mu? Eşitlik rekor
 * değil; hiç geçmişi yoksa (previousBest null) ilk set rekor sayılmaz.
 */
export function isNewE1rmRecord(
  weightKg: number,
  reps: number,
  previousBest: number | null
): boolean {
  if (previousBest == null) return false;
  const e1rm = epley(weightKg, reps);
  return e1rm != null && e1rm > previousBest;
}

/** Aktif seanstaki bir set — rekor rozetinin girdisi */
export interface SessionSet {
  id: string;
  setNumber: number;
  setType: string;
  weightKg: number | null;
  reps: number | null;
  isCompleted: boolean;
  completedAt: string | null;
}

function e1rmOfCounted(set: SessionSet): number | null {
  if (!set.isCompleted || set.setType !== 'normal') return null;
  return epley(set.weightKg, set.reps);
}

/**
 * Seans içi karşılaştırma değeri: önceki en iyi ile bu seansta tamamlanmış
 * (verilen) setlerin en iyisinden büyük olanı. Aynı seansta art arda iki
 * rekor kırılırsa ikincisi birinciyi baz alıyor. Geçmiş yoksa null — ilk
 * seansta hiçbir set rekor sayılmıyor.
 */
export function sessionRecordBaseline(
  previousBest: number | null,
  sessionSets: SessionSet[]
): number | null {
  if (previousBest == null) return null;
  let best = previousBest;
  for (const set of sessionSets) {
    const e1rm = e1rmOfCounted(set);
    if (e1rm != null && e1rm > best) best = e1rm;
  }
  return best;
}

/**
 * Rozet gösterilecek setler: tamamlanma sırasıyla yürünüp o ana kadarki
 * en iyiyi kesinlikle aşanlar. Setlerden türetildiği için geri alınan
 * setin rozeti kalkıyor, ekran yeniden açıldığında rozetler duruyor.
 */
export function findSessionRecordSetIds(
  sessionSets: SessionSet[],
  previousBest: number | null
): Set<string> {
  const ids = new Set<string>();
  if (previousBest == null) return ids;

  const ordered = sessionSets
    .filter((s) => e1rmOfCounted(s) != null)
    .sort((a, b) => {
      const ta = a.completedAt ?? '';
      const tb = b.completedAt ?? '';
      if (ta !== tb) return ta < tb ? -1 : 1;
      return a.setNumber - b.setNumber;
    });

  let best = previousBest;
  for (const set of ordered) {
    const e1rm = e1rmOfCounted(set)!;
    if (e1rm > best) {
      ids.add(set.id);
      best = e1rm;
    }
  }
  return ids;
}

/** Trend çizgisi noktası (LineChart girdisi) */
export interface TrendPoint {
  x: string; // ISO
  y: number;
}

/** Trend çizgisindeki en fazla seans sayısı */
export const TREND_SESSIONS = 8;

/**
 * Son `limit` seansın tahmini 1RM'i, tarihe göre artan. e1RM'i olmayan
 * seanslar (yalnızca 12+ tekrar ya da vücut ağırlığı) atlanıyor.
 */
export function recentE1rmTrend(
  points: SessionPoint[],
  limit: number = TREND_SESSIONS
): TrendPoint[] {
  return [...points]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .flatMap((p) => (p.e1rm != null ? [{ x: p.date, y: p.e1rm }] : []))
    .slice(-limit);
}
