/**
 * Salon paneli (v3.6c, yalnızca yönetici). Salon sekmesi → "Salon paneli".
 *
 * - Şu an salonda: sayı + liste (ad, giriş saati)
 * - Bugün giriş yapan kişi sayısı; son 7 gün çubuk grafik
 * - Üyeliği 7 gün içinde bitenler (Üyeler'de o filtreyle açılır)
 * - Bugünün dersleri, katılımcı sayılarıyla
 * - QR afişi ve elle giriş
 * - Geri bildirimler (v3.6d): özet ve liste
 *
 * Yetkiyi sunucu belirliyor (yönetici salondaki bütün ziyaretleri görür).
 */

import { useCallback } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { CalendarClock, MessageSquareText, QrCode, UserPlus } from 'lucide-react-native';

import { useClassSchedule } from '@/hooks/useClassSchedule';
import { useGymFeedback } from '@/hooks/useFeedback';
import { useGymMembers } from '@/hooks/useGymMembers';
import { useGymMembership } from '@/hooks/useGymMembership';
import { useColors } from '@/hooks/useTheme';
import { useGymVisits } from '@/hooks/useVisits';
import { feedbackSummary, summaryText } from '@/lib/feedback';
import { canManageGym, matchesFilter } from '@/lib/gymAdmin';
import { dailyCounts, gymTime, insideNow, weekdayShort } from '@/lib/visits';
import { BarChart } from '@/components/BarChart';
import { TodayClassesCard } from '@/components/GymCards';
import { Card, ListRow, SecondaryButton, SectionHeader, StatTile } from '@/components/ui';

export default function GymPanelScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const { gymId } = useLocalSearchParams<{ gymId: string }>();
  const { memberships } = useGymMembership();
  const visits = useGymVisits(gymId ?? null);
  const members = useGymMembers(gymId ?? null);
  const { refresh: refreshSchedule } = useClassSchedule();
  const { refresh: refreshVisits } = visits;
  const { refresh: refreshMembers } = members;
  const feedback = useGymFeedback(gymId ?? null);
  const { refresh: refreshFeedback } = feedback;

  useFocusEffect(
    useCallback(() => {
      void refreshVisits();
      void refreshFeedback();
    }, [refreshVisits, refreshFeedback])
  );

  if (!gymId || !canManageGym(gymId, memberships)) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6">
        <Stack.Screen options={{ title: 'Salon paneli' }} />
        <Text className="text-muted text-base text-center">Salon paneli yalnızca yöneticilere açık.</Text>
      </View>
    );
  }

  const nowMs = Date.now();
  const nameOf = (userId: string) => members.members.find((m) => m.userId === userId)?.name ?? 'Adı girilmemiş üye';
  const inside = insideNow(visits.visits, nowMs);
  const days = dailyCounts(visits.visits, nowMs, 7);
  const today = days[days.length - 1]?.count ?? 0;
  const expiring = members.members.filter((m) => matchesFilter(m, 'expiring', nowMs)).length;

  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerClassName="px-5 pt-4 pb-12 gap-4"
      refreshControl={
        <RefreshControl
          refreshing={visits.loading && visits.loaded}
          onRefresh={() => void Promise.all([refreshVisits(), refreshMembers(), refreshSchedule(), refreshFeedback()])}
          tintColor={COLORS.accent}
          colors={[COLORS.accent]}
        />
      }
    >
      <Stack.Screen options={{ title: 'Salon paneli' }} />
      {visits.error != null && <Text className="text-danger text-sm leading-5">{visits.error.message}</Text>}

      <View className="flex-row gap-2">
        <StatTile label="Şu an salonda" value={inside.length} unit="kişi" size="sm" className="flex-1" />
        <StatTile label="Bugün giriş" value={today} unit="kişi" size="sm" className="flex-1" />
      </View>

      {inside.length > 0 && (
        <Card flush className="px-4">
          {inside.map((v, i) => (
            <ListRow key={v.id} divider={i > 0} right={<Text className="text-muted text-sm tabular-nums">{gymTime(v.checkedInAt)}</Text>}>
              <Text className="text-fg text-base" numberOfLines={1}>
                {nameOf(v.userId)}
              </Text>
            </ListRow>
          ))}
        </Card>
      )}

      <View className="gap-2">
        <SectionHeader title="Son 7 gün" variant="label" className="px-1" />
        <Card>
          <BarChart
            bars={days.map((d) => ({ key: d.date, value: d.count }))}
            formatY={(v) => String(Math.round(v))}
            startLabel={weekdayShort(days[0].date)}
            endLabel="Bugün"
          />
        </Card>
      </View>

      <Card flush className="px-4">
        <ListRow
          chevron
          onPress={() => router.push({ pathname: '/gym/members', params: { gymId, filter: 'expiring' } })}
          right={<Text className={`text-base font-semibold tabular-nums ${expiring > 0 ? 'text-warm' : 'text-muted'}`}>{expiring}</Text>}
        >
          <View className="flex-row items-center gap-3">
            <CalendarClock color={COLORS.muted} size={17} strokeWidth={1.75} />
            <Text className="text-fg text-base">Üyeliği 7 gün içinde bitenler</Text>
          </View>
        </ListRow>
      </Card>

      <Card flush className="px-4">
        <ListRow chevron onPress={() => router.push({ pathname: '/gym/feedback', params: { gymId } })}>
          <View className="flex-row items-center gap-3">
            <MessageSquareText color={COLORS.muted} size={17} strokeWidth={1.75} />
            <View className="flex-1">
              <Text className="text-fg text-base">Geri bildirimler</Text>
              {feedback.loaded && (
                <Text className="text-muted text-xs mt-0.5">{summaryText(feedbackSummary(feedback.list, nowMs))}</Text>
              )}
            </View>
          </View>
        </ListRow>
      </Card>

      <TodayClassesCard gymId={gymId} showCounts />

      <View className="gap-2">
        <SectionHeader title="Giriş" variant="label" className="px-1" />
        <View className="flex-row gap-2">
          <SecondaryButton
            label="QR afişi"
            icon={QrCode}
            className="flex-1"
            onPress={() => router.push({ pathname: '/gym/qr', params: { gymId } })}
          />
          <SecondaryButton
            label="Elle giriş"
            icon={UserPlus}
            className="flex-1"
            onPress={() => router.push({ pathname: '/gym/visit', params: { gymId } })}
          />
        </View>
      </View>
    </ScrollView>
  );
}
