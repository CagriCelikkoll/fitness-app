import { Pressable, ScrollView, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { desc, isNotNull, sql } from 'drizzle-orm';
import { Play, Plus } from 'lucide-react-native';

import { useDb } from '@/hooks/useDb';
import { exercises, routines, workoutSessions } from '@/db/schema';
import { useActiveWorkoutStore } from '@/stores/activeWorkoutStore';

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
      contentContainerClassName="p-4 gap-4 pb-8"
    >
      <View>
        <Text className="text-white text-2xl font-bold">Hoş geldin 💪</Text>
        <Text className="text-muted text-sm mt-1">
          Bugün hangi kasları çalıştıracağız?
        </Text>
      </View>

      {/* Aktif session bandı */}
      {activeSessionId && (
        <Link href="/session/active" asChild>
          <Pressable className="bg-accent rounded-xl p-4 flex-row items-center">
            <Play color="#0f172a" size={20} fill="#0f172a" />
            <View className="flex-1 ml-3">
              <Text className="text-bg font-bold">Devam eden antrenman</Text>
              <Text className="text-bg/70 text-xs mt-0.5">Devam et →</Text>
            </View>
          </Pressable>
        </Link>
      )}

      {/* İstatistikler */}
      <View className="flex-row gap-3">
        <StatCard
          label="Egzersiz"
          value={exerciseStats.data?.[0]?.count ?? 0}
        />
        <StatCard label="Rutin" value={routineStats.data?.[0]?.count ?? 0} />
        <StatCard
          label="Antrenman"
          value={sessionStats.data?.[0]?.count ?? 0}
        />
      </View>

      {/* Hızlı aksiyon */}
      {!activeSessionId && (
        <Link href="/(tabs)/workout" asChild>
          <Pressable className="bg-bg-surface rounded-xl p-4 flex-row items-center">
            <View className="w-12 h-12 rounded-full bg-accent/20 items-center justify-center">
              <Play color="#22c55e" size={22} fill="#22c55e" />
            </View>
            <View className="flex-1 ml-3">
              <Text className="text-white font-semibold">
                Antrenmana Başla
              </Text>
              <Text className="text-muted text-xs mt-0.5">
                Rutinlerini gör veya yeni bir antrenman oluştur
              </Text>
            </View>
          </Pressable>
        </Link>
      )}

      {/* Son antrenmanlar */}
      <View className="bg-bg-surface rounded-xl p-4">
        <Text className="text-white font-semibold mb-3">Son Antrenmanlar</Text>
        {!recentSessions.data || recentSessions.data.length === 0 ? (
          <Text className="text-muted text-sm">
            Henüz tamamlanmış antrenman yok. İlk antrenmanını başlat!
          </Text>
        ) : (
          <View className="gap-2">
            {recentSessions.data.map((session) => (
              <View
                key={session.id}
                className="flex-row items-center py-2 border-t border-bg-elevated first:border-t-0"
              >
                <View className="flex-1">
                  <Text className="text-white text-sm font-medium">
                    {session.name}
                  </Text>
                  <Text className="text-muted text-xs mt-0.5">
                    {formatRelativeDate(session.startedAt)}
                    {session.durationSeconds &&
                      `  •  ${formatDuration(session.durationSeconds)}`}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>

      <Text className="text-muted text-xs text-center mt-2">
        Aşama 1 ✓ Egzersiz kütüphanesi  •  Rutinler  •  Antrenman loglama
      </Text>
    </ScrollView>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <View className="flex-1 bg-bg-surface rounded-xl p-3">
      <Text className="text-accent text-2xl font-bold">{value}</Text>
      <Text className="text-muted text-xs mt-1">{label}</Text>
    </View>
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
