/**
 * Tamamlanmış (veya devam eden) bir antrenmanın tam dökümü.
 *
 * Route: /session/<id>
 * Not: expo-router statik `session/active`'i bu dinamik route'a tercih
 * eder, o yüzden aktif antrenman ekranıyla çakışma olmaz.
 */

import { useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { asc, eq } from 'drizzle-orm';
import { Trash2 } from 'lucide-react-native';

import { useDb } from '@/hooks/useDb';
import {
  cardioSegments,
  exercises as exercisesTable,
  sessionExercises,
  sets as setsTable,
  workoutSessions,
  type CardioSegment,
  type Exercise,
  type SessionExercise,
  type WorkoutSet,
} from '@/db/schema';
import {
  formatDateTime,
  formatDuration,
  formatVolume,
} from '@/lib/format';
import { COLORS } from '@/theme';
import { Card, DangerButton } from '@/components/ui';

interface ExerciseGroup {
  se: SessionExercise;
  exercise: Exercise;
  sets: WorkoutSet[];
}

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const db = useDb();

  // 1) Seans satırı
  const sessionQuery = useLiveQuery(
    db
      .select()
      .from(workoutSessions)
      .where(eq(workoutSessions.id, id!))
      .limit(1),
    [id]
  );

  // 2) Egzersizler + setleri (düz satırlar, JS tarafında gruplanıyor)
  const { data: rowsData } = useLiveQuery(
    db
      .select({
        se: sessionExercises,
        exercise: exercisesTable,
        set: setsTable,
      })
      .from(sessionExercises)
      .innerJoin(
        exercisesTable,
        eq(sessionExercises.exerciseId, exercisesTable.id)
      )
      .leftJoin(setsTable, eq(setsTable.sessionExerciseId, sessionExercises.id))
      .where(eq(sessionExercises.sessionId, id!))
      .orderBy(asc(sessionExercises.orderIndex), asc(setsTable.setNumber)),
    [id]
  );

  // 3) Cardio segmentleri
  const { data: cardioData } = useLiveQuery(
    db
      .select({
        segment: cardioSegments,
        exercise: exercisesTable,
      })
      .from(cardioSegments)
      .innerJoin(
        exercisesTable,
        eq(cardioSegments.exerciseId, exercisesTable.id)
      )
      .where(eq(cardioSegments.sessionId, id!))
      .orderBy(asc(cardioSegments.orderIndex)),
    [id]
  );

  // Düz satırları egzersiz bazında grupla, sadece tamamlanmış setleri al
  const exerciseGroups = useMemo<ExerciseGroup[]>(() => {
    const groups = new Map<string, ExerciseGroup>();
    for (const row of rowsData ?? []) {
      let group = groups.get(row.se.id);
      if (!group) {
        group = { se: row.se, exercise: row.exercise, sets: [] };
        groups.set(row.se.id, group);
      }
      if (row.set && row.set.isCompleted) {
        group.sets.push(row.set);
      }
    }

    return [...groups.values()];
  }, [rowsData]);

  const totalVolume = exerciseGroups.reduce(
    (sum, group) => sum + group.sets.reduce((s, set) => s + setVolume(set), 0),
    0
  );
  const totalSets = exerciseGroups.reduce(
    (sum, group) => sum + group.sets.length,
    0
  );

  const session = sessionQuery.data?.[0];

  const handleDelete = () => {
    if (!session) return;
    Alert.alert(
      'Antrenmanı Sil',
      `"${session.name}" antrenmanını silmek istediğine emin misin? Bu işlem geri alınamaz.`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Sil',
          style: 'destructive',
          onPress: async () => {
            await db
              .delete(workoutSessions)
              .where(eq(workoutSessions.id, session.id));
            router.back();
          },
        },
      ]
    );
  };

  // İlk sorgu daha dönmediyse yükleniyor
  if (!sessionQuery.updatedAt) {
    return (
      <View className="flex-1 bg-bg items-center justify-center">
        <Stack.Screen options={{ title: 'Antrenman' }} />
        <ActivityIndicator color={COLORS.accent} />
      </View>
    );
  }

  if (!session) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6">
        <Stack.Screen options={{ title: 'Antrenman' }} />
        <Text className="text-white text-xl font-semibold tracking-tight">
          Antrenman bulunamadı
        </Text>
        <Text className="text-muted text-sm text-center mt-2">
          Bu antrenman silinmiş olabilir.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerClassName="px-5 pt-4 gap-3 pb-10"
    >
      <Stack.Screen options={{ title: session.name }} />

      {/* Özet */}
      <View className="mb-1">
        <Text className="text-white text-4xl font-bold tracking-tight">
          {session.name}
        </Text>
        <Text className="text-muted text-sm mt-2 tabular-nums">
          {formatDateTime(session.startedAt)}
        </Text>

        <View className="flex-row gap-3 mt-5">
          <SummaryStat
            label="Süre"
            value={
              session.durationSeconds != null
                ? formatDuration(session.durationSeconds)
                : '—'
            }
          />
          <SummaryStat label="Set" value={String(totalSets)} />
          <SummaryStat
            label="Hacim"
            value={totalVolume > 0 ? formatVolume(totalVolume) : '—'}
          />
        </View>
      </View>

      {/* Egzersizler */}
      {exerciseGroups.map((group) => (
        <ExerciseDetailCard key={group.se.id} group={group} />
      ))}

      {/* Cardio segmentleri */}
      {(cardioData ?? []).length > 0 && (
        <Card>
          <Text className="text-accent-warm text-xl font-semibold tracking-tight mb-3">
            Kardiyo
          </Text>
          <View className="gap-3">
            {(cardioData ?? []).map((row) => (
              <CardioRow
                key={row.segment.id}
                segment={row.segment}
                exercise={row.exercise}
              />
            ))}
          </View>
        </Card>
      )}

      {/* Seans notu */}
      {session.notes && (
        <Card>
          <Text className="text-muted text-xs uppercase tracking-widest mb-2">
            Not
          </Text>
          <Text className="text-white text-base">{session.notes}</Text>
        </Card>
      )}

      {exerciseGroups.length === 0 && (cardioData ?? []).length === 0 && (
        <Card>
          <Text className="text-muted text-sm">
            Bu antrenmanda kayıtlı egzersiz yok.
          </Text>
        </Card>
      )}

      {/* Silme */}
      <DangerButton
        onPress={handleDelete}
        label="Antrenmanı Sil"
        icon={Trash2}
        className="mt-4"
      />
    </ScrollView>
  );
}

function ExerciseDetailCard({ group }: { group: ExerciseGroup }) {
  const volume = group.sets.reduce((sum, set) => sum + setVolume(set), 0);
  const heaviest = group.sets.reduce<WorkoutSet | null>(
    (best, set) =>
      set.weightKg != null && (best?.weightKg == null || set.weightKg > best.weightKg)
        ? set
        : best,
    null
  );

  return (
    <Card>
      <Text className="text-white text-xl font-semibold tracking-tight">
        {group.exercise.nameTr ?? group.exercise.name}
      </Text>

      {group.sets.length === 0 ? (
        <Text className="text-muted text-sm mt-2">
          Tamamlanmış set yok.
        </Text>
      ) : (
        <>
          {/* Tablo başlığı */}
          <View className="flex-row mt-4 pb-2 border-b border-border">
            <Text className="text-muted text-[11px] tracking-widest w-10">SET</Text>
            <Text className="text-muted text-[11px] tracking-widest flex-1 text-right">
              KG
            </Text>
            <Text className="text-muted text-[11px] tracking-widest flex-1 text-right">
              TEKRAR
            </Text>
            <Text className="text-muted text-[11px] tracking-widest flex-1 text-right">
              HACİM
            </Text>
          </View>

          {group.sets.map((set, idx) => (
            <View
              key={set.id}
              className={`flex-row py-2.5 ${idx > 0 ? 'border-t border-border' : ''}`}
            >
              <Text className="text-muted text-base tabular-nums w-10">
                {set.setNumber}
              </Text>
              <Text className="text-white text-base font-semibold tabular-nums flex-1 text-right">
                {set.weightKg != null ? String(set.weightKg) : '—'}
              </Text>
              <Text className="text-white text-base font-semibold tabular-nums flex-1 text-right">
                {set.reps != null ? String(set.reps) : '—'}
              </Text>
              <Text className="text-muted text-base tabular-nums flex-1 text-right">
                {setVolume(set) > 0 ? Math.round(setVolume(set)) : '—'}
              </Text>
            </View>
          ))}

          {/* Egzersiz özeti */}
          <View className="flex-row flex-wrap gap-x-4 gap-y-1 mt-2 pt-3 border-t border-border">
            <Text className="text-muted text-xs tabular-nums">
              {group.sets.length} set
            </Text>
            {volume > 0 && (
              <Text className="text-white text-xs font-semibold tabular-nums">
                {formatVolume(volume)}
              </Text>
            )}
            {heaviest?.weightKg != null && (
              <Text className="text-muted text-xs tabular-nums">
                En ağır: {heaviest.weightKg} kg
                {heaviest.reps != null && ` × ${heaviest.reps}`}
              </Text>
            )}
          </View>
        </>
      )}
    </Card>
  );
}

function CardioRow({
  segment,
  exercise,
}: {
  segment: CardioSegment;
  exercise: Exercise;
}) {
  return (
    <View className="border-t border-border pt-3 first:border-t-0 first:pt-0">
      <Text className="text-white text-base font-semibold">
        {exercise.nameTr ?? exercise.name}
      </Text>
      <View className="flex-row gap-4 mt-1">
        <Text className="text-muted text-xs">
          {formatDuration(segment.durationSeconds)}
        </Text>
        {segment.distanceKm != null && (
          <Text className="text-muted text-xs">{segment.distanceKm} km</Text>
        )}
        {segment.avgHeartRate != null && (
          <Text className="text-muted text-xs">
            ort. {segment.avgHeartRate} bpm
          </Text>
        )}
      </View>
    </View>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 bg-bg-surface border border-border rounded-2xl p-4">
      <Text className="text-muted text-[11px] uppercase tracking-widest">
        {label}
      </Text>
      <Text
        className="text-white text-2xl font-bold tabular-nums tracking-tight mt-2"
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
    </View>
  );
}

function setVolume(set: WorkoutSet): number {
  if (set.reps == null || set.weightKg == null) return 0;
  return set.reps * set.weightKg;
}
