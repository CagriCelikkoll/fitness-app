import { useMemo, type ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Line } from 'react-native-svg';

import { useColors, useContextTones } from '@/hooks/useTheme';
import { tickGeometry, type TickMode } from '@/lib/tickRing';
import type { ContextKind } from '@/theme';

interface TickRingProps {
  /** 0–1; `drain`'de kalan oran */
  progress: number;
  /** `fill` (varsayılan) dolar; `drain` (dinlenme) saat yönünde söner */
  mode?: TickMode;
  /** Çap: dinlenme ~270, ana sayfa ~80 */
  size: number;
  /** Çentik uzunluğu: dinlenme ~22, ana sayfa ~9 */
  tickLength: number;
  strokeWidth?: number;
  color?: ContextKind;
  /** Zorunlu: "Dinlenme: 1 dakika 24 saniye kaldı" (`restRingLabel`) */
  accessibilityLabel: string;
  /** Ortadaki içerik (kalan süre …) */
  children?: ReactNode;
}

/**
 * Çentikli halka (v4.0a 1.6): 60 radyal çizgi, saat 12'den saat yönünde
 * bağlam rengine boyanır, kalanlar `line`. Animasyon yok: her saniye
 * çentikler değişir ("hareketi azalt" açıkken de aynı).
 */
export function TickRing({
  progress,
  mode = 'fill',
  size,
  tickLength,
  strokeWidth,
  color,
  accessibilityLabel,
  children,
}: TickRingProps) {
  const COLORS = useColors();
  const tones = useContextTones(color);
  const ticks = useMemo(
    () => tickGeometry(size, tickLength, progress, undefined, undefined, mode),
    [size, tickLength, progress, mode]
  );
  const sw = strokeWidth ?? Math.max(2, Math.round(size / 90));

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
    >
      <Svg width={size} height={size} style={{ position: 'absolute', top: 0, left: 0 }}>
        {ticks.map((t, i) => (
          <Line
            key={i}
            x1={t.x1}
            y1={t.y1}
            x2={t.x2}
            y2={t.y2}
            stroke={t.on ? tones.fill : COLORS.border}
            strokeWidth={sw}
            strokeLinecap="round"
          />
        ))}
      </Svg>
      {children}
    </View>
  );
}
