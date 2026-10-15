/**
 * Programı düzenle (v3.2c, yalnızca yönetici). Haftalık dersler gün gün;
 * dokununca düzenle (sil / pasifleştir formda), "Ders ekle" ile yenisi.
 * Rol görünüm içindir; yetkiyi sunucu belirler (0005_classes.sql).
 */

import { useCallback } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Plus } from 'lucide-react-native';

import { useClassSchedule } from '@/hooks/useClassSchedule';
import { useGymMembership } from '@/hooks/useGymMembership';
import { WEEKDAY_LONG_TR, canEditSchedule, formatMinutes, parseTime, type Weekday } from '@/lib/classes';
import { Card, ListRow, PrimaryButton } from '@/components/ui';

export default function ClassTemplatesScreen() {
  const router = useRouter();
  const { gymId } = useLocalSearchParams<{ gymId: string }>();
  const { memberships } = useGymMembership();
  const { templates, offline, error, refresh } = useClassSchedule();

  useFocusEffect(
    useCallback(() => {
      void refresh();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  if (!gymId || !canEditSchedule(gymId, memberships)) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6">
        <Stack.Screen options={{ title: 'Programı düzenle' }} />
        <Text className="text-muted text-base text-center">Programı yalnızca salon yöneticisi düzenleyebilir.</Text>
      </View>
    );
  }

  const own = templates.filter((t) => t.gymId === gymId);
  const days = ([1, 2, 3, 4, 5, 6, 7] as Weekday[]).map((weekday) => ({
    weekday,
    items: own
      .filter((t) => t.weekday === weekday)
      .sort((a, b) => (parseTime(a.startTime) ?? 0) - (parseTime(b.startTime) ?? 0)),
  }));

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="px-5 pt-4 pb-12 gap-3">
      <Stack.Screen options={{ title: 'Programı düzenle' }} />
      <PrimaryButton
        label="Ders ekle"
        icon={Plus}
        onPress={() => router.push({ pathname: '/classes/template', params: { gymId } })}
      />
      {offline && <Text className="text-muted text-xs leading-5">Çevrimdışı · değişiklik kaydedilemez</Text>}
      {error != null && <Text className="text-danger text-sm leading-5">{error.message}</Text>}
      <Text className="text-muted text-xs leading-5">
        Burada yapılan değişiklik her haftayı etkiler. Yalnızca bir günü iptal etmek ya da değiştirmek için
        programda o derse uzun bas.
      </Text>

      {days.map(({ weekday, items }) => (
        <View key={weekday} className="gap-2 mt-2">
          <Text className="text-white text-sm font-semibold">{WEEKDAY_LONG_TR[weekday - 1]}</Text>
          {items.length === 0 ? (
            <Text className="text-muted text-xs">Ders yok</Text>
          ) : (
            <Card className="py-1">
              {items.map((t, i) => (
                <ListRow
                  key={t.id}
                  divider={i > 0}
                  chevron
                  onPress={() => router.push({ pathname: '/classes/template', params: { gymId, id: t.id } })}
                  right={!t.active ? <Text className="text-muted text-xs">Pasif</Text> : undefined}
                >
                  <Text className={`text-base font-semibold ${t.active ? 'text-white' : 'text-muted'}`}>
                    {t.name}
                  </Text>
                  <Text className="text-muted text-xs mt-0.5 tabular-nums">
                    {t.startTime}–{formatMinutes((parseTime(t.startTime) ?? 0) + t.durationMin)} · {t.instructorName}
                  </Text>
                </ListRow>
              ))}
            </Card>
          )}
        </View>
      ))}
    </ScrollView>
  );
}
