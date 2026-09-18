/**
 * Ayarlar sekmesi.
 *
 * Yukarıdan aşağıya: profil (boy/doğum tarihi/cinsiyet), antrenman
 * tercihleri, birimler, veri yönetimi (yedek al / geri yükle),
 * tehlikeli bölge (tüm verileri sıfırla), hakkında.
 *
 * Profil düzenleme İlerleme sekmesinden buraya taşındı; ölçüm
 * hesaplarında kullanılan boy/yaş/cinsiyet artık tek yerden giriliyor.
 *
 * Tema, dil ve dinlenme sesi `app_settings` şemasında duruyor ama
 * arayüzde yok: uygulama şu an sabit koyu tema ve Türkçe, ses de
 * henüz çalmıyor (expo-audio kurulmadı). Çalışmayan bir anahtar
 * göstermek kullanıcıyı yanıltır; ses eklenince anahtar geri gelir.
 */

import { useState } from 'react';
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
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import Constants from 'expo-constants';
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
import { calculateAge } from '@/lib/bodyMetrics';
import {
  BACKUP_TABLE_KEYS,
  TABLE_LABELS,
  backupFileName,
  buildBackup,
  countRecords,
  restoreBackup,
  validateBackup,
  wipeUserData,
  type BackupFile,
} from '@/lib/backup';
import { getAppVersion, shareBackup } from '@/lib/backupFile';
import { DateInput } from '@/components/DateInput';
import {
  dateKeyToParts,
  formatDateTime,
  getDateInputError,
  partsToDateKey,
  sanitizeDecimalInput,
  type DateParts,
} from '@/lib/format';
import { COLORS } from '@/theme';
import {
  Chip,
  DangerButton,
  ListRow,
  PrimaryButton,
  SecondaryButton,
  SectionHeader,
} from '@/components/ui';

type Gender = 'male' | 'female' | 'unspecified';

/** Doğum tarihi için en erken yıl */
const BIRTH_DATE_MIN_YEAR = 1900;

const EMPTY_DATE_PARTS: DateParts = { day: '', month: '', year: '' };

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: 'male', label: 'Erkek' },
  { value: 'female', label: 'Kadın' },
  { value: 'unspecified', label: 'Belirtmek istemiyorum' },
];

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

/** Boy sınırları (cm) */
const MIN_HEIGHT_CM = 50;
const MAX_HEIGHT_CM = 272;

/**
 * Doğum tarihi opsiyonel: üç alan da boşsa hata yok. Aksi halde ortak
 * tarih doğrulaması, ardından yaşın makul aralıkta olması.
 */
function getBirthDateError(parts: DateParts, submitted: boolean): string | null {
  if (!parts.day && !parts.month && !parts.year) return null;

  const error = getDateInputError(parts, {
    minYear: BIRTH_DATE_MIN_YEAR,
    submitted,
    futureError: 'Doğum tarihi ileri bir tarih olamaz.',
  });
  if (error != null) return error;

  const key = partsToDateKey(parts);
  if (key != null && calculateAge(key) == null) return 'Geçerli bir doğum tarihi gir.';
  return null;
}

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

function ChipGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <View>
      <Text className="text-muted text-xs mb-2">{label}</Text>
      <View className="flex-row flex-wrap gap-2">
        {options.map((opt) => (
          <Chip
            key={opt.value}
            label={opt.label}
            active={value === opt.value}
            onPress={() => onChange(opt.value)}
          />
        ))}
      </View>
    </View>
  );
}

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

/** Ayar satırını (id = 1) upsert eder; satır seed'de oluşuyor ama yoksa da çalışsın */
async function saveSettings(
  db: ReturnType<typeof useDb>,
  values: Partial<typeof appSettings.$inferInsert>
): Promise<void> {
  const patch = { ...values, updatedAt: new Date().toISOString() };
  await db
    .insert(appSettings)
    .values({ id: 1, ...patch })
    .onConflictDoUpdate({ target: appSettings.id, set: patch });
}

// ============================================================================
// a) Profil
// ============================================================================

function ProfileSection({ settings }: { settings?: AppSettings }) {
  const db = useDb();

  const [height, setHeight] = useState(
    settings?.heightCm != null ? String(settings.heightCm) : ''
  );
  const [birthParts, setBirthParts] = useState<DateParts>(
    settings?.birthDate ? dateKeyToParts(settings.birthDate) : EMPTY_DATE_PARTS
  );
  const [birthSubmitted, setBirthSubmitted] = useState(false);
  const [gender, setGender] = useState<Gender | null>(
    (settings?.gender as Gender | null) ?? null
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const birthError = getBirthDateError(birthParts, birthSubmitted);

  // "Kaydedildi" etiketi yeni bir değişiklikte kaybolsun
  const touch = () => setSaved(false);

  const handleSave = async () => {
    const heightCm = parseFloatOrNull(height);
    if (
      heightCm != null &&
      (heightCm < MIN_HEIGHT_CM || heightCm > MAX_HEIGHT_CM)
    ) {
      Alert.alert('Hata', 'Boyu santimetre olarak gir (ör. 178).');
      return;
    }
    // Doğum tarihi hatası Alert yerine alanların altında gösteriliyor
    setBirthSubmitted(true);
    if (getBirthDateError(birthParts, true) != null) return;

    setSaving(true);
    try {
      await saveSettings(db, {
        heightCm,
        birthDate: partsToDateKey(birthParts), // üç alan da boşsa null
        gender,
      });
      setSaved(true);
    } catch (err) {
      console.error('[SETTINGS-SAVE] HATA:', err);
      Alert.alert('Kaydetme hatası', String(err));
    } finally {
      setSaving(false);
    }
  };

  const age = settings?.birthDate ? calculateAge(settings.birthDate) : null;

  return (
    <Section
      title="Profil"
      description="VKİ ve bazal metabolizma hesapları için kullanılır."
    >
      {/* DateInput üç alanıyla yarım satıra sığmadığı için boy ayrı satırda */}
      <View>
        <Text className="text-muted text-xs mb-2">Boy (cm)</Text>
        <TextInput
          value={height}
          onChangeText={(v) => {
            touch();
            setHeight((prev) => sanitizeDecimalInput(v, prev));
          }}
          placeholder="178"
          placeholderTextColor={COLORS.muted}
          keyboardType="decimal-pad"
          className={`${INPUT_CLASS} w-28`}
        />
      </View>

      <DateInput
        label="Doğum tarihi"
        value={birthParts}
        onChange={(parts) => {
          touch();
          setBirthParts(parts);
        }}
        error={birthError}
      />
      {age != null && (
        <Text className="text-muted text-xs -mt-2 tabular-nums">
          Kayıtlı yaş: {age}
        </Text>
      )}

      <ChipGroup
        label="Cinsiyet"
        options={GENDER_OPTIONS}
        value={gender}
        onChange={(v) => {
          touch();
          setGender(v);
        }}
      />

      <ActionButton
        label={saved ? 'Kaydedildi ✓' : 'Profili Kaydet'}
        busy={saving}
        busyLabel="Kaydediliyor..."
        onPress={handleSave}
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

      {/* "Dinlenme bitiminde ses" anahtarı kaldırıldı: ses çalma henüz
          uygulanmadı, restTimerSound alanı şemada duruyor. */}
      <ToggleRow
        label="Dinlenme bitiminde titreşim"
        value={vibrate}
        onChange={(v) => {
          setVibrate(v);
          void persist({ restTimerVibrate: v });
        }}
      />
    </Section>
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

/** "3 antrenman, 2 rutin, 5 ölçüm" — boş tablolar atlanır */
function summarizeCounts(counts: Record<string, number>): string {
  const lines = BACKUP_TABLE_KEYS.filter((key) => counts[key] > 0).map(
    (key) => `${TABLE_LABELS[key] ?? key}: ${counts[key]}`
  );
  return lines.length > 0 ? lines.join('\n') : 'Yedekte hiç kayıt yok.';
}

function DataSection({ onDataReplaced }: { onDataReplaced: () => void }) {
  const db = useDb();
  const router = useRouter();
  const endSession = useActiveWorkoutStore((s) => s.endSession);

  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

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

  /** Onay alındıktan sonraki asıl geri yükleme */
  const runRestore = async (data: BackupFile) => {
    setImporting(true);
    try {
      await restoreBackup(db, data);
      // Silinen seansa işaret eden state kalmasın
      endSession();
      onDataReplaced();
      Alert.alert('Geri yüklendi', 'Yedekteki veriler yüklendi.');
      router.replace('/');
    } catch (err) {
      console.error('[BACKUP-IMPORT] HATA:', err);
      Alert.alert('Geri yükleme hatası', String(err));
    } finally {
      setImporting(false);
    }
  };

  const handleImport = async () => {
    try {
      // Tür filtresi yok: bazı dosya sağlayıcıları JSON'u application/json
      // olarak bildirmiyor, filtreleyince yedek dosyası seçilemez hale
      // geliyor. Dosyanın gerçekten yedek olup olmadığını validateBackup
      // söylüyor.
      const picked = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
      });
      if (picked.canceled) return;

      const asset = picked.assets[0];
      if (!asset) return;

      setImporting(true);
      const raw = await new File(asset.uri).text();
      setImporting(false);

      const result = validateBackup(raw);
      if (!result.ok) {
        Alert.alert('Dosya okunamadı', result.error);
        return;
      }

      const data = result.data;
      const counts = countRecords(data);
      const exportedAt = data.exportedAt
        ? formatDateTime(data.exportedAt)
        : 'bilinmiyor';

      Alert.alert(
        'Yedek içeriği',
        `Alındığı tarih: ${exportedAt}\nUygulama sürümü: ${data.appVersion}\n\n${summarizeCounts(counts)}`,
        [
          { text: 'Vazgeç', style: 'cancel' },
          {
            text: 'Devam',
            onPress: () =>
              Alert.alert(
                'Mevcut tüm veriler silinecek',
                'Geri yükleme birleştirme yapmaz. Cihazdaki rutinler, antrenmanlar, ölçümler ve egzersiz kütüphanesi silinip yedektekiyle değiştirilecek. Bu işlem geri alınamaz.',
                [
                  { text: 'Vazgeç', style: 'cancel' },
                  {
                    text: 'Evet, geri yükle',
                    style: 'destructive',
                    onPress: () => void runRestore(data),
                  },
                ]
              ),
          },
        ]
      );
    } catch (err) {
      setImporting(false);
      console.error('[BACKUP-IMPORT] HATA:', err);
      Alert.alert('Dosya okunamadı', String(err));
    }
  };

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
        onPress={handleImport}
        icon={Download}
      />
    </Section>
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
      </View>
    </Section>
  );
}

function countText(n: number | undefined): string {
  return (n ?? 0).toLocaleString('tr-TR');
}

function parseFloatOrNull(v: string): number | null {
  const trimmed = v.trim().replace(',', '.');
  if (!trimmed) return null;
  const n = parseFloat(trimmed);
  return isNaN(n) ? null : n;
}
