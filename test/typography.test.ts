/**
 * Yazı tipi (v4.0a 1.4): sınıftan aileye, Türkçe büyük harf, dosyalar ve
 * ekranların uygulamanın `Text`'ini kullanması.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { FONT_FAMILIES, MIN_FONT_SIZE, TYPE_SCALE, familyForWeight, resolveFontFamily, upperTr } from '@/lib/typography';

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
