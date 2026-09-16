/**
 * İlerleme sekmesi — vücut ölçümleri.
 *
 * Yukarıdan aşağıya: güncel durum, türetilmiş metrikler, 90 günlük
 * ağırlık grafiği, ölçüm geçmişi. Profil (boy/doğum tarihi/cinsiyet)
 * artık Ayarlar sekmesinde; burada yalnızca eksikse oraya yönlendiren
 * bir satır görünüyor.
 *
 * Bilinçli olarak yalnızca ölçüm ve hesap gösteriliyor; hedef kilo,
 * kalori açığı gibi yönlendirmeler yok.
 */

import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { desc, eq } from 'drizzle-orm';
import { ChevronRight, Plus, Settings as SettingsIcon } from 'lucide-react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';

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
  formatSignedKg,
  toDateKey,
} from '@/lib/format';

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
        <ActivityIndicator color="#22c55e" />
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
      <ScrollView contentContainerClassName="p-4 gap-4 pb-28">
        <CurrentCard withWeight={withWeight} />
        <ProfileHint profile={profile} />
        <DerivedMetricsCard
          profile={profile}
          metrics={metrics}
          withWeight={withWeight}
        />
        <WeightChartCard withWeight={withWeight} />
        <HistoryCard metrics={metrics} />
      </ScrollView>

      <Link href={{ pathname: '/metrics/[date]', params: { date: 'new' } }} asChild>
        <Pressable className="absolute bottom-6 right-6 bg-accent w-14 h-14 rounded-full items-center justify-center shadow-lg">
          <Plus color="#0f172a" size={28} strokeWidth={3} />
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
      <Pressable className="bg-bg-surface rounded-xl px-4 py-3 flex-row items-center">
        <SettingsIcon color="#22c55e" size={18} />
        <Text className="text-white text-sm flex-1 ml-3">
          Hesaplamalar için profil bilgilerini Ayarlar'dan gir
        </Text>
        <ChevronRight color="#64748b" size={18} />
      </Pressable>
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
        <Pressable className="bg-bg-surface rounded-xl p-6 items-center">
          <Text className="text-white text-lg font-semibold">
            İlk ölçümünü ekle
          </Text>
          <Text className="text-muted text-center text-sm mt-1">
            Ağırlığını ve istersen çevre ölçülerini kaydet; değişim burada
            görünecek.
          </Text>
        </Pressable>
      </Link>
    );
  }

  return (
    <View className="bg-bg-surface rounded-xl p-4">
      <Text className="text-muted text-xs">Güncel ağırlık</Text>
      <View className="flex-row items-end mt-1">
        <Text className="text-white text-4xl font-bold">
          {formatDecimal(latest.weightKg)}
        </Text>
        <Text className="text-muted text-lg ml-1 mb-1">kg</Text>
      </View>
      <Text className="text-muted text-xs mt-2">
        {formatDateKey(latest.date)}
        {previous &&
          `  •  önceki ölçüme göre ${formatSignedKg(
            latest.weightKg - previous.weightKg
          )}`}
      </Text>
    </View>
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
    <View className="bg-bg-surface rounded-xl p-4 gap-4">
      <Text className="text-white font-semibold">Hesaplanan metrikler</Text>
      <MetricRow {...bmi} />
      <MetricRow {...whtr} />
      <MetricRow {...bmr} />
      <MetricRow {...lbm} />
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
    <View>
      <View className="flex-row items-baseline justify-between">
        <Text className="text-muted text-sm">{label}</Text>
        {value != null && (
          <Text className="text-white text-base font-semibold">{value}</Text>
        )}
      </View>
      {hint != null && value == null && (
        <Text className="text-accent text-xs mt-0.5">{hint}</Text>
      )}
      {(detail != null || note != null) && value != null && (
        <Text className="text-muted text-xs mt-0.5">
          {[detail, note].filter(Boolean).join('  •  ')}
        </Text>
      )}
    </View>
  );
}

// ============================================================================
// d) Ağırlık grafiği (son 90 gün)
// ============================================================================

const CHART_HEIGHT = 140;
const CHART_PAD = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

function dateKeyToTime(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

function WeightChartCard({
  withWeight,
}: {
  withWeight: (BodyMetric & { weightKg: number })[];
}) {
  const [width, setWidth] = useState(0);

  const cutoff = toDateKey(new Date(Date.now() - 90 * DAY_MS));
  // Liste tarihe göre azalan geliyor; grafik için artan sıraya çevir
  const points = withWeight.filter((m) => m.date >= cutoff).reverse();

  const header = (
    <Text className="text-white font-semibold">Ağırlık — son 90 gün</Text>
  );

  if (points.length < 2) {
    return (
      <View className="bg-bg-surface rounded-xl p-4 gap-2">
        {header}
        <Text className="text-muted text-sm">
          Grafik için en az iki ölçüm gerekli.
        </Text>
      </View>
    );
  }

  const weights = points.map((p) => p.weightKg);
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  // Düz çizgide ölçek sıfıra bölünmesin
  const span = max - min || 1;

  const t0 = dateKeyToTime(points[0].date);
  const tSpan = dateKeyToTime(points[points.length - 1].date) - t0 || 1;

  const innerW = Math.max(width - CHART_PAD * 2, 0);
  const innerH = CHART_HEIGHT - CHART_PAD * 2;
  const coords = points.map((p) => ({
    x: CHART_PAD + ((dateKeyToTime(p.date) - t0) / tSpan) * innerW,
    y: CHART_PAD + (1 - (p.weightKg - min) / span) * innerH,
  }));

  return (
    <View className="bg-bg-surface rounded-xl p-4 gap-2">
      {header}
      <View className="flex-row">
        <View className="justify-between mr-2" style={{ height: CHART_HEIGHT }}>
          <Text className="text-muted text-xs">{formatDecimal(max)}</Text>
          <Text className="text-muted text-xs">{formatDecimal(min)}</Text>
        </View>
        <View
          className="flex-1"
          style={{ height: CHART_HEIGHT }}
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        >
          {width > 0 && (
            <Svg width={width} height={CHART_HEIGHT}>
              <Polyline
                points={coords.map((c) => `${c.x},${c.y}`).join(' ')}
                fill="none"
                stroke="#22c55e"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {coords.map((c, i) => (
                <Circle key={i} cx={c.x} cy={c.y} r={3} fill="#22c55e" />
              ))}
            </Svg>
          )}
        </View>
      </View>
      <View className="flex-row justify-between">
        <Text className="text-muted text-xs">{formatDateKey(points[0].date)}</Text>
        <Text className="text-muted text-xs">
          {formatDateKey(points[points.length - 1].date)}
        </Text>
      </View>
    </View>
  );
}

// ============================================================================
// e) Ölçüm geçmişi
// ============================================================================

function HistoryCard({ metrics }: { metrics: BodyMetric[] }) {
  if (metrics.length === 0) return null;

  return (
    <View className="gap-2">
      <Text className="text-white font-semibold px-1">Ölçüm geçmişi</Text>
      {metrics.map((m) => (
        <Link
          key={m.id}
          href={{ pathname: '/metrics/[date]', params: { date: m.date } }}
          asChild
        >
          <Pressable className="bg-bg-surface rounded-xl px-4 py-3 flex-row items-center">
            <Text className="text-white flex-1">{formatDateKey(m.date)}</Text>
            {m.bodyFatPct != null && (
              <Text className="text-muted text-sm mr-3">
                %{formatDecimal(m.bodyFatPct)}
              </Text>
            )}
            <Text className="text-white font-semibold mr-2">
              {m.weightKg != null ? `${formatDecimal(m.weightKg)} kg` : '—'}
            </Text>
            <ChevronRight color="#64748b" size={18} />
          </Pressable>
        </Link>
      ))}
    </View>
  );
}

