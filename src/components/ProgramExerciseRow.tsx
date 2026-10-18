import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { TriangleAlert } from 'lucide-react-native';

import { useColors, useTheme } from '@/hooks/useTheme';
import type { ExerciseInfo } from '@/hooks/useExerciseLookup';
import { imageFrameClass } from '@/theme';
import { EXERCISE_IMAGE_CACHE, getExerciseCoverUrl } from '@/lib/exerciseImage';
import { restText, setsRepsText, type ProgramExercise } from '@/lib/programs';

/**
 * Program ayrıntısında bir egzersiz (v3.6b): görsel, Türkçe ad, set ×
 * tekrar, dinlenme, hoca notu. Kütüphanede yoksa uyarıyla (rutine
 * eklenirken atlanır). Ada dokununca egzersiz ayrıntısı.
 */
export function ProgramExerciseRow({
  exercise,
  info,
  missing,
  divider,
}: {
  exercise: ProgramExercise;
  info: ExerciseInfo | undefined;
  /** Kütüphane okundu ve bu egzersiz yok */
  missing: boolean;
  divider?: boolean;
}) {
  const COLORS = useColors();
  const { scheme } = useTheme();
  const router = useRouter();
  const cover = info ? getExerciseCoverUrl(info.imagePaths) : null;

  return (
    <Pressable
      onPress={() => info && router.push({ pathname: '/exercise/[id]', params: { id: info.id } })}
      disabled={!info}
      className={`flex-row py-3 active:opacity-70 ${divider ? 'border-t border-border' : ''}`}
    >
      <View
        className={`w-14 h-14 rounded-2xl bg-bg-elevated overflow-hidden items-center justify-center ${imageFrameClass(scheme)}`}
      >
        {cover ? (
          <Image source={{ uri: cover }} style={{ width: 56, height: 56 }} contentFit="cover" cachePolicy={EXERCISE_IMAGE_CACHE} />
        ) : missing ? (
          <TriangleAlert color={COLORS.warning} size={20} />
        ) : (
          <Text className="text-muted text-xs">💪</Text>
        )}
      </View>
      <View className="flex-1 ml-4">
        <Text className={`text-base font-semibold ${missing ? 'text-muted' : 'text-fg'}`} numberOfLines={2}>
          {info?.name ?? (missing ? 'Kütüphanede bulunamadı' : '…')}
        </Text>
        <Text className="text-muted text-sm mt-0.5 tabular-nums">
          {setsRepsText(exercise)} · {restText(exercise.restSec)}
        </Text>
        {missing && <Text className="text-warning text-xs mt-1">Rutine eklenirken atlanacak.</Text>}
        {exercise.notes && <Text className="text-fg text-sm mt-1 leading-5">Not: {exercise.notes}</Text>}
      </View>
    </Pressable>
  );
}
