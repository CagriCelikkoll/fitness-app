/**
 * Ortam ışığı (v4.0a 1.3) — saf ölçüler. Çizim `src/components/ui/Glow.tsx`.
 *
 * Elips merkez (50%, 35%), genişlik ekranın ~1.3 katı, yükseklik ~420;
 * opaklık merkezde 0.40, %48'de 0.10, %72'de 0. Açık temada ışık yok.
 */

export const GLOW_HEIGHT = 420;
export const GLOW_WIDTH_FACTOR = 1.3;
export const GLOW_CENTER = { x: 0.5, y: 0.35 } as const;

export const GLOW_STOPS = [
  { offset: 0, opacity: 0.4 },
  { offset: 0.48, opacity: 0.1 },
  { offset: 0.72, opacity: 0 },
  { offset: 1, opacity: 0 },
] as const;

export interface GlowBox {
  /** SVG kutusu (ekran genişliğinden taşar, ortalanır) */
  width: number;
  height: number;
  left: number;
  /** Elips yarıçapları ve merkezi (kutu içinde, px) */
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export function glowBox(screenWidth: number, height = GLOW_HEIGHT): GlowBox {
  const width = Math.round(screenWidth * GLOW_WIDTH_FACTOR);
  return {
    width,
    height,
    left: Math.round((screenWidth - width) / 2),
    cx: width * GLOW_CENTER.x,
    cy: height * GLOW_CENTER.y,
    rx: width / 2,
    ry: height / 2,
  };
}

export function glowVisible(scheme: 'light' | 'dark'): boolean {
  return scheme === 'dark';
}
