/**
 * Programlarım (v3.6b, hoca / yönetici). Programlar → "Programlarım".
 * Hoca kendi programlarını, yönetici salondaki bütün programları görür.
 * "Yeni program", "Hazır programdan başla" (uygulamadaki hazır
 * programlardan biri şablon olur), arşivdekiler ayrı bölümde.
 */

import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { LayoutList, NotebookPen, Plus } from 'lucide-react-native';

import { useGymMembership } from '@/hooks/useGymMembership';
import { usePrograms } from '@/hooks/usePrograms';
import { useColors } from '@/hooks/useTheme';
import { canViewMembers } from '@/lib/gymAdmin';
import { managedPrograms, visibilityLabel, type GymProgram } from '@/lib/programs';
import { WORKOUT_TEMPLATES } from '@/lib/workoutTemplates';
import { ProgramRow } from '@/components/ProgramRow';
import { Card, EmptyState, ListRow, PrimaryButton, SecondaryButton, SectionHeader } from '@/components/ui';

export default function ManageProgramsScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const { gymId } = useLocalSearchParams<{ gymId: string }>();
  const { memberships } = useGymMembership();
  const { userId, programs, loaded, loading, offline, error, refresh } = usePrograms();
  const [showTemplates, setShowTemplates] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
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
      <View className="flex-row gap-2">
        <PrimaryButton
          label="Yeni program"
          icon={Plus}
          className="flex-1"
          onPress={() => router.push({ pathname: '/programs/edit', params: { gymId } })}
        />
        <SecondaryButton
          label="Hazır programdan"
          icon={LayoutList}
          className="flex-1"
          onPress={() => setShowTemplates((v) => !v)}
        />
      </View>

      {showTemplates && (
        <View className="gap-2">
          <SectionHeader
            title="Hazır programdan başla"
            description="Seçtiğin program taslak olarak açılır; kaydetmeden önce değiştirebilirsin."
            variant="label"
            className="px-1"
          />
          <Card flush className="px-4">
            {WORKOUT_TEMPLATES.map((t, i) => (
              <ListRow
                key={t.id}
                divider={i > 0}
                chevron
                onPress={() => {
                  setShowTemplates(false);
                  router.push({ pathname: '/programs/edit', params: { gymId, template: t.id } });
                }}
              >
                <Text className="text-fg text-base font-semibold">{t.name}</Text>
                <Text className="text-muted text-xs mt-0.5">{t.dayCount} gün</Text>
              </ListRow>
            ))}
          </Card>
        </View>
      )}

      {offline && <Text className="text-muted text-xs leading-5">Çevrimdışı · son çekilen programlar gösteriliyor</Text>}
      {error != null && <Text className="text-danger text-sm leading-5">{error.message}</Text>}

      {loaded && active.length === 0 && archived.length === 0 ? (
        <EmptyState
          icon={NotebookPen}
          title="Henüz program yok"
          description="Yeni bir program hazırla ya da hazır programlardan biriyle başla. Salona açabilir ya da yalnızca öğrencilerine atayabilirsin."
          className="mt-6"
        />
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
                    extra={visibilityLabel(p.visibility)}
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
