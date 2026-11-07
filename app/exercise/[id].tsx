import { ScrollView, View, ActivityIndicator } from 'react-native';
import { Text } from '@/components/ui/Text';
import { useLocalSearchParams, Stack } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { eq } from 'drizzle-orm';

import { useDb } from '@/hooks/useDb';
import { exerciseDisplayName } from '@/lib/exerciseCatalog';
import { useColors } from '@/hooks/useTheme';
import { exercises } from '@/db/schema';
import { ExerciseDetailContent } from '@/components/ExerciseDetailContent';

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

  if (!exercise) {
    return (
      <View className="flex-1 items-center justify-center bg-bg p-6">
        <Text className="text-muted">Egzersiz bulunamadı.</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: exerciseDisplayName(exercise) }} />
      <ScrollView
        className="flex-1 bg-bg"
        contentContainerClassName="px-5 pt-4 gap-3 pb-10"
      >
        <ExerciseDetailContent exercise={exercise} showProgress />
      </ScrollView>
    </>
  );
}
