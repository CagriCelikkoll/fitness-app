/**
 * Bağlam rengi (v4.0a 1.2) — saf: bir rutinin / antrenmanın rengi kas
 * gruplarından.
 *
 * Setlerin %85'inden fazlası üst vücut kaslarındaysa `upper`, alt vücut
 * kaslarındaysa `lower`, değilse `full` (%65 iken bacak hareketi olan ön /
 * arka zincir ve full body günleri "üst vücut" çıkıyordu; hazır programlarda
 * tek bölgeli günler %100, karışık günler en çok %80). Karın, core, boyun ve kardiyo
 * hesaba katılmaz. Bir hareketin birden çok ana kası varsa setleri bunlar
 * arasında eşit bölünür (yalnızca ana kaslar; yardımcılar sayılmaz).
 * Dinlenme her zaman `rest`, rekor her zaman `record` (ekranlar doğrudan).
 */

import type { ContextKind } from '@/theme';

/** Üst: göğüs, sırt (kanat, orta sırt, bel), omuz, kollar, trapez */
export const UPPER_MUSCLES = new Set([
  'chest',
  'lats',
  'middle back',
  'lower back',
  'shoulders',
  'biceps',
  'triceps',
  'forearms',
  'traps',
]);

/** Alt: quadriceps, hamstring, kalça, baldır, adductor / abductor */
export const LOWER_MUSCLES = new Set(['quadriceps', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors']);

export const CONTEXT_THRESHOLD = 0.85;

export interface ContextExercise {
  /** Ana kaslar (exercises.primary_muscles; JSON dizi ya da dizi) */
  primaryMuscles: readonly string[] | string | null | undefined;
  /** 'strength' | 'cardio' | 'stretching'; kardiyo sayılmaz */
  category?: string | null;
  /** Set sayısı (rutinde hedef, antrenmanda yapılan / planlanan) */
  sets: number;
}

export type BodyContext = Extract<ContextKind, 'upper' | 'lower' | 'full'>;

export function musclesOf(value: ContextExercise['primaryMuscles']): string[] {
  if (value == null) return [];
  if (typeof value !== 'string') return [...value];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((m): m is string => typeof m === 'string') : [];
  } catch {
    return [];
  }
}

/** Üst / alt set sayıları (kesirli olabilir) */
export function bodySetSplit(exercises: readonly ContextExercise[]): { upper: number; lower: number } {
  let upper = 0;
  let lower = 0;
  for (const ex of exercises) {
    if (ex.category === 'cardio' || !(ex.sets > 0)) continue;
    const muscles = musclesOf(ex.primaryMuscles);
    const ups = muscles.filter((m) => UPPER_MUSCLES.has(m)).length;
    const lows = muscles.filter((m) => LOWER_MUSCLES.has(m)).length;
    const counted = ups + lows;
    if (counted === 0) continue;
    upper += (ex.sets * ups) / counted;
    lower += (ex.sets * lows) / counted;
  }
  return { upper, lower };
}

export function contextColorFor(exercises: readonly ContextExercise[]): BodyContext {
  const { upper, lower } = bodySetSplit(exercises);
  const total = upper + lower;
  if (total <= 0) return 'full';
  if (upper / total > CONTEXT_THRESHOLD) return 'upper';
  if (lower / total > CONTEXT_THRESHOLD) return 'lower';
  return 'full';
}

/**
 * Tek hareketin rengi (v4.0b 1.7: odak modu ve "Sıradaki"). Karın, boyun ya
 * da kardiyo gibi üst / alt ayrımı olmayan harekette antrenmanın rengi kalır.
 */
export function exerciseContextColor(
  exercise: Omit<ContextExercise, 'sets'>,
  fallback: BodyContext
): BodyContext {
  const single = [{ ...exercise, sets: 1 }];
  const { upper, lower } = bodySetSplit(single);
  return upper + lower > 0 ? contextColorFor(single) : fallback;
}
