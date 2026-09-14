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
        <ActivityIndicator color="#22c55e" />
      </View>
    );
  }

  if (!session) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6">
        <Stack.Screen options={{ title: 'Antrenman' }} />
        <Text className="text-white text-lg font-semibold">
          Antrenman bulunamadı
        </Text>
        <Text className="text-muted text-center mt-2">
          Bu antrenman silinmiş olabilir.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerClassName="p-4 gap-3 pb-8"
    >
      <Stack.Screen options={{ title: session.name }} />

      {/* Özet kartı */}
      <View className="bg-bg-surface rounded-xl p-4">
        <Text className="text-white text-xl font-bold">{session.name}</Text>
        <Text className="text-muted text-xs mt-1">
          {formatDateTime(session.startedAt)}
        </Text>

        <View className="flex-row gap-3 mt-4">
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
        <View className="bg-bg-surface rounded-xl p-4">
          <Text className="text-accent-warm font-semibold mb-3">Kardiyo</Text>
          <View className="gap-3">
            {(cardioData ?? []).map((row) => (
              <CardioRow
                key={row.segment.id}
                segment={row.segment}
                exercise={row.exercise}
              />
            ))}
          </View>
        </View>
      )}

      {/* Seans notu */}
      {session.notes && (
        <View className="bg-bg-surface rounded-xl p-4">
          <Text className="text-white font-semibold mb-1">Not</Text>
          <Text className="text-muted text-sm">{session.notes}</Text>
        </View>
      )}

      {exerciseGroups.length === 0 && (cardioData ?? []).length === 0 && (
        <View className="bg-bg-surface rounded-xl p-4">
          <Text className="text-muted text-sm">
            Bu antrenmanda kayıtlı egzersiz yok.
          </Text>
        </View>
      )}

      {/* Silme */}
      <Pressable
        onPress={handleDelete}
        className="bg-bg-surface rounded-xl p-4 flex-row items-center justify-center mt-2"
      >
        <Trash2 color="#ef4444" size={18} />
        <Text className="text-red-400 font-semibold ml-2">Antrenmanı Sil</Text>
      </Pressable>
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
    <View className="bg-bg-surface rounded-xl p-4">
      <Text className="text-white text-base font-semibold">
        {group.exercise.nameTr ?? group.exercise.name}
      </Text>

      {group.sets.length === 0 ? (
        <Text className="text-muted text-xs mt-2">
          Tamamlanmış set yok.
        </Text>
      ) : (
        <>
          {/* Tablo başlığı */}
          <View className="flex-row mt-3 pb-1 border-b border-bg-elevated">
            <Text className="text-muted text-xs w-10">SET</Text>
            <Text className="text-muted text-xs flex-1 text-right">KG</Text>
            <Text className="text-muted text-xs flex-1 text-right">TEKRAR</Text>
            <Text className="text-muted text-xs flex-1 text-right">HACİM</Text>
          </View>

          {group.sets.map((set) => (
            <View
              key={set.id}
              className="flex-row py-1.5 border-b border-bg-elevated"
            >
              <Text className="text-muted text-sm w-10">{set.setNumber}</Text>
              <Text className="text-white text-sm flex-1 text-right">
                {set.weightKg != null ? String(set.weightKg) : '—'}
              </Text>
              <Text className="text-white text-sm flex-1 text-right">
                {set.reps != null ? String(set.reps) : '—'}
              </Text>
              <Text className="text-muted text-sm flex-1 text-right">
                {setVolume(set) > 0 ? Math.round(setVolume(set)) : '—'}
              </Text>
            </View>
          ))}

          {/* Egzersiz özeti */}
          <View className="flex-row gap-4 mt-3">
            <Text className="text-muted text-xs">{group.sets.length} set</Text>
            {volume > 0 && (
              <Text className="text-accent text-xs font-medium">
                {formatVolume(volume)}
              </Text>
            )}
            {heaviest?.weightKg != null && (
              <Text className="text-muted text-xs">
                En ağır: {heaviest.weightKg} kg
                {heaviest.reps != null && ` × ${heaviest.reps}`}
              </Text>
            )}
          </View>
        </>
      )}
    </View>
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
    <View className="border-t border-bg-elevated pt-3 first:border-t-0 first:pt-0">
      <Text className="text-white text-sm font-medium">
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
    <View className="flex-1 bg-bg-elevated rounded-lg p-3">
      <Text className="text-white text-base font-bold" numberOfLines={1}>
        {value}
      </Text>
      <Text className="text-muted text-xs mt-0.5">{label}</Text>
    </View>
  );
}

function setVolume(set: WorkoutSet): number {
  if (set.reps == null || set.weightKg == null) return 0;
  return set.reps * set.weightKg;
}
