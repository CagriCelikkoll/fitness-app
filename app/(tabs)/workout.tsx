import { useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  Text,
  View,
  ActivityIndicator,
} from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { drizzle, useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { asc, eq, sql } from 'drizzle-orm';
import { Play, Plus, Trash2 } from 'lucide-react-native';

import * as schema from '@/db/schema';
import {
  routineExercises,
  routines,
  sessionExercises,
  sets,
  workoutSessions,
  type Routine,
} from '@/db/schema';
import { newId } from '@/lib/id';
import { useActiveWorkoutStore } from '@/stores/activeWorkoutStore';

export default function WorkoutScreen() {
  const router = useRouter();
  const sqliteDb = useSQLiteContext();
  const db = drizzle(sqliteDb, { schema });

  const activeSessionId = useActiveWorkoutStore((s) => s.activeSessionId);
  const startSession = useActiveWorkoutStore((s) => s.startSession);
  const [starting, setStarting] = useState(false);

  // Tüm aktif (arşivlenmemiş) rutinleri canlı sorgu ile çek
  const { data: routineList } = useLiveQuery(
    db
      .select({
        id: routines.id,
        name: routines.name,
        description: routines.description,
        exerciseCount: sql<number>`(
          SELECT COUNT(*) FROM ${routineExercises}
          WHERE ${routineExercises.routineId} = ${routines.id}
        )`.as('exercise_count'),
      })
      .from(routines)
      .where(eq(routines.isArchived, false))
      .orderBy(asc(routines.name))
  );

  const handleStartRoutine = async (routine: Routine) => {
    if (starting) return;
    setStarting(true);
    try {
      // Rutindeki egzersizleri çek
      const exercisesInRoutine = await db
        .select()
        .from(routineExercises)
        .where(eq(routineExercises.routineId, routine.id))
        .orderBy(asc(routineExercises.orderIndex));

      if (exercisesInRoutine.length === 0) {
        Alert.alert(
          'Boş Rutin',
          'Bu rutin egzersiz içermiyor. Önce egzersiz ekle.'
        );
        return;
      }

      // Yeni session oluştur
      const sessionId = newId();
      await db.insert(workoutSessions).values({
        id: sessionId,
        routineId: routine.id,
        name: routine.name,
        startedAt: new Date().toISOString(),
      });

      // Rutindeki egzersizleri session_exercises'e snapshot et
      const sessionExerciseRows = exercisesInRoutine.map((re, idx) => ({
        id: newId(),
        sessionId,
        exerciseId: re.exerciseId,
        orderIndex: idx,
        supersetGroup: re.supersetGroup,
      }));
      await db.insert(sessionExercises).values(sessionExerciseRows);

      // Her egzersiz için target_sets kadar boş "normal" set oluştur (kullanıcı doldurur)
      const allSets: (typeof sets.$inferInsert)[] = [];
      exercisesInRoutine.forEach((re, exIdx) => {
        const targetSets = re.targetSets ?? 3;
        for (let i = 0; i < targetSets; i++) {
          allSets.push({
            id: newId(),
            sessionExerciseId: sessionExerciseRows[exIdx].id,
            setNumber: i + 1,
            setType: 'normal',
            weightKg: re.targetWeightKg,
            reps: null,
            isCompleted: false,
          });
        }
      });
      if (allSets.length > 0) {
        await db.insert(sets).values(allSets);
      }

      startSession(sessionId);
      router.push('/session/active');
    } catch (err) {
      console.error('Antrenman başlatılırken hata:', err);
      Alert.alert('Hata', String(err));
    } finally {
      setStarting(false);
    }
  };

  const handleDelete = (routine: Routine) => {
    Alert.alert(
      'Rutini Sil',
      `"${routine.name}" rutinini silmek istediğine emin misin?`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Sil',
          style: 'destructive',
          onPress: async () => {
            await db.delete(routines).where(eq(routines.id, routine.id));
          },
        },
      ]
    );
  };

  if (!routineList) {
    return (
      <View className="flex-1 bg-bg items-center justify-center">
        <ActivityIndicator color="#22c55e" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg">
      {/* Aktif session uyarısı */}
      {activeSessionId && (
        <Link href="/session/active" asChild>
          <Pressable className="bg-accent mx-4 mt-4 rounded-xl p-3 flex-row items-center">
            <Play color="#0f172a" size={18} fill="#0f172a" />
            <Text className="text-bg font-semibold ml-2">
              Aktif antrenmana dön
            </Text>
          </Pressable>
        </Link>
      )}

      {routineList.length === 0 ? (
        <View className="flex-1 items-center justify-center p-6">
          <Text className="text-white text-lg font-semibold mb-2">
            Henüz rutin yok
          </Text>
          <Text className="text-muted text-center mb-6">
            İlk antrenman rutinini oluşturarak başla. Egzersizleri seç, hedef
            set/tekrar ata, başlat.
          </Text>
          <Link href="/routine/new" asChild>
            <Pressable className="bg-accent px-6 py-3 rounded-full flex-row items-center">
              <Plus color="#0f172a" size={18} />
              <Text className="text-bg font-semibold ml-1">İlk Rutini Oluştur</Text>
            </Pressable>
          </Link>
        </View>
      ) : (
        <FlatList
          data={routineList}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <RoutineCard
              routine={{
                id: item.id,
                name: item.name,
                description: item.description,
              }}
              exerciseCount={item.exerciseCount}
              onStart={() =>
                handleStartRoutine({
                  id: item.id,
                  name: item.name,
                  description: item.description,
                } as Routine)
              }
              onDelete={() =>
                handleDelete({
                  id: item.id,
                  name: item.name,
                  description: item.description,
                } as Routine)
              }
              starting={starting}
            />
          )}
          contentContainerClassName="p-4 gap-3 pb-24"
        />
      )}

      {/* FAB: Yeni rutin */}
      {routineList.length > 0 && (
        <Link href="/routine/new" asChild>
          <Pressable className="absolute bottom-6 right-6 bg-accent w-14 h-14 rounded-full items-center justify-center shadow-lg">
            <Plus color="#0f172a" size={28} strokeWidth={3} />
          </Pressable>
        </Link>
      )}
    </View>
  );
}

interface RoutineCardProps {
  routine: { id: string; name: string; description: string | null };
  exerciseCount: number;
  onStart: () => void;
  onDelete: () => void;
  starting: boolean;
}

function RoutineCard({
  routine,
  exerciseCount,
  onStart,
  onDelete,
  starting,
}: RoutineCardProps) {
  return (
    <View className="bg-bg-surface rounded-xl p-4">
      <View className="flex-row items-start justify-between">
        <View className="flex-1 mr-3">
          <Text className="text-white text-lg font-semibold">
            {routine.name}
          </Text>
          {routine.description && (
            <Text className="text-muted text-xs mt-0.5" numberOfLines={2}>
              {routine.description}
            </Text>
          )}
          <Text className="text-muted text-xs mt-1">
            {exerciseCount} egzersiz
          </Text>
        </View>
        <Pressable onPress={onDelete} hitSlop={10} className="p-1">
          <Trash2 color="#ef4444" size={18} />
        </Pressable>
      </View>

      <Pressable
        onPress={onStart}
        disabled={starting || exerciseCount === 0}
        className={`mt-3 px-4 py-2.5 rounded-lg flex-row items-center justify-center ${
          starting || exerciseCount === 0 ? 'bg-bg-elevated' : 'bg-accent'
        }`}
      >
        <Play
          color={starting || exerciseCount === 0 ? '#64748b' : '#0f172a'}
          size={16}
          fill={starting || exerciseCount === 0 ? '#64748b' : '#0f172a'}
        />
        <Text
          className={`font-semibold ml-2 ${
            starting || exerciseCount === 0 ? 'text-muted' : 'text-bg'
          }`}
        >
          {starting ? 'Başlatılıyor...' : 'Antrenmanı Başlat'}
        </Text>
      </Pressable>
    </View>
  );
}
