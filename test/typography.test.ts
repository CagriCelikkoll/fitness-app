/**
 * Yazı tipi (v4.0a 1.4): sınıftan aileye, Türkçe büyük harf, dosyalar ve
 * ekranların uygulamanın `Text`'ini kullanması.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CARD_NAME_SIZES,
  FONT_FAMILIES,
  MIN_FONT_SIZE,
  TYPE_SCALE,
  familyForWeight,
  nameCase,
  nameFontSize,
  resolveFontFamily,
  upperTr,
} from '@/lib/typography';

const ROOT = path.resolve(__dirname, '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const SOURCES = [...files(path.join(ROOT, 'app')), ...files(path.join(ROOT, 'src'))].map((f) => ({
  rel: path.relative(ROOT, f).split(path.sep).join('/'),
  text: readFileSync(f, 'utf8'),
}));

describe('sınıftan aileye', () => {
  it('ağırlık sınıfları', () => {
    expect(resolveFontFamily({ className: 'text-fg text-base' })).toBe(FONT_FAMILIES.regular);
    expect(resolveFontFamily({ className: 'text-fg font-semibold' })).toBe(FONT_FAMILIES.semibold);
    expect(resolveFontFamily({ className: 'font-medium' })).toBe(FONT_FAMILIES.semibold);
    expect(resolveFontFamily({ className: 'font-bold text-xl' })).toBe(FONT_FAMILIES.bold);
    expect(resolveFontFamily({ className: 'font-black' })).toBe(FONT_FAMILIES.bold);
    expect(resolveFontFamily({ className: 'font-normal' })).toBe(FONT_FAMILIES.regular);
  });

  it('font-display: geniş ExtraBold, ağırlık sınıfından önce', () => {
    expect(resolveFontFamily({ className: 'font-display text-5xl font-bold' })).toBe(FONT_FAMILIES.display);
  });

  it('stildeki ağırlık ve aile', () => {
    expect(resolveFontFamily({ styleWeight: '600' })).toBe(FONT_FAMILIES.semibold);
    expect(resolveFontFamily({ styleWeight: 700, className: 'font-normal' })).toBe(FONT_FAMILIES.bold);
    expect(resolveFontFamily({ styleWeight: 'bold' })).toBe(FONT_FAMILIES.bold);
    expect(resolveFontFamily({ styleFamily: 'monospace', className: 'font-bold' })).toBe('monospace');
    expect(familyForWeight('abc')).toBeNull();
  });

  it('iç içe metin: kendi sınıfı yoksa dıştakinin ailesi', () => {
    expect(resolveFontFamily({ className: 'text-accent', inherited: FONT_FAMILIES.bold })).toBe(FONT_FAMILIES.bold);
    expect(resolveFontFamily({ className: 'font-normal', inherited: FONT_FAMILIES.bold })).toBe(FONT_FAMILIES.regular);
    expect(resolveFontFamily({ inherited: null })).toBe(FONT_FAMILIES.regular);
  });
});

describe('Türkçe büyük harf', () => {
  it('i → İ, ı → I', () => {
    expect(upperTr('İlerleme')).toBe('İLERLEME');
    expect(upperTr('sıradaki')).toBe('SIRADAKİ');
    expect(upperTr('dinlenme')).toBe('DİNLENME');
    expect(upperTr('Bugün')).toBe('BUGÜN');
    expect(upperTr('Hareket 2 / 7 · Set 2 / 4')).toBe('HAREKET 2 / 7 · SET 2 / 4');
  });
});

describe('hareket / rutin adları (v4.0b 1.5)', () => {
  it('büyük harfe çevrilmez, yalnızca ilk harf', () => {
    expect(nameCase('Romanian deadlift (RDL)')).toBe('Romanian deadlift (RDL)');
    expect(nameCase('itiş günü')).toBe('İtiş günü');
    expect(nameCase('  ısınma')).toBe('Isınma');
  });

  it('boyut kademesi: kısa 36, uzun 30, çok uzun 26 (360 dp, kenarlar 20)', () => {
    const width = 320;
    expect(nameFontSize('Squat', width)).toBe(36);
    expect(nameFontSize('Bench press (barbell)', width)).toBe(36);
    expect(nameFontSize('Preacher curl (barbell)', width)).toBe(30);
    expect(nameFontSize('Romanian deadlift (RDL)', width)).toBe(26);
  });

  it('kart için ayrı kademe; dar ekranda küçülür', () => {
    expect(nameFontSize('Push', 282, CARD_NAME_SIZES)).toBe(30);
    expect(nameFontSize('Concentration', 320)).toBe(30);
    expect(nameFontSize('Concentration', 280)).toBe(26);
  });

  it('katalogdaki hiçbir ad 320 dp ekranda bile kelime ortasından bölünmez', () => {
    const catalog = JSON.parse(readFileSync(path.join(ROOT, 'assets/seed/exercise-catalog.json'), 'utf8')) as Record<
      string,
      { tr?: string }
    >;
    const names = Object.values(catalog).flatMap((e) => (e.tr ? [e.tr] : []));
    expect(names.length).toBeGreaterThan(150);
    const width = 320 - 40;
    for (const name of names) {
      const charWidth = nameFontSize(name, width) * 0.8;
      for (const word of name.split(/\s+/)) expect([...word].length * charWidth, name).toBeLessThanOrEqual(width);
    }
  });

  it('adlar büyük harfe çevrilmiyor; ekranlar DisplayName kullanıyor', () => {
    const screens = ['app/session/active.tsx', 'app/session/summary.tsx', 'app/(tabs)/index.tsx'];
    for (const file of screens) {
      const text = readFileSync(path.join(ROOT, file), 'utf8');
      expect(text, file).toContain('<DisplayName');
      expect(text, file).not.toMatch(/upperTr\((next\.name|session\.name|sessionName|summary\.name|exerciseDisplayName)/);
    }
    const name = readFileSync(path.join(ROOT, 'src/components/ui/DisplayName.tsx'), 'utf8');
    expect(name).toContain('textBreakStrategy="simple"');
    expect(name).toContain('android_hyphenationFrequency="none"');
    expect(name).toContain('numberOfLines={NAME_MAX_LINES}');
  });
});

describe('yazı tipi dosyaları', () => {
  it('dört statik örnek + OFL lisansı, fontAssets aileleri karşılıyor', () => {
    for (const family of Object.values(FONT_FAMILIES)) {
      expect(existsSync(path.join(ROOT, 'assets/fonts', `${family}.ttf`)), family).toBe(true);
    }
    expect(readFileSync(path.join(ROOT, 'assets/fonts/OFL.txt'), 'utf8')).toContain('SIL OPEN FONT LICENSE');
    const assets = readFileSync(path.join(ROOT, 'src/lib/fontAssets.ts'), 'utf8');
    for (const family of Object.values(FONT_FAMILIES)) expect(assets).toContain(`assets/fonts/${family}.ttf`);
  });

  it('tailwind font-display ailesi FONT_FAMILIES ile aynı', () => {
    const tw = readFileSync(path.join(ROOT, 'tailwind.config.js'), 'utf8');
    expect(tw).toContain(`display: ['${FONT_FAMILIES.display}']`);
  });

  it('ölçekte 12 altı yok', () => {
    for (const size of Object.values(TYPE_SCALE)) expect(size).toBeGreaterThanOrEqual(MIN_FONT_SIZE);
  });
});

describe('ekranlar', () => {
  it("Text / TextInput react-native'den değil uygulamanın bileşeninden", () => {
    const hits: string[] = [];
    for (const { rel, text } of SOURCES) {
      if (rel === 'src/components/ui/Text.tsx') continue;
      for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'react-native'/g)) {
        const specs = m[1]!.split(',').map((s) => s.trim());
        if (specs.includes('Text') || specs.includes('TextInput')) hits.push(rel);
      }
      if (/\bRN\.Text\b|from 'react-native\/Libraries\/Text/.test(text)) hits.push(rel);
    }
    expect(hits).toEqual([]);
  });

  it('12 pikselden küçük yazı yok', () => {
    const hits: string[] = [];
    for (const { rel, text } of SOURCES) {
      for (const m of text.matchAll(/text-\[(\d+)px\]|fontSize:\s*(\d+)|fontSize=\{(\d+)\}/g)) {
        const size = Number(m[1] ?? m[2] ?? m[3]);
        if (size < MIN_FONT_SIZE) hits.push(`${rel}: ${m[0]}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
