/**
 * Tema (v3.5): kontrast hesabı, paletler × iki tema (WCAG AA), tema
 * çözümleme, salon vurgusu, CSS değişkenlerinin tutarlılığı ve ekranlarda
 * token dışı renk kalmaması.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CONTRAST_LARGE,
  CONTRAST_TEXT,
  contrastRatio,
  ensureContrast,
  hexToRgbChannels,
  mix,
  parseHex,
  withAlpha,
} from '@/lib/color';
import { GYM_COLORS } from '@/lib/gymAdmin';
import {
  canUseGymAccent,
  initialThemeMode,
  parseGymAccentEnabled,
  parseThemeMode,
  resolveAccent,
  resolveScheme,
} from '@/lib/themeMode';
import {
  DARK_COLORS,
  DINC_ACCENT,
  DINC_LIME,
  PALETTES,
  buildColors,
  cssVariables,
  gymAccentTones,
  imageFrameClass,
  textBackgrounds,
  type ColorScheme,
} from '@/theme';

const ROOT = path.resolve(__dirname, '..');
const SCHEMES: ColorScheme[] = ['light', 'dark'];

describe('kontrast hesabı', () => {
  it('WCAG örnekleri', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#3EC5FF', '#3EC5FF')).toBe(1);
    // #777777 beyazda 4.48: AA'nın hemen altı
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
    expect(contrastRatio('#767676', '#FFFFFF')).toBeGreaterThanOrEqual(CONTRAST_TEXT);
  });

  it('hex ayrıştırma ve biçimler', () => {
    expect(parseHex('#d7ff3e')).toEqual({ r: 215, g: 255, b: 62 });
    expect(parseHex('d7ff3e')).toBeNull();
    expect(parseHex('#fff')).toBeNull();
    expect(hexToRgbChannels('#0A0A0B')).toBe('10 10 11');
    expect(withAlpha('#D7FF3E', 0x66 / 255)).toBe('#D7FF3E66');
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
  });

  it('ensureContrast: tutuyorsa dokunmaz, tutmuyorsa hedefe doğru en yakın tonu bulur', () => {
    expect(ensureContrast('#4D6B00', ['#FFFFFF'], CONTRAST_TEXT, '#000000')).toBe('#4D6B00');
    const fixed = ensureContrast('#FFD23E', ['#FFFFFF'], CONTRAST_TEXT, '#000000');
    expect(contrastRatio(fixed, '#FFFFFF')).toBeGreaterThanOrEqual(CONTRAST_TEXT);
    // bir adım öncesi tutmamalı (gereğinden koyu değil)
    const ratioBefore = contrastRatio(mix('#FFD23E', '#000000', 0), '#FFFFFF');
    expect(ratioBefore).toBeLessThan(CONTRAST_TEXT);
  });
});

describe('paletler × iki tema (AA)', () => {
  for (const scheme of SCHEMES) {
    describe(scheme, () => {
      const p = PALETTES[scheme];
      const bgs = textBackgrounds(scheme);

      it('metin, ikincil metin, tehlike ve uyarı her zeminde ≥ 4.5', () => {
        for (const [name, color] of Object.entries({ text: p.text, muted: p.muted, danger: p.danger, warning: p.warning })) {
          for (const bg of bgs) {
            expect(contrastRatio(color, bg), `${scheme} ${name} / ${bg}`).toBeGreaterThanOrEqual(CONTRAST_TEXT);
          }
        }
      });

      it('dolgular üstündeki metin ≥ 4.5', () => {
        expect(contrastRatio(p.success, p.successFg)).toBeGreaterThanOrEqual(CONTRAST_TEXT);
        expect(contrastRatio(p.pr, p.prFg)).toBeGreaterThanOrEqual(CONTRAST_TEXT);
        expect(contrastRatio(p.danger, p.dangerFg)).toBeGreaterThanOrEqual(CONTRAST_TEXT);
      });

      it('Dinç vurgusu: mürekkep her zeminde ≥ 4.5, dolgu üstü metin ≥ 4.5', () => {
        const a = DINC_ACCENT[scheme];
        for (const bg of bgs) expect(contrastRatio(a.ink, bg)).toBeGreaterThanOrEqual(CONTRAST_TEXT);
        expect(contrastRatio(a.fill, a.onFill)).toBeGreaterThanOrEqual(CONTRAST_TEXT);
      });

      for (const c of GYM_COLORS) {
        it(`salon rengi ${c.label} (${c.hex})`, () => {
          const t = gymAccentTones(c.hex, scheme);
          for (const bg of bgs) {
            // metin ≥ 4.5 (ikon / kenarlık için gereken 3'ü de karşılar)
            expect(contrastRatio(t.ink, bg), `ink / ${bg}`).toBeGreaterThanOrEqual(CONTRAST_TEXT);
            expect(contrastRatio(t.ink, bg)).toBeGreaterThanOrEqual(CONTRAST_LARGE);
          }
          expect(contrastRatio(t.fill, t.onFill), 'fill / onFill').toBeGreaterThanOrEqual(CONTRAST_TEXT);
        });
      }
    });
  }

  it('açık temada limon ve altın metin olarak kullanılmaz (koyulaştırılmış ton)', () => {
    expect(DINC_ACCENT.light.ink).toBe('#4D6B00');
    expect(gymAccentTones(DINC_LIME, 'light').ink).not.toBe(DINC_LIME);
    const gold = GYM_COLORS.find((c) => c.label === 'Güneş')!;
    expect(gymAccentTones(gold.hex, 'light').ink).not.toBe(gold.hex);
    // dolgu olarak kalabilir
    expect(gymAccentTones(gold.hex, 'light').fill).toBe(gold.hex);
  });

  it('Euphoria pembesi (fuşya) listede, iki temada okunur', () => {
    expect(GYM_COLORS.some((c) => c.hex === '#A33A8C')).toBe(true);
    expect(gymAccentTones('#A33A8C', 'light').ink).toBe('#A33A8C');
    // koyu zeminde açılıyor
    expect(gymAccentTones('#A33A8C', 'dark').ink).not.toBe('#A33A8C');
  });

  it('koyu tema bugünkü değerlerle aynı', () => {
    expect(DARK_COLORS).toMatchObject({
      bg: '#0A0A0B',
      surface: '#141416',
      elevated: '#1E1E21',
      border: '#2A2A2F',
      text: '#FAFAFA',
      muted: '#8A8A90',
      accent: '#D7FF3E',
      accentFill: '#D7FF3E',
      accentFg: '#0A0A0B',
      warm: '#FF9A3C',
      danger: '#FF5A5A',
      success: '#D7FF3E',
      pr: '#D7FF3E',
      disabledIcon: '#2A2A2F',
    });
    // salon rengi koyu temada kendisi (v3.2d'deki görünüm)
    for (const c of GYM_COLORS.filter((g) => g.hex !== '#A33A8C')) {
      expect(gymAccentTones(c.hex, 'dark')).toMatchObject({ fill: c.hex, ink: c.hex });
    }
  });

  it('görsel çerçevesi yalnızca açık temada', () => {
    expect(imageFrameClass('light')).toContain('border');
    expect(imageFrameClass('dark')).toBe('');
  });
});

describe('CSS değişkenleri', () => {
  const css = readFileSync(path.join(ROOT, 'global.css'), 'utf8');
  const tailwind = readFileSync(path.join(ROOT, 'tailwind.config.js'), 'utf8');

  it('global.css varsayılanı = koyu tema + Dinç vurgusu', () => {
    const declared = Object.fromEntries(
      [...css.matchAll(/(--color-[a-z-]+):\s*([0-9 ]+);/g)].map((m) => [m[1], m[2]!.trim()])
    );
    expect(declared).toEqual(cssVariables(DARK_COLORS));
  });

  it("tailwind.config.js'teki her değişken tanımlı", () => {
    const used = new Set([...tailwind.matchAll(/v\('([a-z-]+)'\)/g)].map((m) => `--color-${m[1]}`));
    const defined = Object.keys(cssVariables(DARK_COLORS));
    for (const name of used) expect(defined).toContain(name);
  });

  it('açık tema değişkenleri farklı ve vurgu ayrı (dolgu / mürekkep)', () => {
    const light = cssVariables(buildColors('light', DINC_ACCENT.light));
    expect(light['--color-bg']).not.toBe(cssVariables(DARK_COLORS)['--color-bg']);
    expect(light['--color-accent']).toBe(hexToRgbChannels(DINC_LIME));
    expect(light['--color-accent-ink']).toBe(hexToRgbChannels('#4D6B00'));
  });
});

describe('tema çözümleme', () => {
  it('kayıtlı seçim geçerli', () => {
    expect(initialThemeMode('light', true)).toBe('light');
    expect(initialThemeMode('system', true)).toBe('system');
    expect(initialThemeMode('dark', false)).toBe('dark');
  });

  it('ilk açılış: mevcut kullanıcı Koyu, yeni kurulum Sistem', () => {
    expect(initialThemeMode(null, true)).toBe('dark');
    expect(initialThemeMode(null, false)).toBe('system');
    expect(initialThemeMode('bozuk', false)).toBe('system');
    expect(parseThemeMode('Açık')).toBeNull();
  });

  it('Sistem: telefonun ayarı; bilinmiyorsa koyu', () => {
    expect(resolveScheme('system', 'light')).toBe('light');
    expect(resolveScheme('system', 'dark')).toBe('dark');
    expect(resolveScheme('system', 'unspecified')).toBe('dark');
    expect(resolveScheme('system', null)).toBe('dark');
    expect(resolveScheme('light', 'dark')).toBe('light');
    expect(resolveScheme('dark', 'light')).toBe('dark');
  });
});

describe('salon vurgusu', () => {
  const pink = '#FF6FAE';
  const base = { scheme: 'dark' as const, gymFeatures: true, gymAccentEnabled: true, gymColor: pink };

  it('üye, bayrak açık, anahtar açık: salonun tonu', () => {
    expect(resolveAccent(base)).toEqual({ source: 'gym', tones: gymAccentTones(pink, 'dark') });
    expect(resolveAccent({ ...base, scheme: 'light' }).tones).toEqual(gymAccentTones(pink, 'light'));
  });

  it('anahtar kapalı: Dinç', () => {
    expect(resolveAccent({ ...base, gymAccentEnabled: false })).toEqual({ source: 'dinc', tones: DINC_ACCENT.dark });
  });

  it('üye değil / salonun rengi yok ya da listede değil: Dinç', () => {
    expect(resolveAccent({ ...base, gymColor: null }).source).toBe('dinc');
    expect(resolveAccent({ ...base, gymColor: '#123456' }).source).toBe('dinc');
  });

  it('bayrak kapalı: salon rengi hiçbir yerde (vurgu Dinç, anahtar gizli)', () => {
    expect(resolveAccent({ ...base, gymFeatures: false })).toEqual({ source: 'dinc', tones: DINC_ACCENT.dark });
    expect(canUseGymAccent(false, pink)).toBe(false);
    expect(canUseGymAccent(true, pink)).toBe(true);
    expect(canUseGymAccent(true, null)).toBe(false);
  });

  it('anahtar varsayılan açık', () => {
    expect(parseGymAccentEnabled(null)).toBe(true);
    expect(parseGymAccentEnabled('1')).toBe(true);
    expect(parseGymAccentEnabled('0')).toBe(false);
  });
});

describe('ekranlarda token dışı renk yok', () => {
  // Gerçekten sabit olanlar: palet tanımı ve salon rengi kimlikleri
  const ALLOWED = new Set(['src/theme.ts', 'src/lib/gymAdmin.ts']);

  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return files(full);
      return /\.(ts|tsx)$/.test(name) ? [full] : [];
    });
  }

  it('app/ ve src/ altında sabit hex, rgb() ya da beyaz/siyah sınıfı yok', () => {
    const hits: string[] = [];
    for (const file of [...files(path.join(ROOT, 'app')), ...files(path.join(ROOT, 'src'))]) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      if (ALLOWED.has(rel)) continue;
      readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (/^\s*(\/\/|\/?\*)/.test(line)) return; // yorum
          if (
            /['"`]#[0-9A-Fa-f]{3,8}\b|#[0-9A-Fa-f]{6}\b/.test(line) ||
            /\brgba?\(/.test(line) ||
            /\b(text|bg|border)-(white|black)\b(?!\/)/.test(line)
          ) {
            hits.push(`${rel}:${i + 1}: ${line.trim()}`);
          }
        });
    }
    expect(hits).toEqual([]);
  });
});
