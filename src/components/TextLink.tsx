import { Pressable, Text } from 'react-native';

/** Vurgu renginde metin bağlantısı (uygulama içi ekrana gider) */
export function TextLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="link"
      className="self-start py-1 active:opacity-60"
    >
      <Text className="text-accent text-sm font-semibold">{label}</Text>
    </Pressable>
  );
}
