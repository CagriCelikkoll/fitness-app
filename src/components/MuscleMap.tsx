import { Text, View } from 'react-native';
import Body, { type ExtendedBodyPart } from 'react-native-body-highlighter';

import { useAppSettings } from '@/hooks/useAppSettings';
import { BODY_SLUGS, type MuscleHighlight } from '@/lib/muscleMap';
import { COLORS } from '@/theme';

/**
 * Ön ve arka vücut görünümü yan yana, kaslar yoğunluğa göre boyalı.
 *
 * Renk ve cinsiyet burada yönetiliyor; ekranlar yalnızca `highlights`
 * geçiyor. Yoğunluk 1'den başlıyor, `palette[intensity - 1]` rengini
 * alıyor.
 */

type MuscleMapVariant = 'exercise' | 'weekly';

/** Vurgu renginin opaklık basamakları (8 haneli hex) */
const PALETTES: Record<MuscleMapVariant, string[]> = {
  // İkincil, birincil
  exercise: [`${COLORS.accent}66`, COLORS.accent],
  // Az, orta, yoğun
  weekly: [`${COLORS.accent}4D`, `${COLORS.accent}A6`, COLORS.accent],
};

const LEGENDS: Record<MuscleMapVariant, string[]> = {
  exercise: ['İkincil', 'Birincil'],
  weekly: ['Az', 'Orta', 'Yoğun'],
};

const SCALES = { sm: 0.5, md: 0.7, lg: 0.8 } as const;

interface MuscleMapProps {
  highlights: MuscleHighlight[];
  /** Renk basamakları ve lejant; egzersiz detayı ya da haftalık harita */
  variant?: MuscleMapVariant;
  size?: keyof typeof SCALES;
}

export function MuscleMap({
  highlights,
  variant = 'exercise',
  size = 'md',
}: MuscleMapProps) {
  const { settings } = useAppSettings();
  const gender = settings?.gender === 'female' ? 'female' : 'male';
  const palette = PALETTES[variant];

  // Vücut modellerindeki her parçanın sabit bir rengi var ve kütüphanenin
  // `defaultFill`'i onu ezmiyor; boş kaslar da tema rengini alsın diye
  // her slug için renk açıkça veriliyor.
  const intensityBySlug = new Map(highlights.map((h) => [h.slug, h.intensity]));
  const data: ExtendedBodyPart[] = BODY_SLUGS.map((slug) => {
    const intensity = intensityBySlug.get(slug) ?? 0;
    return {
      slug,
      color:
        intensity > 0
          ? palette[Math.min(intensity, palette.length) - 1]
          : COLORS.elevated,
    };
  });

  const bodyProps = {
    data,
    gender,
    scale: SCALES[size],
    border: COLORS.border,
  } as const;

  return (
    <View className="items-center gap-3">
      <View className="flex-row justify-center">
        <Body {...bodyProps} side="front" />
        <Body {...bodyProps} side="back" />
      </View>
      <View className="flex-row gap-4">
        {LEGENDS[variant].map((label, idx) => (
          <View key={label} className="flex-row items-center">
            <View
              className="w-3 h-3 rounded-full mr-1.5"
              style={{ backgroundColor: palette[idx] }}
            />
            <Text className="text-muted text-xs">{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
