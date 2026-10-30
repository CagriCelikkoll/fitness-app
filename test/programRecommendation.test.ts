/**
 * Program önerisi (v3.8): hedef × gün matrisinin her hücresi, bölgesel
 * split'in ana öneri olmaması (alternatif yalnızca 5 ve 6 günde), haftalık
 * kas sıklığı (Upper / Lower ×2 → her kas 2), kart metinleri ve yeni
 * şablonların kuralları (gün başına 5–7 hareket, büyük birleşik hareket
 * önce).
 */

import { describe, expect, it } from 'vitest';

import {
  ALTERNATIVE_TITLE,
  CHAIN_EXPLANATION,
  DAY_OPTIONS,
  GOAL_OPTIONS,
  MAJOR_GROUPS,
  RECOMMENDATION_GOAL_KEY,
  REGIONAL_SPLIT_IDS,
  SIX_DAYS_STEADY_NOTICE,
  TEMPLATE_PRIMARY_MUSCLE,
  getRecommendationGoal,
  majorGroupOf,
  recommendProgram,
  sessionMinutes,
  setRecommendationGoal,
  weeklyMuscleFrequency,
  weeklyMuscleSets,
  type DaysPerWeek,
  type TrainingGoal,
} from '@/lib/programRecommendation';
import type { KeyValueStore } from '@/lib/onboarding';
import { WORKOUT_TEMPLATES, getTemplate } from '@/lib/workoutTemplates';

const catalog = require('../assets/seed/exercises.json') as {
  id: string;
  primaryMuscles: string[];
  mechanic: string | null;
}[];
const byId = new Map(catalog.map((e) => [e.id, e]));

const GOALS: TrainingGoal[] = ['fast', 'steady'];

/** Spec tablosu: hedef → gün → ana öneri şablonu ve haftalık sıra */
const EXPECTED: Record<TrainingGoal, Record<DaysPerWeek, [string, number[]]>> = {
  fast: {
    2: ['fb-ab', [0, 1]],
    3: ['fb-ab', [0, 1, 0]],
    4: ['upper-lower', [0, 1, 2, 3]],
    5: ['ul-ppl', [0, 1, 2, 3, 4]],
    6: ['ppl', [0, 1, 2, 0, 1, 2]],
  },
  steady: {
    2: ['ant-post', [0, 1]],
    3: ['ppl', [0, 1, 2]],
    4: ['ant-post-4', [0, 1, 2, 3]],
    5: ['ul-fb', [0, 1, 2, 3, 4]],
    6: ['ant-post-4', [0, 1, 2, 3]],
  },
};

const NEW_TEMPLATES = ['ant-post', 'ant-post-4', 'fb-ab', 'upper-lower', 'ul-ppl', 'ul-fb', 'split5'];

describe('hedef × gün matrisi', () => {
  for (const goal of GOALS) {
    for (const days of DAY_OPTIONS) {
      it(`${goal} · ${days} gün`, () => {
        const r = recommendProgram(goal, days);
        const [templateId, schedule] = EXPECTED[goal][days];
        expect(r.main.template.id).toBe(templateId);
        expect(r.main.schedule).toEqual(schedule);
        expect(r.main.daysPerWeek).toBe(schedule.length);

        // bölgesel split hiçbir gün ana öneri değil
        expect(r.main.isRegionalSplit).toBe(false);
        expect(REGIONAL_SPLIT_IDS).not.toContain(r.main.template.id);

        // alternatif yalnızca 5 ve 6 günde, bölgesel split
        if (days >= 5) {
          expect(r.alternative?.isRegionalSplit).toBe(true);
          expect(r.alternative?.why).toBe('Her kas grubu haftada 1 kez · tecrübeli sporcular için');
        } else {
          expect(r.alternative).toBeNull();
        }

        // formu koru + 6 gün: önerilmez, 4 gün ve nedeni
        if (goal === 'steady' && days === 6) {
          expect(r.main.daysPerWeek).toBe(4);
          expect(r.notice).toBe(SIX_DAYS_STEADY_NOTICE);
        } else {
          expect(r.main.daysPerWeek).toBe(days);
          expect(r.notice).toBeNull();
        }

        expect(r.main.summary).toMatch(
          /^Her kas grubu haftada \d(–\d)? kez · seans ~\d+ dk · kas başına ~\d+ set$/
        );
        expect(r.main.why.length).toBeGreaterThan(0);
      });
    }
  }

  it('hızlı gelişim: her büyük kas haftada en az 2 kez, kas başına ~10–16 set', () => {
    for (const days of DAY_OPTIONS) {
      const { main } = recommendProgram('fast', days);
      const freq = weeklyMuscleFrequency(main.template, main.schedule);
      for (const g of MAJOR_GROUPS) expect(freq[g], `${days} gün ${g}`).toBeGreaterThanOrEqual(2);
      const sets = Object.values(weeklyMuscleSets(main.template, main.schedule));
      const avg = sets.reduce((a, b) => a + b, 0) / sets.length;
      // 2 günde tam bütün vücutla ~9 (seans uzamasın diye)
      expect(avg, `${days} gün`).toBeGreaterThanOrEqual(days === 2 ? 9 : 10);
      expect(avg, `${days} gün`).toBeLessThanOrEqual(16);
    }
  });

  it('formu koru: haftada 1–2 kez (5 günde Upper / Lower + Full body 2–3), ~6–10 set', () => {
    for (const days of DAY_OPTIONS) {
      const { main } = recommendProgram('steady', days);
      const freq = Object.values(weeklyMuscleFrequency(main.template, main.schedule));
      expect(Math.min(...freq)).toBeGreaterThanOrEqual(1);
      expect(Math.max(...freq), `${days} gün`).toBeLessThanOrEqual(days === 5 ? 3 : 2);
      const sets = Object.values(weeklyMuscleSets(main.template, main.schedule));
      const avg = sets.reduce((a, b) => a + b, 0) / sets.length;
      expect(avg, `${days} gün`).toBeGreaterThanOrEqual(5.5);
      expect(avg, `${days} gün`).toBeLessThanOrEqual(10);
    }
  });

  it('formu koru seansları hızlı gelişimden kısa (aynı gün sayısında)', () => {
    for (const days of [4, 5] as const) {
      const fast = recommendProgram('fast', days).main;
      const steady = recommendProgram('steady', days).main;
      const avg = (p: typeof fast) =>
        p.schedule.reduce((n, i) => n + p.template.days[i]!.exercises.length, 0) / p.schedule.length;
      expect(avg(steady), `${days} gün`).toBeLessThan(avg(fast));
    }
  });
});

describe('haftalık kas sıklığı', () => {
  it('Upper / Lower ×2 → her kas 2', () => {
    const ul = getTemplate('upper-lower')!;
    expect(weeklyMuscleFrequency(ul, [0, 1, 2, 3])).toEqual({
      chest: 2,
      back: 2,
      shoulders: 2,
      quads: 2,
      hamstrings: 2,
    });
    // tek tur (Üst A / Alt A) → 1
    expect(Object.values(weeklyMuscleFrequency(ul, [0, 1]))).toEqual([1, 1, 1, 1, 1]);
  });

  it('Full body A / B / A → her kas 3; PPL ×2 → 2; bölgesel split → 1', () => {
    expect(new Set(Object.values(weeklyMuscleFrequency(getTemplate('fb-ab')!, [0, 1, 0])))).toEqual(new Set([3]));
    expect(new Set(Object.values(weeklyMuscleFrequency(getTemplate('ppl')!, [0, 1, 2, 0, 1, 2])))).toEqual(new Set([2]));
    // Alternatifte gösterilen split5. (Eski split4'te omuz gününde face pull
    // var; sırtta sayıldığı için orada sırt 2 çıkıyor.)
    const split5 = getTemplate('split5')!;
    const freq = weeklyMuscleFrequency(split5, [0, 1, 2, 3, 4]);
    expect(new Set(Object.values(freq))).toEqual(new Set([1]));
  });

  it('set sayısı: gün tekrarı katlanır', () => {
    const fb = getTemplate('fb-ab')!;
    const once = weeklyMuscleSets(fb, [0]);
    const twice = weeklyMuscleSets(fb, [0, 0]);
    for (const g of MAJOR_GROUPS) expect(twice[g]).toBe(once[g] * 2);
  });

  it('seans süresi: ısınma + setler × (40 sn + dinlenme), 5 dk\'ya yuvarlı', () => {
    // 5 dk + 3 × (40 + 180) sn = 16 dk → 15
    expect(
      sessionMinutes({ name: 'x', exercises: [{ exerciseId: 'a', sets: 3, reps: '5', restSeconds: 180 }] })
    ).toBe(15);
  });

  it('kas grubu eşlemesi exercises.json ile aynı (face pull sırtta, bilinçli)', () => {
    for (const t of WORKOUT_TEMPLATES) {
      for (const d of t.days) {
        for (const e of d.exercises) {
          const muscle = TEMPLATE_PRIMARY_MUSCLE[e.exerciseId];
          expect(muscle, `${t.id}: ${e.exerciseId} eşlemede yok`).toBeDefined();
          if (e.exerciseId === 'Face_Pull') continue;
          expect(muscle).toBe(byId.get(e.exerciseId)?.primaryMuscles[0]);
        }
      }
    }
    expect(majorGroupOf('glutes')).toBe('hamstrings');
    expect(majorGroupOf('traps')).toBe('shoulders');
    expect(majorGroupOf('biceps')).toBeNull();
  });
});

describe('kart metinleri', () => {
  it('örnekler', () => {
    const ul = recommendProgram('fast', 4).main;
    expect(ul.why).toBe('4 gün için en dengeli seçenek: üst ve alt vücut ikişer kez.');
    expect(ul.summary).toMatch(/^Her kas grubu haftada 2 kez · seans ~\d+ dk · kas başına ~1\d set$/);
    expect(ul.scheduleLabel).toBe('Üst A · Alt A · Üst B · Alt B');
    expect(ul.chainNote).toBeNull();

    const fb = recommendProgram('fast', 3).main;
    expect(fb.scheduleLabel).toBe('A · B · A');
    expect(fb.daysPerWeek).toBe(3);

    expect(ALTERNATIVE_TITLE).toBe('Alternatif: Klasik bölgesel split');
  });

  it('ön / arka zincir: arayüzde Türkçe ad ve açıklama', () => {
    for (const days of [2, 4] as const) {
      const { main } = recommendProgram('steady', days);
      expect(main.template.name).toMatch(/^Ön Zincir \/ Arka Zincir/);
      expect(main.chainNote).toBe(CHAIN_EXPLANATION);
    }
    expect(CHAIN_EXPLANATION).toBe(
      'Ön: göğüs, ön omuz, quadriceps, karın. Arka: sırt, arka omuz, hamstring, kalça.'
    );
    for (const t of WORKOUT_TEMPLATES) {
      expect(`${t.name} ${t.days.map((d) => d.name).join(' ')}`).not.toMatch(/Anterior|Posterior/);
    }
  });

  it('hedef seçenekleri', () => {
    expect(GOAL_OPTIONS.map((g) => [g.title, g.subtitle])).toEqual([
      ['Hızlı gelişim', 'Kas ve güç kazanmaya odaklan'],
      ['Formu koru / istikrarlı ilerle', 'Daha kısa seanslar, sürdürülebilir tempo'],
    ]);
  });
});

describe('şablon kuralları (v3.8)', () => {
  it('eski bölgesel split şablonları listede duruyor', () => {
    expect(getTemplate('split4')).toBeDefined();
    expect(getTemplate('ppl')).toBeDefined();
  });

  it.each(NEW_TEMPLATES)('%s: gün başına 5–7 hareket, ilk hareket birleşik', (id) => {
    const t = getTemplate(id)!;
    expect(t).toBeDefined();
    for (const d of t.days) {
      expect(d.exercises.length, `${id} / ${d.name}`).toBeGreaterThanOrEqual(5);
      expect(d.exercises.length, `${id} / ${d.name}`).toBeLessThanOrEqual(7);
      expect(byId.get(d.exercises[0]!.exerciseId)?.mechanic, `${id} / ${d.name}`).toBe('compound');
    }
  });
});

describe('hedef cihazda (kv-store)', () => {
  const memory = (): KeyValueStore => {
    const data = new Map<string, string>();
    return {
      getItem: async (k) => data.get(k) ?? null,
      setItem: async (k, v) => {
        data.set(k, v);
      },
    };
  };

  it('kaydedilir ve okunur; geçersiz değer null', async () => {
    const store = memory();
    expect(await getRecommendationGoal(store)).toBeNull();
    await setRecommendationGoal(store, 'steady');
    expect(await getRecommendationGoal(store)).toBe('steady');
    await store.setItem(RECOMMENDATION_GOAL_KEY, 'xyz');
    expect(await getRecommendationGoal(store)).toBeNull();
  });
});
