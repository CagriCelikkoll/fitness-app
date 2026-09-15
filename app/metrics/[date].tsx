/**
 * Vücut ölçümü ekleme VE düzenleme — tek ekran.
 *
 * Route: /metrics/new        → bugünün tarihiyle boş form
 *        /metrics/2026-09-10 → o günün kaydını yükle, düzenle
 *
 * body_metrics.date unique olduğu için günde tek kayıt var; kaydetme
 * date üzerinden upsert yapar. Seçilen tarihte başka bir kayıt varsa
 * kullanıcıdan üzerine yazma onayı alınır. Düzenlemede tarih
 * değiştirilirse eski günün kaydı aynı transaction içinde silinir.
 */

import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { eq } from 'drizzle-orm';
import { Trash2 } from 'lucide-react-native';

import { useDb } from '@/hooks/useDb';
import { bodyMetrics } from '@/db/schema';
import { newId } from '@/lib/id';
import { DateInput } from '@/components/DateInput';
import {
  DEFAULT_MAX_DECIMAL_DIGITS,
  dateKeyToParts,
  formatDateKey,
  getDateInputError,
  partsToDateKey,
  sanitizeDecimalInput,
  toDateKey,
  type DateParts,
} from '@/lib/format';

interface MetricsForm {
  weightKg: string;
  bodyFatPct: string;
  waistCm: string;
  chestCm: string;
  armCm: string;
  thighCm: string;
  hipCm: string;
  neckCm: string;
  notes: string;
}

const MEASUREMENT_FIELDS: { key: keyof MetricsForm; label: string }[] = [
  { key: 'waistCm', label: 'Bel (cm)' },
  { key: 'chestCm', label: 'Göğüs (cm)' },
  { key: 'armCm', label: 'Kol (cm)' },
  { key: 'thighCm', label: 'Uyluk (cm)' },
  { key: 'hipCm', label: 'Kalça (cm)' },
  { key: 'neckCm', label: 'Boyun (cm)' },
];

const EMPTY_FORM: MetricsForm = {
  weightKg: '',
  bodyFatPct: '',
  waistCm: '',
  chestCm: '',
  armCm: '',
  thighCm: '',
  hipCm: '',
  neckCm: '',
  notes: '',
};

/** Ölçüm kaydı için en erken yıl — daha eskisi büyük olasılıkla yazım hatası */
const MEASUREMENT_MIN_YEAR = 2000;

function getDateError(parts: DateParts, submitted: boolean): string | null {
  return getDateInputError(parts, {
    minYear: MEASUREMENT_MIN_YEAR,
    submitted,
    futureError: 'İleri bir tarihe ölçüm girilemez.',
  });
}

/**
 * Ondalık olarak girilen ölçüm alanları (not hariç) ve her birinde
 * izin verilen en fazla ondalık hane. 0,5 kg / 0,5 cm hassasiyeti yeterli.
 */
const DECIMAL_FIELD_DIGITS: Partial<Record<keyof MetricsForm, number>> = {
  weightKg: DEFAULT_MAX_DECIMAL_DIGITS,
  bodyFatPct: DEFAULT_MAX_DECIMAL_DIGITS,
  waistCm: DEFAULT_MAX_DECIMAL_DIGITS,
  chestCm: DEFAULT_MAX_DECIMAL_DIGITS,
  armCm: DEFAULT_MAX_DECIMAL_DIGITS,
  thighCm: DEFAULT_MAX_DECIMAL_DIGITS,
  hipCm: DEFAULT_MAX_DECIMAL_DIGITS,
  neckCm: DEFAULT_MAX_DECIMAL_DIGITS,
};

function numToField(n: number | null): string {
  return n != null ? String(n) : '';
}

export default function MetricsEditorScreen() {
  const { date: dateParam } = useLocalSearchParams<{ date: string }>();
  const router = useRouter();
  const db = useDb();

  const isNew = !dateParam || dateParam === 'new';

  const [form, setForm] = useState<MetricsForm>(EMPTY_FORM);
  const [dateParts, setDateParts] = useState<DateParts>(() =>
    dateKeyToParts(isNew ? toDateKey(new Date()) : dateParam!)
  );
  const [submitted, setSubmitted] = useState(false);
  const [originalId, setOriginalId] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);

  // Düzenleme modunda o günün kaydını yükle
  useEffect(() => {
    if (isNew) return;
    let cancelled = false;

    (async () => {
      try {
        const rows = await db
          .select()
          .from(bodyMetrics)
          .where(eq(bodyMetrics.date, dateParam!))
          .limit(1);
        if (cancelled) return;

        const row = rows[0];
        if (!row) {
          setNotFound(true);
          setLoading(false);
          return;
        }

        setOriginalId(row.id);
        setDateParts(dateKeyToParts(row.date));
        setForm({
          weightKg: numToField(row.weightKg),
          bodyFatPct: numToField(row.bodyFatPct),
          waistCm: numToField(row.waistCm),
          chestCm: numToField(row.chestCm),
          armCm: numToField(row.armCm),
          thighCm: numToField(row.thighCm),
          hipCm: numToField(row.hipCm),
          neckCm: numToField(row.neckCm),
          notes: row.notes ?? '',
        });
        setLoading(false);
      } catch (err) {
        console.error('[METRICS-EDIT] Yükleme hatası:', err);
        if (!cancelled) {
          Alert.alert('Hata', 'Ölçüm yüklenemedi: ' + String(err));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [db, dateParam, isNew]);

  const update = (key: keyof MetricsForm, value: string) => {
    const maxDecimals = DECIMAL_FIELD_DIGITS[key];
    setForm((prev) => ({
      ...prev,
      [key]:
        maxDecimals != null
          ? sanitizeDecimalInput(value, prev[key], maxDecimals)
          : value,
    }));
  };

  const dateError = getDateError(dateParts, submitted);

  const persist = async (
    date: string,
    values: Omit<typeof bodyMetrics.$inferInsert, 'id' | 'date'>
  ) => {
    setSaving(true);
    try {
      await db.transaction(async (tx) => {
        // Düzenlemede tarih taşındıysa eski günün kaydını kaldır
        if (originalId && date !== dateParam) {
          await tx.delete(bodyMetrics).where(eq(bodyMetrics.id, originalId));
        }
        // Çakışmada mevcut satırın id'si korunur, alanları güncellenir
        await tx
          .insert(bodyMetrics)
          .values({ id: newId(), date, ...values })
          .onConflictDoUpdate({ target: bodyMetrics.date, set: values });
      });
      router.back();
    } catch (err) {
      console.error('[METRICS-SAVE] HATA:', err);
      Alert.alert('Kaydetme hatası', String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    // Tarih hatası Alert yerine alanların altında gösteriliyor
    setSubmitted(true);
    const date = partsToDateKey(dateParts);
    if (date == null || getDateError(dateParts, true) != null) return;

    const weightKg = parseFloatOrNull(form.weightKg);
    if (weightKg == null || weightKg <= 0) {
      Alert.alert('Hata', 'Ağırlık girmen gerekiyor.');
      return;
    }

    const bodyFatPct = parseFloatOrNull(form.bodyFatPct);
    if (bodyFatPct != null && (bodyFatPct <= 0 || bodyFatPct >= 100)) {
      Alert.alert('Hata', 'Yağ oranı 0 ile 100 arasında olmalı.');
      return;
    }

    const measurements: Record<string, number | null> = {};
    for (const { key, label } of MEASUREMENT_FIELDS) {
      const v = parseFloatOrNull(form[key]);
      if (v != null && v <= 0) {
        Alert.alert('Hata', `${label} sıfırdan büyük olmalı.`);
        return;
      }
      measurements[key] = v;
    }

    const values = {
      weightKg,
      bodyFatPct,
      waistCm: measurements.waistCm,
      chestCm: measurements.chestCm,
      armCm: measurements.armCm,
      thighCm: measurements.thighCm,
      hipCm: measurements.hipCm,
      neckCm: measurements.neckCm,
      notes: form.notes.trim() || null,
    };

    try {
      const existing = await db
        .select({ id: bodyMetrics.id })
        .from(bodyMetrics)
        .where(eq(bodyMetrics.date, date))
        .limit(1);

      const overwritesOther =
        existing[0] != null && existing[0].id !== originalId;

      if (overwritesOther) {
        Alert.alert(
          'Bu tarihte kayıt var',
          `${formatDateKey(date)} için zaten bir ölçüm var. Üzerine yazılsın mı?`,
          [
            { text: 'Vazgeç', style: 'cancel' },
            {
              text: 'Üzerine yaz',
              style: 'destructive',
              onPress: () => persist(date, values),
            },
          ]
        );
        return;
      }
    } catch (err) {
      console.error('[METRICS-SAVE] HATA:', err);
      Alert.alert('Kaydetme hatası', String(err));
      return;
    }

    await persist(date, values);
  };

  const handleDelete = () => {
    if (!originalId) return;
    Alert.alert(
      'Kaydı sil',
      `${formatDateKey(dateParam!)} tarihli ölçüm silinecek.`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Sil',
          style: 'destructive',
          onPress: async () => {
            try {
              await db
                .delete(bodyMetrics)
                .where(eq(bodyMetrics.id, originalId));
              router.back();
            } catch (err) {
              console.error('[METRICS-DELETE] HATA:', err);
              Alert.alert('Silme hatası', String(err));
            }
          },
        },
      ]
    );
  };

  if (notFound) {
    return (
      <>
        <Stack.Screen options={{ title: 'Ölçüm' }} />
        <View className="flex-1 bg-bg items-center justify-center p-6">
          <Text className="text-muted text-center">
            Bu tarihte ölçüm bulunamadı. Silinmiş olabilir.
          </Text>
        </View>
      </>
    );
  }

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Ölçüm' }} />
        <View className="flex-1 bg-bg items-center justify-center">
          <ActivityIndicator color="#22c55e" />
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: isNew ? 'Yeni Ölçüm' : 'Ölçümü Düzenle',
          headerRight: () => (
            <Pressable
              onPress={handleSave}
              disabled={saving}
              className="mr-2"
              hitSlop={8}
            >
              <Text
                className={`font-semibold ${
                  saving ? 'text-muted' : 'text-accent'
                }`}
              >
                {saving ? 'Kaydediliyor...' : 'Kaydet'}
              </Text>
            </Pressable>
          ),
        }}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 bg-bg"
      >
        <ScrollView
          className="flex-1"
          contentContainerClassName="p-4 gap-4 pb-32"
          keyboardShouldPersistTaps="handled"
        >
          <View className="bg-bg-surface rounded-xl p-4 gap-3">
            <DateInput
              label="Tarih"
              value={dateParts}
              onChange={setDateParts}
              error={dateError}
            />
            <View className="flex-row gap-2">
              <DecimalField
                label="Ağırlık (kg)"
                value={form.weightKg}
                onChange={(v) => update('weightKg', v)}
                placeholder="zorunlu"
              />
              <DecimalField
                label="Yağ oranı (%)"
                value={form.bodyFatPct}
                onChange={(v) => update('bodyFatPct', v)}
                placeholder="ops."
              />
            </View>
          </View>

          <View className="bg-bg-surface rounded-xl p-4 gap-3">
            <Text className="text-white font-semibold">
              Çevre ölçümleri{' '}
              <Text className="text-muted text-xs font-normal">(opsiyonel)</Text>
            </Text>
            {[0, 2, 4].map((i) => (
              <View key={i} className="flex-row gap-2">
                {MEASUREMENT_FIELDS.slice(i, i + 2).map(({ key, label }) => (
                  <DecimalField
                    key={key}
                    label={label}
                    value={form[key]}
                    onChange={(v) => update(key, v)}
                    placeholder="ops."
                  />
                ))}
              </View>
            ))}
          </View>

          <View className="bg-bg-surface rounded-xl p-4">
            <Text className="text-muted text-xs mb-1">Not (opsiyonel)</Text>
            <TextInput
              value={form.notes}
              onChangeText={(v) => update('notes', v)}
              placeholder="Sabah aç karnına"
              placeholderTextColor="#64748b"
              className="text-white"
              multiline
            />
          </View>

          {!isNew && (
            <Pressable
              onPress={handleDelete}
              className="bg-bg-surface border border-red-500/40 rounded-xl p-4 flex-row items-center justify-center"
            >
              <Trash2 color="#ef4444" size={18} />
              <Text className="text-red-500 font-semibold ml-2">Kaydı Sil</Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

/** Ondalık ölçüm alanı. Girişi temizlemek `update`'in işi. */
function DecimalField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <View className="flex-1">
      <Text className="text-muted text-xs mb-1">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#64748b"
        keyboardType="decimal-pad"
        className="bg-bg-elevated text-white px-3 py-2 rounded-lg"
      />
    </View>
  );
}

function parseFloatOrNull(v: string): number | null {
  const trimmed = v.trim().replace(',', '.');
  if (!trimmed) return null;
  const n = parseFloat(trimmed);
  return isNaN(n) ? null : n;
}
