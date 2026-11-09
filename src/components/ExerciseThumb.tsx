import { memo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { BicepsFlexed, Dumbbell, Footprints, HeartPulse, Target } from 'lucide-react-native';

import { useColors, useTheme } from '@/hooks/useTheme';
import {
  EXERCISE_IMAGE_CACHE,
  exerciseIconKind,
  getExerciseCoverUrl,
  type ExerciseIconKind,
} from '@/lib/exerciseImage';
import { imageFrameClass } from '@/theme';

const ICONS: Record<ExerciseIconKind, typeof Dumbbell> = {
  cardio: HeartPulse,
  arms: BicepsFlexed,
  torso: Dumbbell,
  legs: Footprints,
  core: Target,
};

/**
 * Hareket küçük görseli (v4.0b 1.2). Kas grubu ikonu görselin altında durur:
 * yüklenirken, görsel yoksa ya da indirilemezse (çevrimdışı, boş önbellek)
 * boş kare kalmaz. Görsel inince ikonun üstünü kapatır.
 */
export const ExerciseThumb = memo(function ExerciseThumb({
  imagePaths,
  category,
  primaryMuscles,
  size = 56,
}: {
  imagePaths: string | null;
  category?: string | null;
  primaryMuscles?: string | null;
  size?: number;
}) {
  const COLORS = useColors();
  const { scheme } = useTheme();
  const url = getExerciseCoverUrl(imagePaths);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const Icon = ICONS[exerciseIconKind(category, primaryMuscles)];

  return (
    <View
      className={`rounded-2xl bg-bg-elevated overflow-hidden items-center justify-center ${imageFrameClass(scheme)}`}
      style={{ width: size, height: size }}
    >
      <Icon color={COLORS.muted} size={Math.round(size * 0.42)} strokeWidth={1.75} />
      {url != null && failedUrl !== url && (
        <Image
          source={{ uri: url }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy={EXERCISE_IMAGE_CACHE}
          recyclingKey={url}
          onError={() => setFailedUrl(url)}
        />
      )}
    </View>
  );
});
