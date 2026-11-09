/**
 * Profil sekmesi (v4.0a Bölüm 5; eski Ayarlar sekmesi, rota adı aynı).
 *
 * Üstte avatar (adın baş harfi, brand zemin), ad, eşitleme durumu; 3 küçük
 * sayı (antrenman, seri, rekor); salon kartı. Altında ayar grupları: her satır
 * `app/settings/[group].tsx` alt sayfasını açar (bölümler eskisinin aynısı,
 * `src/components/settings/SettingsSections.tsx`). Yarım kalan antrenman varsa
 * burada da görünür. Grupların içeriği `src/lib/settingsGroups.ts`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { eq, isNotNull } from 'drizzle-orm';
import {
  Bell,
  Building2,
  ChevronRight,
  Info,
  Palette,
  Ruler,
  Shield,
  Timer,
  Archive,
  UserRound,
  type LucideIcon,
} from 'lucide-react-native';

import { GymLogo } from '@/components/GymLogo';
import { UnfinishedSessionsSection } from '@/components/settings/SettingsSections';
import { Card, Glow, ListRow, SectionLabel } from '@/components/ui';
import { Text } from '@/components/ui/Text';
import { appSettings, workoutSessions } from '@/db/schema';
import { useDb } from '@/hooks/useDb';
import { useGymMembership } from '@/hooks/useGymMembership';
import { useProfile } from '@/hooks/useProfile';
import { useScreenTopInset } from '@/hooks/useSafeBottom';
import { useSession } from '@/hooks/useSession';
import { useSyncStatus } from '@/hooks/useSyncTriggers';
import { useColors, useTheme } from '@/hooks/useTheme';
import { useWeeklyGoal } from '@/hooks/useWeeklyGoal';
import { roleLabel } from '@/lib/auth';
import { loadRecordHistory, recordEvents } from '@/lib/recordEvents';
import {
  SETTINGS_GROUPS,
  avatarInitial,
  profileSyncLine,
  restClock,
  type SettingsGroupKey,
} from '@/lib/settingsGroups';
import { syncCardView } from '@/lib/sync/ui';
import { THEME_MODE_OPTIONS } from '@/lib/themeMode';
import { goalStreak, workoutDayKeys } from '@/lib/workoutCalendar';

const GROUP_ICONS: Record<SettingsGroupKey, LucideIcon> = {
  appearance: Palette,
  body: Ruler,
  training: Timer,
  notifications: Bell,
  data: Archive,
  account: Shield,
  about: Info,
};

const SYNC_TONE_CLASS = { ok: 'text-accent', muted: 'text-muted', danger: 'text-danger' } as const;

export default function ProfileScreen() {
  const COLORS = useColors();
  const db = useDb();
  const router = useRouter();
  const topInset = useScreenTopInset();
  const { mode } = useTheme();

  const { data: settingsRows } = useLiveQuery(
    db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1)
  );
  const settings = settingsRows?.[0];

  const values: Partial<Record<SettingsGroupKey, string>> = {
    appearance: THEME_MODE_OPTIONS.find((o) => o.value === mode)?.label,
    training: `${settings?.weightUnit ?? 'kg'} · ${restClock(settings?.defaultRestSeconds ?? 90)}`,
    about: Constants.expoConfig?.version,
  };

  return (
    <View className="flex-1 bg-bg">
      <Glow />
      <ScrollView
        contentContainerStyle={{ paddingTop: topInset + 20 }}
        contentContainerClassName="px-5 gap-4 pb-10"
      >
        <ProfileHeader />
        <ProfileNumbers />
        <GymCard />
        <UnfinishedSessionsSection />

        <View className="gap-2">
          <SectionLabel muted className="px-1">
            Ayarlar
          </SectionLabel>
          <Card className="py-1">
            {SETTINGS_GROUPS.map((g, i) => {
              const Icon = GROUP_ICONS[g.key];
              const value = values[g.key];
              return (
                <ListRow
                  key={g.key}
                  divider={i > 0}
                  chevron
                  onPress={() => router.push({ pathname: '/settings/[group]', params: { group: g.key } })}
                  accessibilityRole="button"
                  accessibilityLabel={value ? `${g.title}: ${value}` : g.title}
                  right={value != null ? <Text className="text-muted text-[13px]">{value}</Text> : undefined}
                >
                  <View className="flex-row items-center gap-3">
                    <Icon color={COLORS.muted} size={20} strokeWidth={1.8} />
                    <Text className="text-fg text-[15px]">{g.title}</Text>
                  </View>
                </ListRow>
              );
            })}
          </Card>
        </View>
      </ScrollView>
    </View>
  );
}

/** Avatar, ad, eşitleme satırı. Hesapsızsa "Hesap aç" bağlantısı. */
function ProfileHeader() {
  const COLORS = useColors();
  const router = useRouter();
  const { available, ready } = useSession();
  const { userId } = useGymMembership();
  const profile = useProfile();
  const { status, running } = useSyncStatus();
  const now = useNowTick(30_000);

  const signedIn = available && ready && userId != null;
  const sync = profileSyncLine(signedIn, syncCardView(status, running, now));
  const initial = avatarInitial(profile.displayName);
  // Hesaplıyken ad yüklenene kadar "Adını ekle" yanıp sönmesin
  const name = profile.displayName ?? (!signedIn ? 'Profil' : profile.loaded ? null : '…');

  return (
    <View className="flex-row items-center gap-4">
      <View
        className="w-16 h-16 rounded-full bg-accent items-center justify-center"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {initial ? (
          <Text className="font-display text-accent-fg text-[28px]">{initial}</Text>
        ) : (
          <UserRound color={COLORS.accentFg} size={30} strokeWidth={1.8} />
        )}
      </View>
      <View className="flex-1">
        {name != null ? (
          <Text accessibilityRole="header" className="text-fg text-2xl font-bold" numberOfLines={1}>
            {name}
          </Text>
        ) : (
          <Pressable
            onPress={() => router.push('/account/name')}
            accessibilityRole="button"
            className="self-start min-h-[44px] justify-center active:opacity-70"
          >
            <Text className="text-accent text-xl font-bold">Adını ekle</Text>
          </Pressable>
        )}
        <Text className={`text-[13px] mt-0.5 ${SYNC_TONE_CLASS[sync.tone]}`}>{sync.text}</Text>
        {available && ready && !signedIn && (
          <Pressable
            onPress={() => router.push('/account/sign-in')}
            accessibilityRole="button"
            hitSlop={6}
            className="self-start min-h-[44px] justify-center active:opacity-70"
          >
            <Text className="text-accent text-[13px] font-semibold">Hesap aç ya da giriş yap ›</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

/** "2 dk önce" kendiliğinden ilerlesin */
function useNowTick(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** 3 küçük sayı: bitmiş antrenman, hedef serisi (hafta), kırılan rekor */
function ProfileNumbers() {
  const db = useDb();
  const { goal } = useWeeklyGoal();
  const finished = useLiveQuery(
    db
      .select({ id: workoutSessions.id, startedAt: workoutSessions.startedAt, endedAt: workoutSessions.endedAt })
      .from(workoutSessions)
      .where(isNotNull(workoutSessions.endedAt))
  );
  const sessions = finished.data ?? [];
  const streak = useMemo(() => goalStreak(workoutDayKeys(sessions), goal, new Date()), [sessions, goal]);

  // Rekor geçmişi join'li → odakta oku
  const [records, setRecords] = useState<number | null>(null);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      loadRecordHistory(db).then((rows) => {
        if (!active) return;
        const seen = new Set(recordEvents(rows).map((e) => `${e.sessionId}|${e.exerciseId}`));
        setRecords(seen.size);
      });
      return () => {
        active = false;
      };
    }, [db])
  );

  const items = [
    { value: String(sessions.length), label: 'antrenman', spoken: `${sessions.length} antrenman` },
    { value: String(streak), label: 'hafta seri', spoken: `${streak} hafta seri` },
    { value: records == null ? '—' : String(records), label: 'rekor', spoken: `${records ?? 0} rekor` },
  ];

  return (
    <Card className="flex-row py-4">
      {items.map((it, i) => (
        <View
          key={it.label}
          accessible
          accessibilityLabel={it.spoken}
          className={`flex-1 items-center ${i > 0 ? 'border-l border-border' : ''}`}
        >
          <Text className="font-display text-fg text-2xl">{it.value}</Text>
          <Text className="text-muted text-[13px] mt-0.5">{it.label}</Text>
        </View>
      ))}
    </Card>
  );
}

/**
 * Salon kartı: üyeyse salonun adı ve rolü (Salon sekmesine gider; salon
 * araçları ve ayrılma "Gizlilik ve hesap"ta); değilse "Salon koduyla katıl".
 * Hesap özellikleri kapalıysa (sunucu ayarı yok) görünmez.
 */
function GymCard() {
  const COLORS = useColors();
  const router = useRouter();
  const { available, ready } = useSession();
  const { userId, primary } = useGymMembership();
  if (!available || !ready) return null;

  if (primary) {
    return (
      <Pressable
        onPress={() => router.push('/(tabs)/gym')}
        accessibilityRole="button"
        accessibilityLabel={`${primary.gymName}, ${roleLabel(primary.role)}. Salon sekmesini aç`}
        className="bg-bg-surface border border-border rounded-3xl p-4 flex-row items-center gap-3 active:opacity-80"
      >
        <GymLogo name={primary.gymName} logoUrl={primary.logoUrl} gymColor={primary.primaryColor} size={44} />
        <View className="flex-1">
          <Text className="text-fg text-base font-semibold" numberOfLines={1}>
            {primary.gymName}
          </Text>
          <Text className="text-muted text-[13px] mt-0.5">{roleLabel(primary.role)}</Text>
        </View>
        <ChevronRight color={COLORS.muted} size={18} />
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={() =>
        userId
          ? router.push('/account/join-gym')
          : router.push({ pathname: '/account/sign-in', params: { next: 'join-gym' } })
      }
      accessibilityRole="button"
      className="bg-bg-surface border border-border rounded-3xl p-4 flex-row items-center gap-3 active:opacity-80"
    >
      <View className="w-11 h-11 rounded-2xl bg-bg-elevated items-center justify-center">
        <Building2 color={COLORS.muted} size={22} strokeWidth={1.8} />
      </View>
      <View className="flex-1">
        <Text className="text-fg text-base font-semibold">Salonun yok</Text>
        <Text className="text-muted text-[13px] mt-0.5">Salon koduyla katıl, hocanın programlarını al</Text>
      </View>
      <ChevronRight color={COLORS.muted} size={18} />
    </Pressable>
  );
}
