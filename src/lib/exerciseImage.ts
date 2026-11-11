/**
 * Free Exercise DB GitHub'da hostlanan görsellerin URL'lerini üretir.
 *
 * İleride bunları kendi Cloudflare R2 CDN'ine taşıyacağız ve burayı
 * tek bir noktadan değiştireceğiz. Şu an doğrudan GitHub'dan çekiyoruz
 * (geliştirme için yeterli, production için R2'ye geçilecek).
 */

import { LOWER_MUSCLES, musclesOf } from './contextColor';

const GITHUB_BASE =
  'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises';

// İleride: const CDN_BASE = 'https://cdn.fitnesstracker.app/exercises';

/**
 * expo-image önbellek politikası — görseller bellek + diskte tutuluyor,
 * bir kez görülen ya da ön yüklenen görsel internetsiz de görünüyor.
 * Gösterim ve ön yükleme aynı politikayı kullanmalı.
 */
export const EXERCISE_IMAGE_CACHE = 'memory-disk' as const;

/**
 * Image path JSON array string'inden tam URL listesi üretir.
 * @param imagePaths - schema'daki exercises.image_paths alanı (JSON string)
 */
export function getExerciseImageUrls(imagePaths: string | null): string[] {
  if (!imagePaths) return [];
  try {
    const paths: string[] = JSON.parse(imagePaths);
    return paths.map((p) => `${GITHUB_BASE}/${p}`);
  } catch {
    return [];
  }
}

/**
 * Tek bir görsel URL'i — tipik olarak ilk görseli kullanırız (kapak için).
 */
export function getExerciseCoverUrl(imagePaths: string | null): string | null {
  const urls = getExerciseImageUrls(imagePaths);
  return urls[0] ?? null;
}

export type ExerciseIconKind = 'cardio' | 'arms' | 'torso' | 'legs' | 'core';

const ARM_MUSCLES = new Set(['biceps', 'triceps', 'forearms']);
const CORE_MUSCLES = new Set(['abdominals', 'core', 'neck']);

/** Görsel yokken / yüklenemezken gösterilen kas grubu ikonu */
export function exerciseIconKind(category: string | null | undefined, primaryMuscles: string | null | undefined): ExerciseIconKind {
  if (category === 'cardio') return 'cardio';
  const first = musclesOf(primaryMuscles)[0];
  if (first == null) return 'torso';
  if (LOWER_MUSCLES.has(first)) return 'legs';
  if (ARM_MUSCLES.has(first)) return 'arms';
  if (CORE_MUSCLES.has(first)) return 'core';
  return 'torso';
}
