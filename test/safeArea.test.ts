/**
 * Alt güvenli alan (v3.6e): yığın ekranlarının alt boşluğu tek yerden
 * (`app/_layout.tsx` → `screenBottomInset`), alttan açılan Modal sayfaları
 * `useSheetBottomPadding`. Ekranlar kendi alt boşluğunu eklemez (çift
 * boşluk olur). Android 9 gibi inset'i 0 olan cihazda görünüm aynı.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { SHEET_BASE_PADDING, screenBottomInset, sheetBottomPadding } from '@/lib/safeArea';

const ROOT = path.resolve(__dirname, '..');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return name.endsWith('.tsx') ? [full] : [];
  });
}

const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join('/');

describe('screenBottomInset', () => {
  it('yığın ekranı gezinme çubuğu kadar boşluk alır (3 tuş ~48, hareket ~24)', () => {
    expect(screenBottomInset('session/active', 48, false)).toBe(48);
    expect(screenBottomInset('programs/assign', 24, false)).toBe(24);
  });

  it('sekmeler kendi boşluğunu bırakıyor: 0', () => {
    expect(screenBottomInset('(tabs)', 48, false)).toBe(0);
  });

  it('klavye açıkken 0 (çubuk klavyenin altında)', () => {
    expect(screenBottomInset('feedback/new', 48, true)).toBe(0);
  });

  it('Android 9 / geçersiz değer: 0, görünüm değişmez', () => {
    expect(screenBottomInset('session/active', 0, false)).toBe(0);
    expect(screenBottomInset('session/active', -3, false)).toBe(0);
    expect(screenBottomInset('session/active', Number.NaN, false)).toBe(0);
  });
});

describe('sheetBottomPadding', () => {
  it('taban + çubuk; inset 0 iken eski pb-10 (40)', () => {
    expect(SHEET_BASE_PADDING).toBe(40);
    expect(sheetBottomPadding(0, false)).toBe(40);
    expect(sheetBottomPadding(48, false)).toBe(88);
    expect(sheetBottomPadding(48, true)).toBe(40);
    expect(sheetBottomPadding(24, false, 16)).toBe(40);
  });
});

describe('tek yerden uygulanıyor', () => {
  it('kök yığın içerik kabına alt boşluğu veriyor', () => {
    const layout = readFileSync(path.join(ROOT, 'app/_layout.tsx'), 'utf8');
    expect(layout).toContain('useScreenBottomInset()');
    expect(layout).toContain('paddingBottom: bottomInset(route.name)');
  });

  it('ekranlar kendi alt güvenli alanını eklemiyor (çift boşluk)', () => {
    const offenders = tsxFiles(path.join(ROOT, 'app')).filter((f) => {
      const src = readFileSync(f, 'utf8');
      return /insets\.bottom|\.bottom\s*}\s*=\s*useSafeAreaInsets|edges=\{\[[^\]]*'bottom'/.test(src);
    });
    expect(offenders.map(rel)).toEqual([]);
  });

  it('alttan açılan Modal sayfaları useSheetBottomPadding kullanıyor', () => {
    const files = [...tsxFiles(path.join(ROOT, 'app')), ...tsxFiles(path.join(ROOT, 'src/components'))];
    const sheets = files.filter((f) => {
      const src = readFileSync(f, 'utf8');
      return src.includes('<Modal') && src.includes('rounded-t-3xl');
    });
    expect(sheets.length).toBeGreaterThan(0);
    for (const f of sheets) {
      const src = readFileSync(f, 'utf8');
      expect(src, rel(f)).toContain('useSheetBottomPadding()');
      expect(src, rel(f)).not.toMatch(/rounded-t-3xl[^"]*pb-10/);
    }
  });

  it('active.tsx alt boşluğu kendisi eklemiyor (yerleşim kökten geliyor)', () => {
    const src = readFileSync(path.join(ROOT, 'app/session/active.tsx'), 'utf8');
    expect(src).not.toContain('useSafeAreaInsets');
    expect(src).not.toContain('useSheetBottomPadding');
  });
});
