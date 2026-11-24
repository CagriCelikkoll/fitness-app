/**
 * Paylaşım kartı çizimi (0.13 Bölüm 3). Veri ve ölçüler `src/lib/shareCard.ts`
 * (1080 × 1920 piksel birimi); bileşen verilen genişliğe ölçekler. Aynı
 * bileşen önizlemede küçük, görüntü alırken tam boy çiziliyor.
 *
 * Her temada koyu (fotoğraf ve ışık koyu zeminde). Kullanıcı bilgisi yok.
 */

import { forwardRef, useId } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { Trophy } from 'lucide-react-native';

import { CoverImage } from '@/components/CoverImage';
import { Text } from '@/components/ui/Text';
import { DarkSurface, useColors, useContextTones } from '@/hooks/useTheme';
import {
  SAFE_BOTTOM,
  SAFE_TOP,
  SHARE_CARD_HEIGHT,
  SHARE_CARD_WIDTH,
  SHARE_FOOTER,
  SIDE_PADDING,
  shareCardLabel,
  type RecordShareCard,
  type ShareCardData,
  type WorkoutShareCard,
} from '@/lib/shareCard';

const LOGO = require('../../assets/brand/icon.png');

/** Alt yazının (logo + "Dinç · Google Play'de ücretsiz") yüksekliği */
const FOOTER_HEIGHT = 84;

export const ShareCard = forwardRef<View, { card: ShareCardData; width: number }>(function ShareCard(
  { card, width },
  ref
) {
  const s = width / SHARE_CARD_WIDTH;
  return (
    <View
      ref={ref}
      collapsable={false}
      accessible
      accessibilityLabel={shareCardLabel(card)}
      style={{ width, height: SHARE_CARD_HEIGHT * s }}
    >
      <DarkSurface className="flex-1 bg-bg overflow-hidden">
        {card.kind === 'record' ? <RecordBody card={card} s={s} /> : <WorkoutBody card={card} s={s} />}
        <Footer s={s} />
      </DarkSurface>
    </View>
  );
});

function Footer({ s }: { s: number }) {
  return (
    <View
      className="absolute flex-row items-center"
      style={{ left: SIDE_PADDING * s, right: SIDE_PADDING * s, bottom: SAFE_BOTTOM * s, height: FOOTER_HEIGHT * s, gap: 22 * s }}
    >
      <Image source={LOGO} style={{ width: FOOTER_HEIGHT * s, height: FOOTER_HEIGHT * s, borderRadius: 20 * s }} />
      <Text className="text-muted font-semibold" style={{ fontSize: 34 * s }}>
        {SHARE_FOOTER}
      </Text>
    </View>
  );
}

/** Yazı bloğunun altı: alt arayüz alanı + alt yazı + boşluk */
const contentBottom = (s: number) => (SAFE_BOTTOM + FOOTER_HEIGHT + 64) * s;

function RecordBody({ card, s }: { card: RecordShareCard; s: number }) {
  const tones = useContextTones('record');
  return (
    <>
      <CoverImage cover={card.cover} variant="page" className="absolute left-0 right-0 top-0" style={{ height: '64%' }} />
      <View
        className="absolute"
        style={{ left: SIDE_PADDING * s, right: SIDE_PADDING * s, top: SAFE_TOP * s, bottom: contentBottom(s), justifyContent: 'flex-end', gap: 24 * s }}
      >
        <View
          className="flex-row self-start items-center rounded-full"
          style={{ backgroundColor: tones.fill, paddingHorizontal: 30 * s, paddingVertical: 14 * s, gap: 14 * s }}
        >
          <Trophy color={tones.onFill} size={36 * s} />
          <Text className="font-bold" style={{ color: tones.onFill, fontSize: 32 * s, letterSpacing: 4 * s }}>
            YENİ REKOR
          </Text>
        </View>
        <Text className="font-bold" style={{ color: tones.ink, fontSize: 30 * s, letterSpacing: 4 * s }}>
          {card.kindsText}
        </Text>
        <Text className="text-fg font-bold" numberOfLines={2} style={{ fontSize: card.exerciseNameSize * s }}>
          {card.exerciseName}
        </Text>
        <Text
          className="font-display text-fg"
          numberOfLines={1}
          style={{ fontSize: card.headlineSize * s, lineHeight: Math.round(card.headlineSize * 1.1) * s }}
        >
          {card.headline[0]}
          <Text className="font-display" style={{ color: tones.ink }}>
            {card.headline[1]}
          </Text>
        </Text>
        {card.gainLine != null && (
          <Text className="text-fg font-semibold" style={{ fontSize: 40 * s }}>
            {card.gainLine}
          </Text>
        )}
        {card.moreText != null && (
          <Text className="font-semibold" style={{ color: tones.ink, fontSize: 36 * s }}>
            {card.moreText}
          </Text>
        )}
      </View>
    </>
  );
}

function WorkoutBody({ card, s }: { card: WorkoutShareCard; s: number }) {
  const COLORS = useColors();
  const tones = useContextTones(card.context);
  const record = useContextTones('record');
  const glowId = `shareGlow${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <>
      {/* Bağlam ışığı: üstten yayılan renk */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Svg width="100%" height="100%">
          <Defs>
            <RadialGradient id={glowId} cx="50%" cy="0%" rx="85%" ry="55%" fx="50%" fy="0%">
              <Stop offset="0" stopColor={tones.fill} stopOpacity={0.55} />
              <Stop offset="0.55" stopColor={tones.fill} stopOpacity={0.12} />
              <Stop offset="1" stopColor={COLORS.bg} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x={0} y={0} width="100%" height="100%" fill={`url(#${glowId})`} />
        </Svg>
      </View>

      <View
        className="absolute"
        style={{ left: SIDE_PADDING * s, right: SIDE_PADDING * s, top: SAFE_TOP * s, bottom: contentBottom(s), gap: 40 * s }}
      >
        <Text className="font-bold" style={{ color: tones.ink, fontSize: 32 * s, letterSpacing: 5 * s }}>
          ANTRENMAN TAMAM
        </Text>
        <Text
          className="font-display text-fg"
          numberOfLines={2}
          style={{ fontSize: card.titleSize * s, lineHeight: Math.round(card.titleSize * 1.08) * s }}
        >
          {card.title}
        </Text>

        <View className="flex-row" style={{ gap: 24 * s }}>
          {card.stats.map((stat) => (
            <View
              key={stat.label}
              className="flex-1 bg-bg-surface border border-border"
              style={{ borderRadius: 36 * s, paddingHorizontal: 30 * s, paddingVertical: 30 * s, gap: 8 * s }}
            >
              <Text className="text-muted font-semibold" style={{ fontSize: 30 * s }}>
                {stat.label}
              </Text>
              <Text className="font-display text-fg" numberOfLines={1} adjustsFontSizeToFit style={{ fontSize: 60 * s }}>
                {stat.value}
              </Text>
            </View>
          ))}
        </View>

        {card.records.length > 0 && (
          <View
            className="bg-bg-surface border border-border"
            style={{ borderRadius: 36 * s, paddingHorizontal: 34 * s, paddingVertical: 32 * s, gap: 18 * s }}
          >
            <View className="flex-row items-center" style={{ gap: 14 * s }}>
              <Trophy color={record.ink} size={36 * s} />
              <Text className="font-bold" style={{ color: record.ink, fontSize: 30 * s, letterSpacing: 4 * s }}>
                YENİ REKOR
              </Text>
            </View>
            {card.records.map((line) => (
              <Text key={line} className="text-fg font-semibold" numberOfLines={1} style={{ fontSize: 40 * s }}>
                {line}
              </Text>
            ))}
            {card.moreRecords != null && (
              <Text className="text-muted font-semibold" style={{ fontSize: 34 * s }}>
                {card.moreRecords}
              </Text>
            )}
          </View>
        )}
      </View>
    </>
  );
}
