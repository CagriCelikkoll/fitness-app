/**
 * İlk açılış (karşılama) akışının saf mantığı.
 *
 * "Karşılama gösterildi" bayrağı `app_settings`'te değil, expo-sqlite'ın
 * anahtar-değer deposunda (`expo-sqlite/kv-store`) tutuluyor: şema
 * değişikliği/migration gerektirmiyor. Depo burada parametre olarak
 * alınıyor ki bu dosya Expo native modülünü içe aktarmasın ve testte
 * bellek içi bir taklitle denenebilsin.
 */

import type { DaysPerWeek } from '@/lib/programRecommendation';
import type { WorkoutTemplate } from '@/lib/workoutTemplates';
import { setWeeklyGoal, type RemovableKeyValueStore } from '@/lib/weeklyGoal';

/** kv-store'daki anahtar. Değiştirme: mevcut cihazlarda bayrak kaybolur. */
export const ONBOARDING_FLAG_KEY = 'onboarding.done';

/** `expo-sqlite/kv-store` varsayılan örneğinin kullandığımız kısmı */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export async function isOnboardingDone(store: KeyValueStore): Promise<boolean> {
  return (await store.getItem(ONBOARDING_FLAG_KEY)) === '1';
}

export async function markOnboardingDone(store: KeyValueStore): Promise<void> {
  await store.setItem(ONBOARDING_FLAG_KEY, '1');
}

/**
 * Karşılama sadece gerçekten yeni kullanıcıya gösterilir. Bayrağı
 * olmayan ama rutini ya da antrenmanı olan kullanıcı, karşılama
 * eklenmeden önce uygulamayı kullanmaya başlamış demektir: ona
 * gösterilmez (çağıran bayrağı sessizce set eder).
 */
export function shouldShowOnboarding({
  flagDone,
  routineCount,
  sessionCount,
}: {
  flagDone: boolean;
  routineCount: number;
  sessionCount: number;
}): boolean {
  if (flagDone) return false;
  return routineCount === 0 && sessionCount === 0;
}

/**
 * "Haftada kaç gün?" sorusunun seçenekleri (v3.8: 2–6 gün). Öneri hedefe
 * ve güne göre `programRecommendation.ts`'te.
 */
export type TrainingDaysChoice = DaysPerWeek | 'custom';

export const TRAINING_DAYS_OPTIONS: { value: TrainingDaysChoice; label: string }[] = [
  { value: 2, label: '2 gün' },
  { value: 3, label: '3 gün' },
  { value: 4, label: '4 gün' },
  { value: 5, label: '5 gün' },
  { value: 6, label: '6 gün' },
  { value: 'custom', label: 'Kendi programımı kuracağım' },
];

/**
 * Karşılamada "Bu programı ekle"ye basılınca önerinin haftalık gün
 * sayısını (A / B / A → 3) haftalık hedef yapar. Sadece seçim yapıp
 * program eklemeyen ya da "Kendi programımı kuracağım"ı seçen kullanıcı
 * için çağrılmaz:
 * karşılama Ayarlar'dan yeniden açılsa da mevcut hedef korunur.
 */
export async function saveGoalForAddedTemplate(
  store: RemovableKeyValueStore,
  template: Pick<WorkoutTemplate, 'dayCount'>
): Promise<void> {
  await setWeeklyGoal(store, template.dayCount);
}
