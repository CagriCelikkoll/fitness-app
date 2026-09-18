import { Text, View } from 'react-native';

import { Card, type CardVariant } from './Card';

interface StatTileProps {
  label: string;
  value: string | number;
  unit?: string;
  variant?: CardVariant;
  /** `lg`: text-4xl değer (varsayılan), `sm`: ızgaradaki küçük kartlar */
  size?: 'lg' | 'sm' | 'xl';
  /** Değerin altındaki küçük açıklama satırı */
  footnote?: string;
  className?: string;
}

const VALUE_SIZE = { sm: 'text-2xl', lg: 'text-4xl', xl: 'text-6xl' } as const;

/** Etiket + iri değer + opsiyonel birim */
export function StatTile({
  label,
  value,
  unit,
  variant = 'default',
  size = 'lg',
  footnote,
  className = '',
}: StatTileProps) {
  const onAccent = variant === 'accent';
  const labelColor = onAccent ? 'text-accent-fg/70' : 'text-muted';
  const valueColor = onAccent ? 'text-accent-fg' : 'text-white';

  return (
    <Card variant={variant} className={`justify-between ${className}`}>
      <Text className={`text-xs uppercase tracking-widest ${labelColor}`}>
        {label}
      </Text>
      <View className="flex-row items-baseline mt-3">
        <Text
          className={`${VALUE_SIZE[size]} font-bold tabular-nums tracking-tight ${valueColor}`}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {value}
        </Text>
        {unit != null && (
          <Text className={`${size === 'xl' ? 'text-xl' : 'text-base'} ml-1.5 ${labelColor}`}>
            {unit}
          </Text>
        )}
      </View>
      {footnote != null && (
        <Text className={`text-xs mt-2 tabular-nums ${labelColor}`}>
          {footnote}
        </Text>
      )}
    </Card>
  );
}
