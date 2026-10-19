/**
 * Renk hesapları (v3.5): WCAG kontrast oranı ve okunur tona kaydırma.
 * Saf; React bilmez. Paletler `src/theme.ts`'te.
 *
 * WCAG AA: normal metin ≥ 4.5, büyük metin ve ikon / düğme sınırı ≥ 3.
 */

export const CONTRAST_TEXT = 4.5;
export const CONTRAST_LARGE = 3;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** "#RRGGBB" (büyük/küçük harf) → 0–255; geçersizse null */
export function parseHex(hex: string): Rgb | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function toHex({ r, g, b }: Rgb): string {
  const h = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

/** "#d7ff3e" → "#D7FF3E"; geçersizse hata */
export function normalizeHex(hex: string): string {
  return toHex(mustParse(hex));
}

function mustParse(hex: string): Rgb {
  const rgb = parseHex(hex);
  if (!rgb) throw new Error(`Geçersiz renk: ${hex}`);
  return rgb;
}

/** WCAG göreli parlaklık (0 siyah – 1 beyaz) */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = mustParse(hex);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG kontrast oranı, 1–21; sıra önemsiz */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** `a`'dan `b`'ye doğru `t` (0–1) kadar karışım */
export function mix(a: string, b: string, t: number): string {
  const x = mustParse(a);
  const y = mustParse(b);
  return toHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
}

/**
 * `hex`'i `toward` rengine (açık temada siyah, koyu temada beyaz) yüzde
 * birer adımla yaklaştırır; `backgrounds`'un hepsine en az `min`
 * kontrast tutan ilk ton. Zaten tutuyorsa olduğu gibi döner.
 */
export function ensureContrast(hex: string, backgrounds: readonly string[], min: number, toward: string): string {
  const ok = (c: string) => backgrounds.every((bg) => contrastRatio(c, bg) >= min);
  const start = toHex(mustParse(hex));
  if (ok(start)) return start;
  for (let step = 1; step <= 100; step++) {
    const c = mix(start, toward, step / 100);
    if (ok(c)) return c;
  }
  return toHex(mustParse(toward));
}

/** Dolgu üstündeki metin: koyu ya da beyazdan kontrastı yüksek olan */
export function pickOnColor(fill: string, dark: string, light: string): string {
  return contrastRatio(fill, dark) >= contrastRatio(fill, light) ? dark : light;
}

/** NativeWind CSS değişkeni biçimi: "#D7FF3E" → "215 255 62" */
export function hexToRgbChannels(hex: string): string {
  const { r, g, b } = mustParse(hex);
  return `${r} ${g} ${b}`;
}

/** "#RRGGBB" + saydamlık (0–1) → "#RRGGBBAA" (SVG / kas haritası) */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
  return `${toHex(mustParse(hex))}${a}`;
}
