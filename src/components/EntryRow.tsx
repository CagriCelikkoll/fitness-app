import { Pressable, type PressableProps } from 'react-native';
import { ChevronRight, type LucideIcon } from 'lucide-react-native';

import { Text } from '@/components/ui/Text';
import { useColors } from '@/hooks/useTheme';

/** Liste üstündeki giriş satırı. `Link asChild` dokunuşu `rest` ile veriyor. */
export function EntryRow({
  icon: Icon,
  label,
  brand = false,
  ...rest
}: { icon: LucideIcon; label: string; brand?: boolean } & PressableProps) {
  const COLORS = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      className={`flex-row items-center gap-3 px-4 h-14 rounded-2xl border active:opacity-70 ${
        brand ? 'border-accent' : 'bg-bg-surface border-border'
      }`}
      {...rest}
    >
      <Icon color={brand ? COLORS.accent : COLORS.muted} size={19} strokeWidth={2} />
      <Text className="flex-1 text-fg text-[15px] font-bold">{label}</Text>
      <ChevronRight color={COLORS.muted} size={18} />
    </Pressable>
  );
}
