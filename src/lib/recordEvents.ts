/**
 * Rekorlar (v4.0a; 0.13'te iki tür) — TEK KAYNAK. Ana sayfa "Son rekor",
 * İlerleme "Rekor" kartı, antrenman özeti, rekor sayfası ve hareket
 * detayının Geçmiş sekmesi aynı kuralı kullanır (`findSetRecords`).
 *
 * İki tür:
 * - **En ağır kilo** (`weight`): o harekette şimdiye kadarki en ağır kilodan
 *   kesinlikle ağır. Tekrar sayısı fark etmez (1 tekrar da sayılır).
 * - **Tahmini 1RM** (`e1rm`): Epley, yalnızca 1–12 tekrar; önceki en iyi
 *   e1RM'i kesinlikle aşan.
 * Bir set ikisini birden kırabilir: tek olay, iki etiket.
 *
 * Kurallar:
 * - Yalnızca bitmiş antrenmanların tamamlanmış normal setleri (ısınma hariç);
 *   kilo > 0.
 * - Hareketin ilk antrenmanında rekor yok. Bir türün önceki değeri hiç
 *   yoksa (ör. önceki setlerin hepsi 12 tekrar üstü) o tür o seansta
 *   sayılmaz; seans bitince en iyi değer kaydedilir.
 * - Seans içinde setler tamamlanma sırasıyla yürünür; aynı seansta ikinci
 *   rekor birinciyi baz alır.
 * - Geçmişe dönük: kayıtlı setlerden her açılışta yeniden hesaplanır,
 *   veritabanında rekor alanı yok.
 *
 * Antrenman sırasındaki 🏆 rozeti de bu kural (`sessionRecordSetIds`).
 * ✓ anındaki başarı titreşimi (`active.tsx` `isRecordCompletion`) set
 * tamamlama akışının parçası; değişmedi, yalnızca tahmini 1RM'e bakıyor.
 */

import { and, eq, isNotNull } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { exercises, sessionExercises, sets, workoutSessions } from '@/db/schema';
import { exerciseDisplayName } from '@/lib/exerciseCatalog';
import { epley, type SessionSet } from '@/lib/exerciseProgress';
import { formatDecimal } from '@/lib/format';

export type RecordKind = 'weight' | 'e1rm';

/** Rozet ve etiket sırası: önce en ağır kilo */
export const RECORD_KIND_ORDER: readonly RecordKind[] = ['weight', 'e1rm'];

export interface WeightSet {
  weightKg: number;
  reps: number;
}

export interface RecordSet extends WeightSet {
  e1rm: number;
}

/** Bir hareketin o ana kadarki en iyileri; hiç sayılan seti yoksa ikisi de null */
export interface ExerciseBest {
  /** En yüksek tahmini 1RM'li set */
  e1rm: RecordSet | null;
  /** En ağır set (eşitlikte ilk kaldırılan) */
  weight: WeightSet | null;
}

/** Bir setin kırdığı rekor(lar) */
export interface SetRecord {
  setId: string;
  weightKg: number;
  reps: number;
  /** 12 tekrar üstünde null */
  e1rm: number | null;
  /** En az bir tür; `RECORD_KIND_ORDER` sırasında */
  kinds: RecordKind[];
  /** Bu antrenmandan önceki en iyi 1RM seti (kinds'te e1rm varsa dolu) */
  previousE1rm: RecordSet | null;
  /** Bu antrenmandan önceki en ağır set (kinds'te weight varsa dolu) */
  previousWeight: WeightSet | null;
}

/** Rekora sayılan set: tamamlanmış, normal, kilo > 0, tekrar ≥ 1 */
function counted(set: SessionSet): set is SessionSet & { weightKg: number; reps: number } {
  return (
    set.isCompleted &&
    set.setType === 'normal' &&
    set.weightKg != null &&
    set.weightKg > 0 &&
    set.reps != null &&
    Number.isInteger(set.reps) &&
    set.reps >= 1
  );
}

/** Tamamlanma sırası (zaman yoksa set numarası) */
function inCompletionOrder<T extends SessionSet>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => {
    const ta = a.completedAt ?? '';
    const tb = b.completedAt ?? '';
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.setNumber - b.setNumber;
  });
}

/**
 * Bir hareketin bir seanstaki setlerinden rekor kıranlar (saf). `previous`
 * bu seanstan önceki en iyiler; null ise hareketin ilk antrenmanı → rekor yok.
 */
export function findSetRecords(sessionSets: readonly SessionSet[], previous: ExerciseBest | null): SetRecord[] {
  if (previous == null) return [];
  let bestE1rm = previous.e1rm;
  let bestWeight = previous.weight;
  const out: SetRecord[] = [];
  for (const set of inCompletionOrder(sessionSets)) {
    if (!counted(set)) continue;
    const e1rm = epley(set.weightKg, set.reps);
    const kinds: RecordKind[] = [];
    if (bestWeight != null && set.weightKg > bestWeight.weightKg) kinds.push('weight');
    if (bestE1rm != null && e1rm != null && e1rm > bestE1rm.e1rm) kinds.push('e1rm');
    if (kinds.length > 0) {
      out.push({
        setId: set.id,
        weightKg: set.weightKg,
        reps: set.reps,
        e1rm,
        kinds,
        // "Önceki en iyi" bu antrenmandan önceki değer (seans içi baz değil)
        previousE1rm: kinds.includes('e1rm') ? previous.e1rm : null,
        previousWeight: kinds.includes('weight') ? previous.weight : null,
      });
    }
    // Seans içi baz: yalnızca önceki değeri olan tür ilerler
    if (kinds.includes('weight')) bestWeight = { weightKg: set.weightKg, reps: set.reps };
    if (kinds.includes('e1rm')) bestE1rm = { weightKg: set.weightKg, reps: set.reps, e1rm: e1rm! };
  }
  return out;
}

/**
 * Antrenman sırasındaki 🏆 rozeti (0.13): bu seansta rekor kıran setlerin
 * id'leri, aynı kuralla (en ağır kilo ya da tahmini 1RM). Setlerden
 * türetiliyor: geri alınan setin rozeti kalkar.
 */
export function sessionRecordSetIds(sessionSets: readonly SessionSet[], previous: ExerciseBest | null): Set<string> {
  return new Set(findSetRecords(sessionSets, previous).map((r) => r.setId));
}

/** Seans bittikten sonraki en iyiler (bir sonraki seansın `previous`'u) */
export function mergeBest(previous: ExerciseBest | null, sessionSets: readonly SessionSet[]): ExerciseBest | null {
  let e1rmBest = previous?.e1rm ?? null;
  let weightBest = previous?.weight ?? null;
  let any = previous != null;
  for (const set of inCompletionOrder(sessionSets)) {
    if (!counted(set)) continue;
    any = true;
    const e = epley(set.weightKg, set.reps);
    if (e != null && (e1rmBest == null || e > e1rmBest.e1rm)) {
      e1rmBest = { weightKg: set.weightKg, reps: set.reps, e1rm: e };
    }
    if (weightBest == null || set.weightKg > weightBest.weightKg) {
      weightBest = { weightKg: set.weightKg, reps: set.reps };
    }
  }
  return any ? { e1rm: e1rmBest, weight: weightBest } : null;
}

/**
 * Bir hareketin bir seanstaki "asıl" rekoru: en çok tür kıran, sonra
 * en yüksek 1RM, sonra en ağır. Özet satırı ve rekor sayfası bunu gösterir.
 */
export function topSetRecord<T extends Pick<SetRecord, 'kinds' | 'e1rm' | 'weightKg'>>(records: readonly T[]): T | null {
  let top: T | null = null;
  for (const r of records) if (top == null || compareRecords(r, top) < 0) top = r;
  return top;
}

/** Sıralama: negatif → a önce */
export function compareRecords(
  a: Pick<SetRecord, 'kinds' | 'e1rm' | 'weightKg'>,
  b: Pick<SetRecord, 'kinds' | 'e1rm' | 'weightKg'>
): number {
  if (a.kinds.length !== b.kinds.length) return b.kinds.length - a.kinds.length;
  const ea = a.e1rm ?? 0;
  const eb = b.e1rm ?? 0;
  if (ea !== eb) return eb - ea;
  return b.weightKg - a.weightKg;
}

// ── Geçmiş boyunca ──────────────────────────────────────────────────────

export interface RecordHistoryRow extends SessionSet {
  exerciseId: string;
  exerciseName: string;
  sessionId: string;
  sessionStartedAt: string;
}

/** Rekor kıran bir set, seansı ve hareketiyle */
export interface RecordEvent extends SetRecord {
  sessionId: string;
  /** Seans başlangıcı (ISO) */
  at: string;
  exerciseId: string;
  exerciseName: string;
}

type SessionGroup = { sessionId: string; startedAt: string; byExercise: Map<string, RecordHistoryRow[]> };

/** Satırları seans başlangıcına göre sıralı seanslara, onları harekete böler */
function groupSessions(rows: readonly RecordHistoryRow[]): SessionGroup[] {
  const groups = new Map<string, SessionGroup>();
  const sortedRows = [...rows].sort((a, b) =>
    a.sessionStartedAt === b.sessionStartedAt ? 0 : a.sessionStartedAt < b.sessionStartedAt ? -1 : 1
  );
  for (const r of sortedRows) {
    let s = groups.get(r.sessionId);
    if (!s) {
      s = { sessionId: r.sessionId, startedAt: r.sessionStartedAt, byExercise: new Map() };
      groups.set(r.sessionId, s);
    }
    const list = s.byExercise.get(r.exerciseId) ?? [];
    list.push(r);
    s.byExercise.set(r.exerciseId, list);
  }
  return [...groups.values()];
}

/**
 * Seansları kronolojik yürür; her hareket için o seanstan önceki en iyiler
 * `visit`'e verilir, sonra seansın setleriyle güncellenir.
 */
function walkSessions(
  rows: readonly RecordHistoryRow[],
  visit: (s: SessionGroup, exerciseId: string, list: RecordHistoryRow[], previous: ExerciseBest | null) => void
): void {
  const best = new Map<string, ExerciseBest>();
  for (const s of groupSessions(rows)) {
    for (const [exerciseId, list] of s.byExercise) {
      const prev = best.get(exerciseId) ?? null;
      visit(s, exerciseId, list, prev);
      const next = mergeBest(prev, list);
      if (next) best.set(exerciseId, next);
    }
  }
}

/** Seans sırasıyla, her seansta rekor kıran setler */
export function recordEvents(rows: readonly RecordHistoryRow[]): RecordEvent[] {
  const events: RecordEvent[] = [];
  walkSessions(rows, (s, exerciseId, list, prev) => {
    for (const rec of findSetRecords(list, prev)) {
      events.push({ ...rec, sessionId: s.sessionId, at: s.startedAt, exerciseId, exerciseName: list[0]!.exerciseName });
    }
  });
  return events;
}

/**
 * Bir seanstan önceki en iyiler, hareket başına (antrenman özeti). Seans
 * geçmişte yoksa (ör. bitmemiş) bütün bitmiş seanslar baz alınır.
 */
export function bestsBeforeSession(rows: readonly RecordHistoryRow[], sessionId: string): Map<string, ExerciseBest> {
  const before = new Map<string, ExerciseBest>();
  let reached = false;
  const finalBest = new Map<string, ExerciseBest>();
  walkSessions(rows, (s, exerciseId, list, prev) => {
    if (s.sessionId === sessionId) {
      reached = true;
      if (prev) before.set(exerciseId, prev);
    }
    const next = mergeBest(prev, list);
    if (next) finalBest.set(exerciseId, next);
  });
  return reached ? before : finalBest;
}

/** Bir seansta hareket başına asıl rekor, sıralı (en büyük önce) */
export function sessionRecords(events: readonly RecordEvent[], sessionId: string): RecordEvent[] {
  const byExercise = new Map<string, RecordEvent[]>();
  for (const e of events) {
    if (e.sessionId !== sessionId) continue;
    byExercise.set(e.exerciseId, [...(byExercise.get(e.exerciseId) ?? []), e]);
  }
  return [...byExercise.values()].map((list) => topSetRecord(list)!).sort(compareRecords);
}

/** Bir harekette rekor kırılan seanslar ve kırılan türler (hareket detayı, Geçmiş) */
export function recordKindsBySession(events: readonly RecordEvent[], exerciseId: string): Map<string, RecordKind[]> {
  const out = new Map<string, Set<RecordKind>>();
  for (const e of events) {
    if (e.exerciseId !== exerciseId) continue;
    const set = out.get(e.sessionId) ?? new Set<RecordKind>();
    for (const k of e.kinds) set.add(k);
    out.set(e.sessionId, set);
  }
  return new Map([...out].map(([id, kinds]) => [id, RECORD_KIND_ORDER.filter((k) => kinds.has(k))]));
}

// ── Rekor sayfası (v4.0b Bölüm 7; 0.13 türler) ──────────────────────────

/** Antrenman sonundaki rekor sayfası */
export interface RecordPageData {
  exerciseName: string;
  weightKg: number;
  reps: number;
  e1rm: number | null;
  kinds: RecordKind[];
  previousE1rm: RecordSet | null;
  previousWeight: WeightSet | null;
  /** En büyüğü dışında kaç harekette daha rekor var */
  moreCount: number;
}

/** Sıralı rekor listesinden sayfa; rekor yoksa null (sayfa çıkmaz) */
export function recordPageFrom(
  records: readonly (Omit<SetRecord, 'setId'> & { exerciseName: string })[]
): RecordPageData | null {
  const top = records[0];
  if (!top) return null;
  return {
    exerciseName: top.exerciseName,
    weightKg: top.weightKg,
    reps: top.reps,
    e1rm: top.e1rm,
    kinds: top.kinds,
    previousE1rm: top.previousE1rm,
    previousWeight: top.previousWeight,
    moreCount: records.length - 1,
  };
}

/** Bu seansın rekor sayfası; rekor yoksa null */
export function sessionRecordPage(events: readonly RecordEvent[], sessionId: string): RecordPageData | null {
  return recordPageFrom(sessionRecords(events, sessionId));
}

export async function loadSessionRecordPage(db: Db, sessionId: string): Promise<RecordPageData | null> {
  return sessionRecordPage(recordEvents(await loadRecordHistory(db)), sessionId);
}

// ── Metinler ────────────────────────────────────────────────────────────

const KIND_BADGE: Record<RecordKind, string> = { weight: 'EN AĞIR KİLO', e1rm: 'TAHMİNİ 1RM' };
const KIND_LABEL: Record<RecordKind, string> = { weight: 'en ağır kilo', e1rm: 'tahmini 1RM' };

/** Rozet: "EN AĞIR KİLO", "TAHMİNİ 1RM" ya da "EN AĞIR KİLO · TAHMİNİ 1RM" */
export function recordBadgeText(kinds: readonly RecordKind[]): string {
  return RECORD_KIND_ORDER.filter((k) => kinds.includes(k))
    .map((k) => KIND_BADGE[k])
    .join(' · ');
}

/** Küçük etiket: "en ağır kilo · tahmini 1RM" */
export function recordKindsText(kinds: readonly RecordKind[]): string {
  return RECORD_KIND_ORDER.filter((k) => kinds.includes(k))
    .map((k) => KIND_LABEL[k])
    .join(' · ');
}

/** "77,5 × 5" */
export function recordSetText(set: WeightSet): string {
  return `${formatDecimal(set.weightKg, 2)} × ${set.reps}`;
}

/** Dev yazı iki renkli: ["80 kg ", "× 5"] */
export function recordHeadlineParts(set: WeightSet): [weight: string, reps: string] {
  return [`${formatDecimal(set.weightKg, 2)} kg `, `× ${set.reps}`];
}

/** Gösterilecek fark: tek ondalıkta görünmüyorsa null */
function gainText(gain: number): string | null {
  const rounded = Math.round(gain * 10) / 10;
  return rounded > 0 ? `+${formatDecimal(rounded)}` : null;
}

/** "+2,9"; 1RM rekoru değilse ya da fark görünmüyorsa null */
export function recordE1rmGain(page: Pick<RecordPageData, 'e1rm' | 'previousE1rm'>): string | null {
  if (page.e1rm == null || page.previousE1rm == null) return null;
  return gainText(page.e1rm - page.previousE1rm.e1rm);
}

/** "+2,5"; kilo rekoru değilse null */
export function recordWeightGain(page: Pick<RecordPageData, 'weightKg' | 'previousWeight'>): string | null {
  if (page.previousWeight == null) return null;
  return gainText(page.weightKg - page.previousWeight.weightKg);
}

/**
 * Sayfadaki iki kart: "Önceki en iyi" ilgili türün önceki değeri, yanındaki
 * kart o türün yeni değeri ve farkı. İkisi birden kırıldıysa 1RM gösterilir
 * (önceki 1RM seti); kilo farkı rozetten ve dev yazıdan okunur.
 */
export function recordComparison(page: RecordPageData): {
  previousText: string;
  metricLabel: string;
  metricValue: string;
  gain: string | null;
} {
  if (page.kinds.includes('e1rm') && page.previousE1rm && page.e1rm != null) {
    return {
      previousText: recordSetText(page.previousE1rm),
      metricLabel: 'Tahmini 1RM',
      metricValue: `${formatDecimal(page.e1rm)} kg`,
      gain: recordE1rmGain(page),
    };
  }
  const prev = page.previousWeight;
  return {
    previousText: prev ? recordSetText(prev) : '—',
    metricLabel: 'En ağır kilo',
    metricValue: `${formatDecimal(page.weightKg, 2)} kg`,
    gain: recordWeightGain(page),
  };
}

/** "+2 rekor daha"; tek rekorsa null */
export function recordMoreText(moreCount: number): string | null {
  return moreCount > 0 ? `+${moreCount} rekor daha` : null;
}

// ── Okuma ───────────────────────────────────────────────────────────────

/** Bütün bitmiş antrenmanların tamamlanmış normal setleri (Türkçe adla) */
export async function loadRecordHistory(db: Db, exerciseId?: string): Promise<RecordHistoryRow[]> {
  const rows = await db
    .select({
      id: sets.id,
      setNumber: sets.setNumber,
      setType: sets.setType,
      weightKg: sets.weightKg,
      reps: sets.reps,
      isCompleted: sets.isCompleted,
      completedAt: sets.completedAt,
      exerciseId: exercises.id,
      name: exercises.name,
      nameTr: exercises.nameTr,
      sessionId: workoutSessions.id,
      sessionStartedAt: workoutSessions.startedAt,
    })
    .from(sets)
    .innerJoin(sessionExercises, eq(sets.sessionExerciseId, sessionExercises.id))
    .innerJoin(workoutSessions, eq(sessionExercises.sessionId, workoutSessions.id))
    .innerJoin(exercises, eq(sessionExercises.exerciseId, exercises.id))
    .where(
      and(
        isNotNull(workoutSessions.endedAt),
        eq(sets.isCompleted, true),
        eq(sets.setType, 'normal'),
        exerciseId != null ? eq(exercises.id, exerciseId) : undefined
      )
    );
  return rows.map(({ name, nameTr, ...r }) => ({
    ...r,
    exerciseName: exerciseDisplayName({ id: r.exerciseId, name, nameTr }),
  }));
}

/**
 * Bir hareketin, bu seans hariç bitmiş antrenmanlardaki en iyileri
 * (antrenman ekranının rozeti). Hiç sayılan seti yoksa null.
 */
export async function loadPreviousExerciseBest(
  db: Db,
  exerciseId: string,
  sessionId: string
): Promise<ExerciseBest | null> {
  const rows = (await loadRecordHistory(db, exerciseId)).filter((r) => r.sessionId !== sessionId);
  return bestsBeforeSession(rows, sessionId).get(exerciseId) ?? null;
}

/** Bir hareketin rekorlu seansları (hareket detayı, Geçmiş sekmesi) */
export async function loadExerciseRecordSessions(db: Db, exerciseId: string): Promise<Map<string, RecordKind[]>> {
  return recordKindsBySession(recordEvents(await loadRecordHistory(db, exerciseId)), exerciseId);
}
