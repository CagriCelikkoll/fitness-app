/**
 * Programlar (v3.6b). Ayarlar → Hesap ve salon → salon kartı →
 * "Programlar" (3.6c'de Salon sekmesine taşınacak). İki bölüm:
 * "Hocamın programları" (bana atanmış) ve "Salon programları" (salona
 * açık). Hoca / yönetici için "Programlarım" (oluştur, düzenle, ata).
 *
 * İnternetsizken son çekilen liste (kv-store) gösterilir.
 */

import { useCallback, type ReactNode } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { ClipboardList, NotebookPen } from 'lucide-react-native';

import { useGymMembership } from '@/hooks/useGymMembership';
import { usePrograms } from '@/hooks/usePrograms';
import { useColors } from '@/hooks/useTheme';
import { canViewMembers } from '@/lib/gymAdmin';
import { assignedPrograms, gymPrograms, type GymProgram } from '@/lib/programs';
import { ProgramRow } from '@/components/ProgramRow';
import { Card, EmptyState, SecondaryButton, SectionHeader } from '@/components/ui';

export default function ProgramsScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const { gymId } = useLocalSearchParams<{ gymId?: string }>();
  const { memberships } = useGymMembership();
  const { programs, loaded, loading, offline, error, refresh } = usePrograms();

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const gym = gymId ? memberships.find((m) => m.gymId === gymId) : undefined;
  const filterGym = gym?.gymId;
  const mine = assignedPrograms(programs, filterGym);
  const salon = gymPrograms(programs, filterGym);
  const staffGymId = filterGym
    ? canViewMembers(filterGym, memberships)
      ? filterGym
      : null
    : (memberships.find((m) => canViewMembers(m.gymId, memberships))?.gymId ?? null);

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
      <Stack.Screen options={{ title: 'Programlar' }} />
      {staffGymId != null && (
        <SecondaryButton
          label="Programlarım"
          icon={NotebookPen}
          onPress={() => router.push({ pathname: '/programs/manage', params: { gymId: staffGymId } })}
        />
      )}
      {offline && <Text className="text-muted text-xs leading-5">Çevrimdışı · son çekilen programlar gösteriliyor</Text>}
      {error != null && <Text className="text-danger text-sm leading-5">{error.message}</Text>}

      {loaded && mine.length === 0 && salon.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Henüz program yok"
          description="Hocan sana bir program atadığında ya da salonun bir program paylaştığında burada görünür."
          className="mt-6"
        />
      ) : (
        <>
          <ProgramSection title="Hocamın programları" empty="Hocan sana henüz program atamadı.">
            {mine.map((p, i) => (
              <ProgramRow key={p.id} program={p} divider={i > 0} onPress={() => open(p)} />
            ))}
          </ProgramSection>
          <ProgramSection title="Salon programları" empty="Salon henüz program paylaşmadı.">
            {salon.map((p, i) => (
              <ProgramRow key={p.id} program={p} divider={i > 0} onPress={() => open(p)} />
            ))}
          </ProgramSection>
        </>
      )}
    </ScrollView>
  );
}

function ProgramSection({ title, empty, children }: { title: string; empty: string; children: ReactNode[] }) {
  return (
    <View className="gap-2">
      <SectionHeader title={title} variant="label" className="px-1" />
      {children.length === 0 ? (
        <Text className="text-muted text-sm px-1">{empty}</Text>
      ) : (
        <Card flush className="px-4">
          {children}
        </Card>
      )}
    </View>
  );
}
