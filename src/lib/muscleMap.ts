/**
 * Veritabanı kas adları ↔ `react-native-body-highlighter` slug'ları ve
 * kas haritası için hacim/yoğunluk hesapları.
 *
 * Saf modül: React ve veritabanı bilmiyor. Kütüphaneden yalnızca tip
 * alınıyor — çalışma zamanında içe aktarmak react-native-svg'yi de
 * çekerdi, testler Node'da koşamazdı.
 *
 * Slug listesi paketin 3.2.0 sürümündeki tip tanımından ve vücut
 * modellerinden okundu. Ön/arka deltoid ayrımı ve abductors slug'ı yok;
 * `deltoids` hem ön hem arka görünümde çiziliyor. Eksik/fazla slug'ı
 * `test/muscleMap.test.ts` yakalıyor.
 */

import type { Slug } from 'react-native-body-highlighter';

/** Vücut modellerinde çizilen tüm slug'lar (kas olmayanlar dahil) */
export const BODY_SLUGS: readonly Slug[] = [
  'abs',
  'adductors',
  'ankles',
  'biceps',
  'calves',
  'chest',
  'deltoids',
  'feet',
  'forearm',
  'gluteal',
  'hair',
  'hamstring',
  'hands',
  'head',
  'knees',
  'lower-back',
  'neck',
  'obliques',
  'quadriceps',
  'tibialis',
  'trapezius',
  'triceps',
  'upper-back',
];

/**
 * Bir veritabanı kası birden fazla slug'a açılabilir (`core`), birden
 * fazla kas aynı slug'a düşebilir (`lats` + `middle back`).
 */
export const MUSCLE_SLUGS: Record<string, Slug[]> = {
  abdominals: ['abs'],
  // Kütüphanede abductor bölgesi yok; kalçayı dışa açan asıl kas gluteus
  // medius olduğu için kalçaya düşüyor.
  abductors: ['gluteal'],
  adductors: ['adductors'],
  biceps: ['biceps'],
  calves: ['calves'],
  chest: ['chest'],
  core: ['abs', 'obliques'],
  forearms: ['forearm'],
  glutes: ['gluteal'],
  hamstrings: ['hamstring'],
  lats: ['upper-back'],
  'lower back': ['lower-back'],
  'middle back': ['upper-back'],
  neck: ['neck'],
  quadriceps: ['quadriceps'],
  // Tek `deltoids` slug'ı ön ve arka görünümde birlikte boyanıyor
  shoulders: ['deltoids'],
  traps: ['trapezius'],
  triceps: ['triceps'],
};

export interface MuscleHighlight {
  slug: Slug;
  intensity: number;
}

/** Egzersiz detayındaki iki seviye */
export const EXERCISE_INTENSITY = { secondary: 1, primary: 2 } as const;

/**
 * Haftalık set eşikleri. Kas başına haftada 10-20 set yaygın bir
 * hipertrofi hedefi. `low` 0,5: yalnızca ikincil olarak çalışmış bir kas
 * da haritada görünsün.
 */
export const VOLUME_THRESHOLDS = { low: 0.5, mid: 6, high: 12 } as const;

/** Veritabanı kas adını kütüphane slug'larına çevirir */
export function toBodySlugs(muscle: string): Slug[] {
  return MUSCLE_SLUGS[muscle] ?? [];
}

/**
 * Kas → yoğunluk eşlemesini slug listesine çevirir. Aynı slug'a düşen
 * kaslardan en yüksek yoğunluk kazanıyor; toplamak `lats` + `middle back`
 * gibi ayrıntılı verilen bölgeleri olduğundan yoğun gösterirdi.
 */
function mergeHighlights(
  entries: Iterable<[muscle: string, intensity: number]>
): MuscleHighlight[] {
  const bySlug = new Map<Slug, number>();
  for (const [muscle, intensity] of entries) {
    if (intensity <= 0) continue;
    for (const slug of toBodySlugs(muscle)) {
      bySlug.set(slug, Math.max(bySlug.get(slug) ?? 0, intensity));
    }
  }
  return [...bySlug].map(([slug, intensity]) => ({ slug, intensity }));
}

/** Bir egzersizin birincil/ikincil kaslarını görsel veriye çevirir */
export function exerciseHighlight(
  primaryMuscles: string[],
  secondaryMuscles: string[]
): MuscleHighlight[] {
  return mergeHighlights([
    ...secondaryMuscles.map(
      (m): [string, number] => [m, EXERCISE_INTENSITY.secondary]
    ),
    ...primaryMuscles.map(
      (m): [string, number] => [m, EXERCISE_INTENSITY.primary]
    ),
  ]);
}

/** Set listesinden kas başına hacim hesaplar (birincil 1, ikincil 0.5) */
export function muscleVolume(
  sets: { primaryMuscles: string[]; secondaryMuscles: string[] }[]
): Record<string, number> {
  const volume: Record<string, number> = {};
  for (const set of sets) {
    for (const m of set.primaryMuscles) volume[m] = (volume[m] ?? 0) + 1;
    for (const m of set.secondaryMuscles) volume[m] = (volume[m] ?? 0) + 0.5;
  }
  return volume;
}

/** Hacmi yoğunluk seviyesine çevirir (eşiklere göre 0-3) */
export function volumeToIntensity(sets: number): number {
  if (sets >= VOLUME_THRESHOLDS.high) return 3;
  if (sets >= VOLUME_THRESHOLDS.mid) return 2;
  if (sets >= VOLUME_THRESHOLDS.low) return 1;
  return 0;
}

/** Haftalık hacmi haritaya çevirir */
export function volumeHighlight(
  volume: Record<string, number>
): MuscleHighlight[] {
  return mergeHighlights(
    Object.entries(volume).map(
      ([m, sets]): [string, number] => [m, volumeToIntensity(sets)]
    )
  );
}
