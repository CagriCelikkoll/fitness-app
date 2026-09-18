import type { ReactNode } from 'react';
import { Pressable, View, type PressableProps } from 'react-native';
import { ChevronRight } from 'lucide-react-native';

import { COLORS } from '@/theme';

interface ListRowProps extends Omit<PressableProps, 'children'> {
  children: ReactNode;
  /** Sağ taraftaki içerik (değer, rozet …) */
  right?: ReactNode;
  /** Sağda soluk ok göster */
  chevron?: boolean;
  /** Üstte ince ayraç çiz (listede ilk satır hariç) */
  divider?: boolean;
  className?: string;
}

/**
 * Sol içerik + sağ içerik satırı. `onPress` verilirse (ya da
 * `<Link asChild>` içine konursa) basılabilir.
 */
export function ListRow({
  children,
  right,
  chevron = false,
  divider = false,
  className = '',
  onPress,
  ...rest
}: ListRowProps) {
  const cls = `min-h-[52px] flex-row items-center py-3 ${
    divider ? 'border-t border-border' : ''
  } ${className}`;

  const content = (
    <>
      <View className="flex-1">{children}</View>
      {right != null && <View className="ml-3">{right}</View>}
      {chevron && (
        <View className="ml-2">
          <ChevronRight color={COLORS.muted} size={18} />
        </View>
      )}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        className={`${cls} active:opacity-70`}
        {...rest}
      >
        {content}
      </Pressable>
    );
  }

  return <View className={cls}>{content}</View>;
}
