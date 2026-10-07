import { useEffect, useMemo, useRef, useState } from 'react';
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
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { Check, ChevronLeft, ChevronRight, Info, Plus, X } from 'lucide-react-native';
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
import {
  DEFAULT_MAX_DECIMAL_DIGITS,
  MAX_REP_DIGITS,
  MAX_WEIGHT_INTEGER_DIGITS,
  digitsOnly,
  sanitizeDecimalInput,
} from '@/lib/format';
import { useActiveWorkoutStore } from '@/stores/activeWorkoutStore';
import { getLastSessionForExercise, type LastSessionData } from '@/lib/lastSession';
import { getPreviousBestE1rm } from '@/lib/exerciseHistory';
import {
  findSessionRecordSetIds,
  isNewE1rmRecord,
  sessionRecordBaseline,
} from '@/lib/exerciseProgress';
import { saveSessionExerciseNote } from '@/lib/notes';
import { RIR_OPTIONS, formatSetSummary, rirLabel } from '@/lib/rir';
import { afterSetCompleted, supersetPositions } from '@/lib/superset';
import { restNotificationScheduler } from '@/lib/restNative';
import { finishSessionRecord } from '@/lib/finishSession';
import { RestTimer } from '@/components/RestTimer';
import { NoteEditor } from '@/components/NoteEditor';
import { COLORS, DISABLED_ICON } from '@/theme';
import { SecondaryButton } from '@/components/ui';

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
          headerStyle: { backgroundColor: COLORS.bg },
          headerTintColor: COLORS.text,
          headerLeft: () => (
            <Pressable
              onPress={() => router.back()}
              hitSlop={10}
              className="ml-1"
            >
              <X color={COLORS.text} size={22} />
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

  // ── v1.9 süperset ─────────────────────────────────────────────────────
  // Hareketlerin süperset konumu (A1, A2 ...); süperset değilse null
  const supersets = useMemo(
    () => supersetPositions((seData ?? []).map((r) => r.se.supersetGroup)),
    [seData]
  );
  const currentSuperset = seData
    ? supersets[Math.min(currentExerciseIndex, Math.max(0, seData.length - 1))]
    : null;

  // Bulunulan grubun tüm setleri — dinlenme kararı için. Süperset
  // değilse boş liste, sorgu hiçbir satır döndürmez.
  const groupSeIds =
    seData && currentSuperset
      ? seData
          .slice(currentSuperset.start, currentSuperset.end + 1)
          .map((r) => r.se.id)
      : [];
  const { data: groupSets } = useLiveQuery(
    db
      .select({
        id: setsTable.id,
        sessionExerciseId: setsTable.sessionExerciseId,
        isCompleted: setsTable.isCompleted,
      })
      .from(setsTable)
      .where(inArray(setsTable.sessionExerciseId, groupSeIds)),
    [groupSeIds.join(',')]
  );

  // "Sıradaki" barı. fromIndex: barın çıktığı hareket; kullanıcı bara
  // basmadan elle başka harekete geçerse bar kaybolur. Otomatik geçiş yok:
  // tamamlanan setin altındaki RIR seçimi ve rekor rozeti görülebilsin.
  const [nextHint, setNextHint] = useState<{
    fromIndex: number;
    exerciseIndex: number;
    label: string;
  } | null>(null);

  useEffect(() => {
    if (nextHint && nextHint.fromIndex !== currentExerciseIndex) {
      setNextHint(null);
    }
  }, [currentExerciseIndex, nextHint]);
  // ──────────────────────────────────────────────────────────────────────

  // ── Yarım kalan antrenman ───────────────────────────────────────────
  // Açılıştaki "Yarım kalan antrenman" sorusunda Bitir seçildiyse ekran
  // `finish=1` ile açılıyor: hareketler yüklenince normal bitirme akışı
  // (onay + onaylanmamış set sorusu) bir kez başlatılıyor. `finishAt`:
  // son tamamlanan setin zamanı, seans o anda bitmiş sayılıyor.
  const { finish, finishAt } = useLocalSearchParams<{
    finish?: string;
    finishAt?: string;
  }>();
  const finishPromptShown = useRef(false);
  useEffect(() => {
    if (finish !== '1' || finishPromptShown.current) return;
    if (!seData || seData.length === 0) return;
    finishPromptShown.current = true;
    handleFinishWorkout(finishAt || undefined);
    // handleFinishWorkout her render'da yeniden tanımlanıyor; tetikleyici
    // yalnızca hareketlerin yüklenmesi
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finish, seData]);
  // ──────────────────────────────────────────────────────────────────────

  if (!seData) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color={COLORS.accent} />
      </View>
    );
  }

  const safeIndex = Math.min(currentExerciseIndex, Math.max(0, seData.length - 1));
  const current = seData[safeIndex];

  /**
   * v1.9: set tamamlanınca dinlenme başlasın mı (bkz. afterSetCompleted).
   * Süperset olmayan harekette her zaman true — v1.9 öncesiyle aynı.
   * Hesap patlarsa da true: set tamamlama akışı etkilenmesin.
   */
  const handleSetCompleted = (completedSetId: string): boolean => {
    try {
      const result = afterSetCompleted({
        exercises: seData.map((r) => ({
          name: r.exercise.nameTr ?? r.exercise.name,
          supersetGroup: r.se.supersetGroup,
          sets: (groupSets ?? []).filter((s) => s.sessionExerciseId === r.se.id),
        })),
        currentIndex: safeIndex,
        completedSetId,
      });
      setNextHint(
        result.next ? { fromIndex: currentExerciseIndex, ...result.next } : null
      );
      // v2.0: dinlenme bildirimi barla aynı "Sıradaki" metnini taşısın.
      // Sayaç bundan sonra başlıyor; metin o sayaca bağlanıyor.
      restNotificationScheduler.setNextLabel(result.next?.label ?? null);
      return result.startRest;
    } catch (err) {
      console.warn('[SUPERSET] Dinlenme kararı verilemedi:', err);
      restNotificationScheduler.setNextLabel(null);
      return true;
    }
  };

  /**
   * Seansı kapatır. Tek transaction: onaylanmamış setlerin akıbeti,
   * boş setlerin silinmesi ve session'ın bitirilmesi ya hep ya hiç.
   *
   * pendingFilledIds: değer girilmiş ama ✓ ile onaylanmamış setler.
   * mode 'complete' ise bunlar tamamlanmış sayılır, 'delete' ise
   * diğer boş setlerle birlikte silinir.
   *
   * endedAt: yalnızca yarım kalan antrenmanı kurtarma yolu veriyor (son
   * tamamlanan setin zamanı). Verilmezse eskisi gibi "şimdi".
   * Transaction `finishSessionRecord`'da (test edilebilsin diye).
   */
  const finishSession = async (
    pendingFilledIds: string[],
    mode: 'complete' | 'delete',
    endedAt?: string
  ) => {
    const sessionExerciseIds = seData.map((s) => s.se.id);

    try {
      await finishSessionRecord(db, {
        sessionId,
        sessionExerciseIds,
        pendingFilledIds,
        mode,
        endedAt,
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

  /** endedAt: bkz. finishSession — yalnızca kurtarma yolu veriyor */
  const handleFinishWorkout = (endedAt?: string) => {
    Alert.alert('Antrenmanı bitir', 'Bu seansı tamamlamak istiyor musun?', [
      { text: 'Devam et', style: 'cancel' },
      {
        text: 'Bitir',
        style: 'destructive',
        onPress: async () => {
          const pendingFilledIds = await findPendingFilledSets();

          if (pendingFilledIds.length === 0) {
            await finishSession([], 'delete', endedAt);
            return;
          }

          Alert.alert(
            'Onaylanmamış setler',
            `${pendingFilledIds.length} sette değer girilmiş ama onaylanmamış. Ne yapmak istersin?`,
            [
              {
                text: 'Tamamlanmış say',
                onPress: () => finishSession(pendingFilledIds, 'complete', endedAt),
              },
              {
                text: 'Sil',
                style: 'destructive',
                onPress: () => finishSession(pendingFilledIds, 'delete', endedAt),
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
      <View className="flex-row items-center px-3 py-3 bg-bg border-b border-border">
        <Pressable
          onPress={prevExercise}
          disabled={safeIndex === 0}
          hitSlop={8}
          className="w-12 h-12 rounded-full items-center justify-center bg-bg-surface active:bg-bg-elevated"
        >
          <ChevronLeft
            color={safeIndex === 0 ? DISABLED_ICON : COLORS.text}
            size={26}
          />
        </Pressable>
        <View className="flex-1 items-center px-2">
          {/* Hareket adı detayı açar; seans ekranı yığında kaldığı için
              set satırları ve dinlenme sayacı korunur */}
          <Pressable
            onPress={() =>
              router.push({
                pathname: '/exercise/[id]',
                params: { id: current.exercise.id },
              })
            }
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel="Hareket detayını aç"
            className="flex-row items-center max-w-full active:opacity-60"
          >
            {currentSuperset && (
              <View className="bg-accent rounded-md px-1.5 py-0.5 mr-2">
                <Text className="text-accent-fg text-xs font-bold tabular-nums">
                  {currentSuperset.label}
                </Text>
              </View>
            )}
            <Text
              className="text-white text-xl font-semibold tracking-tight shrink"
              numberOfLines={1}
            >
              {current.exercise.nameTr ?? current.exercise.name}
            </Text>
            <Info
              color={COLORS.muted}
              size={16}
              strokeWidth={1.75}
              style={{ marginLeft: 6 }}
            />
          </Pressable>
          <Text className="text-muted/70 text-xs tabular-nums tracking-widest mt-0.5">
            {safeIndex + 1} / {seData.length}
          </Text>
        </View>
        <Pressable
          onPress={nextExercise}
          disabled={safeIndex === seData.length - 1}
          hitSlop={8}
          className="w-12 h-12 rounded-full items-center justify-center bg-bg-surface active:bg-bg-elevated"
        >
          <ChevronRight
            color={
              safeIndex === seData.length - 1 ? DISABLED_ICON : COLORS.text
            }
            size={26}
          />
        </Pressable>
      </View>

      {/* v1.9: süperset üyeleri — basınca o üyeye geçilir */}
      {currentSuperset && (
        <View className="flex-row flex-wrap justify-center gap-2 px-3 py-2 bg-bg border-b border-border">
          {seData
            .slice(currentSuperset.start, currentSuperset.end + 1)
            .map((r, i) => {
              const memberIndex = currentSuperset.start + i;
              const active = memberIndex === safeIndex;
              return (
                <Pressable
                  key={r.se.id}
                  onPress={() => setCurrentExerciseIndex(memberIndex)}
                  disabled={active}
                  hitSlop={6}
                  className={`flex-row items-center rounded-full px-3 h-8 max-w-[48%] active:opacity-70 ${
                    active ? 'bg-accent' : 'bg-bg-surface border border-border'
                  }`}
                >
                  <Text
                    className={`text-xs font-bold tabular-nums mr-1.5 ${
                      active ? 'text-accent-fg' : 'text-accent'
                    }`}
                  >
                    {supersets[memberIndex]?.label}
                  </Text>
                  <Text
                    className={`text-xs shrink ${active ? 'text-accent-fg font-semibold' : 'text-white'}`}
                    numberOfLines={1}
                  >
                    {r.exercise.nameTr ?? r.exercise.name}
                  </Text>
                </Pressable>
              );
            })}
        </View>
      )}

      {/* Egzersiz içeriği (set listesi) */}
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pt-4 gap-3 pb-32"
        keyboardShouldPersistTaps="handled"
      >
        <ExerciseSetEditor
          sessionId={sessionId}
          sessionExerciseId={current.se.id}
          exercise={current.exercise}
          initialNote={current.se.notes}
          onSetCompleted={handleSetCompleted}
        />
      </ScrollView>

      {/* Alt aksiyon: antrenmanı bitir */}
      <View className="bg-bg px-4 py-3 border-t border-border">
        {/* v1.9: süperset "Sıradaki" barı. Dinlenme sayacı bu bölümün
            altında ayrı duruyor; ikisi birlikte görünebilir. */}
        {nextHint && nextHint.fromIndex === currentExerciseIndex && (
          <Pressable
            onPress={() => {
              setCurrentExerciseIndex(nextHint.exerciseIndex);
              setNextHint(null);
            }}
            accessibilityRole="button"
            className="flex-row items-center justify-between min-h-[48px] px-4 mb-3 rounded-2xl bg-accent/10 border border-accent/50 active:opacity-70"
          >
            <Text className="text-accent text-base font-semibold shrink" numberOfLines={1}>
              {nextHint.label}
            </Text>
            <ChevronRight color={COLORS.accent} size={20} />
          </Pressable>
        )}
        <SecondaryButton
          onPress={() => handleFinishWorkout()}
          label="Antrenmanı Bitir"
        />
      </View>
    </KeyboardAvoidingView>
  );
}

interface ExerciseSetEditorProps {
  sessionId: string;
  sessionExerciseId: string;
  exercise: Exercise;
  /** Bu antrenmanda bu hareketin notu (session_exercises.notes) */
  initialNote: string | null;
  /** v1.9: set tamamlanınca dinlenme başlasın mı (süperset kararı) */
  onSetCompleted: (setId: string) => boolean;
}

function ExerciseSetEditor({
  sessionId,
  sessionExerciseId,
  exercise,
  initialNote,
  onSetCompleted,
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

  // Rekor kontrolü: mevcut seans hariç en iyi e1RM, egzersiz ekrana
  // gelince bir kez okunuyor (set başına sorgu yok). Hangi egzersize ait
  // olduğu tutuluyor; editör egzersiz değişince yeniden kurulmuyor, eski
  // egzersizin değeri yenisine karışmasın. Okunamazsa kontrol yapılmıyor.
  const [previousBest, setPreviousBest] = useState<{
    exerciseId: string;
    value: number | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPreviousBestE1rm(db, exercise.id, sessionId)
      .then((value) => {
        if (!cancelled) setPreviousBest({ exerciseId: exercise.id, value });
      })
      .catch((err) => {
        console.warn('[PR-CHECK] Önceki rekor okunamadı:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [db, exercise.id, sessionId]);

  const bestLoaded = previousBest?.exerciseId === exercise.id;

  // Rozetler setlerden türetiliyor: geri alınan setin rozeti kalkıyor,
  // egzersiz değiştirip dönünce rozetler duruyor.
  const recordSetIds = useMemo(
    () =>
      bestLoaded
        ? findSessionRecordSetIds(setsData ?? [], previousBest.value)
        : new Set<string>(),
    [bestLoaded, previousBest, setsData]
  );

  /** ✓ anında: bu tamamlama rekor mu (başarı titreşimi için) */
  const isRecordCompletion = (
    set: WorkoutSet,
    weightKg: number,
    reps: number
  ): boolean => {
    if (!bestLoaded || set.setType !== 'normal') return false;
    const others = (setsData ?? []).filter((s) => s.id !== set.id);
    return isNewE1rmRecord(
      weightKg,
      reps,
      sessionRecordBaseline(previousBest.value, others)
    );
  };

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
      {lastSession && (lastSession.sets.length > 0 || lastSession.notes) && (
        <View className="bg-bg-surface border border-border rounded-2xl px-4 py-3">
          <Text className="text-muted text-xs uppercase tracking-widest">
            Son antrenman ({formatDate(lastSession.sessionDate)})
          </Text>
          {lastSession.sets.length > 0 && (
            <Text className="text-white text-sm mt-1.5 tabular-nums">
              {lastSession.sets
                .map((s) => formatSetSummary(s.weightKg, s.reps, s.rir))
                .join('  •  ')}
            </Text>
          )}
          {/* Önceki antrenmanın hareket notu (salt okunur) */}
          {lastSession.notes && (
            <Text className="text-muted text-sm mt-1.5">
              📝 {lastSession.notes}
            </Text>
          )}
        </View>
      )}

      {/* Set başlık satırı */}
      <View className="flex-row px-2 mt-2">
        <Text className="text-muted text-[11px] tracking-widest w-9">SET</Text>
        <Text className="text-muted text-[11px] tracking-widest flex-1 text-center">
          ÖNCEKİ
        </Text>
        <Text className="text-muted text-[11px] tracking-widest w-20 text-center">
          KG
        </Text>
        <Text className="text-muted text-[11px] tracking-widest w-16 text-center ml-2">
          TEKRAR
        </Text>
        <Text className="text-muted text-[11px] w-12 ml-2"></Text>
      </View>

      {/* Setler */}
      {setsData?.map((set, idx) => (
        <SetRow
          key={set.id}
          set={set}
          previousSet={lastSession?.sets[idx]}
          restSeconds={restSeconds}
          vibrate={vibrate}
          isRecord={recordSetIds.has(set.id)}
          isRecordCompletion={isRecordCompletion}
          onSetCompleted={onSetCompleted}
        />
      ))}

      {/* Set ekle butonu */}
      <Pressable
        onPress={handleAddSet}
        className="min-h-[52px] border border-dashed border-border rounded-2xl items-center flex-row justify-center mt-1 active:bg-bg-surface"
      >
        <Plus color={COLORS.text} size={18} />
        <Text className="text-white text-base font-semibold ml-2">Set Ekle</Text>
      </Pressable>

      {/* Hareket notu. key: başka harekete geçince alan yeniden kurulsun,
          önceki hareketin bekleyen notu kaldırılırken kaydedilsin */}
      <View className="mt-2">
        <NoteEditor
          key={sessionExerciseId}
          initialValue={initialNote}
          onSave={(text) => saveSessionExerciseNote(db, sessionExerciseId, text)}
          addLabel="Not ekle"
          placeholder="Bu hareketle ilgili not (ör. sol omuzda sıkışma)"
        />
      </View>
    </View>
  );
}

interface SetRowProps {
  set: WorkoutSet;
  previousSet?: WorkoutSet;
  restSeconds: number;
  /** Ayarlardaki titreşim tercihi; kapalıysa set tamamlamada haptic olmaz */
  vibrate: boolean;
  /** 🏆 rozeti: bu set seansta bir rekor kırdı */
  isRecord: boolean;
  /** Tamamlama rekor mu — yalnızca başarı titreşimi için */
  isRecordCompletion: (set: WorkoutSet, weightKg: number, reps: number) => boolean;
  /** v1.9: tamamlamadan sonra dinlenme başlasın mı (süperset değilse hep true) */
  onSetCompleted: (setId: string) => boolean;
}

function SetRow({
  set,
  previousSet,
  restSeconds,
  vibrate,
  isRecord,
  isRecordCompletion,
  onSetCompleted,
}: SetRowProps) {
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

  // RIR: tamamlanmış sette, girilmemişse ince seçici sırası; girilmişse
  // "RIR 2" etiketi (basınca seçici yeniden açılır). Set geri alınınca
  // değer silinmiyor, yalnızca gizleniyor.
  const [rirEditing, setRirEditing] = useState(false);
  const [rirHelp, setRirHelp] = useState(false);
  const showRirPicker = set.isCompleted && (set.rir == null || rirEditing);
  const showRirLabel = set.isCompleted && set.rir != null && !rirEditing;

  const selectRir = async (value: number) => {
    await db
      .update(setsTable)
      .set({ rir: value })
      .where(eq(setsTable.id, set.id));
    setRirEditing(false);
    setRirHelp(false);
  };

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
      // v1.9: süpersette tur bitmeden dinlenme başlamaz. Süperset olmayan
      // harekette onSetCompleted hep true döner; koşul eskisiyle aynı kalır.
      if (onSetCompleted(set.id) && restSeconds > 0) {
        startRestTimer(restSeconds);
      }
      // Rekor kontrolü: tamamlama yazıldıktan sonra, ek olarak. Hata
      // tamamlamayı etkilemesin; set tamamlanmış kalır, yalnızca loglanır.
      try {
        if (vibrate && isRecordCompletion(set, parsedWeight, parsedReps)) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      } catch (err) {
        console.warn('[PR-CHECK] Rekor kontrolü başarısız:', err);
      }
    } else {
      // Geri al
      await db
        .update(setsTable)
        .set({ isCompleted: false, completedAt: null })
        .where(eq(setsTable.id, set.id));
    }
  };

  const updateWeight = async (raw: string) => {
    const v = sanitizeDecimalInput(
      raw,
      weight,
      DEFAULT_MAX_DECIMAL_DIGITS,
      MAX_WEIGHT_INTEGER_DIGITS
    );
    setWeight(v);
    const parsed = parseFloat(v.replace(',', '.'));
    await db
      .update(setsTable)
      .set({ weightKg: isNaN(parsed) ? null : parsed })
      .where(eq(setsTable.id, set.id));
  };

  const updateReps = async (raw: string) => {
    const v = digitsOnly(raw);
    setReps(v);
    const parsed = parseInt(v, 10);
    await db
      .update(setsTable)
      .set({ reps: isNaN(parsed) ? null : parsed })
      .where(eq(setsTable.id, set.id));
  };

  return (
    <View>
    <View
      className={`flex-row items-center min-h-[60px] px-2 py-2 rounded-2xl ${
        set.isCompleted ? 'bg-accent/10' : ''
      }`}
    >
      <Text className="text-white text-lg font-semibold tabular-nums w-9">
        {set.setNumber}
      </Text>
      <View className="flex-1 items-center">
        <Text
          className="text-muted text-sm tabular-nums text-center"
          numberOfLines={1}
        >
          {previousLabel}
        </Text>
        {isRecord && (
          <View className="bg-accent rounded-full px-2 py-0.5 mt-1">
            <Text className="text-accent-fg text-[11px] font-semibold">
              🏆 Rekor
            </Text>
          </View>
        )}
        {showRirLabel && (
          <Pressable
            onPress={() => setRirEditing(true)}
            hitSlop={6}
            accessibilityLabel="RIR değerini değiştir"
            className="border border-border rounded-full px-2 py-0.5 mt-1 active:opacity-60"
          >
            <Text className="text-muted text-[11px] font-semibold tabular-nums">
              RIR {rirLabel(set.rir!)}
            </Text>
          </Pressable>
        )}
      </View>
      <TextInput
        value={weight}
        onChangeText={updateWeight}
        placeholder={previousSet?.weightKg ? String(previousSet.weightKg) : '-'}
        placeholderTextColor={COLORS.muted}
        keyboardType="decimal-pad"
        editable={!set.isCompleted}
        className={`w-20 h-12 text-center text-lg font-semibold tabular-nums px-2 rounded-xl ${
          set.isCompleted ? 'bg-transparent text-muted' : 'bg-bg-elevated text-white'
        }`}
      />
      <TextInput
        value={reps}
        onChangeText={updateReps}
        placeholder={previousSet?.reps ? String(previousSet.reps) : '-'}
        placeholderTextColor={COLORS.muted}
        keyboardType="number-pad"
        maxLength={MAX_REP_DIGITS}
        editable={!set.isCompleted}
        className={`w-16 h-12 text-center text-lg font-semibold tabular-nums px-2 rounded-xl ml-2 ${
          set.isCompleted ? 'bg-transparent text-muted' : 'bg-bg-elevated text-white'
        }`}
      />
      <Pressable onPress={toggleComplete} hitSlop={6} className="ml-2">
        <View
          className={`w-12 h-12 rounded-xl items-center justify-center ${
            set.isCompleted ? 'bg-accent' : 'bg-bg-elevated border border-border'
          }`}
        >
          <Check
            color={set.isCompleted ? COLORS.accentFg : COLORS.muted}
            size={20}
            strokeWidth={3}
          />
        </View>
      </Pressable>
    </View>
    {showRirPicker && (
      <RirPicker
        selected={set.rir}
        showHelp={rirHelp}
        onToggleHelp={() => setRirHelp((h) => !h)}
        onSelect={selectRir}
      />
    )}
    </View>
  );
}

/**
 * Tamamlanmış setin altındaki ince RIR sırası: `RIR ?  0 1 2 3 4+`.
 * Tamamen isteğe bağlı; basılmazsa hiçbir şey yazılmıyor.
 */
function RirPicker({
  selected,
  showHelp,
  onToggleHelp,
  onSelect,
}: {
  selected: number | null;
  showHelp: boolean;
  onToggleHelp: () => void;
  onSelect: (value: number) => void;
}) {
  return (
    <View className="px-2 pb-1">
      <View className="flex-row items-center">
        <Text className="text-muted text-[11px] tracking-widest w-9">RIR</Text>
        <Pressable
          onPress={onToggleHelp}
          hitSlop={8}
          accessibilityLabel="RIR nedir?"
          className="w-6 h-6 rounded-full border border-border items-center justify-center mr-2 active:opacity-60"
        >
          <Text className="text-muted text-[11px] font-semibold">?</Text>
        </Pressable>
        {RIR_OPTIONS.map((value) => {
          const active = selected != null && rirLabel(selected) === rirLabel(value);
          return (
            <Pressable
              key={value}
              onPress={() => onSelect(value)}
              hitSlop={4}
              accessibilityLabel={`RIR ${rirLabel(value)}`}
              className={`h-7 min-w-[32px] px-2 rounded-full items-center justify-center mr-1 ${
                active
                  ? 'bg-accent'
                  : 'bg-bg-surface border border-border active:bg-bg-elevated'
              }`}
            >
              <Text
                className={`text-xs font-semibold tabular-nums ${
                  active ? 'text-accent-fg' : 'text-muted'
                }`}
              >
                {rirLabel(value)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {showHelp && (
        <Text className="text-muted text-xs mt-1.5">
          Bu sette kaç tekrar daha yapabilirdin? 0 = tükeniş, 3 = rahat.
        </Text>
      )}
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
