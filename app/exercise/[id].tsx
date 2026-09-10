import { Image, ScrollView, Text, View, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { eq } from 'drizzle-orm';

import { useDb } from '@/hooks/useDb';
import { exercises } from '@/db/schema';
import { getExerciseImageUrls } from '@/lib/exerciseImage';

export default function ExerciseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();

  const { data } = useLiveQuery(
    db.select().from(exercises).where(eq(exercises.id, id ?? '')).limit(1),
    [id]
  );

  if (!data) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color="#22c55e" />
      </View>
    );
  }

  const exercise = data[0];

  if (!exercise) {
    return (
      <View className="flex-1 items-center justify-center bg-bg p-6">
        <Text className="text-muted">Egzersiz bulunamadı.</Text>
      </View>
    );
  }

  const imageUrls = getExerciseImageUrls(exercise.imagePaths);
  const primaryMuscles = parseJsonArray(exercise.primaryMuscles);
  const secondaryMuscles = parseJsonArray(exercise.secondaryMuscles);
  const instructions = parseJsonArray(exercise.instructions);
  const displayName = exercise.nameTr ?? exercise.name;

  return (
    <>
      <Stack.Screen options={{ title: displayName }} />
      <ScrollView
        className="flex-1 bg-bg"
        contentContainerClassName="p-4 gap-4"
      >
        <View>
          <Text className="text-white text-2xl font-bold">{displayName}</Text>
          {exercise.nameTr && exercise.nameTr !== exercise.name && (
            <Text className="text-muted text-sm mt-1">{exercise.name}</Text>
          )}
        </View>

        {/* Görseller */}
        {imageUrls.length > 0 && (
          <View className="flex-row gap-2">
            {imageUrls.slice(0, 2).map((url, idx) => (
              <View
                key={idx}
                className="flex-1 bg-bg-surface rounded-xl overflow-hidden aspect-square"
              >
                <Image
                  source={{ uri: url }}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode="cover"
                />
              </View>
            ))}
          </View>
        )}

        {/* Hızlı bilgiler */}
        <View className="flex-row flex-wrap gap-2">
          {exercise.equipment && (
            <Chip label={`Ekipman: ${exercise.equipment}`} />
          )}
          {exercise.mechanic && <Chip label={exercise.mechanic} />}
          {exercise.force && <Chip label={exercise.force} />}
          {exercise.level && <Chip label={exercise.level} />}
        </View>

        {/* Kaslar */}
        <View className="bg-bg-surface rounded-xl p-4 gap-2">
          <Text className="text-white font-semibold">Çalıştırılan Kaslar</Text>
          {primaryMuscles.length > 0 && (
            <View>
              <Text className="text-muted text-xs">Birincil</Text>
              <Text className="text-white">{primaryMuscles.join(', ')}</Text>
            </View>
          )}
          {secondaryMuscles.length > 0 && (
            <View>
              <Text className="text-muted text-xs">İkincil</Text>
              <Text className="text-white">{secondaryMuscles.join(', ')}</Text>
            </View>
          )}
        </View>

        {/* Talimatlar */}
        {instructions.length > 0 && (
          <View className="bg-bg-surface rounded-xl p-4 gap-2">
            <Text className="text-white font-semibold mb-1">Nasıl Yapılır</Text>
            {instructions.map((step, idx) => (
              <View key={idx} className="flex-row">
                <Text className="text-accent font-bold w-6">{idx + 1}.</Text>
                <Text className="text-white flex-1">{step}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <View className="bg-bg-surface px-3 py-1 rounded-full">
      <Text className="text-white text-xs">{label}</Text>
    </View>
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
