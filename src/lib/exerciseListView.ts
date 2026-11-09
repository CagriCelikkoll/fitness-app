/** Hareketler listesi ve detayının metinleri (v4.0b Bölüm 8) — saf */

import { exerciseOriginalName, type NamedExercise } from '@/lib/exerciseCatalog';
import { categoryLabel, equipmentLabel, muscleLabels } from '@/lib/exerciseTaxonomy';
import { formatDecimal } from '@/lib/format';

export type ExerciseDetailTab = 'howto' | 'growth' | 'history';

export const EXERCISE_DETAIL_TABS: readonly { id: ExerciseDetailTab; label: string }[] = [
  { id: 'howto', label: 'Nasıl yapılır' },
  { id: 'growth', label: 'Gelişim' },
  { id: 'history', label: 'Geçmiş' },
];

export const RECENT_EXERCISE_LIMIT = 3;

interface RowExercise extends NamedExercise {
  primaryMuscles: string | null;
  category: string;
}

/** "Barbell Bench Press · Göğüs"; Türkçe adı olmayanda yalnızca kas grubu */
export function exerciseRowSubtitle(exercise: RowExercise): string {
  const group = muscleLabels(exercise.primaryMuscles)[0] ?? categoryLabel(exercise.category);
  return [exerciseOriginalName(exercise), group].filter(Boolean).join(' · ');
}

/** "Bent Over Barbell Row · Barbell"; ikisi de yoksa null */
export function exerciseDetailSubtitle(exercise: NamedExercise & { equipment: string | null }): string | null {
  const parts = [exerciseOriginalName(exercise), exercise.equipment && equipmentLabel(exercise.equipment)].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** "Tümü · 181", "Göğüs · 23", aramada "Sonuçlar · 5" (`SectionLabel` büyütür) */
export function exerciseListTitle(filterLabel: string, searching: boolean, count: number): string {
  return `${searching ? 'Sonuçlar' : filterLabel} · ${count}`;
}

/** "Son kullandıkların" yalnızca süzülmemiş listede */
export function showRecentExercises(filterId: string, search: string): boolean {
  return filterId === 'all' && search.trim().length === 0;
}

/** "80 kg"; ağırlıksız harekette null */
export function recentBestLabel(bestWeightKg: number | null): string | null {
  return bestWeightKg != null && bestWeightKg > 0 ? `${formatDecimal(bestWeightKg, 2)} kg` : null;
}
