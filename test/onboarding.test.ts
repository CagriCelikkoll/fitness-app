/**
 * İlk açılış (karşılama) mantığı.
 *
 * Bayrak testleri gerçek `expo-sqlite/kv-store` yerine bellek içi bir
 * depo kullanıyor: kv-store native SQLite modülünü açıyor, Node'da
 * çalışmıyor. `src/lib/onboarding.ts` depoyu parametre olarak aldığı
 * için taklit, gerçek depoyla aynı arayüzü (getItem/setItem) sağlıyor.
 */

import { describe, expect, it } from 'vitest';

import {
  ONBOARDING_FLAG_KEY,
  TRAINING_DAYS_OPTIONS,
  isOnboardingDone,
  markOnboardingDone,
  shouldShowOnboarding,
  suggestedTemplate,
  templateIdForDays,
  type KeyValueStore,
} from '@/lib/onboarding';
import { WORKOUT_TEMPLATES } from '@/lib/workoutTemplates';

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
  };
}

describe('shouldShowOnboarding', () => {
  it('bayrak set edilmişse göstermez', () => {
    expect(
      shouldShowOnboarding({ flagDone: true, routineCount: 0, sessionCount: 0 })
    ).toBe(false);
  });

  it('bayrak yok ama rutin varsa göstermez (mevcut kullanıcı)', () => {
    expect(
      shouldShowOnboarding({ flagDone: false, routineCount: 2, sessionCount: 0 })
    ).toBe(false);
  });

  it('bayrak yok ama antrenman varsa göstermez (mevcut kullanıcı)', () => {
    expect(
      shouldShowOnboarding({ flagDone: false, routineCount: 0, sessionCount: 5 })
    ).toBe(false);
  });

  it('bayrak, rutin ve antrenman yoksa gösterir', () => {
    expect(
      shouldShowOnboarding({ flagDone: false, routineCount: 0, sessionCount: 0 })
    ).toBe(true);
  });
});

describe('gün → program eşlemesi', () => {
  it('2 → ant-post, 3 → ppl, 4 → split4, kendi programı → null', () => {
    expect(templateIdForDays(2)).toBe('ant-post');
    expect(templateIdForDays(3)).toBe('ppl');
    expect(templateIdForDays(4)).toBe('split4');
    expect(templateIdForDays('custom')).toBeNull();
  });

  it('önerilen her şablon id WORKOUT_TEMPLATES içinde var', () => {
    const ids = new Set(WORKOUT_TEMPLATES.map((t) => t.id));
    for (const opt of TRAINING_DAYS_OPTIONS) {
      const id = templateIdForDays(opt.value);
      if (id != null) expect(ids.has(id), id).toBe(true);
    }
  });

  it('önerilen programın gün sayısı seçimle aynı', () => {
    for (const days of [2, 3, 4] as const) {
      expect(suggestedTemplate(days)?.dayCount).toBe(days);
    }
    expect(suggestedTemplate('custom')).toBeUndefined();
  });
});

describe('karşılama bayrağı', () => {
  it('boş depoda bayrak yok', async () => {
    expect(await isOnboardingDone(memoryStore())).toBe(false);
  });

  it('set edildikten sonra okunur', async () => {
    const store = memoryStore();
    await markOnboardingDone(store);
    expect(await isOnboardingDone(store)).toBe(true);
    expect(store.data.get(ONBOARDING_FLAG_KEY)).toBe('1');
  });

  it('beklenmeyen değer bayrak sayılmaz', async () => {
    expect(
      await isOnboardingDone(memoryStore({ [ONBOARDING_FLAG_KEY]: '0' }))
    ).toBe(false);
  });
});
