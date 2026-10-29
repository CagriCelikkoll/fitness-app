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
import { saveGoalForAddedTemplate } from '@/lib/onboarding';
import { DAY_OPTIONS, recommendProgram } from '@/lib/programRecommendation';

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
  it('önerinin haftalık gün sayısı hedef oluyor (A / B / A → 3)', async () => {
    for (const goal of ['fast', 'steady'] as const) {
      for (const days of DAY_OPTIONS) {
        const { main } = recommendProgram(goal, days);
        const { store } = memoryStore();
        await saveGoalForAddedTemplate(store, { dayCount: main.daysPerWeek });
        // Formu koru + 6 gün: 4 gün önerilir, hedef 4
        expect(await getWeeklyGoal(store), `${goal} ${days}`).toBe(
          goal === 'steady' && days === 6 ? 4 : days
        );
      }
    }
  });

  it('program eklenince mevcut hedefin üzerine yazıyor', async () => {
    const { store } = memoryStore({ [WEEKLY_GOAL_KEY]: '5' });
    await saveGoalForAddedTemplate(store, { dayCount: recommendProgram('fast', 3).main.daysPerWeek });
    expect(await getWeeklyGoal(store)).toBe(3);
  });
});
