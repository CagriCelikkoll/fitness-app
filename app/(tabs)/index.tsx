import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { desc, eq, isNotNull, sql } from 'drizzle-orm';
import Storage from 'expo-sqlite/kv-store';
import { ChevronRight, Flame, Play, Scale, ShieldCheck, Target, UserRound } from 'lucide-react-native';

import { useDb } from '@/hooks/useDb';
import { useWeeklyGoal } from '@/hooks/useWeeklyGoal';
import { useSessionRecovery } from '@/hooks/useSessionRecovery';
import { runConsentLaunchCheck, useHealthConsent } from '@/hooks/useHealthConsent';
import { useGymMembership } from '@/hooks/useGymMembership';
import { useProfile } from '@/hooks/useProfile';
import { useTrainerLinks } from '@/hooks/useTrainerLinks';
import { DarkSurface, useColors, useGymTones } from '@/hooks/useTheme';
import { useScreenTopInset, useSheetBottomPadding } from '@/hooks/useSafeBottom';
import { usePrograms, useRoutineLinks } from '@/hooks/usePrograms';
import { useStartRoutine } from '@/hooks/useStartRoutine';
import { useElapsedMs } from '@/components/RestTimer';
import { formatElapsed } from '@/lib/focusMode';
import { CARD_NAME_SIZES } from '@/lib/typography';
import { ChooseProgramCard } from '@/components/ChooseProgramCard';
import {
  loadTodayData,
  streakChipText,
  todayHeading,
  weekStrip,
  weekSummaryLabel,
  type LatestRecord,
  type TodayData,
  type WeekDay,
} from '@/lib/today';
import { membershipWarning } from '@/lib/gymAdmin';
import { markNamePrompted, shouldPromptForName, wasNamePrompted } from '@/lib/profile';
import { pendingRequestsFor, requestCardText } from '@/lib/trainers';
import { roleLabel } from '@/lib/auth';
import { routines, workoutSessions } from '@/db/schema';
import { useActiveWorkoutStore } from '@/stores/activeWorkoutStore';
import {
  isOnboardingDone,
  markOnboardingDone,
  shouldShowOnboarding,
} from '@/lib/onboarding';
import { formatDuration, formatRelativeDate } from '@/lib/format';
import {
  goalStreak,
  workoutDayKeys,
  workoutDaysThisWeek,
} from '@/lib/workoutCalendar';
import {
  Card,
  DisplayName,
  Glow,
  ListRow,
  PrimaryButton,
  ScreenTitle,
  SecondaryButton,
  SectionLabel,
  StatCard,
} from '@/components/ui';
import { CornerGlow } from '@/components/ui/CornerGlow';
import { WeeklyGoalPicker } from '@/components/WeeklyGoalPicker';
import { GymLogo } from '@/components/GymLogo';
import { AnnouncementAlert } from '@/components/GymCards';
import { ConsentCheckbox } from '@/components/ConsentCard';
import { LegalLink } from '@/components/LegalLink';
import { TextLink } from '@/components/TextLink';
import { usePrivacyNotice } from '@/hooks/usePrivacyNotice';
import { PRIVACY_NOTICE_CHECKBOX, privacyAckCardText } from '@/lib/privacyNotice';

/**
 * Karşılama kararı uygulama açılışı başına bir kez verilir; sekmeler
 * arasında gidip gelirken ana sayfa yeniden mount olunca tekrar sorgulanmaz.
 */
let onboardingChecked = false;

/**
 * Karşılama kontrolü burada, `_layout.tsx`'te değil: giriş noktasındaki
 * bir hata bütün uygulamayı durdururdu. Bu ekran DatabaseInitializer'ın
 * içinde, yani migration ve seed bittikten sonra mount oluyor.
 *
 * Karar verilene kadar boş zemin çiziliyor; karşılama gösterilecekse ana
 * sayfa hiç render edilmeden yerine geçiliyor (flash yok).
 */
export default function HomeScreen() {
  const db = useDb();
  const router = useRouter();
  const [ready, setReady] = useState(onboardingChecked);

  useEffect(() => {
    if (onboardingChecked) return;
    let cancelled = false;

    const decide = async (): Promise<boolean> => {
      const flagDone = await isOnboardingDone(Storage);
      if (flagDone) return false;

      const [routineRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(routines);
      const [sessionRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(workoutSessions);
      const show = shouldShowOnboarding({
        flagDone,
        routineCount: routineRow?.count ?? 0,
        sessionCount: sessionRow?.count ?? 0,
      });
      // Karşılama eklenmeden önce uygulamayı kullanmaya başlamış kullanıcı
      if (!show) await markOnboardingDone(Storage);
      return show;
    };

    decide()
      .catch((err) => {
        // Karar verilemezse ana sayfayı göster; karşılama zorunlu değil
        console.error('[ONBOARDING] Karar verilemedi:', err);
        return false;
      })
      .then((show) => {
        // Yarıda unmount olduysa karar bir sonraki mount'ta yeniden verilir
        if (cancelled) return;
        onboardingChecked = true;
        if (show) router.replace('/onboarding');
        else setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [db, router]);

  if (!ready) return <View className="flex-1 bg-bg" />;
  return <HomeContent />;
}

/**
 * v3.0: salon üyesiyse en üstte küçük salon satırı (ad + rol); dokununca
 * Salon sekmesi (v3.6c). Bayrak
 * kapalıysa / giriş yoksa / üyelik yoksa hiçbir şey çizmez, istek atmaz.
 */
function GymRow() {
  const COLORS = useColors();
  const { primary } = useGymMembership();
  // Salon rengi (v3.2d): yönetici seçer; yoksa uygulama vurgusu. Temaya göre ton (v3.5)
  const tones = useGymTones(primary?.primaryColor);
  if (!primary) return null;
  const warning = membershipWarning(primary.membershipEndsOn, Date.now());
  return (
    <View className="gap-2 -mb-1">
      <Link href="/(tabs)/gym" asChild>
        <Pressable
          className="flex-row items-center self-start bg-bg-surface border rounded-full pl-1 pr-3 py-1 active:opacity-70"
          style={{ borderColor: tones.ink }}
        >
          {/* Logo (v3.3); yoksa adın baş harfi salon renginde */}
          <GymLogo name={primary.gymName} logoUrl={primary.logoUrl} gymColor={primary.primaryColor} size={22} />
          <Text className="text-fg text-xs font-semibold ml-2" numberOfLines={1}>
            {primary.gymName}
          </Text>
          <Text className="text-muted text-xs ml-1.5">· {roleLabel(primary.role)}</Text>
        </Pressable>
      </Link>
      {/* Üyelik bitişi 7 gün ya da daha yakınsa / bittiyse; kapatılamaz */}
      {warning != null && (
        <Text className={`text-xs px-1 ${warning.ended ? 'text-danger' : 'text-warm'}`}>{warning.text}</Text>
      )}
    </View>
  );
}

/**
 * Aydınlatma metni (v3.7, KVKK): hesabı olan ama güncel metni okuduğunu
 * işaretlememiş kullanıcıya (v3.7 öncesi hesaplar, metin güncellenince).
 * Bilgilendirme kaydı, rıza değil; kapatılmaz, işaretlenince kaybolur.
 */
function PrivacyNoticeCard() {
  const COLORS = useColors();
  const router = useRouter();
  const { needsAck, storedVersion, acknowledge } = usePrivacyNotice();
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!needsAck) return null;
  const copy = privacyAckCardText(storedVersion);

  const save = async () => {
    setSaving(true);
    setError(null);
    const err = await acknowledge();
    setSaving(false);
    if (err) setError(err.message);
  };

  return (
    <Card className="gap-3">
      <View className="flex-row items-center gap-2">
        <ShieldCheck color={COLORS.accent} size={16} />
        <Text className="text-fg text-base font-semibold flex-1">{copy.title}</Text>
      </View>
      <Text className="text-muted text-sm leading-5">{copy.body}</Text>
      <View>
        <TextLink
          label="Aydınlatma Metni →"
          onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'kvkk' } })}
        />
        <LegalLink to="privacy" label="Gizlilik Politikası →" />
      </View>
      <ConsentCheckbox
        checked={checked}
        label={PRIVACY_NOTICE_CHECKBOX}
        onToggle={() => setChecked((c) => !c)}
      />
      <PrimaryButton label="Kaydet" disabled={!checked} loading={saving} onPress={() => void save()} />
      {error != null && <Text className="text-danger text-sm leading-5">{error}</Text>}
    </Card>
  );
}

/** Bu açılışta "Adını ekle" kartı gösterilen kullanıcı (sekme değişince kart kalsın) */
let namePromptShownFor: string | null = null;

/**
 * Salondaysa ve adı yoksa, kullanıcı başına bir kez "Adını ekle" kartı.
 * Gösterildiği an "soruldu" yazılır: sonraki açılışlarda çıkmaz. "Geç"
 * ile hemen kapanır; ad sonra Ayarlar → Hesap ve salon → Adın'dan girilir.
 */
function NamePromptCard() {
  const COLORS = useColors();
  const router = useRouter();
  const { primary, userId } = useGymMembership();
  const { displayName, loaded } = useProfile();
  const [prompted, setPrompted] = useState<boolean | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!userId) return;
    if (namePromptShownFor === userId) {
      setPrompted(false);
      return;
    }
    let active = true;
    void wasNamePrompted(Storage, userId).then((v) => {
      if (active) setPrompted(v);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  const show =
    !dismissed &&
    userId != null &&
    prompted != null &&
    shouldPromptForName({ inGym: primary != null, displayName, loaded, prompted });

  useEffect(() => {
    if (!show || !userId || namePromptShownFor === userId) return;
    namePromptShownFor = userId;
    markNamePrompted(Storage, userId).catch((err) => console.warn('[PROFILE] Soru kaydedilemedi:', err));
  }, [show, userId]);

  if (!show) return null;
  return (
    <Card className="gap-3">
      <View className="flex-row items-center gap-2">
        <UserRound color={COLORS.accent} size={16} />
        <Text className="text-fg text-base font-semibold flex-1">Adını ekle</Text>
      </View>
      <Text className="text-muted text-sm leading-5">
        Hocaların seni tanısın diye adını yaz. Yalnızca salonunun hocaları ve yöneticisi görür.
      </Text>
      <View className="flex-row gap-2">
        <SecondaryButton label="Geç" className="flex-1" onPress={() => setDismissed(true)} />
        <PrimaryButton
          label="Adını yaz"
          className="flex-1"
          onPress={() => {
            setDismissed(true);
            router.push('/account/name');
          }}
        />
      </View>
    </Card>
  );
}

/**
 * Hoca isteği (v3.6a): öğrenciye yanıt bekleyen istek varsa "Duygu Hoca
 * seni öğrencisi olarak eklemek istiyor." + "Göz at" (izin ekranı). Birden
 * çok istek varsa en yenisi. Bayrak kapalıyken / salon yokken istek atmaz.
 */
function TrainerRequestCard() {
  const COLORS = useColors();
  const router = useRouter();
  const { userId, links, refreshIfStale } = useTrainerLinks();

  useFocusEffect(
    useCallback(() => {
      refreshIfStale();
    }, [refreshIfStale])
  );

  const [request] = pendingRequestsFor(links, userId);
  if (!request) return null;
  return (
    <Card className="gap-3">
      <View className="flex-row items-center gap-2">
        <UserRound color={COLORS.accent} size={16} />
        <Text className="text-fg text-base font-semibold flex-1">Hoca isteği</Text>
      </View>
      <Text className="text-muted text-sm leading-5">{requestCardText(request)}</Text>
      <PrimaryButton
        label="Göz at"
        onPress={() => router.push({ pathname: '/trainer/consent', params: { id: request.id } })}
      />
    </Card>
  );
}

function HomeContent() {
  const COLORS = useColors();
  const db = useDb();
  const router = useRouter();
  const consent = useHealthConsent();
  const topInset = useScreenTopInset();
  // Uygulama arka planda kapatıldıysa yarım antrenmanı geri getir. Ardından
  // (yarım antrenman sorusu yanıtlandıktan sonra) güncellemeyle gelen
  // kullanıcıya vücut ölçüsü rızası. Kullanıcı antrenmana döndüyse rıza
  // sorusu onun üstüne açılmasın; bir sonraki açılışta sorulur.
  useSessionRecovery(({ navigated }) => {
    if (navigated) return;
    void runConsentLaunchCheck(db, () => router.push('/consent'));
  });

  const activeSessionId = useActiveWorkoutStore((s) => s.activeSessionId);
  const { goal, loaded: goalLoaded, setGoal } = useWeeklyGoal();
  const [goalPickerOpen, setGoalPickerOpen] = useState(false);

  // Bitmiş tüm seanslar: haftalık hedef, gün şeridi ve seri.
  // Join yok, useLiveQuery seans bitince kendiliğinden güncelliyor.
  const finishedSessions = useLiveQuery(
    db
      .select({ id: workoutSessions.id, startedAt: workoutSessions.startedAt, endedAt: workoutSessions.endedAt })
      .from(workoutSessions)
      .where(isNotNull(workoutSessions.endedAt))
  );
  const sessions = finishedSessions.data ?? [];
  const now = new Date();
  const dayKeys = useMemo(() => workoutDayKeys(sessions), [sessions]);
  const doneThisWeek = workoutDaysThisWeek(dayKeys, now);
  const streakText = streakChipText(goalStreak(dayKeys, goal, now));
  const strip = weekStrip(dayKeys, now);

  // Programdan eklenen rutinlerin gün sırası (yalnızca cihazdaki bağlar; istek yok)
  const { enabled: programsEnabled } = usePrograms();
  const { links } = useRoutineLinks(programsEnabled);

  // Sıradaki rutin, haftalık hacim, son rekor: join'li → odakta ve seans
  // sayısı değişince yeniden okunur
  const [today, setToday] = useState<TodayData | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setReloadKey((k) => k + 1);
    }, [])
  );
  useEffect(() => {
    let cancelled = false;
    loadTodayData(db, new Date(), links)
      .then((d) => {
        if (!cancelled) setToday(d);
      })
      .catch((err) => console.warn('[TODAY] Okunamadı:', err));
    return () => {
      cancelled = true;
    };
  }, [db, links, reloadKey, sessions.length]);

  // Son 3 tamamlanmış antrenman (geçmişe giriş)
  const recentSessions = useLiveQuery(
    db
      .select()
      .from(workoutSessions)
      .where(isNotNull(workoutSessions.endedAt))
      .orderBy(desc(workoutSessions.startedAt))
      .limit(3)
  );

  return (
    <View className="flex-1 bg-bg">
      <Glow />
      <ScrollView
        contentContainerStyle={{ paddingTop: topInset + 20 }}
        contentContainerClassName="px-5 gap-4 pb-10"
      >
        {/* 1. Tarih, BUGÜN, seri çipi: her zaman en üstte, kartlar altında */}
        <View className="flex-row items-center justify-between gap-3 min-h-[60px]">
          <View className="gap-1 shrink">
            <Text className="text-muted text-[13px] font-semibold">{todayHeading(now)}</Text>
            <ScreenTitle>Bugün</ScreenTitle>
          </View>
          {streakText != null && (
            <View
              accessible
              accessibilityLabel={streakText}
              className="flex-row items-center gap-1.5 px-3 h-9 rounded-full bg-bg-surface border border-border"
            >
              <Flame color={COLORS.accent} size={16} />
              <Text className="text-fg text-[13px] font-bold">{streakText}</Text>
            </View>
          )}
        </View>

        <GymRow />
        <PrivacyNoticeCard />
        <NamePromptCard />
        <TrainerRequestCard />
        {/* Duyuru kartı ve dersler Salon sekmesinde (v3.6c); burada yalnızca okunmamış uyarısı */}
        <AnnouncementAlert />

        {/* 2. Haftalık hedef + gün şeridi */}
        <WeekGoal
          loaded={goalLoaded}
          goal={goal}
          done={doneThisWeek}
          strip={strip}
          onPress={() => setGoalPickerOpen(true)}
        />

        {/* 3. Sıradaki */}
        <NextCard activeSessionId={activeSessionId} data={today} />

        {/* 4. Haftalık hacim + son rekor */}
        {today && (
          <View className="flex-row gap-2.5">
            <StatCard
              className="flex-1"
              label="Haftalık hacim"
              value={Math.round(today.volume.thisWeek).toLocaleString('tr-TR')}
              unit="kg"
              footnote={today.volume.change != null ? `geçen haftaya göre ${today.volume.change}` : undefined}
              color="upper"
              selected
              onPress={() => router.push('/(tabs)/progress')}
              accessibilityLabel={`Haftalık hacim: ${Math.round(today.volume.thisWeek)} kilogram${
                today.volume.change != null ? `, geçen haftaya göre ${today.volume.change.replace('%', 'yüzde ')}` : ''
              }. İlerleme ekranını aç`}
            />
            <RecordCard record={today.record} />
          </View>
        )}

        {/* Kilo takibi: rıza yoksa öneri */}
        {consent.state != null && !consent.granted && (
          <Link href={{ pathname: '/metrics/[date]', params: { date: 'new' } }} asChild>
            <Pressable
              accessibilityRole="button"
              className="flex-row items-center gap-3 rounded-[20px] bg-bg-surface border border-border px-4 py-3.5 active:opacity-70"
            >
              <View className="w-10 h-10 rounded-xl bg-bg-elevated items-center justify-center">
                <Scale color={COLORS.text} size={18} />
              </View>
              <View className="flex-1">
                <Text className="text-fg text-[15px] font-semibold">Kilo takibi için izin ver</Text>
                <Text className="text-muted text-xs mt-0.5">Kilonu ve ölçülerini İlerleme'de gör</Text>
              </View>
              <ChevronRight color={COLORS.muted} size={18} />
            </Pressable>
          </Link>
        )}

        {/* Son antrenmanlar (geçmişe giriş) */}
        <View className="flex-row items-center justify-between mt-3 px-1">
          <SectionLabel muted>Son antrenmanlar</SectionLabel>
          <Link href="/history" asChild>
            <Pressable hitSlop={12} accessibilityRole="link" className="min-h-[44px] justify-center">
              <Text className="text-muted text-sm font-semibold">Tümünü gör ›</Text>
            </Pressable>
          </Link>
        </View>
        <View className="rounded-[20px] bg-bg-surface border border-border px-4 py-1 -mt-2">
          {!recentSessions.data || recentSessions.data.length === 0 ? (
            <Text className="text-muted text-sm py-3">Henüz tamamlanmış antrenman yok. İlk antrenmanını başlat!</Text>
          ) : (
            recentSessions.data.map((session, idx) => (
              <Link key={session.id} href={{ pathname: '/session/[id]', params: { id: session.id } }} asChild>
                <ListRow divider={idx > 0} chevron>
                  <Text className="text-fg text-base font-semibold">{session.name}</Text>
                  <Text className="text-muted text-xs mt-1">
                    {formatRelativeDate(session.startedAt)}
                    {session.durationSeconds ? ` · ${formatDuration(session.durationSeconds)}` : ''}
                  </Text>
                </ListRow>
              </Link>
            ))
          )}
        </View>

        <GoalPickerModal
          visible={goalPickerOpen}
          goal={goal}
          onChange={(days) => void setGoal(days)}
          onClose={() => setGoalPickerOpen(false)}
        />
      </ScrollView>
    </View>
  );
}

// ============================================================================
// Haftalık hedef
// ============================================================================

function WeekGoal({
  loaded,
  goal,
  done,
  strip,
  onPress,
}: {
  loaded: boolean;
  goal: number | null;
  done: number;
  strip: WeekDay[];
  onPress: () => void;
}) {
  const COLORS = useColors();
  // Hedef okunmadan "belirle" daveti göstermeyelim
  if (!loaded) return <View className="h-[140px]" />;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${weekSummaryLabel(strip, done, goal)} ${goal == null ? 'Haftalık hedef belirle' : 'Haftalık hedefi değiştir'}`}
      className="mt-3 gap-3 active:opacity-80"
    >
      <View className="flex-row items-end gap-2.5">
        <Text className="font-display text-fg text-[88px] leading-[84px]">{done}</Text>
        <View className="pb-2 gap-0.5">
          {goal != null && <Text className="font-display text-muted text-[26px] leading-[30px]">/ {goal}</Text>}
          <Text className="text-muted text-sm font-semibold">bu haftaki antrenman</Text>
        </View>
        {goal == null && (
          <View className="ml-auto pb-2 flex-row items-center gap-1">
            <Target color={COLORS.accent} size={16} />
            <Text className="text-accent text-sm font-bold">Hedef belirle</Text>
          </View>
        )}
      </View>
      <View className="flex-row gap-1.5">
        {strip.map((d) => (
          <View key={d.key} className="flex-1 items-center gap-1.5">
            <View
              className={`self-stretch h-1.5 rounded-full ${d.done ? 'bg-accent' : 'bg-bg-elevated'}`}
              style={d.today ? { borderWidth: 2, borderColor: COLORS.accent, height: 10 } : undefined}
            />
            <Text className={`text-xs ${d.today ? 'text-fg font-extrabold' : 'text-muted'}`}>{d.short}</Text>
          </View>
        ))}
      </View>
    </Pressable>
  );
}

// ============================================================================
// Sıradaki kartı
// ============================================================================

/**
 * "Sıradaki" kartı. Açık temada koyu kart (v4.0a 6): içi koyu palette, köşe
 * ışığı da görünür.
 */
/** Ekran kenarı (px-5) + kart içi (p-[18px]) + 1'er kenarlık */
const CARD_NAME_INSET = 2 * (20 + 18 + 1);

function NextCard(props: { activeSessionId: string | null; data: TodayData | null }) {
  return (
    <DarkSurface>
      <NextCardBody {...props} />
    </DarkSurface>
  );
}

function NextCardBody({ activeSessionId, data }: { activeSessionId: string | null; data: TodayData | null }) {
  const { start, starting } = useStartRoutine();

  // Devam eden antrenman: "Antrenmana dön · 24:10"
  if (activeSessionId) return <ResumeCard sessionId={activeSessionId} />;
  if (!data) return <View className="h-[200px] rounded-3xl bg-bg-surface border border-border" />;

  const next = data.next;
  if (!next) return <ChooseProgramCard label="Sıradaki" />;

  return (
    <View className="rounded-3xl overflow-hidden bg-bg-surface border border-border">
      <CornerGlow color={next.color} />
      <View className="p-[18px] gap-3">
        <View className="flex-row items-center justify-between gap-3">
          <SectionLabel color={next.color}>{next.dayLabel ? `Sıradaki · ${next.dayLabel}` : 'Sıradaki'}</SectionLabel>
          {next.lastDone != null && <Text className="text-muted text-xs">{next.lastDone}</Text>}
        </View>
        <DisplayName accessibilityRole="header" inset={CARD_NAME_INSET} sizes={CARD_NAME_SIZES}>
          {next.name}
        </DisplayName>
        <Text className="text-muted text-sm">{next.line}</Text>
        <PrimaryButton
          label={starting ? 'Başlatılıyor…' : 'Antrenmanı başlat'}
          icon={Play}
          iconFill
          disabled={starting}
          accessibilityLabel={`${next.name} antrenmanını başlat`}
          onPress={() => void start({ id: next.routineId, name: next.name })}
        />
      </View>
    </View>
  );
}

function ResumeCard({ sessionId }: { sessionId: string }) {
  const db = useDb();
  const router = useRouter();
  const [session, setSession] = useState<{ name: string; startedAt: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    db.select({ name: workoutSessions.name, startedAt: workoutSessions.startedAt })
      .from(workoutSessions)
      .where(eq(workoutSessions.id, sessionId))
      .limit(1)
      .then((rows) => {
        if (!cancelled) setSession(rows[0] ?? null);
      })
      .catch((err) => console.warn('[TODAY] Antrenman okunamadı:', err));
    return () => {
      cancelled = true;
    };
  }, [db, sessionId]);

  return (
    <View className="rounded-3xl overflow-hidden bg-bg-surface border border-border">
      <CornerGlow />
      <View className="p-[18px] gap-3">
        <SectionLabel>Devam eden antrenman</SectionLabel>
        {session && (
          <DisplayName accessibilityRole="header" inset={CARD_NAME_INSET} sizes={CARD_NAME_SIZES}>
            {session.name}
          </DisplayName>
        )}
        <ResumeButton
          startedAt={session ? Date.parse(session.startedAt) : null}
          onPress={() => router.push('/session/active')}
        />
      </View>
    </View>
  );
}

/** "Antrenmana dön · 24:10" — süre her saniye */
function ResumeButton({ startedAt, onPress }: { startedAt: number | null; onPress: () => void }) {
  const elapsed = Math.floor(useElapsedMs(startedAt ?? 0) / 1000);
  const label = startedAt != null ? `Antrenmana dön · ${formatElapsed(elapsed)}` : 'Antrenmana dön';
  return <PrimaryButton label={label} icon={Play} iconFill onPress={onPress} />;
}

function RecordCard({ record }: { record: LatestRecord | null }) {
  return (
    <View
      accessible
      accessibilityLabel={record ? `Son rekor: ${record.exerciseName}, ${record.weightKg} kilogram, ${record.reps} tekrar` : 'Henüz rekor yok. İlk rekorunu kır.'}
      className="flex-1 rounded-3xl overflow-hidden bg-bg-surface border border-border p-4"
    >
      <CornerGlow color="record" corner="bottom-left" width={160} height={120} opacity={0.35} />
      <SectionLabel color="record">Son rekor</SectionLabel>
      {record ? (
        <>
          <Text className="font-display text-fg text-3xl mt-2" numberOfLines={1} adjustsFontSizeToFit>
            {String(record.weightKg).replace('.', ',')} kg
          </Text>
          <Text className="text-muted text-xs mt-1" numberOfLines={2}>
            {record.exerciseName} × {record.reps}
          </Text>
        </>
      ) : (
        <Text className="text-fg text-base font-bold mt-2">İlk rekorunu kır</Text>
      )}
    </View>
  );
}

/** Ana sayfadan haftalık hedef seçimi — Ayarlar'daki seçicinin aynısı */
function GoalPickerModal({
  visible,
  goal,
  onChange,
  onClose,
}: {
  visible: boolean;
  goal: number | null;
  onChange: (days: number | null) => void;
  onClose: () => void;
}) {
  const sheetPadding = useSheetBottomPadding();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable className="flex-1 bg-black/60 justify-end" onPress={onClose}>
        {/* İçerideki basışlar arka plana gidip modalı kapatmasın */}
        <Pressable
          onPress={() => {}}
          className="bg-bg-surface rounded-t-3xl px-5 pt-6 gap-5 border-t border-border"
          style={{ paddingBottom: sheetPadding }}
        >
          <View>
            <Text className="text-fg text-xl font-semibold tracking-tight">
              Haftalık hedef
            </Text>
            <Text className="text-muted text-sm mt-1">
              Haftada kaç gün antrenman yapmak istiyorsun?
            </Text>
          </View>
          <WeeklyGoalPicker
            label="Gün sayısı"
            value={goal}
            onChange={(days) => {
              onChange(days);
              onClose();
            }}
          />
          <SecondaryButton label="Kapat" onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
