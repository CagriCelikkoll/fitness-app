import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useContextTones, useTheme } from '@/hooks/useTheme';
import { withAlpha } from '@/lib/color';
import type { ContextKind } from '@/theme';

interface ChipProps {
  label: string;
  /** Dolu çip (seçili filtre, bilgi rozeti) */
  active?: boolean;
  /** Dolu çipin bağlam rengi; verilmezse brand */
  color?: ContextKind;
  /** Verilmezse salt görüntü çipi */
  onPress?: () => void;
  size?: 'sm' | 'md';
}

/** Dolu çipin zemini: bağlam renginin %14'ü (v4.0a 1.5) */
export const CHIP_TINT_ALPHA = 0.14;

/**
 * v4.0a 1.5: dolu = bağlam renginin %14 opaklığı + renkli yazı;
 * kenarlıklı = nötr. Açık temada renk yazı olamaz: dolu çip düz dolgu +
 * koyu yazı.
 */
export function Chip({ label, active = false, color, onPress, size = 'md' }: ChipProps) {
  const { scheme } = useTheme();
  const tones = useContextTones(color);
  const filled = active
    ? scheme === 'dark'
      ? { backgroundColor: withAlpha(tones.fill, CHIP_TINT_ALPHA), color: tones.ink }
      : { backgroundColor: tones.fill, color: tones.onFill }
    : null;

  // Basılabilir çip en az 44 dokunma alanı (hitSlop)
  const cls = `rounded-full ${size === 'md' ? 'px-4 h-9' : 'px-3 h-7'} justify-center ${
    filled ? '' : 'bg-bg-elevated border border-border'
  }`;
  const text = (
    <Text
      className={`${size === 'md' ? 'text-sm' : 'text-xs'} font-semibold ${filled ? '' : 'text-fg'}`}
      style={filled ? { color: filled.color } : undefined}
    >
      {label}
    </Text>
  );
  const bgStyle = filled ? { backgroundColor: filled.backgroundColor } : undefined;

  if (!onPress) {
    return (
      <View className={cls} style={bgStyle}>
        {text}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      hitSlop={size === 'md' ? 4 : 8}
      className={`${cls} active:opacity-80`}
      style={bgStyle}
    >
      {text}
    </Pressable>
  );
}
