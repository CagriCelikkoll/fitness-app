import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { bodySetSplit, contextColorFor, exerciseContextColor, LOWER_MUSCLES, UPPER_MUSCLES } from '@/lib/contextColor';
import { MUSCLE_LABELS } from '@/lib/exerciseTaxonomy';

const ex = (primaryMuscles: string[] | string, sets: number, category = 'strength') => ({ primaryMuscles, sets, category });

describe('bağlam rengi (v4.0a 1.2)', () => {
  it('üst vücut ağırlıklı → upper', () => {
    expect(contextColorFor([ex(['chest'], 4), ex(['lats'], 4), ex(['biceps'], 3), ex(['quadriceps'], 1)])).toBe('upper');
  });

  it('alt vücut ağırlıklı → lower', () => {
    expect(contextColorFor([ex(['quadriceps'], 4), ex(['hamstrings'], 4), ex(['calves'], 3), ex(['shoulders'], 1)])).toBe('lower');
  });

  it('karışık → full; eşik %85 (tam %85 yetmez)', () => {
    expect(contextColorFor([ex(['chest'], 3), ex(['glutes'], 3)])).toBe('full');
    // 17 / 20 = 0.85 → full
    expect(contextColorFor([ex(['chest'], 17), ex(['glutes'], 3)])).toBe('full');
    // 18 / 20 = 0.90 → upper
    expect(contextColorFor([ex(['chest'], 18), ex(['glutes'], 2)])).toBe('upper');
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

describe('hareket bazlı renk (v4.0b 1.7)', () => {
  const muscles = (primaryMuscles: string[] | string, category = 'strength') => ({ primaryMuscles, category });

  it('hareketin kendi kası: RDL alt, preacher curl üst (antrenman rengi ne olursa olsun)', () => {
    expect(exerciseContextColor(muscles(['hamstrings']), 'upper')).toBe('lower');
    expect(exerciseContextColor(muscles(['biceps']), 'lower')).toBe('upper');
    expect(exerciseContextColor(muscles('["hamstrings"]'), 'full')).toBe('lower');
  });

  it('üst + alt ana kas eşitse full', () => {
    expect(exerciseContextColor(muscles(['quadriceps', 'shoulders']), 'upper')).toBe('full');
  });

  it('üst / alt ayrımı yoksa (karın, kardiyo, bozuk veri) antrenmanın rengi', () => {
    expect(exerciseContextColor(muscles(['abdominals']), 'upper')).toBe('upper');
    expect(exerciseContextColor(muscles(['quadriceps'], 'cardio'), 'lower')).toBe('lower');
    expect(exerciseContextColor(muscles('bozuk'), 'full')).toBe('full');
  });

  it('odak modu ve Sıradaki hareketin rengini kullanıyor; tüm liste antrenmanın', () => {
    const src = readFileSync(path.resolve(__dirname, '../app/session/active.tsx'), 'utf8');
    expect(src).toContain('exerciseContextColor(current.exercise, workoutColor)');
    expect(src).toContain('<Glow color={focusColor} />');
    expect(src).toContain('color: exerciseContextColor(ex.exercise, workoutColor)');
    expect(src).toMatch(/<ListView[^]*?color=\{workoutColor\}/);
  });
});
