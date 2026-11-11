import { useWindowDimensions, type TextProps } from 'react-native';

import { Text } from '@/components/ui/Text';
import { NAME_MAX_LINES, NAME_SIZES, nameCase, nameFontSize } from '@/lib/typography';

interface DisplayNameProps extends Pick<TextProps, 'accessibilityRole' | 'style'> {
  children: string;
  /** Ekran genişliğinden düşülecek toplam yatay boşluk (padding, ikon) */
  inset: number;
  sizes?: readonly number[];
  className?: string;
}

/**
 * Hareket, rutin ve program adı (v4.0b 1.5): geniş kalın yazı, büyük harfe
 * çevrilmez. Kelime ortasından kırılmaz: boyut, en uzun kelime satıra
 * sığacak şekilde kademeli seçilir; en fazla 3 satır.
 */
export function DisplayName({ children, inset, sizes = NAME_SIZES, className = '', style, ...rest }: DisplayNameProps) {
  const { width } = useWindowDimensions();
  const fontSize = nameFontSize(children, width - inset, sizes);
  return (
    <Text
      {...rest}
      numberOfLines={NAME_MAX_LINES}
      textBreakStrategy="simple"
      android_hyphenationFrequency="none"
      className={`font-display text-fg ${className}`}
      style={[{ fontSize, lineHeight: Math.round(fontSize * 1.12) }, style]}
    >
      {nameCase(children)}
    </Text>
  );
}
