import { Pressable, Text, View } from 'react-native';

interface ChipProps {
  label: string;
  active?: boolean;
  /** Verilmezse salt görüntü çipi */
  onPress?: () => void;
  size?: 'sm' | 'md';
}

export function Chip({ label, active = false, onPress, size = 'md' }: ChipProps) {
  const cls = `rounded-full ${size === 'md' ? 'px-4 h-9' : 'px-3 h-7'} justify-center ${
    active ? 'bg-accent' : 'bg-bg-elevated border border-border'
  }`;
  const text = (
    <Text
      className={`${size === 'md' ? 'text-sm' : 'text-xs'} font-medium ${
        active ? 'text-accent-fg' : 'text-white'
      }`}
    >
      {label}
    </Text>
  );

  if (!onPress) return <View className={cls}>{text}</View>;

  return (
    <Pressable onPress={onPress} hitSlop={6} className={`${cls} active:opacity-80`}>
      {text}
    </Pressable>
  );
}
