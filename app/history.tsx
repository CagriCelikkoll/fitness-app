import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { and, count, countDistinct, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { ChevronRight, History, Play } from 'lucide-react-native';

import { useDb } from '@/hooks/useDb';
import { sessionExercises, sets, workoutSessions } from '@/db/schema';
import {
  formatDuration,
  formatRelativeDate,
  formatVolume,
} from '@/lib/format';
import { COLORS } from '@/theme';
import { Card, EmptyState, PrimaryButton } from '@/components/ui';

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
        <ActivityIndicator color={COLORS.accent} />
      </View>
    );
  }

  if (sessionList.length === 0) {
    return (
      <View className="flex-1 bg-bg">
        <EmptyState
          className="flex-1"
          icon={History}
          title="Henüz tamamlanmış antrenman yok."
          description="Bir rutini başlatıp bitirdiğinde antrenmanın burada listelenecek."
          action={
            <Link href="/(tabs)/workout" asChild>
              <PrimaryButton label="Antrenmana Başla" icon={Play} iconFill />
            </Link>
          }
        />
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
            <Card>
              <View className="flex-row items-center">
                <View className="flex-1 mr-3">
                  <Text className="text-white text-xl font-semibold tracking-tight">
                    {item.name}
                  </Text>
                  <Text className="text-muted text-sm mt-1 tabular-nums">
                    {formatRelativeDate(item.startedAt)}
                    {item.durationSeconds != null &&
                      `  •  ${formatDuration(item.durationSeconds)}`}
                  </Text>
                </View>
                <ChevronRight color={COLORS.muted} size={20} />
              </View>

              <View className="flex-row flex-wrap gap-x-4 gap-y-1 mt-4 pt-4 border-t border-border">
                <Text className="text-muted text-xs uppercase tracking-widest tabular-nums">
                  {item.exerciseCount} egzersiz
                </Text>
                <Text className="text-muted text-xs uppercase tracking-widest tabular-nums">
                  {item.setCount} set
                </Text>
                {item.totalVolume > 0 && (
                  <Text className="text-white text-xs font-semibold uppercase tracking-widest tabular-nums">
                    {formatVolume(item.totalVolume)}
                  </Text>
                )}
              </View>
            </Card>
          </Link>
        )}
        contentContainerClassName="px-5 pt-4 gap-3 pb-10"
      />
    </View>
  );
}
