import { Text, TextInput, View } from 'react-native';

import { useColors } from '@/hooks/useTheme';

/** Etiketli kısa sayı alanı (rutin ve program editörü: set, tekrar, dinlenme) */
export function NumberField({
  label,
  value,
  onChange,
  placeholder,
  keyboardType = 'number-pad',
  maxLength,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'number-pad' | 'decimal-pad' | 'default';
  maxLength?: number;
  /** Pasif: düzenlenemez ve soluk (değer korunur) */
  disabled?: boolean;
}) {
  const COLORS = useColors();
  return (
    <View className={`flex-1 ${disabled ? 'opacity-40' : ''}`}>
      <Text className="text-muted text-xs mb-2">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={COLORS.muted}
        keyboardType={keyboardType}
        maxLength={maxLength}
        editable={!disabled}
        className="bg-bg-elevated text-fg text-base tabular-nums px-4 h-12 rounded-xl"
      />
    </View>
  );
}
