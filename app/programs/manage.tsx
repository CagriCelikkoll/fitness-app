/**
 * Programlarım (v3.6b, hoca / yönetici). Salon sekmesi → Hoca araçları →
 * "Programlarım" (ya da Ayarlar'daki salon kartı). Hoca kendi
 * programlarını, yönetici salondaki bütün programları görür.
 * "Yeni program", "Hazır programdan", "Rutinlerimden" (v3.6e;
 * `ProgramStartOptions`), arşivdekiler ayrı bölümde. Satırda kaç öğrenciye
 * atandığı yazar.
 */

import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { LayoutList, NotebookPen } from 'lucide-react-native';

import { useGymMembership } from '@/hooks/useGymMembership';
import { usePrograms } from '@/hooks/usePrograms';
import { useColors } from '@/hooks/useTheme';
import { useTrainerLinks } from '@/hooks/useTrainerLinks';
import { canViewMembers } from '@/lib/gymAdmin';
import { assignedCount, managedPrograms, visibilityLabel, type GymProgram } from '@/lib/programs';
import { ProgramRow } from '@/components/ProgramRow';
import { ProgramStartOptions, type ProgramStartPanel } from '@/components/ProgramStartOptions';
import { Card, EmptyState, SecondaryButton, SectionHeader } from '@/components/ui';

export default function ManageProgramsScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const { gymId } = useLocalSearchParams<{ gymId: string }>();
  const { memberships } = useGymMembership();
  const { userId, programs, assignments, loaded, loading, offline, error, refresh } = usePrograms();
  const { links, refresh: refreshLinks } = useTrainerLinks();
  const [panel, setPanel] = useState<ProgramStartPanel>(null);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      void refreshLinks();
    }, [refresh, refreshLinks])
  );

  if (!gymId || !canViewMembers(gymId, memberships)) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6">
        <Stack.Screen options={{ title: 'Programlarım' }} />
        <Text className="text-muted text-base text-center">Program hazırlamak salonun hocalarına açık.</Text>
      </View>
    );
  }

  const { active, archived } = managedPrograms(programs, gymId, userId, memberships);
  const open = (p: GymProgram) => router.push({ pathname: '/programs/[id]', params: { id: p.id } });
  const rowExtra = (p: GymProgram) => {
    const n = assignedCount(p, assignments, links);
    return n > 0 ? `${visibilityLabel(p.visibility)} · ${n} öğrenciye atandı` : visibilityLabel(p.visibility);
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
      <Stack.Screen options={{ title: 'Programlarım' }} />
      <ProgramStartOptions gymId={gymId} panel={panel} onPanel={setPanel} />

      {offline && <Text className="text-muted text-xs leading-5">Çevrimdışı · son çekilen programlar gösteriliyor</Text>}
      {error != null && <Text className="text-danger text-sm leading-5">{error.message}</Text>}

      {loaded && active.length === 0 && archived.length === 0 ? (
        panel == null && (
          <EmptyState
            icon={NotebookPen}
            title="Henüz programın yok"
            description="Hazır bir programla başlamak en hızlısı: taslağı değiştirip kaydedince öğrencilerine atarsın."
            className="mt-6"
            action={<SecondaryButton label="Hazır programdan başla" icon={LayoutList} onPress={() => setPanel('templates')} />}
          />
        )
      ) : (
        <>
          {active.length > 0 && (
            <View className="gap-2">
              <SectionHeader title={`Programlar (${active.length})`} variant="label" className="px-1" />
              <Card flush className="px-4">
                {active.map((p, i) => (
                  <ProgramRow
                    key={p.id}
                    program={p}
                    divider={i > 0}
                    showAuthor={p.authorId !== userId}
                    extra={rowExtra(p)}
                    onPress={() => open(p)}
                  />
                ))}
              </Card>
            </View>
          )}
          {archived.length > 0 && (
            <View className="gap-2">
              <SectionHeader title={`Arşiv (${archived.length})`} variant="label" className="px-1" />
              <Card flush className="px-4">
                {archived.map((p, i) => (
                  <ProgramRow key={p.id} program={p} divider={i > 0} showAuthor={p.authorId !== userId} onPress={() => open(p)} />
                ))}
              </Card>
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}
