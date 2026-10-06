/**
 * Haftalık antrenman hedefi: haftada kaç gün (1-7) ya da hedef yok.
 *
 * Karşılama bayrağı gibi `expo-sqlite/kv-store`'da tutuluyor (şema
 * değişikliği yok). Depo parametre olarak alınıyor; bu dosya Expo native
 * modülünü içe aktarmıyor, testte bellek içi taklitle çalışıyor.
 */

import type { KeyValueStore } from '@/lib/onboarding';

/** kv-store'daki anahtar. Değiştirme: mevcut cihazlarda hedef kaybolur. */
export const WEEKLY_GOAL_KEY = 'weeklyGoalDays';

export const MIN_WEEKLY_GOAL = 1;
export const MAX_WEEKLY_GOAL = 7;

export interface RemovableKeyValueStore extends KeyValueStore {
  removeItem(key: string): Promise<void>;
}

export function isValidWeeklyGoal(days: number): boolean {
  return (
    Number.isInteger(days) && days >= MIN_WEEKLY_GOAL && days <= MAX_WEEKLY_GOAL
  );
}

/** Depodaki ham değer → 1-7 ya da null (yok / bozuk değer) */
export function parseWeeklyGoal(raw: string | null): number | null {
  if (raw == null || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return isValidWeeklyGoal(n) ? n : null;
}

export async function getWeeklyGoal(store: KeyValueStore): Promise<number | null> {
  return parseWeeklyGoal(await store.getItem(WEEKLY_GOAL_KEY));
}

/** `null` hedefi kaldırır. 1-7 dışı değer hata fırlatır. */
export async function setWeeklyGoal(
  store: RemovableKeyValueStore,
  days: number | null
): Promise<void> {
  if (days == null) {
    await store.removeItem(WEEKLY_GOAL_KEY);
    return;
  }
  if (!isValidWeeklyGoal(days)) {
    throw new Error(`Geçersiz haftalık hedef: ${days}`);
  }
  await store.setItem(WEEKLY_GOAL_KEY, String(days));
}
