import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

interface SectionHeaderProps {
  title: string;
  description?: string;
  /** Sağ taraftaki aksiyon (ör. "Tümünü gör →") */
  action?: ReactNode;
  /** `section`: text-xl başlık, `label`: kartın dışındaki küçük harf aralıklı etiket */
  variant?: 'section' | 'label';
  /** Başlık rengini tehlike rengine çevirir */
  danger?: boolean;
  className?: string;
}

export function SectionHeader({
  title,
  description,
  action,
  variant = 'section',
  danger = false,
  className = '',
}: SectionHeaderProps) {
  const titleClass =
    variant === 'label'
      ? `text-xs uppercase tracking-widest ${danger ? 'text-danger' : 'text-muted'}`
      : `text-xl font-semibold tracking-tight ${danger ? 'text-danger' : 'text-white'}`;

  return (
    <View className={`flex-row items-end justify-between ${className}`}>
      <View className="flex-1 pr-3">
        <Text className={titleClass}>{title}</Text>
        {description != null && (
          <Text className="text-muted text-sm mt-1">{description}</Text>
        )}
      </View>
      {action}
    </View>
  );
}
