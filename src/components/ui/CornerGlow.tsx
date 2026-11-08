import { useId } from 'react';
import { View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { useContextTones, useTheme } from '@/hooks/useTheme';
import { glowVisible } from '@/lib/glow';
import type { ContextKind } from '@/theme';

interface CornerGlowProps {
  color?: ContextKind;
  /** Köşe: kartın sağ üstü ("Sıradaki") ya da sol altı (rekor) */
  corner?: 'top-right' | 'bottom-left';
  width?: number;
  height?: number;
  /** Merkezdeki opaklık */
  opacity?: number;
}

/**
 * Kart köşesinde bağlam renginde hafif ışık (v4.0a Bölüm 3). Kartın ilk
 * çocuğu olarak koy (kartta `overflow-hidden`); dokunmayı engellemez,
 * ekran okuyucuya görünmez. Açık temada çizilmez.
 */
export function CornerGlow({ color, corner = 'top-right', width = 260, height = 220, opacity = 0.4 }: CornerGlowProps) {
  const { scheme } = useTheme();
  const tones = useContextTones(color);
  const id = `cglow${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  if (!glowVisible(scheme)) return null;

  const position =
    corner === 'top-right' ? { right: -40, top: -60 } : { left: -30, bottom: -50 };
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', width, height, ...position }}
    >
      <Svg width={width} height={height}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" rx="50%" ry="50%" fx="50%" fy="50%">
            <Stop offset={0} stopColor={tones.fill} stopOpacity={opacity} />
            <Stop offset={0.68} stopColor={tones.fill} stopOpacity={0} />
            <Stop offset={1} stopColor={tones.fill} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}
