import { useCallback, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  View,
  ActivityIndicator,
} from 'react-native';
import { Text, TextInput } from '@/components/ui/Text';
import { Link, useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import { Search, X } from 'lucide-react-native';

import { useExerciseList } from '@/hooks/useExerciseList';
import { useColors, useTheme } from '@/hooks/useTheme';
import { imageFrameClass } from '@/theme';
import { type Exercise } from '@/db/schema';
import { EXERCISE_IMAGE_CACHE, getExerciseCoverUrl } from '@/lib/exerciseImage';
import { exerciseDisplayName, exerciseOriginalName } from '@/lib/exerciseCatalog';
import {
  EXERCISE_FILTER_OPTIONS,
  categoryLabel,
  equipmentLabel,
  muscleLabels,
} from '@/lib/exerciseTaxonomy';
import { Chip } from '@/components/ui';
import { OtherHeader, ShowOtherButton } from '@/components/ExercisePickerModal';

export default function ExercisesScreen() {
  const COLORS = useColors();
  const [search, setSearch] = useState('');
  const [filterId, setFilterId] = useState('all');
  // v3.8: varsayılan liste core; extra "Diğer egzersizleri göster" ile
  const [showExtra, setShowExtra] = useState(false);

  // Liste canlı (yeni özel egzersiz anında çıkar); kullanılanlar odakta
  const { items: data, error, refreshUsed } = useExerciseList({ filterId, search, showExtra });
  useFocusEffect(
    useCallback(() => {
      refreshUsed();
    }, [refreshUsed])
  );
  const shownCount = data?.filter((i) => i.kind === 'exercise').length ?? 0;

  if (error) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6">
        <Text className="text-danger">Hata: {error.message}</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg">
      {/* Arama + Filtre */}
      <View className="px-5 pt-4 pb-3 gap-3">
        <View className="flex-row items-center bg-bg-elevated rounded-2xl px-4 h-12">
          <Search color={COLORS.muted} size={18} strokeWidth={1.75} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Egzersiz ara..."
            placeholderTextColor={COLORS.muted}
            className="flex-1 text-fg text-base ml-3"
            autoCorrect={false}
            autoCapitalize="none"
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')} hitSlop={12}>
              <X color={COLORS.muted} size={18} />
            </Pressable>
          )}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="-mx-5 grow-0"
          contentContainerClassName="px-5 gap-2"
          keyboardShouldPersistTaps="handled"
        >
          {EXERCISE_FILTER_OPTIONS.map((opt) => (
            <Chip
              key={opt.id}
              label={opt.label}
              active={filterId === opt.id}
              onPress={() => setFilterId(opt.id)}
            />
          ))}
        </ScrollView>
      </View>

      {/* Liste */}
      {!data ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={COLORS.accent} />
        </View>
      ) : data.length === 0 ? (
        <View className="flex-1 items-center justify-center p-6">
          <Text className="text-muted text-center">
            Aradığın kriterlerde egzersiz bulunamadı.
          </Text>
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => (item.kind === 'exercise' ? item.exercise.id : item.kind)}
          renderItem={({ item }) =>
            item.kind === 'exercise' ? (
              <ExerciseRow exercise={item.exercise} />
            ) : item.kind === 'otherHeader' ? (
              <OtherHeader />
            ) : (
              <ShowOtherButton count={item.count} onPress={() => setShowExtra(true)} />
            )
          }
          contentContainerClassName="px-5 pb-12"
          ItemSeparatorComponent={() => <View className="h-2" />}
        />
      )}

      {/* Toplam sayı footer */}
      {data && data.length > 0 && (
        <View className="absolute bottom-0 left-0 right-0 bg-bg/90 border-t border-border px-5 py-1.5">
          <Text className="text-muted/70 text-xs tracking-wide text-center tabular-nums">
            {shownCount} egzersiz gösteriliyor
          </Text>
        </View>
      )}
    </View>
  );
}

function ExerciseRow({ exercise }: { exercise: Exercise }) {
  const { scheme } = useTheme();
  const coverUrl = getExerciseCoverUrl(exercise.imagePaths);
  const muscles = muscleLabels(exercise.primaryMuscles);
  const displayName = exerciseDisplayName(exercise);
  const originalName = exerciseOriginalName(exercise);

  return (
    <Link href={`/exercise/${exercise.id}`} asChild>
      <Pressable className="flex-row items-center bg-bg-surface border border-border rounded-3xl p-3 active:opacity-80">
        <View
          className={`w-14 h-14 rounded-2xl bg-bg-elevated overflow-hidden items-center justify-center ${imageFrameClass(scheme)}`}
        >
          {coverUrl ? (
            <Image
              source={{ uri: coverUrl }}
              style={{ width: 56, height: 56 }}
              contentFit="cover"
              cachePolicy={EXERCISE_IMAGE_CACHE}
            />
          ) : (
            <Text className="text-muted text-xs">
              {exercise.category === 'cardio' ? '🏃' : '💪'}
            </Text>
          )}
        </View>
        <View className="flex-1 ml-4 justify-center">
          <Text className="text-fg text-base font-semibold" numberOfLines={1}>
            {displayName}
          </Text>
          {originalName != null && (
            <Text className="text-muted text-xs" numberOfLines={1}>
              {originalName}
            </Text>
          )}
          <Text className="text-muted text-xs mt-1" numberOfLines={1}>
            {[muscles.join(', ') || categoryLabel(exercise.category), exercise.equipment && equipmentLabel(exercise.equipment)]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
      </Pressable>
    </Link>
  );
}
