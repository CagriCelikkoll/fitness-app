/**
 * Renk paletleri ve token'lar — tek doğruluk kaynağı (v3.5, değerler v4.0a).
 *
 * Üç katman:
 * - Tema (açık / koyu): zemin, yüzey, metin, kenarlık ve anlamsal renkler
 *   (başarı, tehlike, uyarı, rekor). Salon renginden bağımsız.
 * - Vurgu (brand): Dinç neonu ya da salonun rengi. Her tema için üç ton:
 *   `fill` (dolgu: birincil düğme, seçili çip), `onFill` (dolgu üstündeki
 *   metin), `ink` (zemin üstünde metin / ikon / grafik / kenarlık). Açık
 *   temada neon yazı olamaz: `ink` = brandText (#4A6400).
 * - Bağlam renkleri (v4.0a): üst vücut, alt vücut, full body, dinlenme,
 *   rekor. İki temada aynı ton; açık temada yalnızca dolgu (`contextTones`).
 *
 * v4.0a token adları ↔ buradaki adlar (sınıf adları değişmesin diye):
 * surface2 = `elevated`, line = `border`, textMuted = `muted`,
 * textFaint = `faint`, brand = `accentFill`, brandText = `accent` (ink).
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
  elevated: string; // surface2: kart içi buton, input, basılı durum
  border: string; // line: kart kenarlığı, ince ayraç
  text: string;
  muted: string; // textMuted: ikincil metin
  faint: string; // textFaint: en soluk metin (bundan açık metin yok)
  warning: string; // uyarı metni, kardiyo
  danger: string; // sil, hata
  dangerFg: string; // tehlike dolgusu üstündeki metin
  success: string; // tamamlanan set dolgusu
  successFg: string;
  pr: string; // rekor rozeti dolgusu (= bağlam rengi record)
  prFg: string;
}

export interface AccentTones {
  fill: string;
  onFill: string;
  ink: string;
}

/** Bağlam (v4.0a 1.1): antrenmanın / ekranın anlamı */
export type ContextKind = 'upper' | 'lower' | 'full' | 'rest' | 'record';

/** Bağlam renkleri; iki temada aynı ton */
export const CONTEXT_COLORS: Record<ContextKind, string> = {
  upper: '#2EC5FF',
  lower: '#FF8A3D',
  full: '#D7FF3E',
  rest: '#9B8CFF',
  record: '#FFC83D',
};

/** Ekranların kullandığı düz renk nesnesi (`useColors()`) */
export interface ThemeColors extends BasePalette {
  /** Zemin üstünde vurgu: metin, ikon, grafik, kenarlık (brandText) */
  accent: string;
  /** Vurgu dolgusu: birincil düğme, Switch izi, seçili çip (brand) */
  accentFill: string;
  /** Vurgu dolgusu üstündeki metin / ikon (onBrand) */
  accentFg: string;
  /** Kardiyo (eski adı; `warning` ile aynı) */
  warm: string;
  /** Soluk ikon / devre dışı öğe (ör. sınırdaki gezinme okları) */
  disabledIcon: string;
  /** Bağlam renkleri (dolgu, ışık, çentik, çubuk) */
  upper: string;
  lower: string;
  full: string;
  rest: string;
  record: string;
  /** Bağlam dolgusu üstündeki yazı */
  onContext: string;
}

const INK_DARK = '#0A0A0B';
const INK_LIGHT = '#FFFFFF';

export const PALETTES: Record<ColorScheme, BasePalette> = {
  dark: {
    bg: '#08080A',
    surface: '#121216',
    elevated: '#1E1E24',
    border: '#24242A',
    text: '#F2F2F0',
    muted: '#A1A1A6',
    faint: '#8E8E93',
    warning: '#FF9A3C',
    danger: '#FF5A5A',
    dangerFg: '#0A0A0B',
    success: '#D7FF3E',
    successFg: '#0A0A0B',
    pr: CONTEXT_COLORS.record,
    prFg: '#0A0A0B',
  },
  light: {
    bg: '#F2F1EC',
    surface: '#FFFFFF',
    elevated: '#F2F1EC',
    border: '#E3E1D9',
    text: '#16161A',
    muted: '#5E5E66',
    // Spec açık tema için textFaint vermiyor: zeminlerde ≥ 4.5 kalan en açık ton
    faint: '#66666E',
    warning: '#9A4A0A',
    danger: '#C62828',
    dangerFg: '#FFFFFF',
    success: '#D7FF3E',
    successFg: '#0A0A0B',
    pr: CONTEXT_COLORS.record,
    prFg: '#0A0A0B',
  },
};

/** Dinç neonu (brand). Açık temada neon yazı olamaz: brandText. */
export const DINC_LIME = '#D7FF3E';
export const BRAND_TEXT_LIGHT = '#4A6400';
export const DINC_ACCENT: Record<ColorScheme, AccentTones> = {
  dark: { fill: DINC_LIME, onFill: INK_DARK, ink: DINC_LIME },
  light: { fill: DINC_LIME, onFill: INK_DARK, ink: BRAND_TEXT_LIGHT },
};

/** Metnin okunması gereken zeminler */
export function textBackgrounds(scheme: ColorScheme): string[] {
  const p = PALETTES[scheme];
  return [p.bg, p.surface, p.elevated];
}

/**
 * Bağlam renginin bu temadaki tonları. Dolgu her temada rengin kendisi
 * (üstünde koyu yazı); `ink` (zemin üstünde yazı / ikon) koyu temada renk,
 * açık temada ana metin rengi (1.1: bağlam renkleri açık temada yazı
 * rengi olmaz). Işık (`Glow`) açık temada yok.
 */
export function contextTones(kind: ContextKind, scheme: ColorScheme): AccentTones {
  const fill = CONTEXT_COLORS[kind];
  return { fill, onFill: INK_DARK, ink: scheme === 'dark' ? fill : PALETTES.light.text };
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
    ...CONTEXT_COLORS,
    onContext: INK_DARK,
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
    '--color-faint': hexToRgbChannels(colors.faint),
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
    '--color-upper': hexToRgbChannels(colors.upper),
    '--color-lower': hexToRgbChannels(colors.lower),
    '--color-full': hexToRgbChannels(colors.full),
    '--color-rest': hexToRgbChannels(colors.rest),
    '--color-record': hexToRgbChannels(colors.record),
    '--color-on-context': hexToRgbChannels(colors.onContext),
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
