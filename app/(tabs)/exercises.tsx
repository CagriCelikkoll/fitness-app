import { useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  ActivityIndicator,
} from 'react-native';
import { Link } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Search, X } from 'lucide-react-native';

import { useDb } from '@/hooks/useDb';
import { exercises, type Exercise } from '@/db/schema';
import { getExerciseCoverUrl } from '@/lib/exerciseImage';
import {
  exerciseListCondition,
  exerciseListOrder,
} from '@/lib/exerciseFilter';
import {
  EXERCISE_FILTER_OPTIONS,
  categoryLabel,
  equipmentLabel,
  muscleLabels,
} from '@/lib/exerciseTaxonomy';
import { COLORS } from '@/theme';
import { Chip } from '@/components/ui';

export default function ExercisesScreen() {
  const db = useDb();

  const [search, setSearch] = useState('');
  const [filterId, setFilterId] = useState('all');

  // useLiveQuery — DB değişikliklerini reaktif olarak takip eder.
  // Kullanıcı yeni custom egzersiz eklediğinde anında listede çıkar.
  const baseQuery = useMemo(() => {
    const option =
      EXERCISE_FILTER_OPTIONS.find((o) => o.id === filterId) ??
      EXERCISE_FILTER_OPTIONS[0]!;
    return db
      .select()
      .from(exercises)
      .where(exerciseListCondition(option.filter, search))
      .orderBy(...exerciseListOrder(option.filter));
  }, [db, filterId, search]);

  const { data, error } = useLiveQuery(baseQuery, [filterId, search]);

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
            className="flex-1 text-white text-base ml-3"
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
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <ExerciseRow exercise={item} />}
          contentContainerClassName="px-5 pb-12"
          ItemSeparatorComponent={() => <View className="h-2" />}
        />
      )}

      {/* Toplam sayı footer */}
      {data && data.length > 0 && (
        <View className="absolute bottom-0 left-0 right-0 bg-bg/90 border-t border-border px-5 py-1.5">
          <Text className="text-muted/70 text-[11px] tracking-wide text-center tabular-nums">
            {data.length} egzersiz gösteriliyor
          </Text>
        </View>
      )}
    </View>
  );
}

function ExerciseRow({ exercise }: { exercise: Exercise }) {
  const coverUrl = getExerciseCoverUrl(exercise.imagePaths);
  const muscles = muscleLabels(exercise.primaryMuscles);
  const displayName = exercise.nameTr ?? exercise.name;

  return (
    <Link href={`/exercise/${exercise.id}`} asChild>
      <Pressable className="flex-row items-center bg-bg-surface border border-border rounded-3xl p-3 active:opacity-80">
        <View className="w-14 h-14 rounded-2xl bg-bg-elevated overflow-hidden items-center justify-center">
          {coverUrl ? (
            <Image
              source={{ uri: coverUrl }}
              style={{ width: 56, height: 56 }}
              resizeMode="cover"
            />
          ) : (
            <Text className="text-muted text-xs">
              {exercise.category === 'cardio' ? '🏃' : '💪'}
            </Text>
          )}
        </View>
        <View className="flex-1 ml-4 justify-center">
          <Text className="text-white text-base font-semibold" numberOfLines={1}>
            {displayName}
          </Text>
          <Text className="text-muted text-xs mt-1" numberOfLines={1}>
            {muscles.join(', ') || categoryLabel(exercise.category)}
          </Text>
          {exercise.equipment && (
            <Text className="text-muted/70 text-xs mt-0.5" numberOfLines={1}>
              {equipmentLabel(exercise.equipment)}
            </Text>
          )}
        </View>
      </Pressable>
    </Link>
  );
}
