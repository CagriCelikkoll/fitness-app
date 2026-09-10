import { useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  Text,
  TextInput,
  View,
  ActivityIndicator,
} from 'react-native';
import { Link } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { and, eq, like, or, asc } from 'drizzle-orm';
import { Search, X } from 'lucide-react-native';

import { useDb } from '@/hooks/useDb';
import { exercises, type Exercise } from '@/db/schema';
import { getExerciseCoverUrl } from '@/lib/exerciseImage';

type CategoryFilter = 'all' | 'strength' | 'cardio' | 'stretching';

const CATEGORY_OPTIONS: { value: CategoryFilter; label: string }[] = [
  { value: 'all', label: 'Hepsi' },
  { value: 'strength', label: 'Güç' },
  { value: 'cardio', label: 'Kardiyo' },
  { value: 'stretching', label: 'Esneklik' },
];

export default function ExercisesScreen() {
  const db = useDb();

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');

  // useLiveQuery — DB değişikliklerini reaktif olarak takip eder.
  // Kullanıcı yeni custom egzersiz eklediğinde anında listede çıkar.
  const baseQuery = useMemo(() => {
    const conditions = [eq(exercises.isArchived, false)];
    if (category !== 'all') {
      conditions.push(eq(exercises.category, category));
    }
    if (search.trim()) {
      const pattern = `%${search.trim()}%`;
      conditions.push(
        or(like(exercises.name, pattern), like(exercises.nameTr, pattern))!
      );
    }
    return db
      .select()
      .from(exercises)
      .where(and(...conditions))
      .orderBy(asc(exercises.name))
      .limit(200);
  }, [db, category, search]);

  const { data, error } = useLiveQuery(baseQuery, [category, search]);

  if (error) {
    return (
      <View className="flex-1 items-center justify-center p-6">
        <Text className="text-red-400">Hata: {error.message}</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg">
      {/* Arama + Filtre */}
      <View className="px-4 pt-4 pb-2 gap-3">
        <View className="flex-row items-center bg-bg-surface rounded-xl px-3 h-12">
          <Search color="#64748b" size={18} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Egzersiz ara..."
            placeholderTextColor="#64748b"
            className="flex-1 text-white ml-2"
            autoCorrect={false}
            autoCapitalize="none"
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')} hitSlop={8}>
              <X color="#64748b" size={18} />
            </Pressable>
          )}
        </View>

        <View className="flex-row gap-2">
          {CATEGORY_OPTIONS.map((opt) => {
            const active = category === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => setCategory(opt.value)}
                className={`px-4 py-2 rounded-full ${
                  active ? 'bg-accent' : 'bg-bg-surface'
                }`}
              >
                <Text
                  className={`text-sm font-medium ${
                    active ? 'text-bg' : 'text-white'
                  }`}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Liste */}
      {!data ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#22c55e" />
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
          contentContainerClassName="px-4 pb-6"
          ItemSeparatorComponent={() => <View className="h-2" />}
        />
      )}

      {/* Toplam sayı footer */}
      {data && data.length > 0 && (
        <View className="absolute bottom-0 left-0 right-0 bg-bg-surface px-4 py-2">
          <Text className="text-muted text-xs text-center">
            {data.length} egzersiz gösteriliyor
            {data.length === 200 && ' (ilk 200)'}
          </Text>
        </View>
      )}
    </View>
  );
}

function ExerciseRow({ exercise }: { exercise: Exercise }) {
  const coverUrl = getExerciseCoverUrl(exercise.imagePaths);
  const muscles = parseJsonArray(exercise.primaryMuscles);
  const displayName = exercise.nameTr ?? exercise.name;

  return (
    <Link href={`/exercise/${exercise.id}`} asChild>
      <Pressable className="flex-row bg-bg-surface rounded-xl p-3 active:opacity-80">
        <View className="w-16 h-16 rounded-lg bg-bg-elevated overflow-hidden items-center justify-center">
          {coverUrl ? (
            <Image
              source={{ uri: coverUrl }}
              style={{ width: 64, height: 64 }}
              resizeMode="cover"
            />
          ) : (
            <Text className="text-muted text-xs">
              {exercise.category === 'cardio' ? '🏃' : '💪'}
            </Text>
          )}
        </View>
        <View className="flex-1 ml-3 justify-center">
          <Text className="text-white font-semibold" numberOfLines={1}>
            {displayName}
          </Text>
          <Text className="text-muted text-xs mt-0.5" numberOfLines={1}>
            {muscles.join(', ') || exercise.category}
          </Text>
          {exercise.equipment && (
            <Text className="text-muted text-xs" numberOfLines={1}>
              {exercise.equipment}
            </Text>
          )}
        </View>
      </Pressable>
    </Link>
  );
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}
