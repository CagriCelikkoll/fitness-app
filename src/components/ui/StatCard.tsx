import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useContextTones } from '@/hooks/useTheme';
import { upperTr } from '@/lib/typography';
import type { ContextKind } from '@/theme';

interface StatCardProps {
  label: string;
  value: string | number;
  unit?: string;
  /** Alt satır (ör. "geçen haftadan +12%") */
  footnote?: string;
  /** Bağlam rengi; seçiliyken kart tamamen bununla dolu. Verilmezse brand. */
  color?: ContextKind;
  selected?: boolean;
  onPress?: () => void;
  /** Ekran okuyucu için tek cümle; verilmezse "etiket: değer birim" */
  accessibilityLabel?: string;
  className?: string;
}

/**
 * v4.0a 1.5: etiket + geniş rakam. Seçili hâli bağlam rengiyle tamamen
 * dolu, yazı koyu; seçili değilken nötr kart, etiket bağlam renginde (açık
 * temada ana metin).
 */
export function StatCard({
  label,
  value,
  unit,
  footnote,
  color,
  selected = false,
  onPress,
  accessibilityLabel,
  className = '',
}: StatCardProps) {
  const tones = useContextTones(color);
  const fg = selected ? tones.onFill : undefined;
  const labelColor = selected ? tones.onFill : tones.ink;

  const body = (
    <>
      <Text className="text-xs font-bold tracking-widest" style={{ color: labelColor }}>
        {upperTr(label)}
      </Text>
      <View className="flex-row items-baseline mt-2">
        <Text
          className={`font-display text-3xl ${selected ? '' : 'text-fg'}`}
          style={fg ? { color: fg } : undefined}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {value}
        </Text>
        {unit != null && (
          <Text className={`text-sm ml-1.5 font-semibold ${selected ? '' : 'text-muted'}`} style={fg ? { color: fg } : undefined}>
            {unit}
          </Text>
        )}
      </View>
      {footnote != null && (
        <Text className={`text-xs mt-1 ${selected ? '' : 'text-muted'}`} style={fg ? { color: fg } : undefined}>
          {footnote}
        </Text>
      )}
    </>
  );

  const cls = `rounded-3xl p-4 min-h-[44px] ${selected ? '' : 'bg-bg-surface border border-border'} ${className}`;
  const style = selected ? { backgroundColor: tones.fill } : undefined;
  const a11y = accessibilityLabel ?? `${label}: ${value}${unit ? ` ${unit}` : ''}`;

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={a11y}
        className={`${cls} active:opacity-80`}
        style={style}
      >
        {body}
      </Pressable>
    );
  }
  return (
    <View accessible accessibilityLabel={a11y} className={cls} style={style}>
      {body}
    </View>
  );
}
