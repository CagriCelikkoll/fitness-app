import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { desc, isNotNull, sql } from 'drizzle-orm';
import Storage from 'expo-sqlite/kv-store';
import { Play, Scale, Target } from 'lucide-react-native';

import { useDb } from '@/hooks/useDb';
import { useWeeklyGoal } from '@/hooks/useWeeklyGoal';
import { useSessionRecovery } from '@/hooks/useSessionRecovery';
import { bodyMetrics, routines, workoutSessions } from '@/db/schema';
import { useActiveWorkoutStore } from '@/stores/activeWorkoutStore';
import {
  isOnboardingDone,
  markOnboardingDone,
  shouldShowOnboarding,
} from '@/lib/onboarding';
import { formatDaysAgo, formatDecimal } from '@/lib/format';
import {
  goalStreak,
  workoutDayKeys,
  workoutDaysThisWeek,
} from '@/lib/workoutCalendar';
import { COLORS } from '@/theme';
import {
  Card,
  ListRow,
  SecondaryButton,
  SectionHeader,
} from '@/components/ui';
import { GoalRing } from '@/components/GoalRing';
import { WeeklyGoalPicker } from '@/components/WeeklyGoalPicker';
import { WorkoutCalendar } from '@/components/WorkoutCalendar';

/**
 * Karşılama kararı uygulama açılışı başına bir kez verilir; sekmeler
 * arasında gidip gelirken ana sayfa yeniden mount olunca tekrar sorgulanmaz.
 */
let onboardingChecked = false;

/**
 * Karşılama kontrolü burada, `_layout.tsx`'te değil: giriş noktasındaki
 * bir hata bütün uygulamayı durdururdu. Bu ekran DatabaseInitializer'ın
 * içinde, yani migration ve seed bittikten sonra mount oluyor.
 *
 * Karar verilene kadar boş zemin çiziliyor; karşılama gösterilecekse ana
 * sayfa hiç render edilmeden yerine geçiliyor (flash yok).
 */
export default function HomeScreen() {
  const db = useDb();
  const router = useRouter();
  const [ready, setReady] = useState(onboardingChecked);

  useEffect(() => {
    if (onboardingChecked) return;
    let cancelled = false;

    const decide = async (): Promise<boolean> => {
      const flagDone = await isOnboardingDone(Storage);
      if (flagDone) return false;

      const [routineRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(routines);
      const [sessionRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(workoutSessions);
      const show = shouldShowOnboarding({
        flagDone,
        routineCount: routineRow?.count ?? 0,
        sessionCount: sessionRow?.count ?? 0,
      });
      // Karşılama eklenmeden önce uygulamayı kullanmaya başlamış kullanıcı
      if (!show) await markOnboardingDone(Storage);
      return show;
    };

    decide()
      .catch((err) => {
        // Karar verilemezse ana sayfayı göster; karşılama zorunlu değil
        console.error('[ONBOARDING] Karar verilemedi:', err);
        return false;
      })
      .then((show) => {
        // Yarıda unmount olduysa karar bir sonraki mount'ta yeniden verilir
        if (cancelled) return;
        onboardingChecked = true;
        if (show) router.replace('/onboarding');
        else setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [db, router]);

  if (!ready) return <View className="flex-1 bg-bg" />;
  return <HomeContent />;
}

function HomeContent() {
  const db = useDb();
  // Uygulama arka planda kapatıldıysa yarım antrenmanı geri getir
  useSessionRecovery();

  const activeSessionId = useActiveWorkoutStore((s) => s.activeSessionId);
  const { goal, loaded: goalLoaded, setGoal } = useWeeklyGoal();
  const [goalPickerOpen, setGoalPickerOpen] = useState(false);

  // Bitmiş tüm seanslar: takvim, haftalık hedef, seri ve toplam sayı.
  // Join yok, useLiveQuery seans bitince kendiliğinden güncelliyor.
  const finishedSessions = useLiveQuery(
    db
      .select({
        id: workoutSessions.id,
        name: workoutSessions.name,
        startedAt: workoutSessions.startedAt,
        endedAt: workoutSessions.endedAt,
        durationSeconds: workoutSessions.durationSeconds,
      })
      .from(workoutSessions)
      .where(isNotNull(workoutSessions.endedAt))
  );
  const latestWeight = useLiveQuery(
    db
      .select({ date: bodyMetrics.date, weightKg: bodyMetrics.weightKg })
      .from(bodyMetrics)
      .where(isNotNull(bodyMetrics.weightKg))
      .orderBy(desc(bodyMetrics.date))
      .limit(1)
  );

  const sessions = finishedSessions.data ?? [];
  const now = new Date();
  const dayKeys = useMemo(() => workoutDayKeys(sessions), [sessions]);
  const doneThisWeek = workoutDaysThisWeek(dayKeys, now);
  const streak = goalStreak(dayKeys, goal, now);

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

      {/* Yan yana: haftalık hedef + güncel kilo */}
      <View className="flex-row gap-3">
        <GoalCard
          loaded={goalLoaded}
          goal={goal}
          done={doneThisWeek}
          streak={streak}
          onPress={() => setGoalPickerOpen(true)}
        />
        <WeightCard
          loaded={latestWeight.updatedAt != null}
          latest={latestWeight.data?.[0]}
        />
      </View>

      <WorkoutCalendar sessions={sessions} totalCount={sessions.length} />

      <GoalPickerModal
        visible={goalPickerOpen}
        goal={goal}
        onChange={(days) => void setGoal(days)}
        onClose={() => setGoalPickerOpen(false)}
      />

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

// ============================================================================
// Bento kartları
// ============================================================================

const BENTO_CARD_CLASS = 'flex-1 min-h-[180px] items-center justify-center';

function GoalCard({
  loaded,
  goal,
  done,
  streak,
  onPress,
}: {
  loaded: boolean;
  goal: number | null;
  done: number;
  streak: number;
  onPress: () => void;
}) {
  // Hedef okunmadan "belirle" daveti göstermeyelim — boş kart
  if (!loaded) return <Card className={BENTO_CARD_CLASS} />;

  if (goal == null) {
    return (
      <Card onPress={onPress} className={BENTO_CARD_CLASS}>
        <View className="w-12 h-12 rounded-full bg-accent items-center justify-center">
          <Target color={COLORS.accentFg} size={22} />
        </View>
        <Text className="text-white text-base font-semibold text-center mt-3">
          Haftalık hedef belirle
        </Text>
        <Text className="text-muted text-xs text-center mt-1">
          Haftada kaç gün?
        </Text>
      </Card>
    );
  }

  return (
    <Card
      onPress={onPress}
      className={BENTO_CARD_CLASS}
      accessibilityLabel="Haftalık hedefi değiştir"
    >
      <GoalRing done={done} goal={goal} />
      {streak >= 2 && (
        <Text className="text-white text-xs font-medium mt-3">
          🔥 {streak} haftalık seri
        </Text>
      )}
    </Card>
  );
}

function WeightCard({
  loaded,
  latest,
}: {
  loaded: boolean;
  latest?: { date: string; weightKg: number | null };
}) {
  if (!loaded) return <Card className={BENTO_CARD_CLASS} />;

  if (latest?.weightKg == null) {
    return (
      <Link href={{ pathname: '/metrics/[date]', params: { date: 'new' } }} asChild>
        <Card className={BENTO_CARD_CLASS}>
          <View className="w-12 h-12 rounded-full bg-bg-elevated border border-border items-center justify-center">
            <Scale color={COLORS.text} size={22} />
          </View>
          <Text className="text-white text-base font-semibold text-center mt-3">
            Kilonu ekle
          </Text>
          <Text className="text-muted text-xs text-center mt-1">
            İlerlemeni takip et
          </Text>
        </Card>
      </Link>
    );
  }

  return (
    <Link href="/(tabs)/progress" asChild>
      <Card className={BENTO_CARD_CLASS}>
        <Text className="text-muted text-xs tracking-widest">GÜNCEL KİLO</Text>
        <View className="flex-row items-baseline mt-2">
          <Text className="text-white text-4xl font-bold tracking-tight tabular-nums">
            {formatDecimal(latest.weightKg)}
          </Text>
          <Text className="text-muted text-base ml-1">kg</Text>
        </View>
        <Text className="text-muted text-xs mt-2">
          {formatDaysAgo(latest.date)}
        </Text>
      </Card>
    </Link>
  );
}

/** Ana sayfadan haftalık hedef seçimi — Ayarlar'daki seçicinin aynısı */
function GoalPickerModal({
  visible,
  goal,
  onChange,
  onClose,
}: {
  visible: boolean;
  goal: number | null;
  onChange: (days: number | null) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable className="flex-1 bg-black/60 justify-end" onPress={onClose}>
        {/* İçerideki basışlar arka plana gidip modalı kapatmasın */}
        <Pressable onPress={() => {}} className="bg-bg-surface rounded-t-3xl px-5 pt-6 pb-10 gap-5 border-t border-border">
          <View>
            <Text className="text-white text-xl font-semibold tracking-tight">
              Haftalık hedef
            </Text>
            <Text className="text-muted text-sm mt-1">
              Haftada kaç gün antrenman yapmak istiyorsun?
            </Text>
          </View>
          <WeeklyGoalPicker
            label="Gün sayısı"
            value={goal}
            onChange={(days) => {
              onChange(days);
              onClose();
            }}
          />
          <SecondaryButton label="Kapat" onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
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
