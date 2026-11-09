/**
 * Hazır programlar ekranı (v4.0b Bölüm 6) — saf: gün filtresi, önerilen kart
 * ve iki sütunlu kartların içeriği.
 *
 * Önerilen: kullanıcının hedef + gün seçimi varsa `recommendProgram`, yoksa
 * en temel program (Full Body A / B, haftada 2 gün).
 */

import { COVER_POOLS, templateCover, type WorkoutCover } from '@/lib/coverImage';
import type { BodyContext } from '@/lib/contextColor';
import type { KeyValueStore } from '@/lib/onboarding';
import {
  averageSessionMinutes,
  getRecommendationDays,
  getRecommendationGoal,
  parseDaysPerWeek,
  recommendProgram,
  type DaysPerWeek,
  type RecommendedProgram,
  type TrainingGoal,
} from '@/lib/programRecommendation';
import { getWeeklyGoal } from '@/lib/weeklyGoal';
import { getTemplate, templateExerciseCount, type WorkoutTemplate } from '@/lib/workoutTemplates';

export type DayFilter = 'all' | '2-3' | '4' | '5+';

export const DAY_FILTERS: readonly { id: DayFilter; label: string }[] = [
  { id: 'all', label: 'Tümü' },
  { id: '2-3', label: '2–3 gün' },
  { id: '4', label: '4 gün' },
  { id: '5+', label: '5+ gün' },
];

export function matchesDayFilter(days: number, filter: DayFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case '2-3':
      return days <= 3;
    case '4':
      return days === 4;
    case '5+':
      return days >= 5;
  }
}

/** Kart sırası ve alt satırı; yeni şablon buraya da eklenir (test denetliyor) */
export const PROGRAM_CATALOG: readonly { id: string; tagline: string; dayLabel?: string }[] = [
  { id: 'fb-ab', tagline: 'Yeni başlayanlara', dayLabel: '2–3 GÜN' },
  { id: 'ant-post', tagline: 'Formu koru' },
  { id: 'ppl', tagline: 'Klasik üçlü' },
  { id: 'upper-lower', tagline: 'Dengeli dört gün' },
  { id: 'ant-post-4', tagline: 'Kısa seanslar' },
  { id: 'split4', tagline: 'Bölgesel split' },
  { id: 'ul-ppl', tagline: 'Tecrübeliler için' },
  { id: 'ul-fb', tagline: 'Sürdürülebilir tempo' },
  { id: 'split5', tagline: 'Tecrübeliler için' },
];

export function defaultFeaturedProgram(): RecommendedProgram {
  return recommendProgram('fast', 2).main;
}

export function resolveFeaturedProgram(goal: TrainingGoal | null, days: DaysPerWeek | null): RecommendedProgram {
  return goal != null && days != null ? recommendProgram(goal, days).main : defaultFeaturedProgram();
}

/**
 * Gün: öneri ekranındaki son seçim; o yoksa haftalık hedef (seçim kaydı
 * gelmeden program eklemiş kullanıcılar için).
 */
export async function loadFeaturedProgram(store: KeyValueStore): Promise<RecommendedProgram> {
  const [goal, savedDays, weeklyGoal] = await Promise.all([
    getRecommendationGoal(store),
    getRecommendationDays(store),
    getWeeklyGoal(store),
  ]);
  return resolveFeaturedProgram(goal, savedDays ?? parseDaysPerWeek(weeklyGoal));
}

/** Kartın rengi görseliyle aynı bölgeden: squat kapağı turuncu, row mavi */
export function templateContext(templateId: string): BodyContext {
  const cover = templateCover(templateId);
  if (COVER_POOLS.upper.includes(cover)) return 'upper';
  if (COVER_POOLS.lower.includes(cover)) return 'lower';
  return 'full';
}

export interface ProgramCard {
  template: WorkoutTemplate;
  cover: WorkoutCover;
  context: BodyContext;
  dayLabel: string;
  tagline: string;
}

export interface FeaturedCard {
  template: WorkoutTemplate;
  cover: WorkoutCover;
  /** "ÖNERİLEN · 4 GÜN" */
  badge: string;
  /** "Her kas haftada 2 kez · seans ~55 dk" */
  line: string;
}

export interface ProgramCatalogView {
  featured: FeaturedCard | null;
  cards: ProgramCard[];
}

/**
 * Önerilen kart haftalık gün sayısına göre süzülür (rozetteki sayı), diğerleri
 * programın kendi gün sayısına. Önerilen göründüğü sürece listede tekrar etmez.
 */
export function programCatalogView(filter: DayFilter, program: RecommendedProgram): ProgramCatalogView {
  const showFeatured = matchesDayFilter(program.daysPerWeek, filter);
  const cards: ProgramCard[] = [];
  for (const { id, tagline, dayLabel } of PROGRAM_CATALOG) {
    const template = getTemplate(id);
    if (!template || !matchesDayFilter(template.dayCount, filter)) continue;
    if (showFeatured && id === program.template.id) continue;
    cards.push({
      template,
      cover: templateCover(id),
      context: templateContext(id),
      dayLabel: dayLabel ?? `${template.dayCount} GÜN`,
      tagline,
    });
  }
  return {
    featured: showFeatured
      ? {
          template: program.template,
          cover: templateCover(program.template.id),
          badge: `ÖNERİLEN · ${program.daysPerWeek} GÜN`,
          line: program.shortSummary,
        }
      : null,
    cards,
  };
}

/** Program kapağındaki etiket: "4 GÜN · 24 HAREKET" */
export function templateCoverLabel(template: WorkoutTemplate): string {
  return `${template.dayCount} GÜN · ${templateExerciseCount(template)} HAREKET`;
}

/** Program kapağındaki alt satır: her gün bir kez */
export function templateCoverStats(template: WorkoutTemplate): string {
  return `Seans ~${averageSessionMinutes(template, template.days.map((_, i) => i))} dk`;
}
