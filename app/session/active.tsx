import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { Check, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';

import { useDb } from '@/hooks/useDb';
import { FALLBACK_REST_VIBRATE, useAppSettings } from '@/hooks/useAppSettings';
import {
  exercises as exercisesTable,
  routineExercises,
  sessionExercises as sessionExercisesTable,
  sets as setsTable,
  workoutSessions,
  type Exercise,
  type WorkoutSet,
} from '@/db/schema';
import { newId } from '@/lib/id';
import { useActiveWorkoutStore } from '@/stores/activeWorkoutStore';
import { getLastSessionForExercise, type LastSessionData } from '@/lib/lastSession';
import { RestTimer } from '@/components/RestTimer';

export default function ActiveSessionScreen() {
  const router = useRouter();
  const db = useDb();

  const activeSessionId = useActiveWorkoutStore((s) => s.activeSessionId);
  const currentExerciseIndex = useActiveWorkoutStore(
    (s) => s.currentExerciseIndex
  );
  const setCurrentExerciseIndex = useActiveWorkoutStore(
    (s) => s.setCurrentExerciseIndex
  );
  const nextExercise = useActiveWorkoutStore((s) => s.nextExercise);
  const prevExercise = useActiveWorkoutStore((s) => s.prevExercise);
  const endSession = useActiveWorkoutStore((s) => s.endSession);

  // Aktif session yoksa workout sayfasına yönlendir
  useEffect(() => {
    if (!activeSessionId) {
      router.replace('/(tabs)/workout');
    }
  }, [activeSessionId, router]);

  if (!activeSessionId) return null;

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen
        options={{
          title: 'Antrenman',
          headerStyle: { backgroundColor: '#0f172a' },
          headerTintColor: '#fff',
          headerLeft: () => (
            <Pressable
              onPress={() => router.back()}
              hitSlop={10}
              className="ml-1"
            >
              <X color="#fff" size={22} />
            </Pressable>
          ),
        }}
      />
      <SessionContent sessionId={activeSessionId} />
      <RestTimer />
    </View>
  );
}

function SessionContent({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const db = useDb();

  const currentExerciseIndex = useActiveWorkoutStore(
    (s) => s.currentExerciseIndex
  );
  const setCurrentExerciseIndex = useActiveWorkoutStore(
    (s) => s.setCurrentExerciseIndex
  );
  const nextExercise = useActiveWorkoutStore((s) => s.nextExercise);
  const prevExercise = useActiveWorkoutStore((s) => s.prevExercise);
  const endSession = useActiveWorkoutStore((s) => s.endSession);

  // Bu seanstaki egzersizler (canlı sorgu)
  const { data: seData } = useLiveQuery(
    db
      .select({
        se: sessionExercisesTable,
        exercise: exercisesTable,
      })
      .from(sessionExercisesTable)
      .innerJoin(
        exercisesTable,
        eq(sessionExercisesTable.exerciseId, exercisesTable.id)
      )
      .where(eq(sessionExercisesTable.sessionId, sessionId))
      .orderBy(asc(sessionExercisesTable.orderIndex)),
    [sessionId]
  );

  if (!seData) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color="#22c55e" />
      </View>
    );
  }

  const safeIndex = Math.min(currentExerciseIndex, Math.max(0, seData.length - 1));
  const current = seData[safeIndex];

  /**
   * Seansı kapatır. Tek transaction: onaylanmamış setlerin akıbeti,
   * boş setlerin silinmesi ve session'ın bitirilmesi ya hep ya hiç.
   *
   * pendingFilledIds: değer girilmiş ama ✓ ile onaylanmamış setler.
   * mode 'complete' ise bunlar tamamlanmış sayılır, 'delete' ise
   * diğer boş setlerle birlikte silinir.
   */
  const finishSession = async (
    pendingFilledIds: string[],
    mode: 'complete' | 'delete'
  ) => {
    const now = new Date().toISOString();
    const sessionExerciseIds = seData.map((s) => s.se.id);

    try {
      await db.transaction(async (tx) => {
        const session = await tx
          .select()
          .from(workoutSessions)
          .where(eq(workoutSessions.id, sessionId))
          .limit(1);
        const startedAt = session[0]?.startedAt;
        const durationSeconds = startedAt
          ? Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
          : null;

        // Kullanıcı "tamamlanmış say" dediyse önce bunları onayla ki
        // aşağıdaki silme onlara dokunmasın.
        if (mode === 'complete' && pendingFilledIds.length > 0) {
          await tx
            .update(setsTable)
            .set({ isCompleted: true, completedAt: now })
            .where(inArray(setsTable.id, pendingFilledIds));
        }

        // Geriye kalan onaylanmamış setleri sil (gereksiz kayıt olmasın)
        if (sessionExerciseIds.length > 0) {
          await tx
            .delete(setsTable)
            .where(
              and(
                inArray(setsTable.sessionExerciseId, sessionExerciseIds),
                eq(setsTable.isCompleted, false)
              )
            );
        }

        await tx
          .update(workoutSessions)
          .set({ endedAt: now, durationSeconds })
          .where(eq(workoutSessions.id, sessionId));
      });
    } catch (err) {
      // Transaction geri alındı; kullanıcı ekranda kalsın, verisi kaybolmasın.
      console.error('[SESSION-FINISH] HATA:', err);
      Alert.alert('Hata', 'Antrenman kaydedilemedi: ' + String(err));
      return;
    }

    endSession();
    router.replace('/(tabs)/workout');
  };

  /** Değer girilmiş ama onaylanmamış setlerin id'leri */
  const findPendingFilledSets = async (): Promise<string[]> => {
    const sessionExerciseIds = seData.map((s) => s.se.id);
    if (sessionExerciseIds.length === 0) return [];

    const pending = await db
      .select({ id: setsTable.id, reps: setsTable.reps })
      .from(setsTable)
      .where(
        and(
          inArray(setsTable.sessionExerciseId, sessionExerciseIds),
          eq(setsTable.isCompleted, false)
        )
      );

    // "Dolu" kriteri: tekrar girilmiş olması. Ağırlık, rutindeki hedef
    // değerden otomatik doluyor — kullanıcı hiçbir şey yazmasa bile dolu
    // görünebilir. Tekrar alanı ise yalnızca kullanıcı yazınca doluyor.
    return pending.filter((s) => s.reps != null).map((s) => s.id);
  };

  const handleFinishWorkout = () => {
    Alert.alert('Antrenmanı bitir', 'Bu seansı tamamlamak istiyor musun?', [
      { text: 'Devam et', style: 'cancel' },
      {
        text: 'Bitir',
        style: 'destructive',
        onPress: async () => {
          const pendingFilledIds = await findPendingFilledSets();

          if (pendingFilledIds.length === 0) {
            await finishSession([], 'delete');
            return;
          }

          Alert.alert(
            'Onaylanmamış setler',
            `${pendingFilledIds.length} sette değer girilmiş ama onaylanmamış. Ne yapmak istersin?`,
            [
              {
                text: 'Tamamlanmış say',
                onPress: () => finishSession(pendingFilledIds, 'complete'),
              },
              {
                text: 'Sil',
                style: 'destructive',
                onPress: () => finishSession(pendingFilledIds, 'delete'),
              },
              { text: 'Vazgeç', style: 'cancel' },
            ]
          );
        },
      },
    ]);
  };

  if (seData.length === 0) {
    return (
      <View className="flex-1 items-center justify-center p-6">
        <Text className="text-white">Bu seansta egzersiz yok.</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1"
    >
      {/* Egzersiz navigasyonu */}
      <View className="flex-row items-center px-4 py-3 bg-bg-surface border-b border-bg-elevated">
        <Pressable
          onPress={prevExercise}
          disabled={safeIndex === 0}
          hitSlop={8}
        >
          <ChevronLeft
            color={safeIndex === 0 ? '#334155' : '#fff'}
            size={28}
          />
        </Pressable>
        <View className="flex-1 items-center">
          <Text className="text-white text-base font-semibold" numberOfLines={1}>
            {current.exercise.nameTr ?? current.exercise.name}
          </Text>
          <Text className="text-muted text-xs">
            {safeIndex + 1} / {seData.length}
          </Text>
        </View>
        <Pressable
          onPress={nextExercise}
          disabled={safeIndex === seData.length - 1}
          hitSlop={8}
        >
          <ChevronRight
            color={safeIndex === seData.length - 1 ? '#334155' : '#fff'}
            size={28}
          />
        </Pressable>
      </View>

      {/* Egzersiz içeriği (set listesi) */}
      <ScrollView
        className="flex-1"
        contentContainerClassName="p-4 gap-3 pb-32"
        keyboardShouldPersistTaps="handled"
      >
        <ExerciseSetEditor
          sessionId={sessionId}
          sessionExerciseId={current.se.id}
          exercise={current.exercise}
        />
      </ScrollView>

      {/* Alt aksiyon: antrenmanı bitir */}
      <View className="bg-bg-surface p-3 border-t border-bg-elevated">
        <Pressable
          onPress={handleFinishWorkout}
          className="bg-bg-elevated rounded-lg py-3 items-center"
        >
          <Text className="text-white font-semibold">Antrenmanı Bitir</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

interface ExerciseSetEditorProps {
  sessionId: string;
  sessionExerciseId: string;
  exercise: Exercise;
}

function ExerciseSetEditor({
  sessionId,
  sessionExerciseId,
  exercise,
}: ExerciseSetEditorProps) {
  const db = useDb();

  // Titreşim tercihi burada okunup SetRow'a geçiliyor; her set satırı
  // ayrı canlı sorgu açmasın diye (aynı anda tek editör render ediliyor).
  const { settings } = useAppSettings();
  const vibrate = settings?.restTimerVibrate ?? FALLBACK_REST_VIBRATE;

  const [lastSession, setLastSession] = useState<LastSessionData | null>(null);
  const [restSeconds, setRestSeconds] = useState<number>(90);

  // Bu egzersizin setlerini canlı sorgu ile çek
  const { data: setsData } = useLiveQuery(
    db
      .select()
      .from(setsTable)
      .where(eq(setsTable.sessionExerciseId, sessionExerciseId))
      .orderBy(asc(setsTable.setNumber)),
    [sessionExerciseId]
  );

  // Auto-fill: son seansı çek
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await getLastSessionForExercise(
        db,
        exercise.id,
        sessionId
      );
      if (!cancelled) setLastSession(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [db, exercise.id, sessionId]);

  // Hedef rest süresini routine_exercises'ten al (varsa)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await db
        .select({ routineId: workoutSessions.routineId })
        .from(workoutSessions)
        .where(eq(workoutSessions.id, sessionId))
        .limit(1);
      const routineId = session[0]?.routineId;
      if (!routineId) return;

      const re = await db
        .select()
        .from(routineExercises)
        .where(
          and(
            eq(routineExercises.routineId, routineId),
            eq(routineExercises.exerciseId, exercise.id)
          )
        )
        .limit(1);
      if (!cancelled && re[0]?.restSeconds) {
        setRestSeconds(re[0].restSeconds);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, exercise.id, sessionId]);

  const handleAddSet = async () => {
    const nextSetNumber = (setsData?.length ?? 0) + 1;
    await db.insert(setsTable).values({
      id: newId(),
      sessionExerciseId,
      setNumber: nextSetNumber,
      setType: 'normal',
      isCompleted: false,
    });
  };

  return (
    <View className="gap-3">
      {/* Auto-fill bilgisi */}
      {lastSession && lastSession.sets.length > 0 && (
        <View className="bg-bg-surface rounded-xl p-3 border-l-2 border-accent">
          <Text className="text-muted text-xs">
            Son antrenman ({formatDate(lastSession.sessionDate)})
          </Text>
          <Text className="text-white text-sm mt-1">
            {lastSession.sets
              .map(
                (s) =>
                  `${s.weightKg ?? '-'}kg × ${s.reps ?? '-'}`
              )
              .join('  •  ')}
          </Text>
        </View>
      )}

      {/* Set başlık satırı */}
      <View className="flex-row px-2">
        <Text className="text-muted text-xs w-8">SET</Text>
        <Text className="text-muted text-xs flex-1 text-center">ÖNCEKİ</Text>
        <Text className="text-muted text-xs w-20 text-center">KG</Text>
        <Text className="text-muted text-xs w-16 text-center">TEKRAR</Text>
        <Text className="text-muted text-xs w-10"></Text>
      </View>

      {/* Setler */}
      {setsData?.map((set, idx) => (
        <SetRow
          key={set.id}
          set={set}
          previousSet={lastSession?.sets[idx]}
          restSeconds={restSeconds}
          vibrate={vibrate}
        />
      ))}

      {/* Set ekle butonu */}
      <Pressable
        onPress={handleAddSet}
        className="bg-bg-surface border border-dashed border-bg-elevated rounded-xl p-3 items-center flex-row justify-center"
      >
        <Plus color="#22c55e" size={16} />
        <Text className="text-accent font-semibold ml-1">Set Ekle</Text>
      </Pressable>
    </View>
  );
}

interface SetRowProps {
  set: WorkoutSet;
  previousSet?: WorkoutSet;
  restSeconds: number;
  /** Ayarlardaki titreşim tercihi; kapalıysa set tamamlamada haptic olmaz */
  vibrate: boolean;
}

function SetRow({ set, previousSet, restSeconds, vibrate }: SetRowProps) {
  const db = useDb();
  const startRestTimer = useActiveWorkoutStore((s) => s.startRestTimer);

  // Lokal state — daha akıcı UI, complete olunca DB'ye yazılır
  const [weight, setWeight] = useState<string>(
    set.weightKg != null ? String(set.weightKg) : ''
  );
  const [reps, setReps] = useState<string>(
    set.reps != null ? String(set.reps) : ''
  );

  // DB'den gelen değişiklikleri lokale yansıt
  useEffect(() => {
    if (set.weightKg != null) setWeight(String(set.weightKg));
    if (set.reps != null) setReps(String(set.reps));
  }, [set.weightKg, set.reps]);

  const previousLabel = previousSet
    ? `${previousSet.weightKg ?? '-'} × ${previousSet.reps ?? '-'}`
    : '—';

  const toggleComplete = async () => {
    const parsedWeight = parseFloat(weight.replace(',', '.'));
    const parsedReps = parseInt(reps, 10);

    if (!set.isCompleted && (isNaN(parsedWeight) || isNaN(parsedReps))) {
      Alert.alert('Eksik bilgi', 'Ağırlık ve tekrar gir.');
      return;
    }

    if (!set.isCompleted) {
      // Tamamla
      await db
        .update(setsTable)
        .set({
          weightKg: parsedWeight,
          reps: parsedReps,
          isCompleted: true,
          completedAt: new Date().toISOString(),
        })
        .where(eq(setsTable.id, set.id));
      if (vibrate) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
      if (restSeconds > 0) {
        startRestTimer(restSeconds);
      }
    } else {
      // Geri al
      await db
        .update(setsTable)
        .set({ isCompleted: false, completedAt: null })
        .where(eq(setsTable.id, set.id));
    }
  };

  const updateWeight = async (v: string) => {
    setWeight(v);
    const parsed = parseFloat(v.replace(',', '.'));
    await db
      .update(setsTable)
      .set({ weightKg: isNaN(parsed) ? null : parsed })
      .where(eq(setsTable.id, set.id));
  };

  const updateReps = async (v: string) => {
    setReps(v);
    const parsed = parseInt(v, 10);
    await db
      .update(setsTable)
      .set({ reps: isNaN(parsed) ? null : parsed })
      .where(eq(setsTable.id, set.id));
  };

  return (
    <View
      className={`flex-row items-center px-2 py-2 rounded-lg ${
        set.isCompleted ? 'bg-accent/10' : ''
      }`}
    >
      <Text className="text-white text-base font-semibold w-8">
        {set.setNumber}
      </Text>
      <Text className="text-muted text-xs flex-1 text-center" numberOfLines={1}>
        {previousLabel}
      </Text>
      <TextInput
        value={weight}
        onChangeText={updateWeight}
        placeholder={previousSet?.weightKg ? String(previousSet.weightKg) : '-'}
        placeholderTextColor="#334155"
        keyboardType="decimal-pad"
        editable={!set.isCompleted}
        className={`w-20 text-center py-2 rounded ${
          set.isCompleted ? 'bg-bg-elevated/50 text-muted' : 'bg-bg-elevated text-white'
        }`}
      />
      <TextInput
        value={reps}
        onChangeText={updateReps}
        placeholder={previousSet?.reps ? String(previousSet.reps) : '-'}
        placeholderTextColor="#334155"
        keyboardType="number-pad"
        editable={!set.isCompleted}
        className={`w-16 text-center py-2 rounded ml-2 ${
          set.isCompleted ? 'bg-bg-elevated/50 text-muted' : 'bg-bg-elevated text-white'
        }`}
      />
      <Pressable onPress={toggleComplete} hitSlop={6} className="ml-2">
        <View
          className={`w-10 h-9 rounded items-center justify-center ${
            set.isCompleted ? 'bg-accent' : 'bg-bg-elevated'
          }`}
        >
          <Check
            color={set.isCompleted ? '#0f172a' : '#64748b'}
            size={18}
            strokeWidth={3}
          />
        </View>
      </Pressable>
    </View>
  );
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Bugün';
  if (diffDays === 1) return 'Dün';
  if (diffDays < 7) return `${diffDays} gün önce`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} hafta önce`;
  return date.toLocaleDateString('tr-TR');
}
