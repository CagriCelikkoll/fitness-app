import { useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';

import { formatDecimal } from '@/lib/format';
import { COLORS } from '@/theme';

export interface BarChartBar {
  key: string;
  value: number;
  /** Soluk tonla çiz (ör. henüz bitmemiş hafta) */
  pending?: boolean;
}

interface BarChartProps {
  /** Soldan sağa, eşit aralıklı */
  bars: BarChartBar[];
  /** Maks etiketi */
  formatY?: (value: number) => string;
  /** İlk ve son çubuğun altındaki etiketler */
  startLabel?: string;
  endLabel?: string;
  height?: number;
}

const PAD = 8;
/** Çubuğun kendi aralığındaki genişlik payı */
const BAR_RATIO = 0.6;

/**
 * Sıfırdan başlayan çubuk grafik — LineChart ile aynı görsel dil:
 * accent çubuklar, border ızgara, solda maks / 0 etiketi, altta aralık.
 * Değeri 0 olan çubuk çizilmiyor; boşluk "o dönemde kayıt yok" demek.
 */
export function BarChart({
  bars,
  formatY = (v) => formatDecimal(v),
  startLabel,
  endLabel,
  height = 140,
}: BarChartProps) {
  const [width, setWidth] = useState(0);

  const max = Math.max(0, ...bars.map((b) => b.value));
  // Hepsi 0 ise ölçek sıfıra bölünmesin
  const scale = max || 1;

  const innerW = Math.max(width - PAD * 2, 0);
  const innerH = height - PAD * 2;
  const slot = bars.length > 0 ? innerW / bars.length : 0;
  const barW = slot * BAR_RATIO;

  return (
    <View className="gap-3">
      <View className="flex-row">
        <View className="justify-between mr-2" style={{ height }}>
          <Text className="text-muted text-xs tabular-nums">{formatY(max)}</Text>
          <Text className="text-muted text-xs tabular-nums">0</Text>
        </View>
        <View
          className="flex-1"
          style={{ height }}
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        >
          {width > 0 && (
            <Svg width={width} height={height}>
              {/* Izgara: üst (max), orta, alt (0) */}
              {[0, 0.5, 1].map((f) => (
                <Line
                  key={f}
                  x1={0}
                  x2={width}
                  y1={PAD + f * innerH}
                  y2={PAD + f * innerH}
                  stroke={COLORS.border}
                  strokeWidth={1}
                />
              ))}
              {bars.map((b, i) => {
                if (!(b.value > 0)) return null;
                const h = (b.value / scale) * innerH;
                return (
                  <Rect
                    key={b.key}
                    x={PAD + i * slot + (slot - barW) / 2}
                    y={PAD + innerH - h}
                    width={barW}
                    height={h}
                    rx={Math.min(3, barW / 2)}
                    fill={COLORS.accent}
                    fillOpacity={b.pending ? 0.35 : 1}
                  />
                );
              })}
            </Svg>
          )}
        </View>
      </View>
      {(startLabel != null || endLabel != null) && (
        <View className="flex-row justify-between">
          <Text className="text-muted text-xs tabular-nums">{startLabel}</Text>
          <Text className="text-muted text-xs tabular-nums">{endLabel}</Text>
        </View>
      )}
    </View>
  );
}
