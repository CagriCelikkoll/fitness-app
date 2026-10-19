/**
 * Program ata (v3.6e, hoca / yönetici): öğrenciden programa.
 *
 * - Öğrenci ayrıntısı → "Program ata" (öğrenci seçili gelir): programa
 *   dokun → atanır, onay ("Full Body, Ayşe'ye atandı. Ayşe'ye bildirim
 *   gitti.", "Geri al").
 * - Salon sekmesi → Hoca araçları → "Program ata": önce öğrenci, sonra
 *   program (aynı ekranda).
 * - Programın yoksa ya da yenisini istersen: Yeni program / Hazır
 *   programdan / Rutinlerimden; kaydedince atama ekranı bu öğrenci seçili
 *   açılır.
 *
 * Programlar: bu öğrencinin hocasının yazdığı, arşivde olmayanlar (sunucu
 * yalnızca yazarın aktif öğrencisine atamayı kabul ediyor).
 */

import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { GraduationCap, UserPlus } from 'lucide-react-native';

import { useGymMembership } from '@/hooks/useGymMembership';
import type { GymMembership } from '@/lib/account';
import { usePrograms } from '@/hooks/usePrograms';
import { useColors } from '@/hooks/useTheme';
import { useTrainerLinks } from '@/hooks/useTrainerLinks';
import { canViewMembers } from '@/lib/gymAdmin';
import {
  assignProgram,
  assignedMessage,
  programSummary,
  studentProgramChoices,
  unassignProgram,
  type GymProgram,
  type ProgramAssignment,
} from '@/lib/programs';
import { getSupabase } from '@/lib/supabase';
import { linksAsTrainer, sortByName, studentLabel, type TrainerLink } from '@/lib/trainers';
import { ProgramStartOptions, type ProgramStartPanel } from '@/components/ProgramStartOptions';
import { Card, EmptyState, ListRow, PrimaryButton, SectionHeader } from '@/components/ui';

export default function TrainerAssignScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ gymId: string; linkId?: string }>();
  const { memberships } = useGymMembership();
  const { userId, links, loaded: linksLoaded, refresh: refreshLinks } = useTrainerLinks();
  const { programs, assignments, loaded, loading, refresh } = usePrograms();
  const [linkId, setLinkId] = useState<string | null>(params.linkId ?? null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // undefined: henüz seçilmedi (programı yoksa hazır programlar açık gelir)
  const [panel, setPanel] = useState<ProgramStartPanel | undefined>(undefined);

  useFocusEffect(
    useCallback(() => {
      void refreshLinks();
      void refresh();
    }, [refreshLinks, refresh])
  );

  const gymId = params.gymId ?? links.find((l) => l.id === params.linkId)?.gymId ?? null;
  if (!gymId || !canViewMembers(gymId, memberships)) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6">
        <Text className="text-muted text-base text-center">Program atamak salonun hocalarına açık.</Text>
      </View>
    );
  }

  const link = links.find((l) => l.id === linkId && l.status === 'active') ?? null;

  // 1. adım: öğrenci seç (Hoca araçları → Program ata)
  if (!link) {
    const students = sortByName(
      linksAsTrainer(links, userId, gymId).filter((l) => l.status === 'active'),
      (l) => l.studentName
    );
    return (
      <ScrollView className="flex-1 bg-bg" contentContainerClassName="px-5 pt-4 pb-12 gap-4">
        {linksLoaded && students.length === 0 ? (
          <EmptyState
            icon={GraduationCap}
            title="Henüz öğrencin yok"
            description="Program atamak için önce bir üyeyi öğrencin olarak ekle; izin verince burada görünür."
            className="mt-6"
            action={
              <PrimaryButton
                label="Önce öğrenci ekle"
                icon={UserPlus}
                onPress={() => router.push({ pathname: '/trainer/add', params: { gymId } })}
              />
            }
          />
        ) : (
          students.length > 0 && (
            <View className="gap-2">
              <SectionHeader title="Kime atayacaksın?" variant="label" className="px-1" />
              <Card flush className="px-4">
                {students.map((l, i) => (
                  <ListRow key={l.id} divider={i > 0} chevron onPress={() => setLinkId(l.id)}>
                    <Text className={`text-base font-semibold ${l.studentName ? 'text-fg' : 'text-muted'}`} numberOfLines={1}>
                      {studentLabel(l.studentName)}
                    </Text>
                  </ListRow>
                ))}
              </Card>
            </View>
          )
        )}
      </ScrollView>
    );
  }

  return (
    <ProgramStep
      link={link}
      canChangeStudent={params.linkId == null}
      onChangeStudent={() => setLinkId(null)}
      programs={programs}
      assignments={assignments}
      userId={userId}
      memberships={memberships}
      loaded={loaded}
      loading={loading}
      busyId={busyId}
      setBusyId={setBusyId}
      refresh={refresh}
      panel={panel}
      onPanel={setPanel}
      accent={COLORS.accent}
    />
  );
}

/** 2. adım: programa dokun → ata */
function ProgramStep({
  link,
  canChangeStudent,
  onChangeStudent,
  programs,
  assignments,
  userId,
  memberships,
  loaded,
  loading,
  busyId,
  setBusyId,
  refresh,
  panel,
  onPanel,
  accent,
}: {
  link: TrainerLink;
  canChangeStudent: boolean;
  onChangeStudent: () => void;
  programs: GymProgram[];
  assignments: ProgramAssignment[];
  userId: string | null;
  memberships: GymMembership[];
  loaded: boolean;
  loading: boolean;
  busyId: string | null;
  setBusyId: (id: string | null) => void;
  refresh: () => Promise<void>;
  panel: ProgramStartPanel | undefined;
  onPanel: (panel: ProgramStartPanel) => void;
  accent: string;
}) {
  const router = useRouter();
  const name = studentLabel(link.studentName);
  const { assigned, available } = studentProgramChoices(programs, assignments, link, userId, memberships);
  const hasAny = assigned.length + available.length > 0;
  // Yeni program yalnızca kendi öğrencim için (program yazara bağlı)
  const canCreate = link.trainerId === userId;
  const openPanel = panel === undefined ? (loaded && !hasAny ? 'templates' : null) : panel;

  const undo = async (p: GymProgram) => {
    const result = await unassignProgram(getSupabase(), p.id, link.studentId);
    if (!result.ok) Alert.alert('Geri alınamadı', result.error.message);
    await refresh();
  };

  const assign = async (p: GymProgram) => {
    if (busyId) return;
    setBusyId(p.id);
    const result = await assignProgram(getSupabase(), p.id, [link.studentId]);
    setBusyId(null);
    if (!result.ok) {
      Alert.alert('Atanamadı', result.error.message);
      await refresh();
      return;
    }
    await refresh();
    Alert.alert('Atandı', assignedMessage(p.name, [link.studentName]), [
      { text: 'Geri al', style: 'destructive', onPress: () => void undo(p) },
      { text: 'Tamam', onPress: () => router.back() },
    ]);
  };

  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerClassName="px-5 pt-4 pb-12 gap-4"
      refreshControl={
        <RefreshControl refreshing={loading && loaded} onRefresh={() => void refresh()} tintColor={accent} colors={[accent]} />
      }
    >
      <View className="px-1 gap-1">
        <Text className="text-fg text-2xl font-bold tracking-tight" numberOfLines={1}>
          {name}
        </Text>
        <Text className="text-muted text-sm">Programa dokun, hemen atanır ve {name} bildirim alır.</Text>
        {canChangeStudent && (
          <Pressable onPress={onChangeStudent} hitSlop={6} className="self-start mt-1 active:opacity-60">
            <Text className="text-accent text-sm font-semibold">Öğrenciyi değiştir</Text>
          </Pressable>
        )}
      </View>

      {loaded && !hasAny && (
        <EmptyState
          title="Henüz programın yok"
          description={`Hazır bir programla başla; taslağı kaydedince ${name} seçili gelir.`}
          className="mt-2"
        />
      )}

      {available.length > 0 && (
        <View className="gap-2">
          <SectionHeader title="Programların" variant="label" className="px-1" />
          <Card flush className="px-4">
            {available.map((p, i) => (
              <ListRow
                key={p.id}
                divider={i > 0}
                onPress={() => void assign(p)}
                disabled={busyId != null}
                accessibilityRole="button"
                accessibilityHint={`${name} öğrencisine atar`}
                right={
                  <Text className={`text-sm font-semibold ${busyId === p.id ? 'text-muted' : 'text-accent'}`}>
                    {busyId === p.id ? 'Atanıyor…' : 'Ata'}
                  </Text>
                }
              >
                <Text className="text-fg text-base font-semibold" numberOfLines={1}>
                  {p.name}
                </Text>
                <Text className="text-muted text-xs mt-0.5">{programSummary(p)}</Text>
              </ListRow>
            ))}
          </Card>
        </View>
      )}

      {assigned.length > 0 && (
        <View className="gap-2">
          <SectionHeader title="Zaten atanmış" variant="label" className="px-1" />
          <Card flush className="px-4">
            {assigned.map((p, i) => (
              <ListRow
                key={p.id}
                divider={i > 0}
                chevron
                onPress={() => router.push({ pathname: '/programs/[id]', params: { id: p.id } })}
              >
                <Text className="text-muted text-base font-semibold" numberOfLines={1}>
                  {p.name}
                </Text>
                <Text className="text-muted text-xs mt-0.5">Atanmış · {programSummary(p)}</Text>
              </ListRow>
            ))}
          </Card>
        </View>
      )}

      {canCreate && (
        <View className="gap-2">
          <SectionHeader title={hasAny ? 'Yeni program oluştur' : 'Hazır programdan başla'} variant="label" className="px-1" />
          <ProgramStartOptions
            gymId={link.gymId}
            studentId={link.studentId}
            panel={openPanel}
            onPanel={onPanel}
          />
        </View>
      )}
    </ScrollView>
  );
}
