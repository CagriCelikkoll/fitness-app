import { useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';

import { formatDateKey, formatDecimal } from '@/lib/format';
import { COLORS } from '@/theme';

export interface LineChartPoint {
  /** Tarih: "2026-09-14" (yerel gün) ya da ISO zaman damgası */
  x: string;
  y: number;
}

interface LineChartProps {
  /** Tarihe göre artan sırada */
  points: LineChartPoint[];
  /** Min/maks etiketleri */
  formatY?: (value: number) => string;
  /** Alttaki tarih aralığı etiketleri */
  formatX?: (x: string) => string;
  height?: number;
  /** En yüksek noktayı (rekor) dolgulu ve büyük çiz */
  highlightMax?: boolean;
  /** Nokta sayısı 2'den azsa grafik yerine gösterilen mesaj */
  emptyText?: string;
  /**
   * `sparkline`: satır içi mini trend (~64×24) — eksen, etiket, ızgara
   * yok; yalnızca çizgi ve son nokta. 2'den az noktada hiçbir şey çizmez.
   */
  variant?: 'full' | 'sparkline';
}

const PAD = 8;
const SPARK_W = 64;
const SPARK_H = 24;
const SPARK_PAD = 3;
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * new Date('YYYY-MM-DD') UTC olarak yorumlandığı için gün anahtarları
 * parçalanıp yerel tarih kuruluyor; ISO zaman damgaları olduğu gibi.
 */
function toTime(x: string): number {
  if (DATE_KEY_RE.test(x)) {
    const [y, m, d] = x.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  return new Date(x).getTime();
}

function defaultFormatX(x: string): string {
  return DATE_KEY_RE.test(x)
    ? formatDateKey(x)
    : new Date(x).toLocaleDateString('tr-TR');
}

/**
 * Zamana orantılı çizgi grafik: x ekseni noktalar arasındaki gerçek
 * süreye göre, y ekseni min–maks aralığına göre ölçekleniyor.
 */
export function LineChart({
  points,
  formatY = (v) => formatDecimal(v),
  formatX = defaultFormatX,
  height = 140,
  highlightMax = false,
  emptyText = 'Grafik için en az iki kayıt gerekli.',
  variant = 'full',
}: LineChartProps) {
  const [width, setWidth] = useState(0);

  if (variant === 'sparkline') return <Sparkline points={points} />;

  if (points.length < 2) {
    return <Text className="text-muted text-sm">{emptyText}</Text>;
  }

  const values = points.map((p) => p.y);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // Düz çizgide ölçek sıfıra bölünmesin
  const span = max - min || 1;
  // Eşitlikte ilk ulaşılan nokta rekor
  const maxIndex = values.indexOf(max);

  const t0 = toTime(points[0].x);
  const tSpan = toTime(points[points.length - 1].x) - t0 || 1;

  const innerW = Math.max(width - PAD * 2, 0);
  const innerH = height - PAD * 2;
  const coords = points.map((p) => ({
    x: PAD + ((toTime(p.x) - t0) / tSpan) * innerW,
    y: PAD + (1 - (p.y - min) / span) * innerH,
  }));

  return (
    <View className="gap-3">
      <View className="flex-row">
        <View className="justify-between mr-2" style={{ height }}>
          <Text className="text-muted text-xs tabular-nums">{formatY(max)}</Text>
          <Text className="text-muted text-xs tabular-nums">{formatY(min)}</Text>
        </View>
        <View
          className="flex-1"
          style={{ height }}
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        >
          {width > 0 && (
            <Svg width={width} height={height}>
              {/* Izgara: üst (max), orta, alt (min) */}
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
              <Polyline
                points={coords.map((c) => `${c.x},${c.y}`).join(' ')}
                fill="none"
                stroke={COLORS.accent}
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {coords.map((c, i) =>
                highlightMax && i === maxIndex ? (
                  <Circle key={i} cx={c.x} cy={c.y} r={6} fill={COLORS.accent} />
                ) : (
                  <Circle
                    key={i}
                    cx={c.x}
                    cy={c.y}
                    r={3.5}
                    fill={COLORS.surface}
                    stroke={COLORS.accent}
                    strokeWidth={2}
                  />
                )
              )}
            </Svg>
          )}
        </View>
      </View>
      <View className="flex-row justify-between">
        <Text className="text-muted text-xs tabular-nums">
          {formatX(points[0].x)}
        </Text>
        <Text className="text-muted text-xs tabular-nums">
          {formatX(points[points.length - 1].x)}
        </Text>
      </View>
    </View>
  );
}

function Sparkline({ points }: { points: LineChartPoint[] }) {
  if (points.length < 2) return null;

  const values = points.map((p) => p.y);
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const t0 = toTime(points[0].x);
  const tSpan = toTime(points[points.length - 1].x) - t0 || 1;

  const coords = points.map((p) => ({
    x: SPARK_PAD + ((toTime(p.x) - t0) / tSpan) * (SPARK_W - SPARK_PAD * 2),
    y: SPARK_PAD + (1 - (p.y - min) / span) * (SPARK_H - SPARK_PAD * 2),
  }));
  const last = coords[coords.length - 1];

  return (
    <Svg width={SPARK_W} height={SPARK_H}>
      <Polyline
        points={coords.map((c) => `${c.x},${c.y}`).join(' ')}
        fill="none"
        stroke={COLORS.accent}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <Circle cx={last.x} cy={last.y} r={2.5} fill={COLORS.accent} />
    </Svg>
  );
}
