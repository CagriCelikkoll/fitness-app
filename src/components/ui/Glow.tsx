import { useId } from 'react';
import { useWindowDimensions, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { useContextTones, useTheme } from '@/hooks/useTheme';
import { GLOW_HEIGHT, GLOW_STOPS, glowBox, glowVisible } from '@/lib/glow';
import type { ContextKind } from '@/theme';

interface GlowProps {
  /** Bağlam rengi; verilmezse brand (salon rengi varsa o) */
  color?: ContextKind;
  height?: number;
}

/**
 * Ekranın üstünde bağlam renginde yumuşak ışık (v4.0a 1.3). İçeriğin
 * arkasında (ekranın ilk çocuğu olarak koy), dokunmayı engellemez. Açık
 * temada çizilmez (zemin düz `bg`).
 */
export function Glow({ color, height = GLOW_HEIGHT }: GlowProps) {
  const { scheme } = useTheme();
  const tones = useContextTones(color);
  const { width: screenWidth } = useWindowDimensions();
  const id = `glow${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  if (!glowVisible(scheme)) return null;

  const box = glowBox(screenWidth, height);
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', top: 0, left: box.left, width: box.width, height: box.height }}
    >
      <Svg width={box.width} height={box.height}>
        <Defs>
          <RadialGradient
            id={id}
            gradientUnits="userSpaceOnUse"
            cx={box.cx}
            cy={box.cy}
            fx={box.cx}
            fy={box.cy}
            rx={box.rx}
            ry={box.ry}
          >
            {GLOW_STOPS.map((s) => (
              <Stop key={s.offset} offset={s.offset} stopColor={tones.fill} stopOpacity={s.opacity} />
            ))}
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={box.width} height={box.height} fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}
