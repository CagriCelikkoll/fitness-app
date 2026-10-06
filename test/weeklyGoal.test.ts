/**
 * Haftalık hedef deposu. Gerçek `expo-sqlite/kv-store` Node'da native
 * modül açamadığı için bellek içi taklit kullanılıyor (karşılama
 * bayrağındaki gibi).
 */

import { describe, expect, it } from 'vitest';

import {
  WEEKLY_GOAL_KEY,
  getWeeklyGoal,
  parseWeeklyGoal,
  setWeeklyGoal,
  type RemovableKeyValueStore,
} from '@/lib/weeklyGoal';
import { saveGoalForAddedTemplate, suggestedTemplate } from '@/lib/onboarding';

function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const store: RemovableKeyValueStore = {
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
    removeItem: async (key) => {
      data.delete(key);
    },
  };
  return { store, data };
}

describe('haftalık hedef deposu', () => {
  it('boş depoda hedef yok', async () => {
    expect(await getWeeklyGoal(memoryStore().store)).toBeNull();
  });

  it('yazılan hedef okunuyor', async () => {
    const { store, data } = memoryStore();
    await setWeeklyGoal(store, 4);
    expect(await getWeeklyGoal(store)).toBe(4);
    expect(data.get(WEEKLY_GOAL_KEY)).toBe('4');
  });

  it('null hedefi kaldırıyor', async () => {
    const { store, data } = memoryStore({ [WEEKLY_GOAL_KEY]: '3' });
    await setWeeklyGoal(store, null);
    expect(data.has(WEEKLY_GOAL_KEY)).toBe(false);
    expect(await getWeeklyGoal(store)).toBeNull();
  });

  it('1-7 dışı değer yazılmıyor', async () => {
    const { store, data } = memoryStore({ [WEEKLY_GOAL_KEY]: '3' });
    for (const bad of [0, 8, -1, 2.5, NaN]) {
      await expect(setWeeklyGoal(store, bad)).rejects.toThrow();
    }
    expect(data.get(WEEKLY_GOAL_KEY)).toBe('3');
  });

  it('depodaki bozuk değer hedef sayılmıyor', () => {
    for (const raw of ['0', '8', '2.5', 'abc', '', ' 3', null]) {
      expect(parseWeeklyGoal(raw)).toBeNull();
    }
    expect(parseWeeklyGoal('1')).toBe(1);
    expect(parseWeeklyGoal('7')).toBe(7);
  });
});

// Karşılamada hedef seçimde değil, "Bu programı ekle"de yazılıyor. Seçim
// yapıp eklemeyen ya da "kendi programım"ı seçen için fonksiyon hiç
// çağrılmıyor (app/onboarding.tsx); burada eklenen programın etkisi test
// ediliyor.
describe('karşılamadan hedef', () => {
  it('eklenen programın gün sayısı hedef oluyor (2/3/4 gün önerileri)', async () => {
    for (const days of [2, 3, 4] as const) {
      const template = suggestedTemplate(days);
      expect(template, `${days} gün`).toBeDefined();
      const { store } = memoryStore();
      await saveGoalForAddedTemplate(store, template!);
      expect(await getWeeklyGoal(store)).toBe(days);
    }
  });

  it('program eklenince mevcut hedefin üzerine yazıyor', async () => {
    const { store } = memoryStore({ [WEEKLY_GOAL_KEY]: '5' });
    await saveGoalForAddedTemplate(store, suggestedTemplate(3)!);
    expect(await getWeeklyGoal(store)).toBe(3);
  });

  it('"kendi programım" için önerilen program yok, hedefe yazılacak bir şey yok', () => {
    expect(suggestedTemplate('custom')).toBeUndefined();
  });
});
