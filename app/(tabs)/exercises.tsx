import { useCallback, useState, type ReactNode } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  View,
  ActivityIndicator,
  type PressableProps,
} from 'react-native';
import { Text, TextInput } from '@/components/ui/Text';
import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react-native';

import { ExerciseThumb } from '@/components/ExerciseThumb';
import { useDb } from '@/hooks/useDb';
import { useExerciseList } from '@/hooks/useExerciseList';
import { useColors, useContextTones } from '@/hooks/useTheme';
import { type Exercise } from '@/db/schema';
import { exerciseDisplayName } from '@/lib/exerciseCatalog';
import { getRecentlyUsedExercises, type RecentlyUsedExercise } from '@/lib/exerciseHistory';
import {
  RECENT_EXERCISE_LIMIT,
  exerciseListTitle,
  exerciseRowSubtitle,
  recentBestLabel,
  showRecentExercises,
} from '@/lib/exerciseListView';
import { EXERCISE_FILTER_OPTIONS } from '@/lib/exerciseTaxonomy';
import { Chip, IconButton, ScreenTitle, SectionLabel } from '@/components/ui';
import { OtherHeader, ShowOtherButton } from '@/components/ExercisePickerModal';

export default function ExercisesScreen() {
  return <ExercisesList />;
}

/** Sekme ve salon üyesinin yığın ekranı (`app/exercise/index.tsx`) aynı liste */
export function ExercisesList({ showBack = false }: { showBack?: boolean }) {
  const COLORS = useColors();
  const router = useRouter();
  const db = useDb();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const [filterId, setFilterId] = useState('all');
  // v3.8: varsayılan liste core; extra "Diğer egzersizleri göster" ile
  const [showExtra, setShowExtra] = useState(false);
  const [recent, setRecent] = useState<RecentlyUsedExercise[]>([]);

  // Liste canlı (yeni özel egzersiz anında çıkar); kullanılanlar odakta
  const { items: data, error, refreshUsed } = useExerciseList({ filterId, search, showExtra });
  useFocusEffect(
    useCallback(() => {
      refreshUsed();
      let active = true;
      getRecentlyUsedExercises(db, RECENT_EXERCISE_LIMIT)
        .then((rows) => {
          if (active) setRecent(rows);
        })
        .catch((err) => console.error('[EXERCISES] Son kullanılanlar okunamadı:', err));
      return () => {
        active = false;
      };
    }, [db, refreshUsed])
  );
  const shownCount = data?.filter((i) => i.kind === 'exercise').length ?? 0;
  const filterLabel = EXERCISE_FILTER_OPTIONS.find((o) => o.id === filterId)?.label ?? '';
  const recentRows = showRecentExercises(filterId, search) ? recent : [];

  if (error) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6">
        <Text className="text-danger">Hata: {error.message}</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg">
      {/* Başlık + Arama + Filtre */}
      <View className="px-5 pb-3 gap-3" style={{ paddingTop: insets.top + 12 }}>
        <View className="flex-row items-center gap-3">
          {showBack && <IconButton icon={ChevronLeft} iconSize={22} accessibilityLabel="Geri" onPress={() => router.back()} />}
          <ScreenTitle>Hareketler</ScreenTitle>
        </View>

        <View className="flex-row items-center bg-bg-elevated rounded-2xl px-4 h-12">
          <Search color={COLORS.muted} size={18} strokeWidth={1.75} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Ara: front raise, lat çekiş…"
            placeholderTextColor={COLORS.muted}
            className="flex-1 text-fg text-base ml-3"
            autoCorrect={false}
            autoCapitalize="none"
            accessibilityLabel="Hareket ara"
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')} hitSlop={12} accessibilityRole="button" accessibilityLabel="Aramayı temizle">
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
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View className="gap-1 pb-2">
              {recentRows.length > 0 && (
                <>
                  <SectionLabel muted className="pb-1">Son kullandıkların</SectionLabel>
                  {recentRows.map((r) => (
                    <ExerciseRow key={r.exercise.id} exercise={r.exercise} trailing={<BestWeight kg={r.bestWeightKg} />} />
                  ))}
                  <View className="h-2.5" />
                </>
              )}
              <SectionLabel muted>{exerciseListTitle(filterLabel, search.trim().length > 0, shownCount)}</SectionLabel>
            </View>
          }
          renderItem={({ item }) =>
            item.kind === 'exercise' ? (
              <ExerciseRow exercise={item.exercise} trailing={<RowChevron />} />
            ) : item.kind === 'otherHeader' ? (
              <OtherHeader />
            ) : (
              <ShowOtherButton count={item.count} onPress={() => setShowExtra(true)} />
            )
          }
          contentContainerClassName="px-5 pb-6"
          ItemSeparatorComponent={RowGap}
        />
      )}
    </View>
  );
}

function RowGap() {
  return <View className="h-1" />;
}

function RowChevron() {
  const COLORS = useColors();
  return <ChevronRight color={COLORS.muted} size={18} />;
}

function BestWeight({ kg }: { kg: number | null }) {
  const tones = useContextTones('record');
  const label = recentBestLabel(kg);
  if (label == null) return <RowChevron />;
  return (
    <Text className="text-xs font-bold tabular-nums" style={{ color: tones.ink }}>
      {label}
    </Text>
  );
}

function ExerciseRow({ exercise, trailing }: { exercise: Exercise; trailing: ReactNode }) {
  return (
    <Link href={`/exercise/${exercise.id}`} asChild>
      <RowPressable exercise={exercise} trailing={trailing} />
    </Link>
  );
}

/** `Link asChild` dokunuşu `rest` ile veriyor */
function RowPressable({ exercise, trailing, ...rest }: { exercise: Exercise; trailing: ReactNode } & PressableProps) {
  return (
    <Pressable className="flex-row items-center gap-3 py-2 rounded-2xl active:opacity-70" {...rest}>
      <ExerciseThumb
        imagePaths={exercise.imagePaths}
        category={exercise.category}
        primaryMuscles={exercise.primaryMuscles}
        size={52}
      />
      <View className="flex-1">
        <Text className="text-fg text-[15px] font-bold" numberOfLines={1}>
          {exerciseDisplayName(exercise)}
        </Text>
        <Text className="text-muted text-xs mt-0.5" numberOfLines={1}>
          {exerciseRowSubtitle(exercise)}
        </Text>
      </View>
      {trailing}
    </Pressable>
  );
}
