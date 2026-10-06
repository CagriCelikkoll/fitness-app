/**
 * Profil formu (boy / doğum tarihi / cinsiyet): Ayarlar'daki Profil
 * bölümü ve karşılama akışı aynı alanları ve doğrulamayı kullanıyor.
 *
 * Durum `useProfileForm`'da, alanlar `ProfileFields`'ta. Kaydet düğmesi
 * çağıranın: Ayarlar'da "Profili Kaydet", karşılamada "Devam".
 */

import { useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';

import type { AppSettings } from '@/db/schema';
import { useDb } from '@/hooks/useDb';
import { saveSettings } from '@/lib/appSettings';
import { calculateAge } from '@/lib/bodyMetrics';
import {
  dateKeyToParts,
  getDateInputError,
  partsToDateKey,
  sanitizeDecimalInput,
  type DateParts,
} from '@/lib/format';
import { DateInput } from '@/components/DateInput';
import { ChipGroup } from '@/components/ChipGroup';
import { COLORS } from '@/theme';

type Gender = 'male' | 'female' | 'unspecified';

/** Doğum tarihi için en erken yıl */
const BIRTH_DATE_MIN_YEAR = 1900;

const EMPTY_DATE_PARTS: DateParts = { day: '', month: '', year: '' };

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: 'male', label: 'Erkek' },
  { value: 'female', label: 'Kadın' },
  { value: 'unspecified', label: 'Belirtmek istemiyorum' },
];

/** Boy sınırları (cm) */
const MIN_HEIGHT_CM = 50;
const MAX_HEIGHT_CM = 272;

const INPUT_CLASS =
  'bg-bg-elevated text-white text-base tabular-nums px-4 h-12 rounded-xl';

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

function parseFloatOrNull(v: string): number | null {
  const trimmed = v.trim().replace(',', '.');
  if (!trimmed) return null;
  const n = parseFloat(trimmed);
  return isNaN(n) ? null : n;
}

export type ProfileFormState = ReturnType<typeof useProfileForm>;

/**
 * Form durumu kayıtlı ayarlardan bir kez kurulur; ayarlar değişince
 * yeniden kurulsun isteniyorsa çağıran `key` ile yeniden mount etmeli.
 */
export function useProfileForm(settings?: AppSettings) {
  const db = useDb();

  const [height, setHeightRaw] = useState(
    settings?.heightCm != null ? String(settings.heightCm) : ''
  );
  const [birthParts, setBirthPartsRaw] = useState<DateParts>(
    settings?.birthDate ? dateKeyToParts(settings.birthDate) : EMPTY_DATE_PARTS
  );
  const [birthSubmitted, setBirthSubmitted] = useState(false);
  const [gender, setGenderRaw] = useState<Gender | null>(
    (settings?.gender as Gender | null) ?? null
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // "Kaydedildi" etiketi yeni bir değişiklikte kaybolsun
  const setHeight = (v: string) => {
    setSaved(false);
    setHeightRaw((prev) => sanitizeDecimalInput(v, prev));
  };
  const setBirthParts = (parts: DateParts) => {
    setSaved(false);
    setBirthPartsRaw(parts);
  };
  const setGender = (v: Gender) => {
    setSaved(false);
    setGenderRaw(v);
  };

  /** Doğrular ve kaydeder. Geçersiz giriş ya da hata varsa false. */
  const save = async (): Promise<boolean> => {
    const heightCm = parseFloatOrNull(height);
    if (
      heightCm != null &&
      (heightCm < MIN_HEIGHT_CM || heightCm > MAX_HEIGHT_CM)
    ) {
      Alert.alert('Hata', 'Boyu santimetre olarak gir (ör. 178).');
      return false;
    }
    // Doğum tarihi hatası Alert yerine alanların altında gösteriliyor
    setBirthSubmitted(true);
    if (getBirthDateError(birthParts, true) != null) return false;

    setSaving(true);
    try {
      await saveSettings(db, {
        heightCm,
        birthDate: partsToDateKey(birthParts), // üç alan da boşsa null
        gender,
      });
      setSaved(true);
      return true;
    } catch (err) {
      console.error('[SETTINGS-SAVE] HATA:', err);
      Alert.alert('Kaydetme hatası', String(err));
      return false;
    } finally {
      setSaving(false);
    }
  };

  return {
    settings,
    height,
    setHeight,
    birthParts,
    setBirthParts,
    birthError: getBirthDateError(birthParts, birthSubmitted),
    gender,
    setGender,
    saving,
    saved,
    save,
  };
}

export function ProfileFields({ form }: { form: ProfileFormState }) {
  const age = form.settings?.birthDate
    ? calculateAge(form.settings.birthDate)
    : null;

  return (
    <>
      {/* DateInput üç alanıyla yarım satıra sığmadığı için boy ayrı satırda */}
      <View>
        <Text className="text-muted text-xs mb-2">Boy (cm)</Text>
        <TextInput
          value={form.height}
          onChangeText={form.setHeight}
          placeholder="178"
          placeholderTextColor={COLORS.muted}
          keyboardType="decimal-pad"
          className={`${INPUT_CLASS} w-28`}
        />
      </View>

      <DateInput
        label="Doğum tarihi"
        value={form.birthParts}
        onChange={form.setBirthParts}
        error={form.birthError}
      />
      {age != null && (
        <Text className="text-muted text-xs -mt-2 tabular-nums">
          Kayıtlı yaş: {age}
        </Text>
      )}

      <ChipGroup
        label="Cinsiyet"
        options={GENDER_OPTIONS}
        value={form.gender}
        onChange={form.setGender}
      />
    </>
  );
}
