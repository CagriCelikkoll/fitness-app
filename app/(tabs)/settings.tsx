/**
 * Ayarlar sekmesi.
 *
 * Yukarıdan aşağıya: profil (boy/doğum tarihi/cinsiyet), antrenman
 * tercihleri, birimler, veri yönetimi (yedek al / geri yükle), yarım
 * kalan antrenmanlar (varsa), tehlikeli bölge (tüm verileri sıfırla),
 * hakkında.
 *
 * Profil düzenleme İlerleme sekmesinden buraya taşındı; ölçüm
 * hesaplarında kullanılan boy/yaş/cinsiyet artık tek yerden giriliyor.
 *
 * Tema ve dil `app_settings` şemasında duruyor ama arayüzde yok:
 * uygulama şu an sabit koyu tema ve Türkçe. Çalışmayan bir anahtar
 * göstermek kullanıcıyı yanıltır.
 *
 * Dinlenme sesi ve titreşimi `app_settings`'te; dinlenme bildirimi
 * ayarı kv-store'da (bkz. `restNotification.ts`).
 */

import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { eq, sql } from 'drizzle-orm';
import {
  Download,
  RotateCcw,
  Upload,
  type LucideIcon,
} from 'lucide-react-native';

import { useDb } from '@/hooks/useDb';
import {
  appSettings,
  bodyMetrics,
  exercises,
  routines,
  sets,
  workoutSessions,
  type AppSettings,
} from '@/db/schema';
import { useActiveWorkoutStore } from '@/stores/activeWorkoutStore';
import { saveSettings } from '@/lib/appSettings';
import {
  backupFileName,
  buildBackup,
  countRecords,
  wipeUserData,
} from '@/lib/backup';
import { getAppVersion, shareBackup } from '@/lib/backupFile';
import { ChipGroup } from '@/components/ChipGroup';
import { ProfileFields, useProfileForm } from '@/components/ProfileForm';
import { WeeklyGoalPicker } from '@/components/WeeklyGoalPicker';
import { useWeeklyGoal } from '@/hooks/useWeeklyGoal';
import { useRestNotificationSetting } from '@/hooks/useRestNotificationSetting';
import { summarizeCounts, useBackupRestore } from '@/hooks/useBackupRestore';
import type { RestNotificationPermissionState } from '@/lib/restNotification';
import { openNotificationSettings } from '@/lib/restNative';
import {
  canFinishOpenSession,
  findOpenSessions,
  type OpenSession,
} from '@/lib/sessionRecovery';
import {
  confirmDiscardSession,
  openUnfinishedSession,
} from '@/hooks/useSessionRecovery';
import { formatDateTime } from '@/lib/format';
import { COLORS } from '@/theme';
import {
  DangerButton,
  ListRow,
  PrimaryButton,
  SecondaryButton,
  SectionHeader,
} from '@/components/ui';

type WeightUnit = 'kg' | 'lb';
type DistanceUnit = 'km' | 'mi';

const WEIGHT_UNITS: { value: WeightUnit; label: string }[] = [
  { value: 'kg', label: 'kg' },
  { value: 'lb', label: 'lb' },
];

const DISTANCE_UNITS: { value: DistanceUnit; label: string }[] = [
  { value: 'km', label: 'km' },
  { value: 'mi', label: 'mi' },
];

/** Dinlenme süresi sınırları — 0 = zamanlayıcı yok */
const MIN_REST_SECONDS = 0;
const MAX_REST_SECONDS = 600;

export default function SettingsScreen() {
  const db = useDb();

  const { data: settingsRows, updatedAt } = useLiveQuery(
    db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1)
  );

  // Geri yükleme ayar satırını da değiştiriyor; formlar kendi state'lerini
  // kayıtlı değerlerden kurduğu için yeniden mount edilmeleri gerekiyor.
  const [formEpoch, setFormEpoch] = useState(0);

  // İlk yüklemede data [] geldiği için updatedAt ile ayırt ediyoruz.
  // Form state'i kayıtlı değerlerden kurulduğu için ayarlar gelmeden
  // bölümler render edilmemeli.
  if (!updatedAt) {
    return (
      <View className="flex-1 bg-bg items-center justify-center">
        <ActivityIndicator color={COLORS.accent} />
      </View>
    );
  }

  const settings = settingsRows?.[0];

  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerClassName="px-5 pt-4 gap-7 pb-12"
    >
      {/* key: ayarlar satırı ilk kez oluştuğunda ya da geri yüklemeyle
          değiştiğinde formlar kayıtlı değerlerle yeniden kurulsun */}
      <ProfileSection
        key={`profile-${settings?.id ?? 'new'}-${formEpoch}`}
        settings={settings}
      />
      <WorkoutSection
        key={`workout-${settings?.id ?? 'new'}-${formEpoch}`}
        settings={settings}
      />
      <UnitsSection settings={settings} />
      <DataSection onDataReplaced={() => setFormEpoch((n) => n + 1)} />
      <UnfinishedSessionsSection />
      <DangerSection />
      <AboutSection />
    </ScrollView>
  );
}

// ============================================================================
// Ortak parçalar
// ============================================================================

function Section({
  title,
  description,
  children,
  danger = false,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <View className="gap-2">
      {/* Bölüm başlığı kartın dışında */}
      <SectionHeader
        title={title}
        variant="label"
        danger={danger}
        className="px-1"
      />
      <View
        className={`bg-bg-surface rounded-3xl p-5 gap-4 border ${
          danger ? 'border-danger/50' : 'border-border'
        }`}
      >
        {description != null && (
          <Text className="text-muted text-sm leading-5">{description}</Text>
        )}
        {children}
      </View>
    </View>
  );
}

const INPUT_CLASS =
  'bg-bg-elevated text-white text-base tabular-nums px-4 h-12 rounded-xl';

function ToggleRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <ListRow
      divider
      className="-mb-2"
      right={
        <Switch
          value={value}
          onValueChange={onChange}
          trackColor={{ false: COLORS.border, true: COLORS.accent }}
          thumbColor={value ? COLORS.accentFg : COLORS.text}
          ios_backgroundColor={COLORS.border}
        />
      }
    >
      <Text className="text-white text-base">{label}</Text>
      {description != null && (
        <Text className="text-muted text-xs mt-0.5">{description}</Text>
      )}
    </ListRow>
  );
}

function ActionButton({
  label,
  onPress,
  busy = false,
  busyLabel,
  icon,
  variant = 'default',
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  busyLabel?: string;
  icon?: LucideIcon;
  variant?: 'default' | 'accent' | 'danger';
}) {
  const Button =
    variant === 'accent'
      ? PrimaryButton
      : variant === 'danger'
        ? DangerButton
        : SecondaryButton;

  return (
    <Button
      onPress={onPress}
      loading={busy}
      icon={icon}
      label={busy ? (busyLabel ?? 'Çalışıyor...') : label}
    />
  );
}

// ============================================================================
// a) Profil
// ============================================================================

function ProfileSection({ settings }: { settings?: AppSettings }) {
  const form = useProfileForm(settings);

  return (
    <Section
      title="Profil"
      description="VKİ ve bazal metabolizma hesapları için kullanılır."
    >
      <ProfileFields form={form} />
      <ActionButton
        label={form.saved ? 'Kaydedildi ✓' : 'Profili Kaydet'}
        busy={form.saving}
        busyLabel="Kaydediliyor..."
        onPress={() => void form.save()}
        variant="accent"
      />
    </Section>
  );
}

// ============================================================================
// b) Antrenman tercihleri
// ============================================================================

function WorkoutSection({ settings }: { settings?: AppSettings }) {
  const db = useDb();

  const [rest, setRest] = useState(String(settings?.defaultRestSeconds ?? 90));
  const [vibrate, setVibrate] = useState(settings?.restTimerVibrate ?? true);
  const [sound, setSound] = useState(settings?.restTimerSound ?? true);
  const { goal, loaded: goalLoaded, setGoal } = useWeeklyGoal();
  const restNotification = useRestNotificationSetting();

  const persist = async (values: Partial<typeof appSettings.$inferInsert>) => {
    try {
      await saveSettings(db, values);
    } catch (err) {
      console.error('[SETTINGS-SAVE] HATA:', err);
      Alert.alert('Kaydetme hatası', String(err));
    }
  };

  // Metin alanı serbest yazılıyor; odak çıkınca sınırlara çekip kaydet
  const commitRest = () => {
    const parsed = parseInt(rest, 10);
    const seconds = isNaN(parsed)
      ? (settings?.defaultRestSeconds ?? 90)
      : Math.min(Math.max(parsed, MIN_REST_SECONDS), MAX_REST_SECONDS);
    setRest(String(seconds));
    void persist({ defaultRestSeconds: seconds });
  };

  return (
    <Section title="Antrenman tercihleri">
      <View>
        <Text className="text-muted text-xs mb-2">
          Varsayılan dinlenme süresi (saniye)
        </Text>
        <TextInput
          value={rest}
          onChangeText={(v) => setRest(v.replace(/\D/g, '').slice(0, 3))}
          onBlur={commitRest}
          placeholder="90"
          placeholderTextColor={COLORS.muted}
          keyboardType="number-pad"
          className={`${INPUT_CLASS} w-24`}
        />
        <Text className="text-muted text-xs mt-2">
          Yeni rutin oluştururken öntanımlı değer. 0 = zamanlayıcı yok.
        </Text>
      </View>

      {/* Hedef kv-store'da; okunmadan seçici gösterilmesin, yanlış
          "Hedef yok" görünmesin */}
      {goalLoaded && (
        <View>
          <WeeklyGoalPicker
            label="Haftalık hedef (gün)"
            value={goal}
            onChange={(days) => void setGoal(days)}
          />
          <Text className="text-muted text-xs mt-2">
            Ana sayfadaki halka ve seri bu hedefe göre hesaplanır.
          </Text>
        </View>
      )}

      <ToggleRow
        label="Dinlenme bitiminde ses"
        description="Uygulama açıkken kısa bip. iPhone sessizdeyken çalmaz."
        value={sound}
        onChange={(v) => {
          setSound(v);
          void persist({ restTimerSound: v });
        }}
      />
      <ToggleRow
        label="Dinlenme bitiminde titreşim"
        value={vibrate}
        onChange={(v) => {
          setVibrate(v);
          void persist({ restTimerVibrate: v });
        }}
      />
      {/* kv-store'da; okunmadan anahtar gösterilmesin, yanlış değer
          görünüp sonra zıplamasın */}
      {restNotification.loaded && (
        <RestNotificationRow
          enabled={restNotification.enabled}
          permission={restNotification.permission}
          onChange={(v) => void restNotification.setEnabled(v)}
        />
      )}
    </Section>
  );
}

const PERMISSION_TEXT: Record<RestNotificationPermissionState, string> = {
  granted: 'Telefon kilitliyken dinlenme bitince bildirim gelir.',
  notAsked: 'İzin ilk dinlenme başladığında istenecek.',
  denied: 'Bildirim izni verilmedi. Telefon ayarlarından açabilirsin.',
};

function RestNotificationRow({
  enabled,
  permission,
  onChange,
}: {
  enabled: boolean;
  permission: RestNotificationPermissionState | null;
  onChange: (value: boolean) => void;
}) {
  return (
    <View>
      <ToggleRow
        label="Dinlenme bildirimi"
        description={
          enabled && permission != null ? PERMISSION_TEXT[permission] : undefined
        }
        value={enabled}
        onChange={onChange}
      />
      {enabled && permission === 'denied' && (
        <Pressable
          onPress={openNotificationSettings}
          accessibilityRole="button"
          hitSlop={8}
          className="self-start mt-4 active:opacity-70"
        >
          <Text className="text-accent text-sm font-semibold">
            Telefon ayarlarını aç
          </Text>
        </Pressable>
      )}
    </View>
  );
}

// ============================================================================
// c) Birimler
// ============================================================================

function UnitsSection({ settings }: { settings?: AppSettings }) {
  const db = useDb();

  const persist = async (values: Partial<typeof appSettings.$inferInsert>) => {
    try {
      await saveSettings(db, values);
    } catch (err) {
      console.error('[SETTINGS-SAVE] HATA:', err);
      Alert.alert('Kaydetme hatası', String(err));
    }
  };

  return (
    <Section
      title="Birimler"
      description="Şu an yalnızca kg/km destekleniyor; seçim kaydedilir ama ekranlar hâlâ kg/km gösterir."
    >
      <ChipGroup
        label="Ağırlık"
        options={WEIGHT_UNITS}
        value={(settings?.weightUnit as WeightUnit | undefined) ?? 'kg'}
        onChange={(v) => void persist({ weightUnit: v })}
      />
      <ChipGroup
        label="Mesafe"
        options={DISTANCE_UNITS}
        value={(settings?.distanceUnit as DistanceUnit | undefined) ?? 'km'}
        onChange={(v) => void persist({ distanceUnit: v })}
      />
    </Section>
  );
}

// ============================================================================
// d) Veri yönetimi
// ============================================================================

function DataSection({ onDataReplaced }: { onDataReplaced: () => void }) {
  const db = useDb();
  const router = useRouter();

  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const backup = await buildBackup(db, getAppVersion());
      await shareBackup(backup);
      Alert.alert(
        'Yedek hazır',
        `${backupFileName()}\n\n${summarizeCounts(countRecords(backup))}`
      );
    } catch (err) {
      console.error('[BACKUP-EXPORT] HATA:', err);
      Alert.alert('Yedekleme hatası', String(err));
    } finally {
      setExporting(false);
    }
  };

  // Seç → doğrula → onay → geri yükle akışı karşılamayla ortak
  const { importing, startRestore } = useBackupRestore(() => {
    onDataReplaced();
    router.replace('/');
  });

  return (
    <Section
      title="Veri yönetimi"
      description="Tüm veritabanı tek JSON dosyasında. Telefon değiştirirken ya da uygulamayı silmeden önce yedek al."
    >
      <ActionButton
        label="Yedek Al"
        busy={exporting}
        busyLabel="Yedek hazırlanıyor..."
        onPress={handleExport}
        variant="accent"
        icon={Upload}
      />
      <ActionButton
        label="Yedekten Geri Yükle"
        busy={importing}
        busyLabel="Geri yükleniyor..."
        onPress={() => void startRestore()}
        icon={Download}
      />
    </Section>
  );
}

// ============================================================================
// Yarım kalan antrenmanlar
// ============================================================================

/**
 * Bitirilmemiş seanslar (bkz. `sessionRecovery.ts`). Açılış sorusu
 * yalnızca son 3 günün en yeni yarım seansı için çıkıyor; eskiler ve
 * diğerleri burada. Şu an devam eden antrenman listede yok. Liste boşsa
 * bölüm hiç görünmüyor.
 *
 * Join'li sorgu: useLiveQuery dinlemiyor, odaklanınca ve silince yenileniyor.
 */
function UnfinishedSessionsSection() {
  const db = useDb();
  const router = useRouter();
  const activeSessionId = useActiveWorkoutStore((s) => s.activeSessionId);
  const [sessions, setSessions] = useState<OpenSession[]>([]);

  const reload = useCallback(() => {
    findOpenSessions(db)
      .then(setSessions)
      .catch((err) => console.error('[SESSION-RECOVERY] Liste alınamadı:', err));
  }, [db]);

  useFocusEffect(reload);

  const visible = sessions.filter((s) => s.id !== activeSessionId);
  if (visible.length === 0) return null;

  return (
    <Section
      title="Yarım kalan antrenmanlar"
      description="Bitirilmeden kapanmış antrenmanlar. Bitir, son tamamlanan sette bitmiş sayar; hiç set tamamlanmadıysa silmen önerilir."
    >
      {visible.map((session) => (
        <UnfinishedSessionRow
          key={session.id}
          session={session}
          onFinish={() => void openUnfinishedSession(router, session, true)}
          onDelete={() => confirmDiscardSession(db, session, reload)}
        />
      ))}
    </Section>
  );
}

function UnfinishedSessionRow({
  session,
  onFinish,
  onDelete,
}: {
  session: OpenSession;
  onFinish: () => void;
  onDelete: () => void;
}) {
  const canFinish = canFinishOpenSession(session);
  return (
    <View className="gap-3">
      <View>
        <Text className="text-white text-base font-semibold" numberOfLines={1}>
          {session.name}
        </Text>
        <Text className="text-muted text-xs mt-0.5 tabular-nums">
          {formatDateTime(session.startedAt)} ·{' '}
          {canFinish
            ? `${session.completedSetCount} set tamamlandı`
            : 'Tamamlanmış set yok'}
        </Text>
      </View>
      <View className="flex-row gap-2">
        {canFinish && (
          <SecondaryButton label="Bitir" onPress={onFinish} className="flex-1" />
        )}
        <DangerButton label="Sil" onPress={onDelete} className="flex-1" />
      </View>
    </View>
  );
}

// ============================================================================
// e) Tehlikeli bölge
// ============================================================================

function DangerSection() {
  const db = useDb();
  const endSession = useActiveWorkoutStore((s) => s.endSession);
  const [wiping, setWiping] = useState(false);

  const runWipe = async () => {
    setWiping(true);
    try {
      await wipeUserData(db);
      endSession();
      Alert.alert(
        'Silindi',
        'Rutinler, antrenmanlar ve ölçümler silindi. Egzersiz kütüphanesi ve ayarların duruyor.'
      );
    } catch (err) {
      console.error('[SETTINGS-SAVE] HATA:', err);
      Alert.alert('Silme hatası', String(err));
    } finally {
      setWiping(false);
    }
  };

  const confirmWipe = () => {
    Alert.alert(
      'Son onay',
      'Rutinler, antrenman geçmişi ve vücut ölçümlerinin tamamı silinecek. Bu işlem geri alınamaz.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Evet, sil', style: 'destructive', onPress: () => void runWipe() },
      ]
    );
  };

  const handlePress = () => {
    Alert.alert(
      'Önce yedek almak ister misin?',
      'Silinen veriler yedek dosyası olmadan geri getirilemez.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Devam', style: 'destructive', onPress: confirmWipe },
      ]
    );
  };

  return (
    <Section
      title="Tehlikeli bölge"
      description="Rutinleri, antrenman geçmişini ve ölçümleri siler. Egzersiz kütüphanesi ve ayarların korunur."
      danger
    >
      <ActionButton
        label="Tüm Verileri Sıfırla"
        busy={wiping}
        busyLabel="Siliniyor..."
        onPress={handlePress}
        variant="danger"
        icon={RotateCcw}
      />
    </Section>
  );
}

// ============================================================================
// f) Hakkında
// ============================================================================

function AboutSection() {
  const db = useDb();
  const router = useRouter();

  const exerciseCount = useLiveQuery(
    db.select({ count: sql<number>`count(*)` }).from(exercises)
  );
  const routineCount = useLiveQuery(
    db.select({ count: sql<number>`count(*)` }).from(routines)
  );
  const sessionCount = useLiveQuery(
    db.select({ count: sql<number>`count(*)` }).from(workoutSessions)
  );
  const setCount = useLiveQuery(
    db.select({ count: sql<number>`count(*)` }).from(sets)
  );
  const metricCount = useLiveQuery(
    db.select({ count: sql<number>`count(*)` }).from(bodyMetrics)
  );

  const rows: { label: string; value: string }[] = [
    {
      label: 'Uygulama sürümü',
      value: Constants.expoConfig?.version ?? '—',
    },
    { label: 'Çalışma zamanı', value: Updates.runtimeVersion || '—' },
    { label: 'Kanal', value: Updates.channel || '—' },
    { label: 'Güncelleme', value: updateIdText() },
    { label: 'Egzersiz', value: countText(exerciseCount.data?.[0]?.count) },
    { label: 'Rutin', value: countText(routineCount.data?.[0]?.count) },
    { label: 'Antrenman', value: countText(sessionCount.data?.[0]?.count) },
    { label: 'Kayıtlı set', value: countText(setCount.data?.[0]?.count) },
    { label: 'Vücut ölçümü', value: countText(metricCount.data?.[0]?.count) },
  ];

  return (
    <Section title="Hakkında">
      <View className="-my-3">
        {rows.map((row, idx) => (
          <ListRow
            key={row.label}
            divider={idx > 0}
            right={
              <Text className="text-white text-base font-semibold tabular-nums">
                {row.value}
              </Text>
            }
          >
            <Text className="text-muted text-base">{row.label}</Text>
          </ListRow>
        ))}
        <ListRow divider chevron onPress={() => router.push('/onboarding')}>
          <Text className="text-white text-base">Tanıtımı tekrar göster</Text>
        </ListRow>
      </View>
    </Section>
  );
}

/**
 * Çalışan JS paketinin kimliği. Expo Go ve geliştirme modunda
 * expo-updates kapalıdır, o durumda "—".
 */
function updateIdText(): string {
  if (!Updates.isEnabled) return '—';
  if (Updates.isEmbeddedLaunch) return 'Gömülü';
  return Updates.updateId ? Updates.updateId.slice(0, 8) : '—';
}

function countText(n: number | undefined): string {
  return (n ?? 0).toLocaleString('tr-TR');
}
