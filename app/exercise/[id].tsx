import { Image, ScrollView, Text, View, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { eq } from 'drizzle-orm';

import { useDb } from '@/hooks/useDb';
import { exercises } from '@/db/schema';
import { getExerciseImageUrls } from '@/lib/exerciseImage';
import { COLORS } from '@/theme';
import { Card, Chip, SectionHeader } from '@/components/ui';

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
        <ActivityIndicator color={COLORS.accent} />
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
        contentContainerClassName="px-5 pt-4 gap-3 pb-10"
      >
        <View className="mb-2">
          <Text className="text-white text-4xl font-bold tracking-tight">
            {displayName}
          </Text>
          {exercise.nameTr && exercise.nameTr !== exercise.name && (
            <Text className="text-muted text-sm mt-2">{exercise.name}</Text>
          )}
        </View>

        {/* Görseller */}
        {imageUrls.length > 0 && (
          <View className="flex-row gap-3">
            {imageUrls.slice(0, 2).map((url, idx) => (
              <View
                key={idx}
                className="flex-1 bg-bg-surface border border-border rounded-3xl overflow-hidden aspect-square"
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
            <Chip size="sm" label={`Ekipman: ${exercise.equipment}`} />
          )}
          {exercise.mechanic && <Chip size="sm" label={exercise.mechanic} />}
          {exercise.force && <Chip size="sm" label={exercise.force} />}
          {exercise.level && <Chip size="sm" label={exercise.level} />}
        </View>

        {/* Kaslar */}
        <SectionHeader title="Çalıştırılan Kaslar" className="mt-4" />
        <Card className="gap-4">
          {primaryMuscles.length > 0 && (
            <View>
              <Text className="text-muted text-xs uppercase tracking-widest">
                Birincil
              </Text>
              <Text className="text-white text-base mt-1">
                {primaryMuscles.join(', ')}
              </Text>
            </View>
          )}
          {secondaryMuscles.length > 0 && (
            <View>
              <Text className="text-muted text-xs uppercase tracking-widest">
                İkincil
              </Text>
              <Text className="text-white text-base mt-1">
                {secondaryMuscles.join(', ')}
              </Text>
            </View>
          )}
        </Card>

        {/* Talimatlar */}
        {instructions.length > 0 && (
          <>
            <SectionHeader title="Nasıl Yapılır" className="mt-4" />
            <Card className="gap-4">
              {instructions.map((step, idx) => (
                <View key={idx} className="flex-row">
                  <Text className="text-muted font-semibold tabular-nums w-7">
                    {idx + 1}.
                  </Text>
                  <Text className="text-white text-base leading-6 flex-1">
                    {step}
                  </Text>
                </View>
              ))}
            </Card>
          </>
        )}
      </ScrollView>
    </>
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
