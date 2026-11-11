import { useId, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { useColors } from '@/hooks/useTheme';
import { COVER_GRADIENTS, type CoverKey, type CoverVariant } from '@/lib/coverImage';

/** Paketin içinde: internetsiz de görünür, OTA ile gider */
const COVER_SOURCES: Record<CoverKey, number> = {
  karsilama: require('../../assets/images/kapak/karsilama.webp'),
  'karsilama-2-kayit': require('../../assets/images/kapak/karsilama-2-kayit.webp'),
  'karsilama-3-gelisim': require('../../assets/images/kapak/karsilama-3-gelisim.webp'),
  rekor: require('../../assets/images/kapak/rekor.webp'),
  'rutin-ust-bench': require('../../assets/images/kapak/rutin-ust-bench.webp'),
  'rutin-ust-row': require('../../assets/images/kapak/rutin-ust-row.webp'),
  'ust-barfiks': require('../../assets/images/kapak/ust-barfiks.webp'),
  'ust-omuz-press': require('../../assets/images/kapak/ust-omuz-press.webp'),
  'alt-squat': require('../../assets/images/kapak/alt-squat.webp'),
  'alt-deadlift': require('../../assets/images/kapak/alt-deadlift.webp'),
  'alt-lunge': require('../../assets/images/kapak/alt-lunge.webp'),
  'fullbody-farmer': require('../../assets/images/kapak/fullbody-farmer.webp'),
  'kardiyo-kurek': require('../../assets/images/kapak/kardiyo-kurek.webp'),
};

/**
 * Kapak görseli (v4.0b Bölüm 2): görsel + aşağı doğru zemine geçen karartma,
 * `children` karartmanın üstünde. Süsleme: ekran okuyucu görmez, adı
 * üstündeki yazıdan okur.
 */
export function CoverImage({
  cover,
  variant = 'card',
  className,
  style,
  children,
}: {
  cover: CoverKey;
  variant?: CoverVariant;
  className?: string;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  const COLORS = useColors();
  const id = `cover${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <View className={`overflow-hidden bg-bg-elevated ${className ?? ''}`} style={style}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Image source={COVER_SOURCES[cover]} style={StyleSheet.absoluteFill} contentFit="cover" />
        <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              {COVER_GRADIENTS[variant].map((s) => (
                <Stop key={s.offset} offset={s.offset} stopColor={COLORS.bg} stopOpacity={s.opacity} />
              ))}
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width="100%" height="100%" fill={`url(#${id})`} />
        </Svg>
      </View>
      {children}
    </View>
  );
}
