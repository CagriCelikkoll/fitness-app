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
  type KeyValueStore,
} from '@/lib/onboarding';
import { DAY_OPTIONS } from '@/lib/programRecommendation';

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

// Gün × hedef → program eşlemesi test/programRecommendation.test.ts'te
describe('gün seçenekleri (v3.8)', () => {
  it('2–6 gün ve "kendi programım"', () => {
    expect(TRAINING_DAYS_OPTIONS.map((o) => o.value)).toEqual([...DAY_OPTIONS, 'custom']);
    expect(TRAINING_DAYS_OPTIONS.map((o) => o.label)).toEqual([
      '2 gün',
      '3 gün',
      '4 gün',
      '5 gün',
      '6 gün',
      'Kendi programımı kuracağım',
    ]);
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
