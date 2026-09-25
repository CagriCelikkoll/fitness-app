/**
 * İlerleme sekmesi — vücut ölçümleri.
 *
 * Yukarıdan aşağıya: güncel durum, türetilmiş metrikler, 90 günlük
 * ağırlık grafiği, haftalık hacim, haftalık kas haritası, rekorlar,
 * ölçüm geçmişi. Profil (boy/doğum tarihi/cinsiyet)
 * artık Ayarlar sekmesinde; burada yalnızca eksikse oraya yönlendiren
 * bir satır görünüyor.
 *
 * Bilinçli olarak yalnızca ölçüm ve hesap gösteriliyor; hedef kilo,
 * kalori açığı gibi yönlendirmeler yok.
 */

import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Link, useFocusEffect } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { desc, eq } from 'drizzle-orm';
import { ChevronRight, Plus, Settings as SettingsIcon } from 'lucide-react-native';

import { useDb } from '@/hooks/useDb';
import { appSettings, bodyMetrics, type BodyMetric } from '@/db/schema';
import {
  bmiCategory,
  calculateAge,
  calculateBmi,
  calculateBmr,
  leanBodyMass,
  waistToHeightRatio,
} from '@/lib/bodyMetrics';
import {
  formatDateKey,
  formatDecimal,
  formatShortDate,
  formatSignedKg,
  formatVolume,
  toDateKey,
} from '@/lib/format';
import { muscleLabel } from '@/lib/exerciseTaxonomy';
import { muscleVolume, volumeHighlight } from '@/lib/muscleMap';
import {
  getRecentExerciseRecords,
  type RecentExerciseRecords,
} from '@/lib/exerciseHistory';
import {
  dateKeyToLocalDate,
  getWeeklyVolume,
  WEEKLY_VOLUME_WEEKS,
  type WeekVolume,
} from '@/lib/weeklyVolume';
import {
  toMuscleSets,
  weeklyMuscleSetsQuery,
  weeklyWindowStart,
} from '@/lib/weeklyMuscles';
import { COLORS } from '@/theme';
import {
  Card,
  EmptyState,
  ListRow,
  SectionHeader,
  StatTile,
} from '@/components/ui';
import { BarChart } from '@/components/BarChart';
import { LineChart } from '@/components/LineChart';
import { MuscleMap } from '@/components/MuscleMap';

interface Profile {
  heightCm: number | null;
  birthDate: string | null;
  gender: string | null;
}

export default function ProgressScreen() {
  const db = useDb();

  const { data: settingsRows, updatedAt: settingsLoadedAt } = useLiveQuery(
    db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1)
  );
  const { data: metrics, updatedAt: metricsLoadedAt } = useLiveQuery(
    db.select().from(bodyMetrics).orderBy(desc(bodyMetrics.date))
  );

  // İlk yüklemede data [] geldiği için updatedAt ile ayırt ediyoruz;
  // ayarlar gelmeden "profilin eksik" uyarısı yanlışlıkla görünmesin.
  if (!settingsLoadedAt || !metricsLoadedAt) {
    return (
      <View className="flex-1 bg-bg items-center justify-center">
        <ActivityIndicator color={COLORS.accent} />
      </View>
    );
  }

  const settings = settingsRows?.[0];
  const profile: Profile = {
    heightCm: settings?.heightCm ?? null,
    birthDate: settings?.birthDate ?? null,
    gender: settings?.gender ?? null,
  };

  const withWeight = metrics.filter(
    (m): m is BodyMetric & { weightKg: number } => m.weightKg != null
  );

  return (
    <View className="flex-1 bg-bg">
      <ScrollView contentContainerClassName="px-5 pt-4 gap-3 pb-28">
        <CurrentCard withWeight={withWeight} />
        <ProfileHint profile={profile} />
        <DerivedMetricsCard
          profile={profile}
          metrics={metrics}
          withWeight={withWeight}
        />
        <WeightChartCard withWeight={withWeight} />
        <WeeklyVolumeCard />
        <WeeklyMusclesCard />
        <RecordsCard />
        <HistoryCard metrics={metrics} />
      </ScrollView>

      <Link href={{ pathname: '/metrics/[date]', params: { date: 'new' } }} asChild>
        <Pressable className="absolute bottom-6 right-5 bg-accent w-14 h-14 rounded-full items-center justify-center active:opacity-80">
          <Plus color={COLORS.accentFg} size={26} strokeWidth={2.5} />
        </Pressable>
      </Link>
    </View>
  );
}

// ============================================================================
// a) Profil yönlendirmesi
// ============================================================================

/**
 * Boy ya da doğum tarihi eksikse metriklerin hesaplanamadığını söyleyip
 * Ayarlar sekmesine gönderir. Profil doluysa hiçbir şey göstermez.
 */
function ProfileHint({ profile }: { profile: Profile }) {
  if (profile.heightCm != null && profile.birthDate != null) return null;

  return (
    <Link href="/(tabs)/settings" asChild>
      <Card className="flex-row items-center py-4">
        <SettingsIcon color={COLORS.muted} size={18} strokeWidth={1.75} />
        <Text className="text-white text-sm flex-1 ml-3">
          Hesaplamalar için profil bilgilerini Ayarlar'dan gir
        </Text>
        <ChevronRight color={COLORS.muted} size={18} />
      </Card>
    </Link>
  );
}

// ============================================================================
// b) Güncel durum
// ============================================================================

function CurrentCard({
  withWeight,
}: {
  withWeight: (BodyMetric & { weightKg: number })[];
}) {
  const latest = withWeight[0];
  const previous = withWeight[1];

  if (!latest) {
    return (
      <Link href={{ pathname: '/metrics/[date]', params: { date: 'new' } }} asChild>
        <Card variant="outline" className="items-center py-8">
          <Text className="text-white text-xl font-semibold tracking-tight">
            İlk ölçümünü ekle
          </Text>
          <Text className="text-muted text-center text-sm mt-2">
            Ağırlığını ve istersen çevre ölçülerini kaydet; değişim burada
            görünecek.
          </Text>
        </Card>
      </Link>
    );
  }

  return (
    <StatTile
      label="Güncel ağırlık"
      value={formatDecimal(latest.weightKg)}
      unit="kg"
      size="xl"
      footnote={`${formatDateKey(latest.date)}${
        previous
          ? `  •  önceki ölçüme göre ${formatSignedKg(
              latest.weightKg - previous.weightKg
            )}`
          : ''
      }`}
    />
  );
}

// ============================================================================
// c) Türetilmiş metrikler
// ============================================================================

function DerivedMetricsCard({
  profile,
  metrics,
  withWeight,
}: {
  profile: Profile;
  metrics: BodyMetric[];
  withWeight: (BodyMetric & { weightKg: number })[];
}) {
  const latestWeight = withWeight[0];
  const latestWaist = metrics.find((m) => m.waistCm != null);
  const latestFat = withWeight.find((m) => m.bodyFatPct != null);
  const { heightCm, birthDate, gender } = profile;
  const age = birthDate ? calculateAge(birthDate) : null;

  const missingHeight = 'Hesaplamak için Ayarlar sekmesinde boyunu gir';
  const missingWeight = 'Hesaplamak için bir ağırlık ölçümü ekle';

  // VKİ
  let bmi: MetricRowProps;
  if (!latestWeight) bmi = { label: 'VKİ', hint: missingWeight };
  else if (heightCm == null) bmi = { label: 'VKİ', hint: missingHeight };
  else {
    const value = calculateBmi(latestWeight.weightKg, heightCm);
    const category = value != null ? bmiCategory(value) : null;
    bmi = {
      label: 'VKİ',
      value: value != null ? formatDecimal(value) : undefined,
      detail: category ?? undefined,
      note: 'VKİ kas kütlesini ayırt etmez.',
    };
  }

  // Bel / boy
  let whtr: MetricRowProps;
  if (!latestWaist?.waistCm) {
    whtr = { label: 'Bel / boy oranı', hint: 'Hesaplamak için bel ölçüsü ekle' };
  } else if (heightCm == null) {
    whtr = { label: 'Bel / boy oranı', hint: missingHeight };
  } else {
    const value = waistToHeightRatio(latestWaist.waistCm, heightCm);
    whtr = {
      label: 'Bel / boy oranı',
      value: value != null ? formatDecimal(value, 2) : undefined,
      detail:
        latestWeight && latestWaist.date !== latestWeight.date
          ? `bel: ${formatDateKey(latestWaist.date)}`
          : undefined,
      note: '0,5 altı genelde sağlıklı kabul edilir.',
    };
  }

  // Bazal metabolizma
  let bmr: MetricRowProps;
  const bmrLabel = 'Bazal metabolizma';
  if (!latestWeight) bmr = { label: bmrLabel, hint: missingWeight };
  else if (heightCm == null) bmr = { label: bmrLabel, hint: missingHeight };
  else if (age == null) {
    bmr = {
      label: bmrLabel,
      hint: 'Hesaplamak için Ayarlar sekmesinde doğum tarihini gir',
    };
  } else if (gender == null) {
    bmr = {
      label: bmrLabel,
      hint: 'Hesaplamak için Ayarlar sekmesinde cinsiyet seç',
    };
  } else {
    const value = calculateBmr(latestWeight.weightKg, heightCm, age, gender);
    bmr =
      value != null
        ? {
            label: bmrLabel,
            value: `${Math.round(value).toLocaleString('tr-TR')} kcal/gün`,
            note: 'Mifflin-St Jeor tahmini.',
          }
        : {
            label: bmrLabel,
            hint: 'Formül cinsiyete göre değiştiği için cinsiyet belirtilmeden hesaplanmıyor',
          };
  }

  // Yağsız kütle
  let lbm: MetricRowProps;
  if (!latestFat?.bodyFatPct) {
    lbm = {
      label: 'Yağsız kütle',
      hint: 'Hesaplamak için ölçüme yağ oranı ekle',
    };
  } else {
    const value = leanBodyMass(latestFat.weightKg, latestFat.bodyFatPct);
    lbm = {
      label: 'Yağsız kütle',
      value: value != null ? `${formatDecimal(value)} kg` : undefined,
      detail: `%${formatDecimal(latestFat.bodyFatPct)} yağ, ${formatDateKey(latestFat.date)}`,
    };
  }

  return (
    <View className="gap-3">
      <SectionHeader title="Hesaplanan metrikler" className="mt-4" />
      <View className="flex-row gap-3">
        <MetricRow {...bmi} />
        <MetricRow {...whtr} />
      </View>
      <View className="flex-row gap-3">
        <MetricRow {...bmr} />
        <MetricRow {...lbm} />
      </View>
    </View>
  );
}

interface MetricRowProps {
  label: string;
  value?: string;
  detail?: string;
  note?: string;
  /** Hesaplanamıyorsa hangi verinin eksik olduğu */
  hint?: string;
}

function MetricRow({ label, value, detail, note, hint }: MetricRowProps) {
  return (
    <Card className="flex-1 p-4">
      <Text className="text-muted text-[11px] uppercase tracking-widest">
        {label}
      </Text>
      {value != null && (
        <Text
          className="text-white text-2xl font-bold tabular-nums tracking-tight mt-2"
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {value}
        </Text>
      )}
      {hint != null && value == null && (
        <Text className="text-muted text-xs mt-2 leading-4">{hint}</Text>
      )}
      {(detail != null || note != null) && value != null && (
        <Text className="text-muted text-xs mt-1 leading-4">
          {[detail, note].filter(Boolean).join('  •  ')}
        </Text>
      )}
    </Card>
  );
}

// ============================================================================
// d) Ağırlık grafiği (son 90 gün)
// ============================================================================

const DAY_MS = 24 * 60 * 60 * 1000;

function WeightChartCard({
  withWeight,
}: {
  withWeight: (BodyMetric & { weightKg: number })[];
}) {
  const cutoff = toDateKey(new Date(Date.now() - 90 * DAY_MS));
  // Liste tarihe göre azalan geliyor; grafik için artan sıraya çevir
  const points = withWeight.filter((m) => m.date >= cutoff).reverse();

  const header = (
    <Text className="text-muted text-xs uppercase tracking-widest">
      Ağırlık — son 90 gün
    </Text>
  );

  if (points.length < 2) {
    return (
      <Card className="gap-2">
        {header}
        <Text className="text-muted text-sm">
          Grafik için en az iki ölçüm gerekli.
        </Text>
      </Card>
    );
  }

  return (
    <Card className="gap-3">
      {header}
      <LineChart points={points.map((p) => ({ x: p.date, y: p.weightKg }))} />
    </Card>
  );
}

// ============================================================================
// e) Haftalık hacim (son 12 hafta)
// ============================================================================

/** "2026-09-21" → "21 Eyl" */
function weekLabel(weekStart: string): string {
  return formatShortDate(dateKeyToLocalDate(weekStart).toISOString());
}

/**
 * Pazartesi başlayan haftalarda toplam hacim. Boş haftalar 0 (boşluk
 * bilgi taşıyor); içinde bulunulan hafta soluk tonda. Join'li sorgu —
 * her odaklanmada okunuyor. Pencerede hiç hacim yoksa kart görünmüyor.
 */
function WeeklyVolumeCard() {
  const db = useDb();
  const [weeks, setWeeks] = useState<WeekVolume[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getWeeklyVolume(db, new Date()).then((result) => {
        if (active) setWeeks(result);
      });
      return () => {
        active = false;
      };
    }, [db])
  );

  if (!weeks || weeks.every((w) => w.volume === 0)) return null;

  const current = weeks[weeks.length - 1]!;

  return (
    <View className="gap-3">
      <SectionHeader
        title="Haftalık Hacim"
        description={`Son ${WEEKLY_VOLUME_WEEKS} hafta`}
        className="mt-4"
      />
      <Card className="gap-4">
        <View>
          <Text className="text-muted text-xs uppercase tracking-widest">
            Bu hafta
          </Text>
          <Text className="text-white text-4xl font-bold tabular-nums tracking-tight mt-2">
            {formatVolume(current.volume)}
          </Text>
        </View>
        <BarChart
          bars={weeks.map((w) => ({
            key: w.weekStart,
            value: w.volume,
            pending: w.isCurrent,
          }))}
          formatY={formatVolume}
          startLabel={weekLabel(weeks[0]!.weekStart)}
          endLabel={weekLabel(current.weekStart)}
        />
      </Card>
    </View>
  );
}

// ============================================================================
// f) Bu hafta çalışılan kaslar
// ============================================================================

/**
 * Son 7 günde biten seansların tamamlanmış normal setleri; birincil kas
 * 1, ikincil kas 0,5 set sayılıyor.
 */
function WeeklyMusclesCard() {
  const db = useDb();
  const [volume, setVolume] = useState<Record<string, number> | null>(null);

  // useLiveQuery yalnızca FROM tablosunu (sets) dinliyor; antrenmanı
  // bitirmek workout_sessions'ı güncellediği için harita yenilenmezdi.
  // Setler başka ekranlarda değiştiğinden sekmeye her dönüşte okunuyor.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      weeklyMuscleSetsQuery(db, weeklyWindowStart(new Date())).then((rows) => {
        if (active) setVolume(muscleVolume(toMuscleSets(rows)));
      });
      return () => {
        active = false;
      };
    }, [db])
  );

  if (!volume) return null;

  const ranked = Object.entries(volume).sort(([, a], [, b]) => b - a);

  return (
    <View className="gap-3">
      <SectionHeader
        title="Bu Hafta Çalışılan Kaslar"
        description="Son 7 gün"
        className="mt-4"
      />
      <Card className="gap-4">
        {ranked.length === 0 ? (
          <EmptyState title="Bu hafta henüz antrenman yok" className="py-6" />
        ) : (
          <>
            <MuscleMap highlights={volumeHighlight(volume)} variant="weekly" />
            <View className="gap-2">
              {ranked.map(([muscle, sets]) => (
                <View key={muscle} className="flex-row justify-between">
                  <Text className="text-white text-base">
                    {muscleLabel(muscle)}
                  </Text>
                  <Text className="text-muted text-base tabular-nums">
                    {formatDecimal(sets)} set
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}
      </Card>
    </View>
  );
}

// ============================================================================
// g) Rekorlar
// ============================================================================

const RECORDS_LIMIT = 5;

/**
 * Son çalışılan egzersizlerin tahmini 1RM rekorları; satır egzersiz
 * detayına (grafiğe) gidiyor. Kas haritasıyla aynı sebepten her
 * odaklanmada okunuyor. Hiç veri yoksa kart görünmüyor.
 */
function RecordsCard() {
  const db = useDb();
  const [rows, setRows] = useState<RecentExerciseRecords[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getRecentExerciseRecords(db, RECORDS_LIMIT).then((result) => {
        if (active) setRows(result);
      });
      return () => {
        active = false;
      };
    }, [db])
  );

  if (!rows || rows.length === 0) return null;

  return (
    <View className="gap-3">
      <SectionHeader
        title="Rekorların"
        description="Son çalıştığın egzersizler, tahmini 1RM"
        className="mt-4"
      />
      <Card className="py-1">
        {rows.map((r, idx) => (
          <Link key={r.exerciseId} href={`/exercise/${r.exerciseId}`} asChild>
            <ListRow
              divider={idx > 0}
              chevron
              right={
                <View className="flex-row items-center gap-3">
                  {/* Son 8 seansın e1RM trendi; 2'den az noktada boş */}
                  <LineChart variant="sparkline" points={r.trend} />
                  {r.records.e1rm ? (
                    <View className="items-end">
                      <Text className="text-white text-base font-semibold tabular-nums">
                        {formatDecimal(r.records.e1rm.value)} kg
                      </Text>
                      <Text className="text-muted text-xs tabular-nums mt-0.5">
                        {formatShortDate(r.records.e1rm.date)}
                      </Text>
                    </View>
                  ) : (
                    <Text className="text-muted text-base">—</Text>
                  )}
                </View>
              }
            >
              <Text className="text-white text-base" numberOfLines={1}>
                {r.nameTr ?? r.name}
              </Text>
            </ListRow>
          </Link>
        ))}
      </Card>
    </View>
  );
}

// ============================================================================
// h) Ölçüm geçmişi
// ============================================================================

function HistoryCard({ metrics }: { metrics: BodyMetric[] }) {
  if (metrics.length === 0) return null;

  return (
    <View className="gap-3">
      <SectionHeader title="Ölçüm geçmişi" className="mt-4" />
      <Card className="py-1">
        {metrics.map((m, idx) => (
          <Link
            key={m.id}
            href={{ pathname: '/metrics/[date]', params: { date: m.date } }}
            asChild
          >
            <ListRow
              divider={idx > 0}
              chevron
              right={
                <View className="flex-row items-baseline">
                  {m.bodyFatPct != null && (
                    <Text className="text-muted text-sm tabular-nums mr-3">
                      %{formatDecimal(m.bodyFatPct)}
                    </Text>
                  )}
                  <Text className="text-white text-base font-semibold tabular-nums">
                    {m.weightKg != null ? `${formatDecimal(m.weightKg)} kg` : '—'}
                  </Text>
                </View>
              }
            >
              <Text className="text-white text-base tabular-nums">
                {formatDateKey(m.date)}
              </Text>
            </ListRow>
          </Link>
        ))}
      </Card>
    </View>
  );
}

