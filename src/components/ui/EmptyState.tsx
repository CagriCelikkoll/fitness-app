import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';

import { COLORS } from '@/theme';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className = '',
}: EmptyStateProps) {
  return (
    <View className={`items-center justify-center px-6 ${className}`}>
      {Icon && (
        <View className="w-16 h-16 rounded-full bg-bg-surface border border-border items-center justify-center mb-5">
          <Icon color={COLORS.muted} size={26} strokeWidth={1.75} />
        </View>
      )}
      <Text className="text-white text-xl font-semibold tracking-tight text-center">
        {title}
      </Text>
      {description != null && (
        <Text className="text-muted text-sm text-center mt-2 leading-5">
          {description}
        </Text>
      )}
      {action != null && <View className="mt-6">{action}</View>}
    </View>
  );
}
