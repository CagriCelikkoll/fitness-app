/**
 * Çentikli halka (v4.0a 1.6) — saf geometri ve etiket. Çizim
 * `src/components/ui/TickRing.tsx` (react-native-svg, 60 `Line`).
 */

export const TICK_COUNT = 60;

export interface Tick {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Bağlam renginde mi (ilerlemiş) */
  on: boolean;
}

/** Boyanacak çentik sayısı: 0–60; ilerleme 0–1 dışına taşmaz */
export function litTicks(progress: number, count = TICK_COUNT): number {
  if (!Number.isFinite(progress) || progress <= 0) return 0;
  if (progress >= 1) return count;
  return Math.round(progress * count);
}

/**
 * Saat 12'den başlayıp saat yönünde. `size` çap, `length` çentik boyu,
 * `inset` dış kenardan boşluk (kalın çizginin ucu kesilmesin).
 */
export function tickGeometry(size: number, length: number, progress: number, inset = 2, count = TICK_COUNT): Tick[] {
  const c = size / 2;
  const outer = c - inset;
  const inner = outer - length;
  const lit = litTicks(progress, count);
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * 2 * Math.PI - Math.PI / 2;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    return {
      x1: round(c + inner * cos),
      y1: round(c + inner * sin),
      x2: round(c + outer * cos),
      y2: round(c + outer * sin),
      on: i < lit,
    };
  });
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** "1 dakika 24 saniye", "45 saniye", "2 dakika" */
export function spokenDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `${r} saniye`;
  if (r === 0) return `${m} dakika`;
  return `${m} dakika ${r} saniye`;
}

/** Ekran okuyucu: "Dinlenme: 1 dakika 24 saniye kaldı" */
export function restRingLabel(remainingSeconds: number): string {
  return `Dinlenme: ${spokenDuration(remainingSeconds)} kaldı`;
}
