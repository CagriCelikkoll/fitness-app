import { describe, expect, it } from 'vitest';

import { bodySetSplit, contextColorFor, LOWER_MUSCLES, UPPER_MUSCLES } from '@/lib/contextColor';
import { MUSCLE_LABELS } from '@/lib/exerciseTaxonomy';

const ex = (primaryMuscles: string[] | string, sets: number, category = 'strength') => ({ primaryMuscles, sets, category });

describe('bağlam rengi (v4.0a 1.2)', () => {
  it('üst vücut ağırlıklı → upper', () => {
    expect(contextColorFor([ex(['chest'], 4), ex(['lats'], 4), ex(['biceps'], 3), ex(['quadriceps'], 2)])).toBe('upper');
  });

  it('alt vücut ağırlıklı → lower', () => {
    expect(contextColorFor([ex(['quadriceps'], 4), ex(['hamstrings'], 4), ex(['calves'], 3), ex(['shoulders'], 2)])).toBe('lower');
  });

  it('karışık → full; eşik %65 (tam %65 yetmez)', () => {
    expect(contextColorFor([ex(['chest'], 3), ex(['glutes'], 3)])).toBe('full');
    // 13 / 20 = 0.65 → full
    expect(contextColorFor([ex(['chest'], 13), ex(['glutes'], 7)])).toBe('full');
    // 14 / 20 = 0.70 → upper
    expect(contextColorFor([ex(['chest'], 14), ex(['glutes'], 6)])).toBe('upper');
  });

  it('karın, core ve kardiyo hesaba katılmaz', () => {
    expect(contextColorFor([ex(['chest'], 3), ex(['abdominals'], 10), ex(['core'], 10)])).toBe('upper');
    expect(contextColorFor([ex(['quadriceps'], 3), ex(['quadriceps'], 20, 'cardio')])).toBe('lower');
    expect(contextColorFor([ex(['abdominals'], 5)])).toBe('full');
    expect(contextColorFor([])).toBe('full');
  });

  it('birden çok ana kas: setler eşit bölünür; JSON metin de olur', () => {
    expect(bodySetSplit([ex('["quadriceps","shoulders"]', 4)])).toEqual({ upper: 2, lower: 2 });
    expect(bodySetSplit([ex('bozuk', 4)])).toEqual({ upper: 0, lower: 0 });
    expect(bodySetSplit([ex(['chest'], 0)])).toEqual({ upper: 0, lower: 0 });
  });

  it('sözlükteki her kas grubu ya üst, ya alt, ya da bilerek dışarıda', () => {
    const excluded = new Set(['abdominals', 'core', 'neck']);
    for (const muscle of Object.keys(MUSCLE_LABELS)) {
      const n = [UPPER_MUSCLES.has(muscle), LOWER_MUSCLES.has(muscle), excluded.has(muscle)].filter(Boolean).length;
      expect(n, muscle).toBe(1);
    }
  });
});
