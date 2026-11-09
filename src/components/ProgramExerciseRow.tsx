import { Pressable, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { useRouter } from 'expo-router';
import { TriangleAlert } from 'lucide-react-native';

import { ExerciseThumb } from '@/components/ExerciseThumb';
import { useColors, useTheme } from '@/hooks/useTheme';
import type { ExerciseInfo } from '@/hooks/useExerciseLookup';
import { imageFrameClass } from '@/theme';
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

  return (
    <Pressable
      onPress={() => info && router.push({ pathname: '/exercise/[id]', params: { id: info.id } })}
      disabled={!info}
      className={`flex-row py-3 active:opacity-70 ${divider ? 'border-t border-border' : ''}`}
    >
      {missing ? (
        <View
          className={`w-14 h-14 rounded-2xl bg-bg-elevated items-center justify-center ${imageFrameClass(scheme)}`}
        >
          <TriangleAlert color={COLORS.warning} size={20} />
        </View>
      ) : (
        <ExerciseThumb
          imagePaths={info?.imagePaths ?? null}
          category={info?.category}
          primaryMuscles={info?.primaryMuscles}
        />
      )}
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
