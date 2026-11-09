/**
 * v4.0b Bölüm 2: kapak görseli seçimi (kararlılık, havuzlar, kardiyo, aynı
 * programın günleri), dosyalar ve karartmanın okunurluğu.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  COVER_GRADIENTS,
  COVER_POOLS,
  SCREEN_COVERS,
  TEMPLATE_COVERS,
  WORKOUT_COVERS,
  assignCovers,
  coverFor,
  coverKindFor,
  gradientOpacityAt,
  stableHash,
  templateCover,
} from '@/lib/coverImage';
import { WORKOUT_TEMPLATES } from '@/lib/workoutTemplates';

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'assets/images/kapak');
const ids = Array.from({ length: 400 }, (_, i) => `rutin-${i}-${(i * 7919).toString(36)}`);
const ex = (muscles: string[], sets: number, category = 'strength') => ({ primaryMuscles: muscles, sets, category });

describe('kararlı seçim', () => {
  it('aynı kimlik hep aynı görsel; özet sabit', () => {
    expect(stableHash('abc')).toBe(0x1a47e90b);
    for (const id of ids.slice(0, 20)) expect(coverFor(id, 'upper')).toBe(coverFor(id, 'upper'));
  });

  it('havuzun bütün görselleri kullanılıyor (tek görsele yığılmıyor)', () => {
    for (const kind of ['upper', 'lower'] as const) {
      const seen = new Set(ids.map((id) => coverFor(id, kind)));
      expect([...seen].sort()).toEqual([...COVER_POOLS[kind]].sort());
    }
  });
});

describe('havuzlar', () => {
  it('üst 4, alt 3, full farmer, kardiyo kürek', () => {
    expect(COVER_POOLS.upper).toHaveLength(4);
    expect(COVER_POOLS.lower).toEqual(['alt-squat', 'alt-deadlift', 'alt-lunge']);
    for (const id of ids.slice(0, 30)) {
      expect(coverFor(id, 'full')).toBe('fullbody-farmer');
      expect(coverFor(id, 'cardio')).toBe('kardiyo-kurek');
      expect(COVER_POOLS.upper).toContain(coverFor(id, 'upper'));
      expect(COVER_POOLS.lower).toContain(coverFor(id, 'lower'));
    }
  });

  it('kas gruplarından tür; setlerin yarısından fazlası kardiyoysa kürek', () => {
    expect(coverKindFor([ex(['chest'], 4), ex(['biceps'], 3)])).toBe('upper');
    expect(coverKindFor([ex(['quadriceps'], 4), ex(['hamstrings'], 3)])).toBe('lower');
    expect(coverKindFor([ex(['chest'], 3), ex(['glutes'], 3)])).toBe('full');
    expect(coverKindFor([ex(['quadriceps'], 3, 'cardio'), ex(['chest'], 1)])).toBe('cardio');
    // tam yarısı kardiyo: ağırlık kaldırma rengi kalır
    expect(coverKindFor([ex(['quadriceps'], 2, 'cardio'), ex(['chest'], 2)])).toBe('upper');
    expect(coverKindFor([])).toBe('full');
  });
});

describe('aynı programın günleri', () => {
  it('havuz yettiği sürece farklı görseller', () => {
    const days = ids.slice(0, 4).map((id) => ({ id, kind: 'upper' as const }));
    expect(new Set(assignCovers(days).values()).size).toBe(4);
  });

  it('full günleri: önce farmer, sonra bench / squat', () => {
    const days = ids.slice(0, 3).map((id) => ({ id, kind: 'full' as const }));
    expect([...assignCovers(days).values()].sort()).toEqual(['alt-squat', 'fullbody-farmer', 'rutin-ust-bench']);
  });

  it('havuzdan çok gün: tekrar eder, boş kalmaz', () => {
    const days = ids.slice(0, 7).map((id) => ({ id, kind: 'lower' as const }));
    const result = assignCovers(days);
    expect(result.size).toBe(7);
    for (const cover of result.values()) expect(COVER_POOLS.lower).toContain(cover);
  });

  it('liste sırası sonucu değiştirmez', () => {
    const days = ids.slice(0, 5).map((id, i) => ({ id, kind: i % 2 ? ('upper' as const) : ('lower' as const) }));
    expect([...assignCovers(days)].sort()).toEqual([...assignCovers([...days].reverse())].sort());
  });
});

describe('hazır programlar', () => {
  it('her programın sabit kapağı var; tabloda fazladan kimlik yok', () => {
    const templateIds = WORKOUT_TEMPLATES.map((t) => t.id).sort();
    expect(Object.keys(TEMPLATE_COVERS).sort()).toEqual(templateIds);
    expect(templateCover('fb-ab')).toBe('fullbody-farmer');
    expect(templateCover('bilinmeyen')).toBe('fullbody-farmer');
  });
});

describe('dosyalar', () => {
  const keys = [...WORKOUT_COVERS, ...SCREEN_COVERS];

  it('13 WebP, adlar listeyle aynı, toplam 500 KB altı', () => {
    expect(keys).toHaveLength(13);
    const files = readdirSync(DIR);
    expect(files.sort()).toEqual(keys.map((k) => `${k}.webp`).sort());
    const total = files.reduce((sum, f) => sum + readFileSync(path.join(DIR, f)).length, 0);
    expect(total).toBeLessThan(500 * 1024);
  });

  it('her anahtar pakete giriyor (statik require)', () => {
    const source = readFileSync(path.join(ROOT, 'src/components/CoverImage.tsx'), 'utf8');
    for (const key of keys) {
      expect(source, key).toContain(`require('../../assets/images/kapak/${key}.webp')`);
      expect(existsSync(path.join(DIR, `${key}.webp`)), key).toBe(true);
    }
  });
});

describe('karartma', () => {
  // Fotoğrafın en kötü pikseli bile yazıyla 4.5:1 tutsun diye yazı bölgesinde en az 0,6
  it('yazının başladığı yükseklikte zemin baskın', () => {
    expect(gradientOpacityAt(COVER_GRADIENTS.card, 0.45)).toBeGreaterThanOrEqual(0.6);
    expect(gradientOpacityAt(COVER_GRADIENTS.card, 1)).toBeGreaterThanOrEqual(0.9);
    expect(gradientOpacityAt(COVER_GRADIENTS.page, 0.72)).toBeGreaterThanOrEqual(0.6);
    expect(gradientOpacityAt(COVER_GRADIENTS.page, 1)).toBe(1);
  });

  it('kapağın üstü de hafif kararıyor; orta kısım açık', () => {
    expect(gradientOpacityAt(COVER_GRADIENTS.page, 0)).toBeGreaterThan(0.3);
    expect(gradientOpacityAt(COVER_GRADIENTS.page, 0.3)).toBe(0);
  });

  it('stop sıraları artan', () => {
    for (const stops of Object.values(COVER_GRADIENTS)) {
      const offsets = stops.map((s) => s.offset);
      expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    }
  });
});
