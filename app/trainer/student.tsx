/**
 * Öğrenci ayrıntısı (v3.6b, hoca / yönetici). Öğrencilerim → öğrenciye
 * dokun. Atanmış programlar (kaldırma onaylı) ve hocanın henüz atanmamış
 * programlarından atama. Hoca öğrencinin ağırlık, set ve ölçülerini
 * görmez (rıza metni).
 */

import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { useGymMembership } from '@/hooks/useGymMembership';
import { usePrograms } from '@/hooks/usePrograms';
import { useColors } from '@/hooks/useTheme';
import { useTrainerLinks } from '@/hooks/useTrainerLinks';
import {
  assignProgram,
  canManageProgram,
  programSummary,
  unassignProgram,
  type GymProgram,
} from '@/lib/programs';
import { getSupabase } from '@/lib/supabase';
import { linkDateText, studentLabel } from '@/lib/trainers';
import { Card, ListRow, SectionHeader } from '@/components/ui';

export default function StudentDetailScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { memberships } = useGymMembership();
  const { links, loading: linksLoading, refresh: refreshLinks } = useTrainerLinks();
  const { userId, programs, assignments, loaded, loading, error, refresh } = usePrograms();
  const [busyId, setBusyId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void refreshLinks();
      void refresh();
    }, [refreshLinks, refresh])
  );

  const link = links.find((l) => l.id === id && l.status === 'active') ?? null;
  if (!link) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6">
        <Stack.Screen options={{ title: 'Öğrenci' }} />
        <Text className="text-muted text-base text-center">
          {linksLoading ? 'Yükleniyor…' : 'Bu kişi artık öğrencin değil.'}
        </Text>
      </View>
    );
  }

  // Bu öğrenciye atanabilecek programlar: bu hocanın (yazar), yönetebildiğim, arşivde olmayan
  const candidates = programs.filter(
    (p) =>
      p.gymId === link.gymId &&
      p.authorId === link.trainerId &&
      !p.archivedAt &&
      canManageProgram(p, userId, memberships)
  );
  const assignedIds = new Set(
    assignments.filter((a) => a.studentId === link.studentId).map((a) => a.programId)
  );
  const assigned = candidates.filter((p) => assignedIds.has(p.id));
  const available = candidates.filter((p) => !assignedIds.has(p.id));
  const name = studentLabel(link.studentName);

  const act = async (p: GymProgram, assign: boolean) => {
    setBusyId(p.id);
    const result = assign
      ? await assignProgram(getSupabase(), p.id, [link.studentId])
      : await unassignProgram(getSupabase(), p.id, link.studentId);
    setBusyId(null);
    if (!result.ok) Alert.alert('Yapılamadı', result.error.message);
    await refresh();
  };

  const confirmRemove = (p: GymProgram) =>
    Alert.alert('Atama kaldırılsın mı?', `${name} "${p.name}" programını artık göremeyecek. Rutinlerine eklediyse rutinleri kalır.`, [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Kaldır', style: 'destructive', onPress: () => void act(p, false) },
    ]);

  const row = (p: GymProgram, i: number, label: string, danger: boolean, onAction: () => void) => (
    <ListRow
      key={p.id}
      divider={i > 0}
      onPress={() => router.push({ pathname: '/programs/[id]', params: { id: p.id } })}
      right={
        <Pressable
          onPress={onAction}
          disabled={busyId != null}
          accessibilityRole="button"
          hitSlop={8}
          className="px-2 py-1 active:opacity-60"
        >
          <Text className={`text-sm font-semibold ${busyId === p.id ? 'text-muted' : danger ? 'text-danger' : 'text-accent'}`}>
            {label}
          </Text>
        </Pressable>
      }
    >
      <Text className="text-fg text-base font-semibold" numberOfLines={1}>
        {p.name}
      </Text>
      <Text className="text-muted text-xs mt-0.5">{programSummary(p)}</Text>
    </ListRow>
  );

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
      <Stack.Screen options={{ title: 'Öğrenci' }} />
      <View className="px-1 gap-1">
        <Text className="text-fg text-2xl font-bold tracking-tight">{name}</Text>
        <Text className="text-muted text-sm">{linkDateText(link, Date.now())}</Text>
      </View>
      {error != null && <Text className="text-danger text-sm leading-5">{error.message}</Text>}

      <View className="gap-2">
        <SectionHeader title="Atanmış programlar" variant="label" className="px-1" />
        {assigned.length === 0 ? (
          <Text className="text-muted text-sm px-1">Henüz program atanmadı.</Text>
        ) : (
          <Card flush className="px-4">
            {assigned.map((p, i) => row(p, i, 'Kaldır', true, () => confirmRemove(p)))}
          </Card>
        )}
      </View>

      <View className="gap-2">
        <SectionHeader title="Program ata" variant="label" className="px-1" />
        {available.length === 0 ? (
          <Text className="text-muted text-sm px-1">
            {candidates.length === 0
              ? 'Atanabilecek program yok. Programlar → Programlarım\'dan bir program hazırla.'
              : 'Bütün programların atanmış.'}
          </Text>
        ) : (
          <Card flush className="px-4">
            {available.map((p, i) => row(p, i, 'Ata', false, () => void act(p, true)))}
          </Card>
        )}
      </View>
    </ScrollView>
  );
}
