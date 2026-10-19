/**
 * Renk paletleri ve token'lar — tek doğruluk kaynağı (v3.5).
 *
 * İki katman:
 * - Tema (açık / koyu): zemin, yüzey, metin, kenarlık ve anlamsal renkler
 *   (başarı, tehlike, uyarı, rekor). Salon renginden bağımsız.
 * - Vurgu: Dinç limonu ya da salonun rengi. Her tema için üç ton:
 *   `fill` (dolgu: birincil düğme, seçili çip), `onFill` (dolgu üstündeki
 *   metin), `ink` (zemin üstünde metin / ikon / grafik / kenarlık).
 *   Koyu temada limonun üçü de bugünkü değerler.
 *
 * Kullanım:
 * - NativeWind sınıfları CSS değişkenlerinden (`cssVariables`, kökte
 *   `vars()`; tailwind.config.js). `bg-accent` dolgu, `text-accent` /
 *   `border-accent` mürekkep tonu.
 * - Satır içi renk (ikon, SVG, navigasyon, Switch): `useColors()`
 *   (`src/hooks/useTheme.tsx`). `colors.accent` mürekkep, `accentFill`
 *   dolgu.
 *
 * Ekranlarda sabit hex yok (`test/theme.test.ts` tarıyor). Saf modül,
 * React bilmez; testten içe aktarılıyor.
 */

import { CONTRAST_TEXT, contrastRatio, ensureContrast, hexToRgbChannels, normalizeHex, pickOnColor } from '@/lib/color';

export type ColorScheme = 'light' | 'dark';

/** Temadan gelen renkler (vurgu hariç) */
export interface BasePalette {
  bg: string; // zemin
  surface: string; // kart
  elevated: string; // kart içi kart, input, basılı durum
  border: string; // ince ayraç
  text: string;
  muted: string; // ikincil metin
  warning: string; // uyarı metni, kardiyo
  danger: string; // sil, hata
  dangerFg: string; // tehlike dolgusu üstündeki metin
  success: string; // tamamlanan set dolgusu
  successFg: string;
  pr: string; // rekor rozeti dolgusu
  prFg: string;
}

export interface AccentTones {
  fill: string;
  onFill: string;
  ink: string;
}

/** Ekranların kullandığı düz renk nesnesi (`useColors()`) */
export interface ThemeColors extends BasePalette {
  /** Zemin üstünde vurgu: metin, ikon, grafik, kenarlık */
  accent: string;
  /** Vurgu dolgusu: birincil düğme, Switch izi, seçili çip */
  accentFill: string;
  /** Vurgu dolgusu üstündeki metin / ikon */
  accentFg: string;
  /** Kardiyo (eski adı; `warning` ile aynı) */
  warm: string;
  /** Soluk ikon / devre dışı öğe (ör. sınırdaki gezinme okları) */
  disabledIcon: string;
}

const INK_DARK = '#0A0A0B';
const INK_LIGHT = '#FFFFFF';

export const PALETTES: Record<ColorScheme, BasePalette> = {
  // Bugünkü görünüm; değerler değişmez
  dark: {
    bg: '#0A0A0B',
    surface: '#141416',
    elevated: '#1E1E21',
    border: '#2A2A2F',
    text: '#FAFAFA',
    muted: '#8A8A90',
    warning: '#FF9A3C',
    danger: '#FF5A5A',
    dangerFg: '#0A0A0B',
    success: '#D7FF3E',
    successFg: '#0A0A0B',
    pr: '#D7FF3E',
    prFg: '#0A0A0B',
  },
  light: {
    bg: '#F4F4F5',
    surface: '#FFFFFF',
    elevated: '#EBEBEE',
    border: '#D4D4D9',
    text: '#0A0A0B',
    muted: '#5C5C63',
    warning: '#9A4A0A',
    danger: '#C62828',
    dangerFg: '#FFFFFF',
    success: '#D7FF3E',
    successFg: '#0A0A0B',
    pr: '#D7FF3E',
    prFg: '#0A0A0B',
  },
};

/** Dinç vurgusu. Açık temada limon metin olarak okunmaz: koyu zeytin. */
export const DINC_LIME = '#D7FF3E';
export const DINC_ACCENT: Record<ColorScheme, AccentTones> = {
  dark: { fill: DINC_LIME, onFill: INK_DARK, ink: DINC_LIME },
  light: { fill: DINC_LIME, onFill: INK_DARK, ink: '#4D6B00' },
};

/** Metnin okunması gereken zeminler */
export function textBackgrounds(scheme: ColorScheme): string[] {
  const p = PALETTES[scheme];
  return [p.bg, p.surface, p.elevated];
}

/**
 * Salon renginin temaya göre tonları. Kayıtlı değer `GYM_COLORS`'tan
 * (`src/lib/gymAdmin.ts`) bir hex; sunucu herhangi bir #RRGGBB'ye izin
 * verdiği için hesap her renkte çalışır:
 * - ink: zeminlerin hepsine ≥ 4.5 olana kadar koyu temada açılır, açık
 *   temada koyulaşır (açık temada altın / limon metin olmaz).
 * - fill: salonun kendi rengi; üstüne koyu ya da beyaz metin (≥ 4.5).
 *   İkisi de tutmazsa dolgu da mürekkep tonuna iner.
 */
export function gymAccentTones(hex: string, scheme: ColorScheme): AccentTones {
  if (hex.toUpperCase() === DINC_LIME) return DINC_ACCENT[scheme];
  const toward = scheme === 'dark' ? INK_LIGHT : INK_DARK;
  const ink = ensureContrast(hex, textBackgrounds(scheme), CONTRAST_TEXT, toward);
  let fill = normalizeHex(hex);
  let onFill = pickOnColor(fill, INK_DARK, INK_LIGHT);
  if (contrastRatio(fill, onFill) < CONTRAST_TEXT) {
    fill = ink;
    onFill = pickOnColor(fill, INK_DARK, INK_LIGHT);
  }
  return { fill, onFill, ink };
}


export function buildColors(scheme: ColorScheme, accent: AccentTones): ThemeColors {
  const p = PALETTES[scheme];
  return {
    ...p,
    accent: accent.ink,
    accentFill: accent.fill,
    accentFg: accent.onFill,
    warm: p.warning,
    disabledIcon: p.border,
  };
}

/** NativeWind CSS değişkenleri (kökte `vars()`); adlar tailwind.config.js'te */
export function cssVariables(colors: ThemeColors): Record<`--${string}`, string> {
  return {
    '--color-bg': hexToRgbChannels(colors.bg),
    '--color-surface': hexToRgbChannels(colors.surface),
    '--color-elevated': hexToRgbChannels(colors.elevated),
    '--color-border': hexToRgbChannels(colors.border),
    '--color-text': hexToRgbChannels(colors.text),
    '--color-muted': hexToRgbChannels(colors.muted),
    '--color-accent': hexToRgbChannels(colors.accentFill),
    '--color-accent-fg': hexToRgbChannels(colors.accentFg),
    '--color-accent-ink': hexToRgbChannels(colors.accent),
    '--color-warning': hexToRgbChannels(colors.warning),
    '--color-danger': hexToRgbChannels(colors.danger),
    '--color-danger-fg': hexToRgbChannels(colors.dangerFg),
    '--color-success': hexToRgbChannels(colors.success),
    '--color-success-fg': hexToRgbChannels(colors.successFg),
    '--color-pr': hexToRgbChannels(colors.pr),
    '--color-pr-fg': hexToRgbChannels(colors.prFg),
  };
}

/**
 * Egzersiz görseli küçük önizlemesi: fotoğrafların zemini beyaz, açık
 * temada beyaz kartla birleşmesin diye ince kenarlık. Koyu temada yok
 * (görünüm aynı kalsın).
 */
export function imageFrameClass(scheme: ColorScheme): string {
  return scheme === 'light' ? 'border border-border' : '';
}

/** Koyu tema + Dinç vurgusu: açılış ekranı ve tema yüklenmeden önceki an */
export const DARK_COLORS: ThemeColors = buildColors('dark', DINC_ACCENT.dark);

/**
 * QR afişi (v3.6c): temadan bağımsız siyah üstüne beyaz. Okuyucular açık
 * zemin üstünde koyu modül bekliyor; koyu temada da afiş beyaz kalır.
 */
export const QR_COLORS = { dark: '#000000', light: '#FFFFFF' } as const;
