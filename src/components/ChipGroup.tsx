import { Text, View } from 'react-native';

import { Chip } from '@/components/ui';

/** Etiketli tek seçimli çip grubu (Ayarlar, karşılama) */
export function ChipGroup<T extends string>({
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
