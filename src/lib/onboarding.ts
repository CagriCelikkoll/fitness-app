/**
 * İlk açılış (karşılama) akışının saf mantığı.
 *
 * "Karşılama gösterildi" bayrağı `app_settings`'te değil, expo-sqlite'ın
 * anahtar-değer deposunda (`expo-sqlite/kv-store`) tutuluyor: şema
 * değişikliği/migration gerektirmiyor. Depo burada parametre olarak
 * alınıyor ki bu dosya Expo native modülünü içe aktarmasın ve testte
 * bellek içi bir taklitle denenebilsin.
 */

import { getTemplate } from '@/lib/workoutTemplates';

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

/** "Haftada kaç gün?" sorusunun seçenekleri */
export type TrainingDaysChoice = 2 | 3 | 4 | 'custom';

export const TRAINING_DAYS_OPTIONS: { value: TrainingDaysChoice; label: string }[] = [
  { value: 2, label: '2 gün' },
  { value: 3, label: '3 gün' },
  { value: 4, label: '4 gün' },
  { value: 'custom', label: 'Kendi programımı kuracağım' },
];

const TEMPLATE_BY_DAYS: Record<2 | 3 | 4, string> = {
  2: 'ant-post',
  3: 'ppl',
  4: 'split4',
};

/** Seçime önerilen hazır programın id'si; kendi programını kuracaksa null */
export function templateIdForDays(choice: TrainingDaysChoice): string | null {
  return choice === 'custom' ? null : TEMPLATE_BY_DAYS[choice];
}

/** Önerilen program; kendi programını kuracaksa ya da id bulunamazsa undefined */
export function suggestedTemplate(choice: TrainingDaysChoice) {
  const id = templateIdForDays(choice);
  return id == null ? undefined : getTemplate(id);
}
