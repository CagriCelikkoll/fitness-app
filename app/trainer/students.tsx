/**
 * Öğrencilerim (v3.6a, hoca / yönetici). Ayarlar → Hesap ve salon →
 * "Öğrencilerim". Bu salondaki aktif öğrenciler ve yanıt bekleyen
 * istekler; "Öğrenci ekle"; bağı bitirme / isteği geri çekme (onaylı).
 *
 * Aktif öğrenciye dokununca ayrıntı (v3.6b: atanmış programlar).
 * Satır (`src/components/StudentRow.tsx`) 3.6c'de devam bilgisini (`detail`) alacak şekilde
 * kurulu. Yetkiyi sunucu belirler; rol kontrolü yalnızca görünüm.
 */

import { useCallback, useState, type ReactNode } from 'react';
import { Alert, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { GraduationCap, UserPlus } from 'lucide-react-native';

import { useGymMembership } from '@/hooks/useGymMembership';
import { useColors } from '@/hooks/useTheme';
import { useTrainerLinks } from '@/hooks/useTrainerLinks';
import { canViewMembers } from '@/lib/gymAdmin';
import { getSupabase } from '@/lib/supabase';
import {
  endTrainerLink,
  linkDateText,
  linksAsTrainer,
  sortByName,
  studentLabel,
  type TrainerLink,
} from '@/lib/trainers';
import { StudentRow } from '@/components/StudentRow';
import { Card, EmptyState, PrimaryButton, SectionHeader } from '@/components/ui';

export default function TrainerStudentsScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const { gymId } = useLocalSearchParams<{ gymId: string }>();
  const { memberships } = useGymMembership();
  const { userId, links, loaded, loading, error, refresh } = useTrainerLinks();
  const [busyId, setBusyId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  if (!gymId || !canViewMembers(gymId, memberships)) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6">
        <Stack.Screen options={{ title: 'Öğrencilerim' }} />
        <Text className="text-muted text-base text-center">Öğrenci listesi salonun hocalarına açık.</Text>
      </View>
    );
  }

  const mine = linksAsTrainer(links, userId, gymId);
  const active = sortByName(mine.filter((l) => l.status === 'active'), (l) => l.studentName);
  const pending = sortByName(mine.filter((l) => l.status === 'pending'), (l) => l.studentName);
  const nowMs = Date.now();

  const end = async (link: TrainerLink) => {
    setBusyId(link.id);
    const result = await endTrainerLink(getSupabase(), link.id);
    setBusyId(null);
    if (!result.ok) Alert.alert('Yapılamadı', result.error.message);
    await refresh();
  };

  const confirmEnd = (link: TrainerLink) => {
    const name = studentLabel(link.studentName);
    if (link.status === 'pending') {
      Alert.alert('İstek geri çekilsin mi?', `${name} isteği artık göremeyecek.`, [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Geri çek', style: 'destructive', onPress: () => void end(link) },
      ]);
      return;
    }
    Alert.alert('Öğrencilik bitsin mi?', `${name} artık öğrencin olmayacak; bilgilerini göremeyeceksin.`, [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Bitir', style: 'destructive', onPress: () => void end(link) },
    ]);
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
      <Stack.Screen options={{ title: 'Öğrencilerim' }} />
      <PrimaryButton
        label="Öğrenci ekle"
        icon={UserPlus}
        onPress={() => router.push({ pathname: '/trainer/add', params: { gymId } })}
      />
      {error != null && <Text className="text-danger text-sm leading-5">{error.message}</Text>}

      {loaded && active.length === 0 && pending.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title="Henüz öğrencin yok"
          description="Salon üyelerinden birine istek gönder; izin verince burada görünür."
          className="mt-6"
        />
      ) : (
        <>
          {active.length > 0 && (
            <LinkSection title={`Öğrenciler (${active.length})`}>
              {active.map((l, i) => (
                <StudentRow
                  key={l.id}
                  link={l}
                  divider={i > 0}
                  subtitle={linkDateText(l, nowMs)}
                  actionLabel="Bitir"
                  busy={busyId === l.id}
                  onAction={() => confirmEnd(l)}
                  onPress={() => router.push({ pathname: '/trainer/student', params: { id: l.id } })}
                />
              ))}
            </LinkSection>
          )}
          {pending.length > 0 && (
            <LinkSection title={`Yanıt bekleyenler (${pending.length})`}>
              {pending.map((l, i) => (
                <StudentRow
                  key={l.id}
                  link={l}
                  divider={i > 0}
                  subtitle={linkDateText(l, nowMs)}
                  actionLabel="Geri çek"
                  busy={busyId === l.id}
                  onAction={() => confirmEnd(l)}
                />
              ))}
            </LinkSection>
          )}
        </>
      )}
    </ScrollView>
  );
}

function LinkSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-2">
      <SectionHeader title={title} variant="label" className="px-1" />
      <Card flush className="px-4">
        {children}
      </Card>
    </View>
  );
}
