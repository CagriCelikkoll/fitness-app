/**
 * v4.0b Bölüm 1: cihaz testinden düzeltmeler (görsel yer tutucu, ana sayfa
 * başlığı, Profil etiketi, dinlenme sayacı).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { exerciseIconKind } from '@/lib/exerciseImage';

const ROOT = path.resolve(__dirname, '..');
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');

describe('hareket görseli yer tutucusu', () => {
  it('kas grubuna göre ikon', () => {
    expect(exerciseIconKind('cardio', '["quadriceps"]')).toBe('cardio');
    expect(exerciseIconKind('strength', '["hamstrings"]')).toBe('legs');
    expect(exerciseIconKind('strength', '["biceps"]')).toBe('arms');
    expect(exerciseIconKind('strength', '["abdominals"]')).toBe('core');
    expect(exerciseIconKind('strength', '["chest"]')).toBe('torso');
    expect(exerciseIconKind('strength', null)).toBe('torso');
    expect(exerciseIconKind(undefined, 'bozuk')).toBe('torso');
  });

  it('bütün listeler aynı bileşeni kullanıyor; hata olunca ikon kalıyor; emoji yok', () => {
    for (const file of ['app/(tabs)/exercises.tsx', 'src/components/ExercisePickerModal.tsx', 'src/components/ProgramExerciseRow.tsx']) {
      const text = read(file);
      expect(text, file).toContain('<ExerciseThumb');
      expect(text, file).not.toMatch(/💪|🏃/);
    }
    const thumb = read('src/components/ExerciseThumb.tsx');
    expect(thumb).toContain('onError={() => setFailedUrl(url)}');
    expect(thumb).toContain('recyclingKey={url}');
  });
});

describe('ana sayfa başlığı', () => {
  it('kaydırmanın ilk çocuğu: tarih ve BUGÜN kartlardan önce, yüksekliği korunuyor', () => {
    const home = read('app/(tabs)/index.tsx');
    const scroll = home.indexOf('<ScrollView');
    const title = home.indexOf('<ScreenTitle>Bugün</ScreenTitle>', scroll);
    const gymRow = home.indexOf('<GymRow />', scroll);
    expect(title).toBeGreaterThan(scroll);
    expect(title).toBeLessThan(gymRow);
    expect(home).toContain('min-h-[60px]');
    expect(home).toContain('{todayHeading(now)}');
  });
});

describe('küçük metin düzeltmeleri', () => {
  it('Profil: "hafta seri"', () => {
    const profile = read('app/(tabs)/settings.tsx');
    expect(profile).toContain("label: 'hafta seri'");
    expect(profile).not.toContain('hf seri');
  });

  it('dinlenme sayacı animasyonsuz, geniş yazı tabular', () => {
    const rest = read('src/components/RestScreen.tsx');
    expect(rest).not.toMatch(/Animated|transition|FadeIn|FadeOut/);
    expect(read('src/components/ui/Text.tsx')).toContain("fontVariant: ['tabular-nums'");
  });
});
