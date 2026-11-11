/**
 * Hareket detayının Gelişim ve Geçmiş sekmeleri (v4.0b Bölüm 8).
 *
 * Sorgular join içeriyor; useLiveQuery yalnızca FROM tablosunu dinlediği için
 * ekrana her dönüşte yeniden okunuyor.
 */

import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { LineChart } from '@/components/LineChart';
import { Card, Chip, ListRow, StatTile } from '@/components/ui';
import { Text } from '@/components/ui/Text';
import { useDb } from '@/hooks/useDb';
import { getExerciseSetHistory } from '@/lib/exerciseHistory';
import {
  buildSessionPoints,
  computeRecords,
  type RecordValue,
  type SessionPoint,
} from '@/lib/exerciseProgress';
import { formatDecimal, formatShortDate, formatVolume } from '@/lib/format';
import { getExerciseSessionNotes } from '@/lib/notes';

export interface ExerciseProgressData {
  /** null: okunuyor */
  points: SessionPoint[] | null;
  /** Not yazılmış seansların id'leri (Geçmiş'teki 📝) */
  notedSessions: ReadonlySet<string>;
}

export function useExerciseProgress(exerciseId: string): ExerciseProgressData {
  const db = useDb();
  const [points, setPoints] = useState<SessionPoint[] | null>(null);
  const [notedSessions, setNotedSessions] = useState<ReadonlySet<string>>(new Set());

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getExerciseSetHistory(db, exerciseId)
        .then((rows) => {
          if (active) setPoints(buildSessionPoints(rows));
        })
        .catch((err) => {
          console.error('[EXERCISES] Geçmiş okunamadı:', err);
          if (active) setPoints([]);
        });
      getExerciseSessionNotes(db, exerciseId)
        .then((notes) => {
          if (active) setNotedSessions(new Set(notes.keys()));
        })
        .catch((err) => {
          console.warn('[NOTE] Notlar okunamadı:', err);
        });
      return () => {
        active = false;
      };
    }, [db, exerciseId])
  );

  return { points, notedSessions };
}

type Metric = 'e1rm' | 'topWeight' | 'volume';

const METRICS: { key: Metric; label: string }[] = [
  { key: 'e1rm', label: '1RM' },
  { key: 'topWeight', label: 'Ağırlık' },
  { key: 'volume', label: 'Hacim' },
];

const formatKg = (v: number) => `${formatDecimal(v)} kg`;

/** Seçili metriğin grafik noktaları; değeri olmayan seanslar atlanıyor */
function metricPoints(points: SessionPoint[], metric: Metric) {
  return points.flatMap((p) => {
    const y = p[metric];
    return y != null && y > 0 ? [{ x: p.date, y }] : [];
  });
}

/** "90 kg × 5"; vücut ağırlığında "12 tekrar" */
function formatBestSet(set: SessionPoint['bestSet']): string {
  if (!set) return '—';
  if (set.weightKg == null || set.weightKg <= 0) {
    return set.reps != null ? `${set.reps} tekrar` : '—';
  }
  return `${formatDecimal(set.weightKg)} kg × ${set.reps ?? '-'}`;
}

function NoHistory() {
  return (
    <Text className="text-muted text-sm text-center py-8">
      Bu hareketle bitirdiğin antrenman olunca burada görünür.
    </Text>
  );
}

export function ExerciseGrowthTab({ points }: { points: SessionPoint[] | null }) {
  const [metric, setMetric] = useState<Metric>('e1rm');

  if (!points) return null;
  if (points.length === 0) return <NoHistory />;

  const records = computeRecords(points);

  return (
    <>
      <View className="flex-row gap-2">
        <RecordTile label="Tahmini 1RM" record={records.e1rm} />
        <RecordTile label="En ağır" record={records.topWeight} />
        <RecordTile label="Hacim" record={records.volume} volume />
      </View>

      <Card className="gap-4">
        <View className="flex-row gap-2">
          {METRICS.map((m) => (
            <Chip
              key={m.key}
              label={m.label}
              active={metric === m.key}
              onPress={() => setMetric(m.key)}
            />
          ))}
        </View>
        <LineChart
          points={metricPoints(points, metric)}
          formatY={metric === 'volume' ? formatVolume : formatKg}
          formatX={(x) => formatShortDate(x)}
          height={180}
          highlightMax
          emptyText="Grafik için en az iki seans gerekli."
        />
      </Card>
    </>
  );
}

export function ExerciseHistoryTab({ points, notedSessions }: ExerciseProgressData) {
  if (!points) return null;
  if (points.length === 0) return <NoHistory />;

  return (
    <Card className="py-1">
      {[...points].reverse().map((p, idx) => (
        <ListRow
          key={p.sessionId}
          divider={idx > 0}
          right={
            <Text className="text-fg text-base font-semibold tabular-nums">
              {formatBestSet(p.bestSet)}
            </Text>
          }
        >
          <Text className="text-muted text-base tabular-nums">
            {formatShortDate(p.date)}
            {notedSessions.has(p.sessionId) && '  📝'}
          </Text>
        </ListRow>
      ))}
    </Card>
  );
}

function RecordTile({
  label,
  record,
  volume = false,
}: {
  label: string;
  record: RecordValue | null;
  /** Hacim: binlik ayraçlı tam sayı */
  volume?: boolean;
}) {
  return (
    <StatTile
      label={label}
      value={
        record == null
          ? '—'
          : volume
            ? Math.round(record.value).toLocaleString('tr-TR')
            : formatDecimal(record.value)
      }
      unit={record == null ? undefined : 'kg'}
      size="sm"
      footnote={record == null ? undefined : formatShortDate(record.date)}
      className="flex-1 p-4"
    />
  );
}
