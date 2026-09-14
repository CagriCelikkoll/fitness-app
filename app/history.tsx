import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { and, count, countDistinct, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { ChevronRight, Play } from 'lucide-react-native';

import { useDb } from '@/hooks/useDb';
import { sessionExercises, sets, workoutSessions } from '@/db/schema';
import {
  formatDuration,
  formatRelativeDate,
  formatVolume,
} from '@/lib/format';

export default function HistoryScreen() {
  const db = useDb();

  // Tamamlanmış seanslar + tek sorguda özet metrikler
  const { data: sessionList } = useLiveQuery(
    db
      .select({
        id: workoutSessions.id,
        name: workoutSessions.name,
        startedAt: workoutSessions.startedAt,
        durationSeconds: workoutSessions.durationSeconds,
        exerciseCount: countDistinct(sessionExercises.id),
        setCount: count(sets.id),
        totalVolume: sql<number>`COALESCE(SUM(${sets.reps} * ${sets.weightKg}), 0)`.mapWith(
          Number
        ),
      })
      .from(workoutSessions)
      .leftJoin(
        sessionExercises,
        eq(sessionExercises.sessionId, workoutSessions.id)
      )
      .leftJoin(
        sets,
        and(
          eq(sets.sessionExerciseId, sessionExercises.id),
          eq(sets.isCompleted, true)
        )
      )
      .where(isNotNull(workoutSessions.endedAt))
      .groupBy(workoutSessions.id)
      .orderBy(desc(workoutSessions.startedAt))
  );

  if (!sessionList) {
    return (
      <View className="flex-1 bg-bg items-center justify-center">
        <ActivityIndicator color="#22c55e" />
      </View>
    );
  }

  if (sessionList.length === 0) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6">
        <Text className="text-white text-lg font-semibold mb-2">
          Henüz tamamlanmış antrenman yok.
        </Text>
        <Text className="text-muted text-center mb-6">
          Bir rutini başlatıp bitirdiğinde antrenmanın burada listelenecek.
        </Text>
        <Link href="/(tabs)/workout" asChild>
          <Pressable className="bg-accent px-6 py-3 rounded-full flex-row items-center">
            <Play color="#0f172a" size={18} fill="#0f172a" />
            <Text className="text-bg font-semibold ml-2">Antrenmana Başla</Text>
          </Pressable>
        </Link>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg">
      <FlatList
        data={sessionList}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Link
            href={{ pathname: '/session/[id]', params: { id: item.id } }}
            asChild
          >
            <Pressable className="bg-bg-surface rounded-xl p-4">
              <View className="flex-row items-center">
                <View className="flex-1 mr-3">
                  <Text className="text-white text-lg font-semibold">
                    {item.name}
                  </Text>
                  <Text className="text-muted text-xs mt-0.5">
                    {formatRelativeDate(item.startedAt)}
                    {item.durationSeconds != null &&
                      `  •  ${formatDuration(item.durationSeconds)}`}
                  </Text>
                </View>
                <ChevronRight color="#64748b" size={20} />
              </View>

              <View className="flex-row gap-4 mt-3">
                <Text className="text-muted text-xs">
                  {item.exerciseCount} egzersiz
                </Text>
                <Text className="text-muted text-xs">{item.setCount} set</Text>
                {item.totalVolume > 0 && (
                  <Text className="text-accent text-xs font-medium">
                    {formatVolume(item.totalVolume)}
                  </Text>
                )}
              </View>
            </Pressable>
          </Link>
        )}
        contentContainerClassName="p-4 gap-3 pb-8"
      />
    </View>
  );
}
