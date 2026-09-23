import { Pressable, ScrollView, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { desc, isNotNull, sql } from 'drizzle-orm';
import { Play } from 'lucide-react-native';

import { useDb } from '@/hooks/useDb';
import { exercises, routines, workoutSessions } from '@/db/schema';
import { useActiveWorkoutStore } from '@/stores/activeWorkoutStore';
import { COLORS } from '@/theme';
import { Card, ListRow, SectionHeader, StatTile } from '@/components/ui';

export default function HomeScreen() {
  const db = useDb();

  const activeSessionId = useActiveWorkoutStore((s) => s.activeSessionId);

  const exerciseStats = useLiveQuery(
    db.select({ count: sql<number>`count(*)` }).from(exercises)
  );
  const sessionStats = useLiveQuery(
    db
      .select({ count: sql<number>`count(*)` })
      .from(workoutSessions)
      .where(isNotNull(workoutSessions.endedAt))
  );
  const routineStats = useLiveQuery(
    db.select({ count: sql<number>`count(*)` }).from(routines)
  );

  // Son 3 tamamlanmış antrenman
  const recentSessions = useLiveQuery(
    db
      .select()
      .from(workoutSessions)
      .where(isNotNull(workoutSessions.endedAt))
      .orderBy(desc(workoutSessions.startedAt))
      .limit(3)
  );

  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerClassName="px-5 pt-6 gap-3 pb-10"
    >
      <View className="mb-3">
        <Text className="text-white text-4xl font-bold tracking-tight">
          Hoş geldin 💪
        </Text>
        <Text className="text-muted text-sm mt-2">
          Bugün hangi kasları çalıştıracağız?
        </Text>
      </View>

      {/* Aktif session bandı */}
      {activeSessionId && (
        <Link href="/session/active" asChild>
          <Card variant="accent" className="flex-row items-center">
            <View className="w-12 h-12 rounded-full bg-accent-fg items-center justify-center">
              <Play color={COLORS.accent} size={20} fill={COLORS.accent} />
            </View>
            <View className="flex-1 ml-4">
              <Text className="text-accent-fg text-xl font-bold tracking-tight">
                Devam eden antrenman
              </Text>
              <Text className="text-accent-fg/70 text-sm mt-0.5">
                Devam et →
              </Text>
            </View>
          </Card>
        </Link>
      )}

      {/* İstatistikler — bir geniş + iki dar kart */}
      <View className="flex-row gap-3">
        <StatTile
          label="Antrenman"
          value={sessionStats.data?.[0]?.count ?? 0}
          className="flex-1 min-h-[164px]"
        />
        <View className="flex-1 gap-3">
          <StatTile
            label="Egzersiz"
            value={exerciseStats.data?.[0]?.count ?? 0}
            size="sm"
            className="flex-1"
          />
          <StatTile
            label="Rutin"
            value={routineStats.data?.[0]?.count ?? 0}
            size="sm"
            className="flex-1"
          />
        </View>
      </View>

      {/* Hızlı aksiyon */}
      {!activeSessionId && (
        <Link href="/(tabs)/workout" asChild>
          <Card variant="outline" className="flex-row items-center">
            <View className="w-12 h-12 rounded-full bg-accent items-center justify-center">
              <Play color={COLORS.accentFg} size={20} fill={COLORS.accentFg} />
            </View>
            <View className="flex-1 ml-4">
              <Text className="text-white text-xl font-semibold tracking-tight">
                Antrenmana Başla
              </Text>
              <Text className="text-muted text-sm mt-0.5">
                Rutinlerini gör veya yeni bir antrenman oluştur
              </Text>
            </View>
          </Card>
        </Link>
      )}

      {/* Son antrenmanlar */}
      <SectionHeader
        title="Son Antrenmanlar"
        className="mt-5 mb-1"
        action={
          <Link href="/history" asChild>
            <Pressable hitSlop={12}>
              <Text className="text-muted text-sm font-medium">
                Tümünü gör →
              </Text>
            </Pressable>
          </Link>
        }
      />
      <Card className="py-2">
        {!recentSessions.data || recentSessions.data.length === 0 ? (
          <Text className="text-muted text-sm py-3">
            Henüz tamamlanmış antrenman yok. İlk antrenmanını başlat!
          </Text>
        ) : (
          recentSessions.data.map((session, idx) => (
            <Link
              key={session.id}
              href={{ pathname: '/session/[id]', params: { id: session.id } }}
              asChild
            >
              <ListRow divider={idx > 0} chevron>
                <Text className="text-white text-base font-semibold">
                  {session.name}
                </Text>
                <Text className="text-muted text-xs mt-1 tabular-nums">
                  {formatRelativeDate(session.startedAt)}
                  {session.durationSeconds &&
                    `  •  ${formatDuration(session.durationSeconds)}`}
                </Text>
              </ListRow>
            </Link>
          ))
        )}
      </Card>
    </ScrollView>
  );
}

function formatRelativeDate(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffDays = Math.floor(
    (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diffDays === 0) return 'Bugün';
  if (diffDays === 1) return 'Dün';
  if (diffDays < 7) return `${diffDays} gün önce`;
  return date.toLocaleDateString('tr-TR');
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} dk`;
  const hours = Math.floor(minutes / 60);
  const remainingMin = minutes % 60;
  return `${hours}sa ${remainingMin}dk`;
}
