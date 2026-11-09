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

/**
 * Hareket / rutin / program adı (v4.0b 1.5): büyük harfe çevrilmez (adlar
 * karışık dilde, "DEADLİFT" gibi yanlış çıkıyor); yalnızca ilk harf büyük.
 */
export function nameCase(name: string): string {
  const text = name.trim();
  return upperTr(text.charAt(0)) + text.slice(1);
}

export const NAME_SIZES = [36, 30, 26] as const;
/** Kart içindeki ad (dar alan) */
export const CARD_NAME_SIZES = [30, 26, 22] as const;

export const NAME_MAX_LINES = 3;

/**
 * Archivo Expanded ExtraBold'da karakter başına en geniş ortalama (katalogdaki
 * 7+ harfli kelimelerde ölçülen en büyük değer 0,795 em). Kasıtlı olarak
 * yüksek: kelimenin satıra sığmayıp ortasından kırılmasındansa bir kademe
 * küçük yazı.
 */
const NAME_CHAR_EM = 0.8;

/** Kelime kelime dizince satır sayısı; satıra sığmayan kelime varsa Infinity */
function estimatedLines(words: readonly string[], fontSize: number, width: number): number {
  const charWidth = fontSize * NAME_CHAR_EM;
  const maxChars = Math.floor(width / charWidth);
  if (maxChars < 1) return Infinity;
  let lines = 1;
  let used = 0;
  for (const word of words) {
    const len = [...word].length;
    if (len > maxChars) return Infinity;
    if (used === 0) used = len;
    else if (used + 1 + len <= maxChars) used += 1 + len;
    else {
      lines += 1;
      used = len;
    }
  }
  return lines;
}

/**
 * Adın yazı boyutu: kelimeler bölünmeden büyük boyutta en fazla 2 satıra
 * sığıyorsa o; sığmıyorsa bir kademe küçük. En küçük kademede 3 satıra kadar.
 */
export function nameFontSize(name: string, width: number, sizes: readonly number[] = NAME_SIZES): number {
  const words = name.trim().split(/\s+/);
  const smallest = sizes[sizes.length - 1]!;
  for (const size of sizes) {
    if (size !== smallest && estimatedLines(words, size, width) <= 2) return size;
  }
  return smallest;
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
