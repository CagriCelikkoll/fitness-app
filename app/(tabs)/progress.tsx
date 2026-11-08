/**
 * İlerleme sekmesi (v4.0a Bölüm 4).
 *
 * Yukarıdan aşağıya: "İLERLEME" + Hafta / Ay / Yıl; 2×2 kart (toplam hacim,
 * antrenman günü, süre, rekor; seçili kart renkle dolu ve grafiği belirler);
 * seçili metriğin çubuk grafiği; "Bu hafta kas başına set" (→ Kas haritası);
 * egzersiz rekorları (tahmini 1RM, egzersiz grafiğine gider); vücut ölçüleri
 * (açık rızayla); en altta antrenman takvimi. Hesaplar `src/lib/progressStats.ts`.
 *
 * Vücut ölçüsü kartları açık rızaya bağlı (bkz. `consent.ts`); rıza yokken
 * yerlerinde rıza kartı. Bilinçli olarak yalnızca ölçüm ve hesap gösteriliyor;
 * hedef kilo, kalori açığı gibi yönlendirmeler yok.
 */

import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { Link, useFocusEffect } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { desc, eq, isNotNull } from 'drizzle-orm';
import { WorkoutCalendar } from '@/components/WorkoutCalendar';
import { ChevronRight, Plus, Settings as SettingsIcon } from 'lucide-react-native';

import { useDb } from '@/hooks/useDb';
import { exerciseDisplayName } from '@/lib/exerciseCatalog';
import { useHealthConsent } from '@/hooks/useHealthConsent';
import { useScreenTopInset } from '@/hooks/useSafeBottom';
import { useColors, useContextTones } from '@/hooks/useTheme';
import { ConsentCard } from '@/components/ConsentCard';
import { appSettings, bodyMetrics, workoutSessions, type BodyMetric } from '@/db/schema';
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
  toDateKey,
} from '@/lib/format';
import { muscleLabel } from '@/lib/exerciseTaxonomy';
import { muscleVolume } from '@/lib/muscleMap';
import {
  getRecentExerciseRecords,
  type RecentExerciseRecords,
} from '@/lib/exerciseHistory';
import {
  METRIC_COLORS,
  PROGRESS_PERIODS,
  loadProgressData,
  muscleBars,
  progressChart,
  progressStats,
  type MuscleBar,
  type ProgressData,
  type ProgressMetric,
  type ProgressPeriod,
} from '@/lib/progressStats';
import {
  toMuscleSets,
  weeklyMuscleSetsQuery,
  weeklyWindowStart,
} from '@/lib/weeklyMuscles';
import {
  Card,
  Glow,
  ListRow,
  SectionHeader,
  StatCard,
  StatTile,
} from '@/components/ui';
import { upperTr } from '@/lib/typography';
import { BarChart } from '@/components/BarChart';
import { LineChart } from '@/components/LineChart';

interface Profile {
  heightCm: number | null;
  birthDate: string | null;
  gender: string | null;
}

export default function ProgressScreen() {
  const COLORS = useColors();
  const db = useDb();
  const consent = useHealthConsent();
  const topInset = useScreenTopInset();
  const [period, setPeriod] = useState<ProgressPeriod>('week');
  const [metric, setMetric] = useState<ProgressMetric>('volume');

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
      <Glow color={METRIC_COLORS[metric]} />
      <ScrollView
        contentContainerStyle={{ paddingTop: topInset + 20 }}
        contentContainerClassName="px-5 gap-3 pb-28"
      >
        <View className="flex-row items-center gap-3 mb-2">
          <View className="flex-1">
            <Text
              accessibilityRole="header"
              className="font-display text-fg text-[32px] leading-[38px]"
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {upperTr('İlerleme')}
            </Text>
          </View>
          <PeriodPicker value={period} onChange={setPeriod} />
        </View>

        <ProgressOverview period={period} metric={metric} onMetric={setMetric} />
        <MuscleSetsCard />
        <RecordsCard />

        {/* v2.2: vücut ölçüleri (güncel kilo, VKİ / bel-boy / bazal
            metabolizma, grafik, geçmiş) yalnızca açık rızayla. Rıza
            yokken yerine tek rıza kartı. */}
        {consent.granted ? (
          <>
            <SectionHeader title="Vücut ölçüleri" className="mt-4" />
            <CurrentCard withWeight={withWeight} />
            <ProfileHint profile={profile} />
            <DerivedMetricsCard
              profile={profile}
              metrics={metrics}
              withWeight={withWeight}
            />
            <WeightChartCard withWeight={withWeight} />
            <HistoryCard metrics={metrics} />
          </>
        ) : (
          consent.state != null && (
            <ConsentCard
              action={{ label: 'Onayla ve devam et', onConfirm: consent.grant }}
            />
          )
        )}
        {/* v4.0a: antrenman takvimi ana sayfadan buraya taşındı (en altta) */}
        <CalendarCard />
      </ScrollView>

      {consent.granted && (
        <Link href={{ pathname: '/metrics/[date]', params: { date: 'new' } }} asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ölçüm ekle"
            className="absolute bottom-6 right-5 bg-accent w-14 h-14 rounded-full items-center justify-center active:opacity-80"
          >
            <Plus color={COLORS.accentFg} size={26} strokeWidth={2.5} />
          </Pressable>
        </Link>
      )}
    </View>
  );
}

/** Hafta / Ay / Yıl: tek seçimli, her biri ≥44 dokunma alanı */
function PeriodPicker({ value, onChange }: { value: ProgressPeriod; onChange: (p: ProgressPeriod) => void }) {
  return (
    <View accessibilityRole="radiogroup" className="flex-row bg-bg-surface border border-border rounded-2xl p-1">
      {PROGRESS_PERIODS.map((p) => {
        const selected = p.key === value;
        return (
          <Pressable
            key={p.key}
            onPress={() => onChange(p.key)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={p.label}
            className={`min-h-[44px] px-3 rounded-xl items-center justify-center ${
              selected ? 'bg-accent' : 'active:opacity-70'
            }`}
          >
            <Text className={`text-[13px] font-semibold ${selected ? 'text-accent-fg' : 'text-muted'}`}>
              {p.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Antrenman takvimi (ısı haritası): bitmiş seanslar, join yok → canlı sorgu */
function CalendarCard() {
  const db = useDb();
  const { data } = useLiveQuery(
    db
      .select({
        id: workoutSessions.id,
        name: workoutSessions.name,
        startedAt: workoutSessions.startedAt,
        endedAt: workoutSessions.endedAt,
        durationSeconds: workoutSessions.durationSeconds,
      })
      .from(workoutSessions)
      .where(isNotNull(workoutSessions.endedAt))
  );
  const sessions = data ?? [];
  return <WorkoutCalendar sessions={sessions} totalCount={sessions.length} />;
}

// ============================================================================
// a) Profil yönlendirmesi
// ============================================================================

/**
 * Boy ya da doğum tarihi eksikse metriklerin hesaplanamadığını söyleyip
 * Ayarlar sekmesine gönderir. Profil doluysa hiçbir şey göstermez.
 */
function ProfileHint({ profile }: { profile: Profile }) {
  const COLORS = useColors();
  if (profile.heightCm != null && profile.birthDate != null) return null;

  return (
    <Link href={{ pathname: '/settings/[group]', params: { group: 'body' } }} asChild>
      <Card className="flex-row items-center py-4">
        <SettingsIcon color={COLORS.muted} size={18} strokeWidth={1.75} />
        <Text className="text-fg text-sm flex-1 ml-3">
          Hesaplamalar için vücut bilgilerini Profil'den gir
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
          <Text className="text-fg text-xl font-semibold tracking-tight">
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

  const missingHeight = 'Hesaplamak için Profil → Vücut bilgileri’nde boyunu gir';
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
      hint: 'Hesaplamak için Profil → Vücut bilgileri’nde doğum tarihini gir',
    };
  } else if (gender == null) {
    bmr = {
      label: bmrLabel,
      hint: 'Hesaplamak için Profil → Vücut bilgileri’nde cinsiyet seç',
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
      <Text className="text-muted text-[13px]">
        {label}
      </Text>
      {value != null && (
        <Text
          className="text-fg text-2xl font-bold tabular-nums tracking-tight mt-2"
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
    <Text className="text-muted text-[13px]">
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
// e) 2×2 kart + seçili metriğin grafiği
// ============================================================================

/**
 * Join'li okuma, her odaklanmada (antrenman bitince sekmeye dönüşte güncel).
 * Dönem / metrik değişince yeniden okumaz, yalnızca hesaplar.
 */
function ProgressOverview({
  period,
  metric,
  onMetric,
}: {
  period: ProgressPeriod;
  metric: ProgressMetric;
  onMetric: (m: ProgressMetric) => void;
}) {
  const db = useDb();
  const [data, setData] = useState<ProgressData | null>(null);
  const [now, setNow] = useState(() => new Date());

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setNow(new Date());
      loadProgressData(db).then((d) => {
        if (active) setData(d);
      });
      return () => {
        active = false;
      };
    }, [db])
  );

  const stats = useMemo(() => (data ? progressStats(data, period, now) : null), [data, period, now]);
  const chart = useMemo(
    () => (data ? progressChart(data, metric, period, now) : null),
    [data, metric, period, now]
  );

  if (!stats || !chart) return <View style={{ height: 320 }} />;

  return (
    <>
      <View className="flex-row flex-wrap justify-between gap-y-3">
        {stats.map((s) => (
          <StatCard
            key={s.metric}
            className="w-[48.5%]"
            label={s.label}
            value={s.value}
            unit={s.unit}
            footnote={s.footnote}
            color={METRIC_COLORS[s.metric]}
            selected={s.metric === metric}
            onPress={() => onMetric(s.metric)}
            accessibilityLabel={`${s.accessibilityLabel}. Grafikte göster`}
          />
        ))}
      </View>
      <ChartCard chart={chart} metric={metric} />
    </>
  );
}

function ChartCard({ chart, metric }: { chart: ReturnType<typeof progressChart>; metric: ProgressMetric }) {
  const tones = useContextTones(METRIC_COLORS[metric]);
  const last = chart.bars[chart.bars.length - 1]!;
  return (
    <Card className="gap-4">
      <View className="flex-row items-baseline justify-between">
        <Text className="text-fg text-base font-semibold">{chart.title}</Text>
        <Text className="text-muted text-[13px]">{chart.subtitle}</Text>
      </View>
      <View
        accessible
        accessibilityLabel={`${chart.title}, ${chart.subtitle}. Son dönem: ${chart.format(last.value)}`}
      >
        <BarChart
          bars={chart.bars.map((b, i) => ({ key: b.key, value: b.value, pending: i < chart.bars.length - 1 }))}
          color={tones.fill}
          formatY={chart.format}
          startLabel={chart.startLabel}
          endLabel={chart.endLabel}
        />
      </View>
    </Card>
  );
}

// ============================================================================
// f) Bu hafta kas başına set
// ============================================================================

/**
 * Son 7 günde biten seansların tamamlanmış normal setleri; ana kas 1,
 * yardımcı 0,5 set. En çok çalışan 6 kas yatay çubukla; harita ve tam liste
 * "Kas haritası" ekranında. Join'li → her odaklanmada okunuyor.
 */
function MuscleSetsCard() {
  const db = useDb();
  const [bars, setBars] = useState<MuscleBar[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      weeklyMuscleSetsQuery(db, weeklyWindowStart(new Date())).then((rows) => {
        if (active) setBars(muscleBars(muscleVolume(toMuscleSets(rows))));
      });
      return () => {
        active = false;
      };
    }, [db])
  );

  if (!bars) return null;

  return (
    <Card className="gap-3">
      <View className="flex-row items-center justify-between">
        <Text className="text-fg text-base font-semibold flex-1">Bu hafta kas başına set</Text>
        <Link href="/muscles" asChild>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Kas haritası"
            hitSlop={8}
            className="min-h-[44px] justify-center active:opacity-70"
          >
            <Text className="text-accent text-[13px] font-semibold">Kas haritası ›</Text>
          </Pressable>
        </Link>
      </View>
      {bars.length === 0 ? (
        <Text className="text-muted text-sm">Son 7 günde antrenman yok.</Text>
      ) : (
        <View className="gap-3">
          {bars.map((b) => (
            <MuscleBarRow key={b.muscle} bar={b} />
          ))}
        </View>
      )}
    </Card>
  );
}

function MuscleBarRow({ bar }: { bar: MuscleBar }) {
  const COLORS = useColors();
  const tones = useContextTones(bar.context ?? undefined);
  const fill = bar.context ? tones.fill : COLORS.muted;
  const label = muscleLabel(bar.muscle);
  const sets = formatDecimal(bar.sets);
  return (
    <View accessible accessibilityLabel={`${label}: ${sets} set`} className="flex-row items-center gap-3">
      <Text className="text-fg text-[15px] w-24" numberOfLines={1}>
        {label}
      </Text>
      <View className="flex-1 h-2.5 rounded-full bg-bg-elevated overflow-hidden">
        <View
          className="h-full rounded-full"
          style={{ width: `${Math.max(bar.fraction * 100, 4)}%`, backgroundColor: fill }}
        />
      </View>
      <Text className="font-display text-fg text-[15px] w-10 text-right">{sets}</Text>
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
                      <Text className="text-fg text-base font-semibold tabular-nums">
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
              <Text className="text-fg text-base" numberOfLines={1}>
                {exerciseDisplayName({ id: r.exerciseId, name: r.name, nameTr: r.nameTr })}
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
                  <Text className="text-fg text-base font-semibold tabular-nums">
                    {m.weightKg != null ? `${formatDecimal(m.weightKg)} kg` : '—'}
                  </Text>
                </View>
              }
            >
              <Text className="text-fg text-base tabular-nums">
                {formatDateKey(m.date)}
              </Text>
            </ListRow>
          </Link>
        ))}
      </Card>
    </View>
  );
}

