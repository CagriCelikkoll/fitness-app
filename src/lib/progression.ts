/**
 * Akıllı ilerleme önerisi (v2.1) — çift ilerleme yöntemi.
 *
 * Aktif antrenmanda her hareket için geçen seansa bakıp tek satırlık
 * öneri: "Bugün 85 kg × 8 dene". Yapay zekâ değil, açıklanabilir kurallar:
 *
 * 1. ARTIR — çalışma ağırlığındaki (W) bütün setler üst sınıra ulaştı
 * 2. ARTIR (kolay geldi) — W setlerinin hepsinde RIR ≥ 3 ve tekrar alt
 *    sınırın üstünde
 * 3. AYNI AĞIRLIK, TEKRAR ARTIR — W'de kal, en düşük W setinin tekrarı + 1
 * 4. ZORLANDIN — W setlerinin yarısından fazlası alt sınırın altında
 * Hiçbiri tutmazsa kural 3.
 *
 * Karar fonksiyonu (`suggestProgression`) veri alıp sonuç döndürüyor;
 * veritabanı okuması `getProgressionSuggestion`'da. Öneri dili "dene",
 * emir yok.
 */

import { and, asc, eq } from 'drizzle-orm';

import type { Db } from '@/db/client';
import {
  exercises,
  routineExercises,
  sessionExercises,
  sets,
  workoutSessions,
} from '@/db/schema';
import { getExerciseSetHistory } from '@/lib/exerciseHistory';
import { buildSessionPoints, type SessionPoint } from '@/lib/exerciseProgress';
import { formatDecimal } from '@/lib/format';
import { getLastSessionForExercise } from '@/lib/lastSession';
import type { KeyValueStore } from '@/lib/onboarding';

// ============================================================================
// Ayar (kv-store)
// ============================================================================

/** kv-store anahtarı. Değiştirme: mevcut cihazlarda ayar kaybolur. */
export const PROGRESSION_ENABLED_KEY = 'progression.enabled';
export const DEFAULT_PROGRESSION_ENABLED = true;

export function parseProgressionEnabled(raw: string | null): boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return DEFAULT_PROGRESSION_ENABLED;
}

export async function getProgressionEnabled(store: KeyValueStore): Promise<boolean> {
  return parseProgressionEnabled(await store.getItem(PROGRESSION_ENABLED_KEY));
}

export async function setProgressionEnabled(
  store: KeyValueStore,
  enabled: boolean
): Promise<void> {
  await store.setItem(PROGRESSION_ENABLED_KEY, enabled ? 'true' : 'false');
}

// ============================================================================
// Hedef aralık
// ============================================================================

export interface RepRange {
  lower: number;
  upper: number;
}

/**
 * Rutindeki `targetReps`: "8-12" → 8–12, "10" → 10–10, boşluklar
 * yok sayılıyor. Boş, sayı olmayan ("AMRAP", "max"), 0 ya da ters
 * aralık → null (öneri yok).
 */
export function parseRepRange(raw: string | null | undefined): RepRange | null {
  if (raw == null) return null;
  const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(raw);
  if (!match) return null;
  const lower = Number(match[1]);
  const upper = match[2] != null ? Number(match[2]) : lower;
  if (lower < 1 || upper < lower) return null;
  return { lower, upper };
}

// ============================================================================
// Ağırlık adımı
// ============================================================================

const STEP_KG: Record<string, number> = {
  barbell: 2.5,
  'e-z curl bar': 2.5,
  dumbbell: 2,
  kettlebells: 2,
  cable: 2.5,
  machine: 2.5,
};
const DEFAULT_STEP_KG = 2.5;

/** Ekipmana göre tek adım (kg). Bilinmeyen ekipman 2,5. */
export function weightStepKg(equipment: string | null | undefined): number {
  return (equipment != null ? STEP_KG[equipment] : undefined) ?? DEFAULT_STEP_KG;
}

/** Kablo ve makinede ağırlık kademeli; metinde "bir sonraki kademe" de deniyor */
export function isStackEquipment(equipment: string | null | undefined): boolean {
  return equipment === 'cable' || equipment === 'machine';
}

/** Kayan nokta artığı olmasın: 82,5 + 2,5 = 85 */
function addKg(a: number, b: number): number {
  return Math.round((a + b) * 100) / 100;
}

/** "85", "84", "22,5", "1,25" (tr-TR) */
export function formatKg(kg: number): string {
  return formatDecimal(kg, 2);
}

// ============================================================================
// Karar (saf)
// ============================================================================

/** Değerlendirmeye giren set alanları */
export interface ProgressionSet {
  weightKg: number | null;
  reps: number | null;
  rir: number | null;
  isCompleted: boolean;
  setType: string;
}

export type ProgressionRule =
  | 'increase'
  | 'increaseEasy'
  | 'addReps'
  | 'struggled';

export interface ProgressionSuggestion {
  rule: ProgressionRule;
  /** Önerilen ağırlık; ağırlıksız harekette null */
  weightKg: number | null;
  /** Hedef tekrar */
  reps: number;
  /** Kalın gösterilen kısım: "85 kg × 8" ya da "13 tekrar" */
  headline: string;
  /** Gerekçe satırı */
  reason: string;
  /** "Uygula" düğmesi: yalnızca ağırlık artışında */
  canApply: boolean;
  /** Plato notu; yoksa null */
  plateauNote: string | null;
}

export const PLATEAU_MIN_SESSIONS = 5;
export const PLATEAU_RECENT_SESSIONS = 4;
/** Son 4 seansın en iyisi öncekilerden bu orandan fazla iyi değilse plato */
export const PLATEAU_MIN_GAIN = 0.01;

export const PLATEAU_NOTE =
  'Son 4 antrenmanda ilerleme durmuş görünüyor. Tekrar aralığını değiştirmeyi veya bir hafta hafif çalışmayı düşünebilirsin.';

export const PROGRESSION_HELP =
  'Çift ilerleme yöntemi: Önce hedef aralığın üst sınırına tüm setlerde ulaş, sonra ağırlığı bir adım artır ve alt sınırdan yeniden başla.';

/**
 * Plato: en az 5 seans varsa, son 4 seansın en iyi e1RM'i öncekilerin
 * en iyisinden %1'den fazla iyi değil. e1RM hesaplanamayan (ağırlıksız,
 * 12+ tekrar) taraf varsa karar verilmiyor.
 *
 * @param points tarihe göre artan seans noktaları (bitmiş seanslar)
 */
export function isPlateau(points: Pick<SessionPoint, 'e1rm'>[]): boolean {
  if (points.length < PLATEAU_MIN_SESSIONS) return false;
  const best = (list: Pick<SessionPoint, 'e1rm'>[]) =>
    list.reduce<number | null>(
      (max, p) => (p.e1rm != null && (max == null || p.e1rm > max) ? p.e1rm : max),
      null
    );
  const split = points.length - PLATEAU_RECENT_SESSIONS;
  const before = best(points.slice(0, split));
  const recent = best(points.slice(split));
  if (before == null || recent == null) return false;
  return recent <= before * (1 + PLATEAU_MIN_GAIN);
}

export interface ProgressionInput {
  /** Rutindeki hedef tekrar; seans rutinden değilse null */
  targetReps: string | null;
  /** Egzersiz kategorisi ('strength' | 'cardio' | ...) */
  category: string;
  equipment: string | null;
  /** Geçen seansın setleri; hareket ilk kez yapılıyorsa null */
  lastSets: ProgressionSet[] | null;
  /** Bitmiş seansların e1RM noktaları, tarihe göre artan (plato için) */
  sessionPoints: Pick<SessionPoint, 'e1rm'>[];
}

/**
 * Öneri ya da null (ilk kez, kardiyo, hedef aralık yok, sayılan set yok).
 * Yalnızca tamamlanmış normal setler sayılıyor.
 */
export function suggestProgression(input: ProgressionInput): ProgressionSuggestion | null {
  if (input.category === 'cardio') return null;
  const range = parseRepRange(input.targetReps);
  if (range == null || input.lastSets == null) return null;

  const counted = input.lastSets.filter(
    (s) => s.isCompleted && s.setType === 'normal' && s.reps != null
  );
  if (counted.length === 0) return null;

  // Çalışma ağırlığı: en ağır set. Değerlendirme yalnızca o ağırlıktaki
  // setlerle; piramit/düşüş setleri karışmasın.
  const w = Math.max(...counted.map((s) => s.weightKg ?? 0));
  const workSets = counted.filter((s) => (s.weightKg ?? 0) === w);
  const reps = workSets.map((s) => s.reps!);
  const minReps = Math.min(...reps);
  const bodyweight = !(w > 0);

  const allAtTop = reps.every((r) => r >= range.upper);
  const easy =
    workSets.every((s) => s.rir != null && s.rir >= 3) &&
    reps.every((r) => r > range.lower);
  const belowCount = reps.filter((r) => r < range.lower).length;
  const struggled = belowCount * 2 > reps.length;

  const plateauNote = isPlateau(input.sessionPoints) ? PLATEAU_NOTE : null;
  const kgText = formatKg(w);

  // Kural 1 ve 2: ağırlık bir adım artar, hedef alt sınır
  if (allAtTop || easy) {
    const rule: ProgressionRule = allAtTop ? 'increase' : 'increaseEasy';
    const why = allAtTop
      ? bodyweight
        ? `Geçen sefer tüm setlerde ${range.upper} tekrara ulaştın.`
        : `Geçen sefer ${kgText} kg ile tüm setlerde ${range.upper} tekrara ulaştın.`
      : 'Geçen sefer setler kolay geldi (RIR 3+).';

    if (bodyweight) {
      // Ağırlık yok: yalnızca tekrar
      const target = minReps + 1;
      return {
        rule,
        weightKg: null,
        reps: target,
        headline: `${target} tekrar`,
        reason: `${why} Ya da bir sonraki varyasyona geçebilirsin.`,
        canApply: false,
        plateauNote,
      };
    }

    const next = addKg(w, weightStepKg(input.equipment));
    const stack = isStackEquipment(input.equipment)
      ? ' Tam bu ağırlık yoksa bir sonraki kademeyi deneyebilirsin.'
      : '';
    return {
      rule,
      weightKg: next,
      reps: range.lower,
      headline: `${formatKg(next)} kg × ${range.lower}`,
      reason: why + stack,
      canApply: true,
      plateauNote,
    };
  }

  const keep = (target: number) => (bodyweight ? `${target} tekrar` : `${kgText} kg × ${target}`);

  // Kural 3: hepsi aralıkta, hepsi üstte değil
  const allInRange = reps.every((r) => r >= range.lower && r <= range.upper);
  if (allInRange || !struggled) {
    const target = Math.min(minReps + 1, range.upper);
    return {
      rule: 'addReps',
      weightKg: bodyweight ? null : w,
      reps: target,
      headline: keep(target),
      reason: `Önce tüm setlerde ${range.upper} tekrara ulaş, sonra ağırlık artır.`,
      canApply: false,
      plateauNote,
    };
  }

  // Kural 4: yarısından fazlası alt sınırın altında
  return {
    rule: 'struggled',
    weightKg: bodyweight ? null : w,
    reps: range.lower,
    headline: keep(range.lower),
    reason: bodyweight
      ? 'Geçen sefer zorlandın, aynı varyasyonda kal.'
      : 'Geçen sefer zorlandın, bu ağırlıkta kal.',
    canApply: false,
    plateauNote,
  };
}

// ============================================================================
// Veritabanı
// ============================================================================

/**
 * Seanstaki hareketin rutindeki hedef tekrarı. Seans rutinden
 * başlatılmadıysa ya da rutin/hareket artık yoksa null. Aynı hareket
 * rutinde birden çok kez varsa seanstaki sırasıyla eşleşen, yoksa ilki.
 */
async function routineTargetReps(
  db: Db,
  sessionId: string,
  sessionExerciseId: string,
  exerciseId: string
): Promise<string | null> {
  const [session] = await db
    .select({ routineId: workoutSessions.routineId })
    .from(workoutSessions)
    .where(eq(workoutSessions.id, sessionId))
    .limit(1);
  if (!session?.routineId) return null;

  const [se] = await db
    .select({ orderIndex: sessionExercises.orderIndex })
    .from(sessionExercises)
    .where(eq(sessionExercises.id, sessionExerciseId))
    .limit(1);

  const rows = await db
    .select({ orderIndex: routineExercises.orderIndex, targetReps: routineExercises.targetReps })
    .from(routineExercises)
    .where(
      and(
        eq(routineExercises.routineId, session.routineId),
        eq(routineExercises.exerciseId, exerciseId)
      )
    )
    .orderBy(asc(routineExercises.orderIndex));

  const match = rows.find((r) => r.orderIndex === se?.orderIndex) ?? rows[0];
  return match?.targetReps ?? null;
}

/**
 * Aktif seanstaki bir hareket için öneri. Geçen seans, plato için
 * geçmiş (bitmiş seanslar; aktif seans bitmediği için zaten girmiyor)
 * ve rutin hedefi okunup `suggestProgression`'a veriliyor.
 */
export async function getProgressionSuggestion(
  db: Db,
  args: { sessionId: string; sessionExerciseId: string; exerciseId: string }
): Promise<ProgressionSuggestion | null> {
  const [exercise] = await db
    .select({ category: exercises.category, equipment: exercises.equipment })
    .from(exercises)
    .where(eq(exercises.id, args.exerciseId))
    .limit(1);
  if (!exercise || exercise.category === 'cardio') return null;

  const targetReps = await routineTargetReps(
    db,
    args.sessionId,
    args.sessionExerciseId,
    args.exerciseId
  );
  if (parseRepRange(targetReps) == null) return null;

  const last = await getLastSessionForExercise(db, args.exerciseId, args.sessionId);
  if (last == null) return null;

  const history = await getExerciseSetHistory(db, args.exerciseId);
  return suggestProgression({
    targetReps,
    category: exercise.category,
    equipment: exercise.equipment,
    lastSets: last.sets,
    sessionPoints: buildSessionPoints(history.filter((r) => r.sessionId !== args.sessionId)),
  });
}

/**
 * "Uygula": hareketin henüz tamamlanmamış setlerine önerilen ağırlığı
 * yazar. Set satırının ağırlık alanının kullandığı yolla aynı
 * (`sets.weight_kg` güncellemesi); tamamlanmış setlere ve tekrarlara
 * dokunmuyor.
 *
 * @returns güncellenen set sayısı
 */
export async function applySuggestedWeight(
  db: Db,
  sessionExerciseId: string,
  weightKg: number
): Promise<number> {
  const updated = await db
    .update(sets)
    .set({ weightKg })
    .where(and(eq(sets.sessionExerciseId, sessionExerciseId), eq(sets.isCompleted, false)))
    .returning({ id: sets.id });
  return updated.length;
}
