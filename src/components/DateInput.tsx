/**
 * Gün / ay / yıl olarak üç ayrı sayı alanından oluşan tarih girişi.
 *
 * Kontrollü bileşen: değeri ham metin parçaları olarak tutar, doğrulama
 * yapmaz — hangi tarihin kabul edileceği (ör. ileri tarih yasağı)
 * ekrana özgü olduğu için hata mesajı dışarıdan `error` ile verilir.
 * YYYY-MM-DD'ye çevirmek için `partsToDateKey` kullanılır.
 */

import { useRef } from 'react';
import { Text, TextInput, View } from 'react-native';

import { digitsOnly, type DateParts } from '@/lib/format';

interface DateInputProps {
  label?: string;
  value: DateParts;
  onChange: (parts: DateParts) => void;
  /** Alanların altında gösterilecek hata satırı */
  error?: string | null;
}

export function DateInput({ label, value, onChange, error }: DateInputProps) {
  const monthRef = useRef<TextInput>(null);
  const yearRef = useRef<TextInput>(null);

  const handleDay = (text: string) => {
    const day = digitsOnly(text).slice(0, 2);
    onChange({ ...value, day });
    // Yalnızca hane sayısı 2'ye çıkarken ilerle; silerken odak kaçmasın
    if (day.length === 2 && value.day.length < 2) monthRef.current?.focus();
  };

  const handleMonth = (text: string) => {
    const month = digitsOnly(text).slice(0, 2);
    onChange({ ...value, month });
    if (month.length === 2 && value.month.length < 2) yearRef.current?.focus();
  };

  const handleYear = (text: string) => {
    onChange({ ...value, year: digitsOnly(text).slice(0, 4) });
  };

  const inputClass = `bg-bg-elevated text-white px-3 py-2 rounded-lg text-center ${
    error ? 'border border-red-500' : ''
  }`;

  return (
    <View>
      {label != null && <Text className="text-muted text-xs mb-1">{label}</Text>}
      <View className="flex-row items-center gap-2">
        <TextInput
          value={value.day}
          onChangeText={handleDay}
          placeholder="GG"
          placeholderTextColor="#64748b"
          keyboardType="number-pad"
          maxLength={2}
          className={`w-14 ${inputClass}`}
        />
        <Text className="text-muted">/</Text>
        <TextInput
          ref={monthRef}
          value={value.month}
          onChangeText={handleMonth}
          placeholder="AA"
          placeholderTextColor="#64748b"
          keyboardType="number-pad"
          maxLength={2}
          className={`w-14 ${inputClass}`}
        />
        <Text className="text-muted">/</Text>
        <TextInput
          ref={yearRef}
          value={value.year}
          onChangeText={handleYear}
          placeholder="YYYY"
          placeholderTextColor="#64748b"
          keyboardType="number-pad"
          maxLength={4}
          className={`w-20 ${inputClass}`}
        />
      </View>
      {error ? <Text className="text-red-400 text-xs mt-1">{error}</Text> : null}
    </View>
  );
}
