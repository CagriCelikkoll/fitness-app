import { useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  Text,
  View,
  ActivityIndicator,
} from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { asc, count, eq } from 'drizzle-orm';
import { Dumbbell, Pencil, Play, Plus, Trash2 } from 'lucide-react-native';

import { useDb } from '@/hooks/useDb';
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
import { COLORS } from '@/theme';
import { Card, EmptyState, PrimaryButton } from '@/components/ui';

export default function WorkoutScreen() {
  const router = useRouter();
  const db = useDb();

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
        exerciseCount: count(routineExercises.id),
      })
      .from(routines)
      .leftJoin(routineExercises, eq(routineExercises.routineId, routines.id))
      .where(eq(routines.isArchived, false))
      .groupBy(routines.id)
      .orderBy(asc(routines.name))
  );

  useEffect(() => {
    if (routineList) {
      console.log('[ROUTINE-LIST]', JSON.stringify(routineList, null, 2));
    }
  }, [routineList]);

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
        <ActivityIndicator color={COLORS.accent} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg">
      {/* Aktif session uyarısı */}
      {activeSessionId && (
        <View className="px-5 pt-4">
          <Link href="/session/active" asChild>
            <Card variant="accent" className="flex-row items-center py-4">
              <Play color={COLORS.accentFg} size={18} fill={COLORS.accentFg} />
              <Text className="text-accent-fg text-base font-semibold ml-3">
                Aktif antrenmana dön
              </Text>
            </Card>
          </Link>
        </View>
      )}

      {routineList.length === 0 ? (
        <EmptyState
          className="flex-1"
          icon={Dumbbell}
          title="Henüz rutin yok"
          description="İlk antrenman rutinini oluşturarak başla. Egzersizleri seç, hedef set/tekrar ata, başlat."
          action={
            <Link href="/routine/new" asChild>
              <PrimaryButton
                label="İlk Rutini Oluştur"
                icon={Plus}
              />
            </Link>
          }
        />
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
          contentContainerClassName="px-5 pt-4 gap-3 pb-28"
        />
      )}

      {/* FAB: Yeni rutin */}
      {routineList.length > 0 && (
        <Link href="/routine/new" asChild>
          <Pressable className="absolute bottom-6 right-5 bg-accent w-14 h-14 rounded-full items-center justify-center active:opacity-80">
            <Plus color={COLORS.accentFg} size={26} strokeWidth={2.5} />
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
    <Card>
      <View className="flex-row items-start justify-between">
        <View className="flex-1 mr-3">
          <Text className="text-white text-xl font-semibold tracking-tight">
            {routine.name}
          </Text>
          {routine.description && (
            <Text className="text-muted text-sm mt-1" numberOfLines={2}>
              {routine.description}
            </Text>
          )}
          <Text className="text-muted text-xs uppercase tracking-widest mt-3 tabular-nums">
            {exerciseCount} egzersiz
          </Text>
        </View>
        <View className="flex-row items-center -mr-2 -mt-2">
          <Link
            href={{ pathname: '/routine/[id]', params: { id: routine.id } }}
            asChild
          >
            <Pressable
              hitSlop={4}
              className="w-10 h-10 items-center justify-center rounded-full active:bg-bg-elevated"
            >
              <Pencil color={COLORS.muted} size={17} strokeWidth={1.75} />
            </Pressable>
          </Link>
          <Pressable
            onPress={onDelete}
            hitSlop={4}
            className="w-10 h-10 items-center justify-center rounded-full active:bg-bg-elevated"
          >
            <Trash2 color={COLORS.muted} size={17} strokeWidth={1.75} />
          </Pressable>
        </View>
      </View>

      <PrimaryButton
        onPress={onStart}
        disabled={starting || exerciseCount === 0}
        label={starting ? 'Başlatılıyor...' : 'Antrenmanı Başlat'}
        icon={Play}
        iconFill
        className="mt-5"
      />
    </Card>
  );
}
