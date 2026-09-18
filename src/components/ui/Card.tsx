import type { ReactNode } from 'react';
import { Pressable, View, type PressableProps } from 'react-native';

export type CardVariant = 'default' | 'accent' | 'outline';

const VARIANT_CLASS: Record<CardVariant, string> = {
  default: 'bg-bg-surface border border-border',
  accent: 'bg-accent',
  outline: 'bg-bg-surface border-2 border-accent',
};

export interface CardProps extends Omit<PressableProps, 'children'> {
  variant?: CardVariant;
  /** İç boşluğu kaldırır (ör. içinde tam genişlik satırlar varsa) */
  flush?: boolean;
  className?: string;
  children?: ReactNode;
}

/**
 * Temel kart yüzeyi. `onPress` verilirse (ya da `<Link asChild>` içine
 * konursa) basılabilir olur; aksi halde düz View.
 */
export function Card({
  variant = 'default',
  flush = false,
  className = '',
  children,
  onPress,
  ...rest
}: CardProps) {
  const cls = `rounded-3xl ${flush ? '' : 'p-5'} ${VARIANT_CLASS[variant]} ${className}`;

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        className={`${cls} active:opacity-80`}
        {...rest}
      >
        {children}
      </Pressable>
    );
  }

  return <View className={cls}>{children}</View>;
}
