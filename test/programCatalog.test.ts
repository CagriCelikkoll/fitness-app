import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  DAY_FILTERS,
  PROGRAM_CATALOG,
  defaultFeaturedProgram,
  loadFeaturedProgram,
  matchesDayFilter,
  programCatalogView,
  resolveFeaturedProgram,
  templateContext,
  templateCoverLabel,
  templateCoverStats,
} from '@/lib/programCatalog';
import {
  RECOMMENDATION_DAYS_KEY,
  RECOMMENDATION_GOAL_KEY,
  parseDaysPerWeek,
  recommendProgram,
  setRecommendationDays,
} from '@/lib/programRecommendation';
import { WEEKLY_GOAL_KEY } from '@/lib/weeklyGoal';
import { WORKOUT_TEMPLATES, getTemplate } from '@/lib/workoutTemplates';

const memoryStore = (seed: Record<string, string> = {}) => {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: async (key: string) => data.get(key) ?? null,
    setItem: async (key: string, value: string) => void data.set(key, value),
  };
};

const source = (path: string) => readFileSync(path, 'utf8');

describe('hazır program kataloğu', () => {
  it('her şablon katalogda tam bir kez ve alt satırı var', () => {
    expect(PROGRAM_CATALOG.map((c) => c.id).sort()).toEqual(WORKOUT_TEMPLATES.map((t) => t.id).sort());
    for (const c of PROGRAM_CATALOG) expect(c.tagline.length).toBeGreaterThan(0);
  });

  it('filtreler spec sırasında ve gün aralıkları doğru', () => {
    expect(DAY_FILTERS.map((f) => f.label)).toEqual(['Tümü', '2–3 gün', '4 gün', '5+ gün']);
    expect([2, 3, 4, 5, 6].filter((d) => matchesDayFilter(d, '2-3'))).toEqual([2, 3]);
    expect([2, 3, 4, 5, 6].filter((d) => matchesDayFilter(d, '4'))).toEqual([4]);
    expect([2, 3, 4, 5, 6].filter((d) => matchesDayFilter(d, '5+'))).toEqual([5, 6]);
    expect([2, 3, 4, 5, 6].filter((d) => matchesDayFilter(d, 'all'))).toEqual([2, 3, 4, 5, 6]);
  });

  it('her filtrede en az bir program var', () => {
    for (const { id } of DAY_FILTERS) {
      const view = programCatalogView(id, defaultFeaturedProgram());
      expect(view.cards.length + (view.featured ? 1 : 0)).toBeGreaterThan(0);
    }
  });

  it('kart içeriği: gün etiketi, alt satır, kapak', () => {
    const cards = programCatalogView('all', recommendProgram('fast', 4).main).cards;
    const fb = cards.find((c) => c.template.id === 'fb-ab')!;
    expect(fb.dayLabel).toBe('2–3 GÜN');
    expect(fb.tagline).toBe('Yeni başlayanlara');
    expect(fb.cover).toBe('fullbody-farmer');
    expect(cards.find((c) => c.template.id === 'split5')!.dayLabel).toBe('5 GÜN');
  });

  it('kartın rengi kapağın bölgesi', () => {
    expect(templateContext('upper-lower')).toBe('upper');
    expect(templateContext('ant-post-4')).toBe('lower');
    expect(templateContext('fb-ab')).toBe('full');
  });

  it('kapak etiketi ve seans süresi', () => {
    const t = getTemplate('upper-lower')!;
    expect(templateCoverLabel(t)).toMatch(/^4 GÜN · \d+ HAREKET$/);
    expect(templateCoverStats(t)).toMatch(/^Seans ~\d+ dk$/);
  });
});

describe('önerilen kart', () => {
  it('seçim yoksa en temel program', () => {
    expect(defaultFeaturedProgram().template.id).toBe('fb-ab');
    expect(resolveFeaturedProgram(null, null).template.id).toBe('fb-ab');
    expect(resolveFeaturedProgram('steady', null).template.id).toBe('fb-ab');
    expect(resolveFeaturedProgram(null, 4).template.id).toBe('fb-ab');
  });

  it('hedef + gün varsa öneri motorunun sonucu', () => {
    expect(resolveFeaturedProgram('fast', 4).template.id).toBe('upper-lower');
    expect(resolveFeaturedProgram('steady', 4).template.id).toBe('ant-post-4');
  });

  it('rozet ve satır biçimi', () => {
    const { featured } = programCatalogView('all', recommendProgram('fast', 4).main);
    expect(featured!.badge).toBe('ÖNERİLEN · 4 GÜN');
    expect(featured!.line).toMatch(/^Her kas haftada 2 kez · seans ~\d+ dk$/);
    expect(featured!.cover).toBe('rutin-ust-row');
  });

  it('listede tekrar etmez', () => {
    const view = programCatalogView('all', recommendProgram('fast', 4).main);
    expect(view.cards.map((c) => c.template.id)).not.toContain('upper-lower');
    expect(view.cards).toHaveLength(WORKOUT_TEMPLATES.length - 1);
  });

  it('filtre dışındaysa gizlenir, program kendi gün grubunda kalır', () => {
    const main = recommendProgram('fast', 4).main;
    const view = programCatalogView('2-3', main);
    expect(view.featured).toBeNull();
    expect(view.cards.map((c) => c.template.id)).not.toContain('upper-lower');
    expect(programCatalogView('4', main).featured?.template.id).toBe('upper-lower');
  });

  it('haftada 6 günlük PPL: önerilen 5+ altında, kart 2–3 altında', () => {
    const main = recommendProgram('fast', 6).main;
    expect(main.template.id).toBe('ppl');
    const five = programCatalogView('5+', main);
    expect(five.featured?.badge).toBe('ÖNERİLEN · 6 GÜN');
    expect(five.cards.map((c) => c.template.id)).not.toContain('ppl');
    const short = programCatalogView('2-3', main);
    expect(short.featured).toBeNull();
    expect(short.cards.map((c) => c.template.id)).toContain('ppl');
  });
});

describe('önerinin kaydedilen seçimi', () => {
  it('son gün seçimi haftalık hedeften önce gelir', async () => {
    const store = memoryStore({ [RECOMMENDATION_GOAL_KEY]: 'fast', [WEEKLY_GOAL_KEY]: '2' });
    await setRecommendationDays(store, 4);
    expect((await loadFeaturedProgram(store)).template.id).toBe('upper-lower');
  });

  it('gün seçimi yoksa haftalık hedef', async () => {
    const store = memoryStore({ [RECOMMENDATION_GOAL_KEY]: 'fast', [WEEKLY_GOAL_KEY]: '4' });
    expect((await loadFeaturedProgram(store)).template.id).toBe('upper-lower');
  });

  it('2–6 dışındaki haftalık hedef ve "kendi programım" seçim sayılmaz', async () => {
    expect((await loadFeaturedProgram(memoryStore({ [RECOMMENDATION_GOAL_KEY]: 'fast', [WEEKLY_GOAL_KEY]: '7' }))).template.id).toBe('fb-ab');
    const store = memoryStore({ [RECOMMENDATION_GOAL_KEY]: 'fast' });
    await setRecommendationDays(store, 'custom');
    expect(store.data.get(RECOMMENDATION_DAYS_KEY)).toBe('custom');
    expect((await loadFeaturedProgram(store)).template.id).toBe('fb-ab');
  });

  it('hiç kayıt yoksa en temel program', async () => {
    expect((await loadFeaturedProgram(memoryStore())).template.id).toBe('fb-ab');
  });

  it('gün değeri ayrıştırma', () => {
    expect(parseDaysPerWeek('4')).toBe(4);
    expect(parseDaysPerWeek(6)).toBe(6);
    expect(parseDaysPerWeek('1')).toBeNull();
    expect(parseDaysPerWeek('custom')).toBeNull();
    expect(parseDaysPerWeek(null)).toBeNull();
  });
});

describe('ekranlar', () => {
  it('liste: öneri satırı, filtre, önerilen ve kartlar', () => {
    const list = source('app/templates/index.tsx');
    expect(list).toContain('href="/templates/recommend"');
    expect(list).toContain('label="Bana program öner"');
    expect(list).toContain('DAY_FILTERS.map');
    expect(list).toContain('<FeaturedProgram');
    expect(list).toContain('<GridProgram');
  });

  it('detay: kapak, günler, onaylı ekleme, hareket detayı', () => {
    const detail = source('app/templates/[id].tsx');
    expect(detail).toContain('variant="page"');
    expect(detail).toContain('label="Rutinlerime ekle"');
    expect(detail).toContain('applyTemplate(db, t)');
    expect(detail).toContain("'Vazgeç'");
    expect(detail).toContain("pathname: '/exercise/[id]'");
    expect(detail).toContain('template.description');
    expect(detail).not.toContain('Paylaş');
  });

  it('kendi başlıkları var: yığın başlığı kapalı', () => {
    const layout = source('app/_layout.tsx');
    for (const name of ['templates/index', 'templates/[id]']) {
      expect(layout).toMatch(new RegExp(`name="${name.replace(/[[\]]/g, '\\$&')}"\\s+options=\\{\\{ headerShown: false \\}\\}`));
    }
  });
});
