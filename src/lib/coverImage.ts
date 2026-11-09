/**
 * Kapak görseli seçimi (v4.0b Bölüm 2) — saf. Görsel dosyalarını bilmez;
 * anahtar döner, `src/components/CoverImage.tsx` anahtarı dosyaya çevirir.
 *
 * Seçim kararlı: rutin kimliğinin özeti havuzdaki sırayı belirler, kayıt
 * tutulmaz (veritabanında ve eşitlemede sütun yok). Aynı programın günleri
 * `assignCovers` ile mümkünse farklı görseller alır.
 */

import { contextColorFor, type BodyContext, type ContextExercise } from '@/lib/contextColor';

export const WORKOUT_COVERS = [
  'rutin-ust-bench',
  'rutin-ust-row',
  'ust-barfiks',
  'ust-omuz-press',
  'alt-squat',
  'alt-deadlift',
  'alt-lunge',
  'fullbody-farmer',
  'kardiyo-kurek',
] as const;

export const SCREEN_COVERS = ['karsilama', 'karsilama-2-kayit', 'karsilama-3-gelisim', 'rekor'] as const;

export type WorkoutCover = (typeof WORKOUT_COVERS)[number];
export type CoverKey = WorkoutCover | (typeof SCREEN_COVERS)[number];
export type CoverKind = BodyContext | 'cardio';

/** Rutinin kendi havuzu: tek başına seçilirken yalnızca buradan */
export const COVER_POOLS: Record<CoverKind, readonly WorkoutCover[]> = {
  upper: ['rutin-ust-bench', 'rutin-ust-row', 'ust-barfiks', 'ust-omuz-press'],
  lower: ['alt-squat', 'alt-deadlift', 'alt-lunge'],
  full: ['fullbody-farmer'],
  cardio: ['kardiyo-kurek'],
};

/** Aynı programda havuz bittiyse (birkaç full body günü) */
const COVER_SPILL: Partial<Record<CoverKind, readonly WorkoutCover[]>> = {
  full: ['rutin-ust-bench', 'alt-squat'],
};

/** Setlerin yarısından fazlası kardiyoysa kürek kapağı */
export const CARDIO_COVER_SHARE = 0.5;

export function coverKindFor(exercises: readonly ContextExercise[]): CoverKind {
  const counted = exercises.filter((e) => e.sets > 0);
  const total = counted.reduce((sum, e) => sum + e.sets, 0);
  const cardio = counted.filter((e) => e.category === 'cardio').reduce((sum, e) => sum + e.sets, 0);
  if (total > 0 && cardio / total > CARDIO_COVER_SHARE) return 'cardio';
  return contextColorFor(exercises);
}

/** FNV-1a (32 bit): kısa, cihazdan bağımsız, kimlikler arasında iyi dağılır */
export function stableHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Tek rutin / program: aynı kimlik her açılışta aynı görsel */
export function coverFor(id: string, kind: CoverKind): WorkoutCover {
  const pool = COVER_POOLS[kind];
  return pool[stableHash(id) % pool.length]!;
}

export interface CoverItem {
  id: string;
  kind: CoverKind;
}

/**
 * Bir arada görünen rutinler (aynı programın günleri): her biri kendi
 * sırasından başlar, alınmış görselin yerine sıradaki boş olanı seçer; boş
 * kalmadıysa tekrar eder. Sonuç listenin sırasına bağlı değil.
 */
export function assignCovers(items: readonly CoverItem[]): Map<string, WorkoutCover> {
  const taken = new Set<WorkoutCover>();
  const result = new Map<string, WorkoutCover>();
  for (const { id, kind } of [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const pool = COVER_POOLS[kind];
    const start = stableHash(id) % pool.length;
    const rotated = pool.map((_, i) => pool[(start + i) % pool.length]!);
    const cover = [...rotated, ...(COVER_SPILL[kind] ?? [])].find((c) => !taken.has(c)) ?? rotated[0]!;
    taken.add(cover);
    result.set(id, cover);
  }
  return result;
}

/** Hazır programların sabit kapağı (`workoutTemplates.ts` kimlikleri) */
export const TEMPLATE_COVERS: Record<string, WorkoutCover> = {
  ppl: 'rutin-ust-bench',
  split4: 'ust-omuz-press',
  'ant-post': 'alt-deadlift',
  'ant-post-4': 'alt-squat',
  'fb-ab': 'fullbody-farmer',
  'upper-lower': 'rutin-ust-row',
  'ul-ppl': 'ust-barfiks',
  'ul-fb': 'alt-lunge',
  split5: 'rutin-ust-row',
};

export function templateCover(templateId: string): WorkoutCover {
  return TEMPLATE_COVERS[templateId] ?? 'fullbody-farmer';
}

// ── Karartma ───────────────────────────────────────────────────────────

export interface GradientStop {
  /** Görselin yüksekliğine oranı: 0 üst, 1 alt */
  offset: number;
  /** Zemin renginin opaklığı */
  opacity: number;
}

export type CoverVariant = 'page' | 'card';

/**
 * Aşağı doğru `bg`'ye geçer. `page` (tam genişlik kapak): üstte geri / ⋯
 * düğmeleri için hafif karartma, yazı görselin alt kısmına biner. `card`
 * (rutin kartı): yazı kartın alt yarısında.
 */
export const COVER_GRADIENTS: Record<CoverVariant, readonly GradientStop[]> = {
  page: [
    { offset: 0, opacity: 0.45 },
    { offset: 0.22, opacity: 0 },
    { offset: 0.43, opacity: 0 },
    { offset: 0.77, opacity: 0.85 },
    { offset: 1, opacity: 1 },
  ],
  card: [
    { offset: 0, opacity: 0 },
    { offset: 0.45, opacity: 0.62 },
    { offset: 0.8, opacity: 0.92 },
    { offset: 1, opacity: 0.96 },
  ],
};

/** Yazının başladığı yükseklikte karartma (`test/coverImage.test.ts` okunurluk) */
export function gradientOpacityAt(stops: readonly GradientStop[], offset: number): number {
  const next = stops.findIndex((s) => s.offset >= offset);
  if (next <= 0) return stops[Math.max(next, 0)]?.opacity ?? 0;
  const a = stops[next - 1]!;
  const b = stops[next]!;
  return a.opacity + ((b.opacity - a.opacity) * (offset - a.offset)) / (b.offset - a.offset);
}
