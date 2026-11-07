/**
 * Yazı tipi (v4.0a 1.4) — saf: hangi metin hangi Archivo dosyasıyla.
 *
 * React Native değişken yazı tipi eksenlerini güvenilir desteklemiyor;
 * değişken TTF'ten statik örnekler üretildi (`scripts/build-fonts.py`,
 * `assets/fonts/`). Android ağırlığı aileden değil dosyadan seçer: aynı
 * aileye `fontWeight: 'bold'` verilirse sahte kalınlık çizer. Bu yüzden
 * her ağırlık ayrı aile, `fontWeight` her zaman normal.
 *
 * Bağlantı: `src/components/ui/Text.tsx` (sınıftan aileye) ve
 * `app/_layout.tsx` (`useFonts(FONT_ASSETS)`).
 */

export const FONT_FAMILIES = {
  /** Başlık ve dev rakam: geniş (wdth 125), wght 800 */
  display: 'Archivo-Expanded-ExtraBold',
  regular: 'Archivo-Regular',
  semibold: 'Archivo-SemiBold',
  bold: 'Archivo-Bold',
} as const;

export type FontFamily = (typeof FONT_FAMILIES)[keyof typeof FONT_FAMILIES];

const WEIGHT_CLASS: Record<string, FontFamily> = {
  'font-thin': FONT_FAMILIES.regular,
  'font-extralight': FONT_FAMILIES.regular,
  'font-light': FONT_FAMILIES.regular,
  'font-normal': FONT_FAMILIES.regular,
  'font-medium': FONT_FAMILIES.semibold,
  'font-semibold': FONT_FAMILIES.semibold,
  'font-bold': FONT_FAMILIES.bold,
  'font-extrabold': FONT_FAMILIES.bold,
  'font-black': FONT_FAMILIES.bold,
};

/** `fontWeight` stil değeri → aile */
export function familyForWeight(weight: string | number | undefined | null): FontFamily | null {
  if (weight == null) return null;
  if (weight === 'bold') return FONT_FAMILIES.bold;
  if (weight === 'normal') return FONT_FAMILIES.regular;
  const n = typeof weight === 'number' ? weight : Number(weight);
  if (!Number.isFinite(n)) return null;
  if (n >= 700) return FONT_FAMILIES.bold;
  if (n >= 500) return FONT_FAMILIES.semibold;
  return FONT_FAMILIES.regular;
}

export interface FontInputs {
  className?: string | null;
  /** Düzleştirilmiş stilin `fontWeight` / `fontFamily`'si */
  styleWeight?: string | number | null;
  styleFamily?: string | null;
  /** Dıştaki Text'in ailesi (iç içe metin kalıtımı) */
  inherited?: FontFamily | null;
}

/**
 * Sıra: stilde açık aile > `font-display` sınıfı > stilde ağırlık >
 * ağırlık sınıfı (sonuncusu geçerli) > dıştaki metin > Regular.
 */
export function resolveFontFamily({ className, styleWeight, styleFamily, inherited }: FontInputs): string {
  if (styleFamily) return styleFamily;
  const classes = className ? className.split(/\s+/) : [];
  if (classes.includes('font-display')) return FONT_FAMILIES.display;
  const fromStyle = familyForWeight(styleWeight);
  if (fromStyle) return fromStyle;
  let fromClass: FontFamily | null = null;
  for (const c of classes) {
    const f = WEIGHT_CLASS[c];
    if (f) fromClass = f;
  }
  return fromClass ?? inherited ?? FONT_FAMILIES.regular;
}

/** Türkçe büyük harf: i → İ, ı → I ("İLERLEME"). Hermes'te yerel ayar güvenilmez. */
export function upperTr(text: string): string {
  return text.replace(/i/g, 'İ').replace(/ı/g, 'I').toUpperCase();
}

/** Ölçek (v4.0a 1.4). 12'nin altında yazı yok. */
export const TYPE_SCALE = {
  screenTitle: 32,
  cardTitle: 30,
  cardTitleLg: 36,
  giant: 56,
  giantLg: 76,
  body: 15,
  label: 12,
  labelLg: 13,
} as const;

export const MIN_FONT_SIZE = 12;
