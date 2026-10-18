/**
 * Hocalarım (v3.6a, öğrenci). Ayarlar → Hesap ve salon → "Hocalarım".
 * Aktif hocalar ve "İzni geri al" (onaylı; hocanın erişimi hemen biter).
 * Yanıt bekleyen istekler de burada: "Göz at" izin ekranını açar.
 */

import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { UserRound } from 'lucide-react-native';

import { useColors } from '@/hooks/useTheme';
import { useTrainerLinks } from '@/hooks/useTrainerLinks';
import { getSupabase } from '@/lib/supabase';
import {
  endTrainerLink,
  linkDateText,
  linksAsStudent,
  sortByName,
  trainerTitle,
  type TrainerLink,
} from '@/lib/trainers';
import { Card, EmptyState, ListRow, SectionHeader } from '@/components/ui';

export default function MyTrainersScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const { userId, links, loaded, loading, error, refresh } = useTrainerLinks();
  const [busyId, setBusyId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const mine = linksAsStudent(links, userId);
  const active = sortByName(mine.filter((l) => l.status === 'active'), (l) => l.trainerName);
  const pending = mine.filter((l) => l.status === 'pending');
  const nowMs = Date.now();

  const revoke = async (link: TrainerLink) => {
    setBusyId(link.id);
    const result = await endTrainerLink(getSupabase(), link.id);
    setBusyId(null);
    if (!result.ok) Alert.alert('Yapılamadı', result.error.message);
    await refresh();
  };

  const confirmRevoke = (link: TrainerLink) => {
    Alert.alert(
      'İzin geri alınsın mı?',
      `${trainerTitle(link.trainerName)} artık devamını ve programını göremeyecek. Yeniden paylaşmak için yeni bir istek gerekir.`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'İzni geri al', style: 'destructive', onPress: () => void revoke(link) },
      ]
    );
  };

  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerClassName="px-5 pt-4 pb-12 gap-4"
      refreshControl={
        <RefreshControl
          refreshing={loading && loaded}
          onRefresh={() => void refresh()}
          tintColor={COLORS.accent}
          colors={[COLORS.accent]}
        />
      }
    >
      <Stack.Screen options={{ title: 'Hocalarım' }} />
      {error != null && <Text className="text-danger text-sm leading-5">{error.message}</Text>}

      {loaded && mine.length === 0 ? (
        <EmptyState
          icon={UserRound}
          title="Hocan yok"
          description="Salondaki bir hoca seni öğrencisi olarak eklemek isterse burada ve ana sayfada görürsün."
          className="mt-6"
        />
      ) : (
        <>
          {pending.length > 0 && (
            <View className="gap-2">
              <SectionHeader title="Yanıt bekleyen istekler" variant="label" className="px-1" />
              <Card flush className="px-4">
                {pending.map((l, i) => (
                  <ListRow
                    key={l.id}
                    divider={i > 0}
                    chevron
                    onPress={() => router.push({ pathname: '/trainer/consent', params: { id: l.id } })}
                    right={<Text className="text-accent text-sm font-semibold">Göz at</Text>}
                  >
                    <Text className="text-fg text-base font-semibold" numberOfLines={1}>
                      {trainerTitle(l.trainerName)}
                    </Text>
                    <Text className="text-muted text-xs mt-0.5">{l.gymName ?? ''}</Text>
                  </ListRow>
                ))}
              </Card>
            </View>
          )}
          {active.length > 0 && (
            <View className="gap-2">
              <SectionHeader title="Hocalarım" variant="label" className="px-1" />
              <Card flush className="px-4">
                {active.map((l, i) => (
                  <ListRow
                    key={l.id}
                    divider={i > 0}
                    right={
                      <Pressable
                        onPress={() => confirmRevoke(l)}
                        disabled={busyId === l.id}
                        accessibilityRole="button"
                        hitSlop={8}
                        className="px-2 py-1 active:opacity-60"
                      >
                        <Text className={`text-sm font-semibold ${busyId === l.id ? 'text-muted' : 'text-danger'}`}>
                          İzni geri al
                        </Text>
                      </Pressable>
                    }
                  >
                    <Text className="text-fg text-base font-semibold" numberOfLines={1}>
                      {trainerTitle(l.trainerName)}
                    </Text>
                    <Text className="text-muted text-xs mt-0.5">
                      {[l.gymName, linkDateText(l, nowMs)].filter(Boolean).join(' · ')}
                    </Text>
                  </ListRow>
                ))}
              </Card>
              <Text className="text-muted text-xs leading-5 px-1">
                Hocan antrenmana geldiğin günleri, sürelerini, devamını ve programını görür; ağırlıklarını, setlerini ve vücut
                ölçülerini görmez.
              </Text>
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}
