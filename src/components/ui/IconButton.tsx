import { Pressable, type PressableProps } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';

import { useColors } from '@/hooks/useTheme';

interface IconButtonProps extends Omit<PressableProps, 'children' | 'accessibilityLabel'> {
  icon: LucideIcon;
  /** Zorunlu (v4.0a 1.5): ekran okuyucu ikonu okuyamaz */
  accessibilityLabel: string;
  /** `surface`: kart içi dolgu (varsayılan), `ghost`: zeminsiz */
  variant?: 'surface' | 'ghost';
  /** İkon rengi; varsayılan ana metin */
  color?: string;
  iconSize?: number;
  className?: string;
}

/** 44×44, radius 14 (v4.0a 1.5) */
export function IconButton({
  icon: Icon,
  variant = 'surface',
  color,
  iconSize = 20,
  className = '',
  disabled,
  ...rest
}: IconButtonProps) {
  const COLORS = useColors();
  const bg = variant === 'surface' ? 'bg-bg-elevated' : '';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      hitSlop={4}
      className={`w-11 h-11 rounded-[14px] items-center justify-center active:opacity-70 ${bg} ${
        disabled ? 'opacity-40' : ''
      } ${className}`}
      {...rest}
    >
      <Icon color={color ?? COLORS.text} size={iconSize} strokeWidth={2} />
    </Pressable>
  );
}
