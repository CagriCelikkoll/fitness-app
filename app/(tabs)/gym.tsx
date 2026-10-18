/**
 * Salon sekmesi (v3.6c). Bayrak açık ve bir salona üyeyse sekme çubuğunda
 * görünür (salon rengiyle). Yukarıdan aşağı:
 *
 * 1. Logo, salon adı, rol, üyelik durumu
 * 2. Giriş kartı: "Salona giriş" (QR) ya da "Salondasın · 42 dk" +
 *    "Çıkış yap"; doluluk ("Şu an salonda ~12 kişi")
 * 3. Bu ay: gelinen gün, ortalama süre, bu hafta; seri; 8 hafta ısı haritası
 * 4. Bugünün dersleri  5. Son duyuru  6. Programlar  7. Hocalarım
 *
 * Hoca / yönetici için Öğrencilerim; yönetici için Salon paneli. Birden çok
 * salon varsa üstte seçici.
 */

import { useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { ClipboardList, GraduationCap, LayoutDashboard, LogOut, QrCode, UserRound } from 'lucide-react-native';

import { useAnnouncements } from '@/hooks/useAnnouncements';
import { useClassSchedule } from '@/hooks/useClassSchedule';
import { useGymMembership } from '@/hooks/useGymMembership';
import { usePrograms } from '@/hooks/usePrograms';
import { useColors } from '@/hooks/useTheme';
import { useTrainerLinks } from '@/hooks/useTrainerLinks';
import { checkOutOfGym, useGymVisits } from '@/hooks/useVisits';
import { roleLabel } from '@/lib/auth';
import { canManageGym, canViewMembers, membershipDaysLeft, membershipWarning } from '@/lib/gymAdmin';
import { assignedPrograms, gymPrograms } from '@/lib/programs';
import { linksAsStudent, sortByName, trainerTitle } from '@/lib/trainers';
import {
  currentVisit,
  formatMinutes,
  heatmap,
  insideText,
  monthStats,
  occupancyText,
  visitState,
} from '@/lib/visits';
import { AnnouncementCard, TodayClassesCard } from '@/components/GymCards';
import { GymLogo } from '@/components/GymLogo';
import { ProgramRow } from '@/components/ProgramRow';
import { VisitHeatmap } from '@/components/VisitHeatmap';
import { Card, Chip, ListRow, PrimaryButton, SecondaryButton, SectionHeader, StatTile } from '@/components/ui';

/** Üyelik durumu: 7 gün ve yakını uyarı tonunda; uzaksa kalan gün; yoksa null */
function membershipText(endsOn: string | null, nowMs: number): { text: string; tone: 'muted' | 'warm' | 'danger' } | null {
  const warning = membershipWarning(endsOn, nowMs);
  if (warning) return { text: warning.text, tone: warning.ended ? 'danger' : 'warm' };
  const days = membershipDaysLeft(endsOn, nowMs);
  if (days == null) return null;
  return { text: `Üyeliğin ${days} gün sonra bitiyor.`, tone: 'muted' };
}

export default function GymTabScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const { userId, memberships, primary } = useGymMembership();
  const [selected, setSelected] = useState<string | null>(null);
  const gym = memberships.find((m) => m.gymId === selected) ?? primary;
  const gymId = gym?.gymId ?? null;

  const visits = useGymVisits(gymId);
  const { refresh: refreshAnnouncements } = useAnnouncements();
  const { refresh: refreshSchedule } = useClassSchedule();
  const programs = usePrograms();
  const trainers = useTrainerLinks();
  const [busy, setBusy] = useState(false);

  const { refreshIfStale: visitsIfStale } = visits;
  const { refreshIfStale: programsIfStale } = programs;
  const { refreshIfStale: trainersIfStale } = trainers;
  useFocusEffect(
    useCallback(() => {
      visitsIfStale();
      programsIfStale();
      trainersIfStale();
    }, [visitsIfStale, programsIfStale, trainersIfStale])
  );

  const pullRefresh = async () => {
    await Promise.all([
      visits.refresh(),
      refreshAnnouncements(),
      refreshSchedule(),
      programs.refresh(),
      trainers.refresh(),
    ]);
  };

  if (!gym || !gymId) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6">
        <Text className="text-muted text-base text-center">Salon özellikleri için bir salona katıl.</Text>
      </View>
    );
  }

  const nowMs = Date.now();
  const mine = visits.visits.filter((v) => v.userId === userId);
  const inside = currentVisit(visits.visits, userId, gymId, nowMs);
  const insideState = inside ? visitState(inside, nowMs) : null;
  const stats = monthStats(mine, nowMs);
  const membership = membershipText(gym.membershipEndsOn, nowMs);
  const staff = canViewMembers(gymId, memberships);
  const admin = canManageGym(gymId, memberships);

  const myPrograms = assignedPrograms(programs.programs, gymId);
  const salonPrograms = gymPrograms(programs.programs, gymId);
  const shownPrograms = [...myPrograms, ...salonPrograms].slice(0, 3);
  const myTrainers = sortByName(
    linksAsStudent(trainers.links, userId).filter((l) => l.gymId === gymId && l.status === 'active'),
    (l) => l.trainerName
  );

  const checkOut = () => {
    if (!inside || !userId) return;
    Alert.alert('Çıkış yapılsın mı?', 'Salondaki süren şimdi kaydedilir.', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Çıkış yap',
        onPress: async () => {
          setBusy(true);
          const error = await checkOutOfGym(userId, inside);
          setBusy(false);
          if (error) Alert.alert('Çıkış yapılamadı', error.message);
        },
      },
    ]);
  };

  const occupancy = occupancyText(visits.occupancy);

  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerClassName="px-5 pt-6 pb-12 gap-4"
      refreshControl={
        <RefreshControl
          refreshing={visits.loading && visits.loaded}
          onRefresh={() => void pullRefresh()}
          tintColor={COLORS.accent}
          colors={[COLORS.accent]}
        />
      }
    >
      {memberships.length > 1 && (
        <View className="flex-row flex-wrap gap-2">
          {memberships.map((m) => (
            <Chip key={m.gymId} label={m.gymName} size="sm" active={m.gymId === gymId} onPress={() => setSelected(m.gymId)} />
          ))}
        </View>
      )}

      {/* 1. Başlık */}
      <View className="flex-row items-center gap-3">
        <GymLogo name={gym.gymName} logoUrl={gym.logoUrl} gymColor={gym.primaryColor} size={52} />
        <View className="flex-1">
          <Text className="text-fg text-2xl font-bold tracking-tight" numberOfLines={1}>
            {gym.gymName}
          </Text>
          <Text className="text-accent text-sm font-semibold">{roleLabel(gym.role)}</Text>
          {membership && (
            <Text
              className={`text-xs mt-0.5 ${
                membership.tone === 'danger' ? 'text-danger' : membership.tone === 'warm' ? 'text-warm' : 'text-muted'
              }`}
            >
              {membership.text}
            </Text>
          )}
        </View>
      </View>

      {/* 2. Giriş kartı */}
      <Card className="gap-3">
        {inside && insideState?.kind === 'inside' ? (
          <>
            <Text className="text-fg text-xl font-semibold">{insideText(insideState.minutes)}</Text>
            <Text className="text-muted text-sm leading-5">Antrenmanı bitirince çıkışın otomatik yazılır.</Text>
            <SecondaryButton label="Çıkış yap" icon={LogOut} loading={busy} onPress={checkOut} />
          </>
        ) : (
          <PrimaryButton label="Salona giriş" icon={QrCode} onPress={() => router.push('/checkin')} />
        )}
        {occupancy && <Text className="text-muted text-sm text-center">{occupancy}</Text>}
        {visits.error != null && <Text className="text-danger text-xs text-center">{visits.error.message}</Text>}
      </Card>

      {/* 3. Bu ay */}
      <View className="gap-2">
        <SectionHeader title="Bu ay" variant="label" className="px-1" />
        <View className="flex-row gap-2">
          <StatTile label="Gelinen gün" value={stats.days} size="sm" className="flex-1" />
          <StatTile
            label="Ort. süre"
            value={stats.averageMinutes != null ? formatMinutes(stats.averageMinutes) : '—'}
            size="sm"
            className="flex-1"
          />
          <StatTile label="Bu hafta" value={stats.weekDays} unit="gün" size="sm" className="flex-1" />
        </View>
        <Card className="gap-3">
          <Text className="text-muted text-xs">
            {stats.streakWeeks > 1
              ? `${stats.streakWeeks} haftadır her hafta geldin`
              : stats.streakWeeks === 1
                ? 'Bu seriyi sürdür: gelecek hafta da gel'
                : 'Son 8 hafta'}
          </Text>
          <VisitHeatmap weeks={heatmap(mine, nowMs)} />
        </Card>
      </View>

      {/* 4. Bugünün dersleri, 5. son duyuru */}
      <TodayClassesCard gymId={gymId} />
      <AnnouncementCard gymId={gymId} />

      {/* 6. Programlar */}
      <View className="gap-2">
        <SectionHeader title="Programlar" variant="label" className="px-1" />
        <Card flush className="px-4">
          {shownPrograms.map((p, i) => (
            <ProgramRow
              key={p.id}
              program={p}
              divider={i > 0}
              extra={p.assignedAt ? 'Hocamın' : undefined}
              onPress={() => router.push({ pathname: '/programs/[id]', params: { id: p.id } })}
            />
          ))}
          <ListRow
            divider={shownPrograms.length > 0}
            chevron
            onPress={() => router.push({ pathname: '/programs', params: { gymId } })}
          >
            <View className="flex-row items-center gap-3">
              <ClipboardList color={COLORS.muted} size={17} strokeWidth={1.75} />
              <Text className="text-fg text-base">{shownPrograms.length > 0 ? 'Tüm programlar' : 'Programlar'}</Text>
            </View>
          </ListRow>
        </Card>
      </View>

      {/* 7. Hocalarım (+ hocaya Öğrencilerim, yöneticiye panel) */}
      <View className="gap-2">
        <SectionHeader title="Hocalarım" variant="label" className="px-1" />
        <Card flush className="px-4">
          {myTrainers.map((l, i) => (
            <ListRow key={l.id} divider={i > 0}>
              <Text className="text-fg text-base">{trainerTitle(l.trainerName)}</Text>
            </ListRow>
          ))}
          <ListRow divider={myTrainers.length > 0} chevron onPress={() => router.push('/trainer/mine')}>
            <View className="flex-row items-center gap-3">
              <UserRound color={COLORS.muted} size={17} strokeWidth={1.75} />
              <Text className="text-fg text-base">{myTrainers.length > 0 ? 'Hocalarım' : 'Henüz hocan yok'}</Text>
            </View>
          </ListRow>
          {staff && (
            <ListRow
              divider
              chevron
              onPress={() => router.push({ pathname: '/trainer/students', params: { gymId } })}
            >
              <View className="flex-row items-center gap-3">
                <GraduationCap color={COLORS.muted} size={17} strokeWidth={1.75} />
                <Text className="text-fg text-base">Öğrencilerim</Text>
              </View>
            </ListRow>
          )}
          {admin && (
            <ListRow divider chevron onPress={() => router.push({ pathname: '/gym/panel', params: { gymId } })}>
              <View className="flex-row items-center gap-3">
                <LayoutDashboard color={COLORS.muted} size={17} strokeWidth={1.75} />
                <Text className="text-fg text-base">Salon paneli</Text>
              </View>
            </ListRow>
          )}
        </Card>
      </View>
    </ScrollView>
  );
}
