/**
 * Hareket detayı (v4.0b Bölüm 8): katalog görseli, ad, kas çipleri ve üç
 * sekme. Seçici ve odak panelindeki önizleme `ExerciseDetailContent`.
 */

import { useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { eq } from 'drizzle-orm';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';

import {
  ExerciseHowTo,
  ExerciseImages,
  ExerciseMuscles,
  ExerciseQuickInfo,
} from '@/components/ExerciseDetailContent';
import { ExerciseGrowthTab, ExerciseHistoryTab, useExerciseProgress } from '@/components/ExerciseProgress';
import { Chip, DisplayName, IconButton, SegmentedTabs } from '@/components/ui';
import { Text } from '@/components/ui/Text';
import { exercises, type Exercise } from '@/db/schema';
import { useDb } from '@/hooks/useDb';
import { DarkSurface, useColors } from '@/hooks/useTheme';
import { exerciseContextColor } from '@/lib/contextColor';
import { exerciseDisplayName } from '@/lib/exerciseCatalog';
import { getExerciseImageUrls } from '@/lib/exerciseImage';
import { EXERCISE_DETAIL_TABS, exerciseDetailSubtitle, type ExerciseDetailTab } from '@/lib/exerciseListView';
import { muscleLabels } from '@/lib/exerciseTaxonomy';
import { CARD_NAME_SIZES } from '@/lib/typography';

/** Sayfa kenarları (20 + 20) */
const NAME_INSET = 40;
/** Görsel yoksa ad, geri düğmesinin altından başlasın */
const BACK_BUTTON_SPACE = 52;
/** 44'lük düğmenin yarısı: tam daire */
const BACK_BUTTON_RADIUS = 22;

export default function ExerciseDetailScreen() {
  const COLORS = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();

  const { data } = useLiveQuery(
    db.select().from(exercises).where(eq(exercises.id, id ?? '')).limit(1),
    [id]
  );

  if (!data) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={COLORS.accent} />
      </View>
    );
  }

  const exercise = data[0];
  return exercise ? <ExerciseDetailBody key={exercise.id} exercise={exercise} /> : <NotFound />;
}

function ExerciseDetailBody({ exercise }: { exercise: Exercise }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<ExerciseDetailTab>('howto');
  const progress = useExerciseProgress(exercise.id);

  const imageUrls = getExerciseImageUrls(exercise.imagePaths).slice(0, 2);
  const subtitle = exerciseDetailSubtitle(exercise);
  const color = exerciseContextColor(exercise, 'full');

  return (
    <View className="flex-1 bg-bg">
      <ScrollView
        className="flex-1"
        contentContainerClassName="pb-10"
        contentContainerStyle={{ paddingTop: insets.top + 8 + (imageUrls.length > 0 ? 0 : BACK_BUTTON_SPACE) }}
      >
        {imageUrls.length > 0 && (
          <DarkSurface className="px-4">
            <ExerciseImages urls={imageUrls} />
          </DarkSurface>
        )}

        <View className="px-5 pt-4 gap-3">
          <View className="gap-1">
            <DisplayName accessibilityRole="header" inset={NAME_INSET} sizes={CARD_NAME_SIZES}>
              {exerciseDisplayName(exercise)}
            </DisplayName>
            {subtitle != null && <Text className="text-muted text-[13px]">{subtitle}</Text>}
          </View>

          <View className="flex-row flex-wrap gap-2">
            {muscleLabels(exercise.primaryMuscles).map((m) => (
              <Chip key={`p-${m}`} size="sm" active color={color} label={m} />
            ))}
            {muscleLabels(exercise.secondaryMuscles).map((m) => (
              <Chip key={`s-${m}`} size="sm" label={m} />
            ))}
          </View>

          <SegmentedTabs tabs={EXERCISE_DETAIL_TABS} value={tab} onChange={setTab} />

          {tab === 'howto' && (
            <>
              <ExerciseHowTo exercise={exercise} showTitle={false} />
              <ExerciseQuickInfo exercise={exercise} />
              <ExerciseMuscles exercise={exercise} />
            </>
          )}
          {tab === 'growth' && <ExerciseGrowthTab points={progress.points} />}
          {tab === 'history' && <ExerciseHistoryTab {...progress} />}
        </View>
      </ScrollView>

      <View pointerEvents="box-none" className="absolute left-0 top-0 px-6" style={{ paddingTop: insets.top + 16 }}>
        {/* Fotoğrafın üstünde iki temada da koyu, yarı saydam daire */}
        <DarkSurface>
          <IconButton
            icon={ChevronLeft}
            variant="ghost"
            iconSize={22}
            accessibilityLabel="Geri"
            onPress={() => router.back()}
            className="bg-bg/70"
            style={{ borderRadius: BACK_BUTTON_RADIUS }}
          />
        </DarkSurface>
      </View>
    </View>
  );
}

function NotFound() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-bg px-4" style={{ paddingTop: insets.top + 8 }}>
      <IconButton icon={ChevronLeft} accessibilityLabel="Geri" onPress={() => router.back()} />
      <Text className="text-muted text-base text-center mt-10">Egzersiz bulunamadı.</Text>
    </View>
  );
}
