import { useCallback, useState } from 'react';
import { Image, ScrollView, Text, View, ActivityIndicator } from 'react-native';
import { useFocusEffect, useLocalSearchParams, Stack } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { eq } from 'drizzle-orm';

import { useDb } from '@/hooks/useDb';
import { exercises } from '@/db/schema';
import { getExerciseImageUrls } from '@/lib/exerciseImage';
import {
  equipmentLabel,
  forceLabel,
  levelLabel,
  mechanicLabel,
  muscleLabels,
  parseMuscles,
} from '@/lib/exerciseTaxonomy';
import { exerciseHighlight } from '@/lib/muscleMap';
import { getExerciseSetHistory } from '@/lib/exerciseHistory';
import {
  buildSessionPoints,
  computeRecords,
  type RecordValue,
  type SessionPoint,
} from '@/lib/exerciseProgress';
import { formatDecimal, formatShortDate, formatVolume } from '@/lib/format';
import { COLORS } from '@/theme';
import { Card, Chip, ListRow, SectionHeader, StatTile } from '@/components/ui';
import { LineChart } from '@/components/LineChart';
import { MuscleMap } from '@/components/MuscleMap';

export default function ExerciseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();

  const { data } = useLiveQuery(
    db.select().from(exercises).where(eq(exercises.id, id ?? '')).limit(1),
    [id]
  );

  if (!data) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={COLORS.accent} />
      </View>
    );
  }

  const exercise = data[0];

  if (!exercise) {
    return (
      <View className="flex-1 items-center justify-center bg-bg p-6">
        <Text className="text-muted">Egzersiz bulunamadı.</Text>
      </View>
    );
  }

  const imageUrls = getExerciseImageUrls(exercise.imagePaths);
  const primaryMuscles = muscleLabels(exercise.primaryMuscles);
  const secondaryMuscles = muscleLabels(exercise.secondaryMuscles);
  const highlights = exerciseHighlight(
    parseMuscles(exercise.primaryMuscles),
    parseMuscles(exercise.secondaryMuscles)
  );
  const instructions = parseJsonArray(exercise.instructions);
  const displayName = exercise.nameTr ?? exercise.name;

  return (
    <>
      <Stack.Screen options={{ title: displayName }} />
      <ScrollView
        className="flex-1 bg-bg"
        contentContainerClassName="px-5 pt-4 gap-3 pb-10"
      >
        <View className="mb-2">
          <Text className="text-white text-4xl font-bold tracking-tight">
            {displayName}
          </Text>
          {exercise.nameTr && exercise.nameTr !== exercise.name && (
            <Text className="text-muted text-sm mt-2">{exercise.name}</Text>
          )}
        </View>

        {/* Görseller */}
        {imageUrls.length > 0 && (
          <View className="flex-row gap-3">
            {imageUrls.slice(0, 2).map((url, idx) => (
              <View
                key={idx}
                className="flex-1 bg-bg-surface border border-border rounded-3xl overflow-hidden aspect-square"
              >
                <Image
                  source={{ uri: url }}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode="cover"
                />
              </View>
            ))}
          </View>
        )}

        {/* Hızlı bilgiler */}
        <View className="flex-row flex-wrap gap-2">
          {exercise.equipment && (
            <Chip
              size="sm"
              label={`Ekipman: ${equipmentLabel(exercise.equipment)}`}
            />
          )}
          {exercise.mechanic && (
            <Chip size="sm" label={mechanicLabel(exercise.mechanic)} />
          )}
          {exercise.force && (
            <Chip size="sm" label={forceLabel(exercise.force)} />
          )}
          {exercise.level && (
            <Chip size="sm" label={`Seviye: ${levelLabel(exercise.level)}`} />
          )}
        </View>

        {/* Kaslar */}
        <SectionHeader title="Çalıştırılan Kaslar" className="mt-4" />
        <Card className="gap-4">
          {highlights.length > 0 && <MuscleMap highlights={highlights} />}
          {primaryMuscles.length > 0 && (
            <View>
              <Text className="text-muted text-xs uppercase tracking-widest">
                Birincil
              </Text>
              <Text className="text-white text-base mt-1">
                {primaryMuscles.join(', ')}
              </Text>
            </View>
          )}
          {secondaryMuscles.length > 0 && (
            <View>
              <Text className="text-muted text-xs uppercase tracking-widest">
                İkincil
              </Text>
              <Text className="text-white text-base mt-1">
                {secondaryMuscles.join(', ')}
              </Text>
            </View>
          )}
        </Card>

        <ExerciseProgressSection exerciseId={exercise.id} />

        {/* Talimatlar */}
        {instructions.length > 0 && (
          <>
            <SectionHeader title="Nasıl Yapılır" className="mt-4" />
            <Card className="gap-4">
              {instructions.map((step, idx) => (
                <View key={idx} className="flex-row">
                  <Text className="text-muted font-semibold tabular-nums w-7">
                    {idx + 1}.
                  </Text>
                  <Text className="text-white text-base leading-6 flex-1">
                    {step}
                  </Text>
                </View>
              ))}
            </Card>
          </>
        )}
      </ScrollView>
    </>
  );
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

// ============================================================================
// İlerlemen — rekorlar, metrik grafiği, son seanslar
// ============================================================================

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

/**
 * Kullanıcının bu egzersizde hiç tamamlanmış seti yoksa hiçbir şey
 * göstermez (kütüphanedeki hareketlerin çoğu için durum bu).
 *
 * Sorgu join içeriyor; useLiveQuery yalnızca FROM tablosunu dinlediği
 * için ekrana her dönüşte yeniden okunuyor.
 */
function ExerciseProgressSection({ exerciseId }: { exerciseId: string }) {
  const db = useDb();
  const [points, setPoints] = useState<SessionPoint[] | null>(null);
  const [metric, setMetric] = useState<Metric>('e1rm');

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getExerciseSetHistory(db, exerciseId).then((rows) => {
        if (active) setPoints(buildSessionPoints(rows));
      });
      return () => {
        active = false;
      };
    }, [db, exerciseId])
  );

  if (!points || points.length === 0) return null;

  const records = computeRecords(points);
  const recentSessions = points.slice(-5).reverse();

  return (
    <>
      <SectionHeader title="İlerlemen" className="mt-4" />
      <View className="flex-row gap-2">
        <RecordTile label="Tahmini 1RM" record={records.e1rm} />
        <RecordTile label="En Ağır" record={records.topWeight} />
        <RecordTile label="En Yüksek Hacim" record={records.volume} volume />
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

      <Card className="py-1">
        {recentSessions.map((p, idx) => (
          <ListRow
            key={p.sessionId}
            divider={idx > 0}
            right={
              <Text className="text-white text-base font-semibold tabular-nums">
                {formatBestSet(p.bestSet)}
              </Text>
            }
          >
            <Text className="text-muted text-base tabular-nums">
              {formatShortDate(p.date)}
            </Text>
          </ListRow>
        ))}
      </Card>
    </>
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
