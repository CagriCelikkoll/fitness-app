import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { Text, TextInput } from '@/components/ui/Text';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { Check, ChevronDown, ChevronLeft, ChevronRight, Info, NotebookPen, Plus, X } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';

import { useDb } from '@/hooks/useDb';
import { exerciseDisplayName } from '@/lib/exerciseCatalog';
import { FALLBACK_REST_SOUND, FALLBACK_REST_VIBRATE, useAppSettings } from '@/hooks/useAppSettings';
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
import { findSessionRecordSetIds, isNewE1rmRecord, sessionRecordBaseline } from '@/lib/exerciseProgress';
import { saveSessionExerciseNote } from '@/lib/notes';
import { RIR_OPTIONS, formatSetSummary, rirLabel } from '@/lib/rir';
import { afterSetCompleted, supersetPositions } from '@/lib/superset';
import { restNotificationScheduler } from '@/lib/restNative';
import { finishSessionRecord } from '@/lib/finishSession';
import {
  PROGRESSION_HELP,
  applySuggestedWeight,
  getProgressionSuggestion,
  type ProgressionSuggestion,
} from '@/lib/progression';
import {
  completeSetRecord,
  parseSetInput,
  saveSetReps,
  saveSetRir,
  saveSetWeight,
  uncompleteSetRecord,
} from '@/lib/setCompletion';
import {
  exerciseAfterSet,
  finishConfirmation,
  focusLabel,
  focusSetIndex,
  nextAfterSet,
  nextIncompleteExercise,
  nextUpText,
  prefillValues,
  earlierCompletedSet,
  progressSegments,
  repsA11yLabel,
  setValueText,
  stepReps,
  stepWeight,
  supersetMemberLabels,
  weightA11yLabel,
  weightStep,
  workoutProgress,
  type FocusExercise,
} from '@/lib/focusMode';
import { contextColorFor } from '@/lib/contextColor';
import { withAlpha } from '@/lib/color';
import { upperTr } from '@/lib/typography';
import { CHIP_TINT_ALPHA } from '@/components/ui/Chip';
import { muscleLabels } from '@/lib/exerciseTaxonomy';
import { saveSettings } from '@/lib/appSettings';
import { useProgressionSetting } from '@/hooks/useProgressionSetting';
import { useColors, useContextOutline, useContextTones } from '@/hooks/useTheme';
import { useScreenTopInset } from '@/hooks/useSafeBottom';
import { FocusSheet } from '@/components/FocusSheet';
import { RestTimerBar, useRestTimerController, type RestTimerController } from '@/components/RestTimer';
import { RestScreen, WorkoutClock, type RestLastSet, type RestNextCard } from '@/components/RestScreen';
import { NoteEditor } from '@/components/NoteEditor';
import { Glow, IconButton, PrimaryButton, SecondaryButton, SectionLabel } from '@/components/ui';
import type { ContextKind } from '@/theme';

/**
 * Aktif antrenman (v4.0a: odak modu, dinlenme ekranı, tüm liste).
 *
 * Mantık değişmedi, yalnızca görünüm:
 * - Set yazımları `src/lib/setCompletion.ts` (önceki `SetRow` sorguları),
 *   tamamlama sırası `useSetCompletion` (titreşim → süperset kararı →
 *   dinlenme → rekor titreşimi; eskisiyle aynı).
 * - Dinlenme sayacı `useRestTimerController` (bir kez bağlanır).
 * - Süperset kararı `afterSetCompleted`, bitirme `finishSessionRecord`.
 * - "Sıradaki" / yüzde / hazır değerler `src/lib/focusMode.ts` (saf, test).
 */

type ViewMode = 'focus' | 'list';

interface SessionRow {
  se: typeof sessionExercisesTable.$inferSelect;
  exercise: Exercise;
}

export default function ActiveSessionScreen() {
  const router = useRouter();
  const activeSessionId = useActiveWorkoutStore((s) => s.activeSessionId);
  // Dinlenme sayacının bitişi (titreşim, ses, 3 sn sonra kapanma) tek yerde
  const restController = useRestTimerController();

  // Aktif session yoksa workout sayfasına yönlendir
  useEffect(() => {
    if (!activeSessionId) {
      router.replace('/(tabs)/workout');
    }
  }, [activeSessionId, router]);

  if (!activeSessionId) return null;

  return (
    <View className="flex-1 bg-bg">
      {/* Kendi üst satırı var (küçült · süre · Bitir) */}
      <Stack.Screen options={{ headerShown: false }} />
      <SessionContent sessionId={activeSessionId} restController={restController} />
    </View>
  );
}

function SessionContent({ sessionId, restController }: { sessionId: string; restController: RestTimerController }) {
  const COLORS = useColors();
  const router = useRouter();
  const db = useDb();
  const topInset = useScreenTopInset();

  const currentExerciseIndex = useActiveWorkoutStore((s) => s.currentExerciseIndex);
  const setCurrentExerciseIndex = useActiveWorkoutStore((s) => s.setCurrentExerciseIndex);
  const endSession = useActiveWorkoutStore((s) => s.endSession);

  const { settings } = useAppSettings();
  const soundOn = settings?.restTimerSound ?? FALLBACK_REST_SOUND;

  // Bu seanstaki egzersizler (canlı sorgu)
  const { data: seData } = useLiveQuery(
    db
      .select({
        se: sessionExercisesTable,
        exercise: exercisesTable,
      })
      .from(sessionExercisesTable)
      .innerJoin(exercisesTable, eq(sessionExercisesTable.exerciseId, exercisesTable.id))
      .where(eq(sessionExercisesTable.sessionId, sessionId))
      .orderBy(asc(sessionExercisesTable.orderIndex)),
    [sessionId]
  );

  // Seans satırı: başlangıç (geçen süre) ve ad
  const { data: sessionRows } = useLiveQuery(
    db.select().from(workoutSessions).where(eq(workoutSessions.id, sessionId)).limit(1),
    [sessionId]
  );
  const session = sessionRows?.[0];

  // ── v1.9 süperset ─────────────────────────────────────────────────────
  // Hareketlerin süperset konumu (A1, A2 ...); süperset değilse null
  const supersets = useMemo(() => supersetPositions((seData ?? []).map((r) => r.se.supersetGroup)), [seData]);

  // Seansın bütün setleri: yüzde, bölümlü çizgi, "Sıradaki" ve süperset
  // kararı (v4.0a; önceden yalnızca bulunulan süperset grubunun setleri
  // okunuyordu — aynı satırlar, şimdi bütün liste ekranda görünüyor)
  const seIds = (seData ?? []).map((r) => r.se.id);
  const { data: allSets } = useLiveQuery(
    db
      .select()
      .from(setsTable)
      .where(inArray(setsTable.sessionExerciseId, seIds))
      .orderBy(asc(setsTable.setNumber)),
    [seIds.join(',')]
  );

  const focusExercises = useMemo<FocusExercise[]>(
    () =>
      (seData ?? []).map((r) => ({
        name: exerciseDisplayName(r.exercise),
        supersetGroup: r.se.supersetGroup,
        sets: (allSets ?? [])
          .filter((s) => s.sessionExerciseId === r.se.id)
          .map((s) => ({ id: s.id, setNumber: s.setNumber, isCompleted: s.isCompleted })),
      })),
    [seData, allSets]
  );

  // Antrenmanın bağlam rengi (v4.0a 1.2): kas gruplarına göre
  const workoutColor = useMemo<ContextKind>(
    () =>
      contextColorFor(
        (seData ?? []).map((r) => ({
          primaryMuscles: r.exercise.primaryMuscles,
          category: r.exercise.category,
          sets: Math.max(1, (allSets ?? []).filter((s) => s.sessionExerciseId === r.se.id).length),
        }))
      ),
    [seData, allSets]
  );

  // "Sıradaki" barı (tüm liste). fromIndex: barın çıktığı hareket; kullanıcı
  // bara basmadan elle başka harekete geçerse bar kaybolur.
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

  // ── v4.0a görünüm durumu ────────────────────────────────────────────
  const [mode, setMode] = useState<ViewMode>('focus');
  const [restMinimized, setRestMinimized] = useState(false);
  const [lastCompleted, setLastCompleted] = useState<{ setId: string; exerciseIndex: number } | null>(null);
  // Hareketin son seti tamamlanınca dinlenme bittiğinde geçilecek hareket
  const pendingAdvance = useRef<number | null>(null);
  const restActive = restController.restTimer != null;
  useEffect(() => {
    if (restActive) return;
    if (pendingAdvance.current != null) {
      setCurrentExerciseIndex(pendingAdvance.current);
      pendingAdvance.current = null;
    }
  }, [restActive, setCurrentExerciseIndex]);

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
  const progress = workoutProgress(focusExercises);
  const startedAtMs = session ? new Date(session.startedAt).getTime() : Date.now();

  /**
   * v1.9: set tamamlanınca dinlenme başlasın mı (bkz. afterSetCompleted).
   * Süperset olmayan harekette her zaman true — v1.9 öncesiyle aynı.
   * Hesap patlarsa da true: set tamamlama akışı etkilenmesin.
   * v4.0a: tüm listede her hareket düzenlenebildiği için hareketin indeksi
   * parametre (önceden hep bulunulan hareket).
   */
  const handleSetCompleted = (completedSetId: string, exerciseIndex: number): boolean => {
    try {
      const result = afterSetCompleted({
        exercises: seData.map((r) => ({
          name: exerciseDisplayName(r.exercise),
          supersetGroup: r.se.supersetGroup,
          sets: (allSets ?? []).filter((s) => s.sessionExerciseId === r.se.id),
        })),
        currentIndex: exerciseIndex,
        completedSetId,
      });
      setNextHint(result.next ? { fromIndex: exerciseIndex, ...result.next } : null);
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

  /** Tüm listede set tamamlandı: o hareket "bulunulan" olur, dinlenme alt çubukta */
  /** Elle hareket değişince dinlenme sonrası otomatik geçiş iptal */
  const goToExercise = (index: number) => {
    pendingAdvance.current = null;
    setCurrentExerciseIndex(index);
  };

  const handleListSetCompleted = (completedSetId: string, exerciseIndex: number): boolean => {
    pendingAdvance.current = null;
    setCurrentExerciseIndex(exerciseIndex);
    setRestMinimized(true);
    return handleSetCompleted(completedSetId, exerciseIndex);
  };

  /** Odakta set tamamlandı (yazım ve dinlenme kararından sonra) */
  const handleFocusCompleted = (completedSetId: string, restStarted: boolean) => {
    const target = exerciseAfterSet(focusExercises, safeIndex, completedSetId);
    setLastCompleted({ setId: completedSetId, exerciseIndex: safeIndex });
    if (restStarted) {
      setRestMinimized(false);
      pendingAdvance.current = target;
    } else {
      // Süperset turu (dinlenmesiz) ya da dinlenme süresi 0: hemen geç
      pendingAdvance.current = null;
      setCurrentExerciseIndex(target);
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
  const finishSession = async (pendingFilledIds: string[], mode: 'complete' | 'delete', endedAt?: string) => {
    const sessionExerciseIds = seData.map((s) => s.se.id);
    // Özetteki "x / y" için bitirmeden önceki set sayısı (boşlar silinecek)
    const plannedSets = workoutProgress(focusExercises).total;

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
    // v4.0a: antrenman özeti ("Kaydet ve kapat" → Antrenman sekmesi)
    router.replace({ pathname: '/session/summary', params: { id: sessionId, planned: String(plannedSets) } });
  };

  /** Değer girilmiş ama onaylanmamış setlerin id'leri */
  const findPendingFilledSets = async (): Promise<string[]> => {
    const sessionExerciseIds = seData.map((s) => s.se.id);
    if (sessionExerciseIds.length === 0) return [];

    const pending = await db
      .select({ id: setsTable.id, reps: setsTable.reps })
      .from(setsTable)
      .where(and(inArray(setsTable.sessionExerciseId, sessionExerciseIds), eq(setsTable.isCompleted, false)));

    // "Dolu" kriteri: tekrar girilmiş olması. Ağırlık, rutindeki hedef
    // değerden otomatik doluyor — kullanıcı hiçbir şey yazmasa bile dolu
    // görünebilir. Tekrar alanı ise yalnızca kullanıcı yazınca doluyor.
    return pending.filter((s) => s.reps != null).map((s) => s.id);
  };

  /** Onaydan sonraki adım: onaylanmamış set sorusu (değişmedi) */
  const finishAfterConfirm = async (endedAt?: string) => {
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
  };

  /**
   * endedAt: bkz. finishSession — yalnızca kurtarma yolu veriyor.
   * v4.0a: tamamlanmamış set varsa "Antrenmanı bitir? N set tamamlanmadı."
   * diye sorulur; bütün setler bittiyse onaysız biter.
   */
  const handleFinishWorkout = (endedAt?: string) => {
    const confirm = finishConfirmation(focusExercises);
    if (!confirm.needed) {
      void finishAfterConfirm(endedAt);
      return;
    }
    Alert.alert('Antrenmanı bitir?', confirm.message, [
      { text: 'Devam et', style: 'cancel' },
      { text: 'Bitir', style: 'destructive', onPress: () => void finishAfterConfirm(endedAt) },
    ]);
  };

  if (seData.length === 0) {
    return (
      <View className="flex-1 items-center justify-center p-6" style={{ paddingTop: topInset }}>
        <Text className="text-fg">Bu seansta egzersiz yok.</Text>
        <SecondaryButton label="Kapat" onPress={() => router.back()} className="mt-4" />
      </View>
    );
  }

  // ── Dinlenme ekranı (odaktan tamamlanan setten sonra) ──────────────
  if (mode === 'focus' && restActive && !restMinimized) {
    const last = lastCompleted ? (allSets ?? []).find((s) => s.id === lastCompleted.setId) : undefined;
    const lastSet: RestLastSet | null =
      last && last.weightKg != null && last.reps != null
        ? { setId: last.id, setNumber: last.setNumber, weightKg: last.weightKg, reps: last.reps, rir: last.rir }
        : null;
    let next: RestNextCard | null = null;
    if (lastCompleted && last) {
      const target = nextAfterSet(focusExercises, lastCompleted.exerciseIndex, last.id);
      const ex = target ? seData[target.exerciseIndex] : undefined;
      const targetSets = target ? (allSets ?? []).filter((s) => s.sessionExerciseId === ex?.se.id) : [];
      const nextSet = target ? targetSets[target.setIndex] : undefined;
      if (target && ex && nextSet) {
        const sameExercise = target.exerciseIndex === lastCompleted.exerciseIndex;
        next = {
          setLabel: `Set ${target.setIndex + 1} / ${targetSets.length}`,
          name: exerciseDisplayName(ex.exercise),
          value: sameExercise
            ? setValueText(nextSet.weightKg ?? last.weightKg, nextSet.reps ?? last.reps)
            : setValueText(nextSet.weightKg, nextSet.reps),
          color: contextColorFor([{ primaryMuscles: ex.exercise.primaryMuscles, category: ex.exercise.category, sets: 1 }]),
        };
      }
    }
    return (
      <RestScreen
        controller={restController}
        workoutStartedAt={startedAtMs}
        percent={progress.percent}
        soundOn={soundOn}
        onToggleSound={() =>
          saveSettings(db, { restTimerSound: !soundOn }).catch((err) =>
            console.warn('[REST] Ses ayarı kaydedilemedi:', err)
          )
        }
        onMinimize={() => setRestMinimized(true)}
        lastSet={lastSet}
        onSelectRir={(setId, rir) =>
          saveSetRir(db, setId, rir).catch((err) => console.warn('[RIR] Kaydedilemedi:', err))
        }
        next={next}
      />
    );
  }

  const topBar = (
    <View className="flex-row items-center justify-between px-4" style={{ paddingTop: topInset + 8 }}>
      {mode === 'focus' ? (
        <IconButton icon={ChevronDown} accessibilityLabel="Antrenmanı küçült" onPress={() => router.back()} />
      ) : (
        <Pressable
          onPress={() => setMode('focus')}
          accessibilityRole="button"
          className="h-11 px-3.5 rounded-[14px] bg-bg-surface border border-border flex-row items-center gap-1.5 active:opacity-70"
        >
          <ChevronLeft color={COLORS.text} size={18} />
          <Text className="text-fg text-sm font-bold">Odak modu</Text>
        </Pressable>
      )}
      <View className="flex-1 items-center px-2">
        <WorkoutClock startedAt={startedAtMs} percent={progress.percent} />
        {mode === 'focus' && session && (
          <Text className="text-muted text-xs mt-0.5" numberOfLines={1}>
            {session.name}
          </Text>
        )}
      </View>
      <Pressable
        onPress={() => handleFinishWorkout()}
        accessibilityRole="button"
        accessibilityLabel="Antrenmanı bitir"
        className="h-11 px-4 rounded-[14px] bg-bg-surface border border-border items-center justify-center active:opacity-70"
      >
        <Text className="text-fg text-sm font-bold">Bitir</Text>
      </Pressable>
    </View>
  );

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
      {mode === 'focus' && <Glow color={workoutColor} />}
      {topBar}

      {mode === 'focus' ? (
        <FocusView
          key={current.se.id}
          sessionId={sessionId}
          row={current}
          exerciseIndex={safeIndex}
          rows={seData}
          focusExercises={focusExercises}
          supersets={supersets}
          color={workoutColor}
          weightUnit={settings?.weightUnit ?? 'kg'}
          onSetCompleted={(id) => handleSetCompleted(id, safeIndex)}
          onCompleted={handleFocusCompleted}
          onOpenList={() => setMode('list')}
          onGoToExercise={goToExercise}
          onFinish={() => handleFinishWorkout()}
        />
      ) : (
        <ListView
          sessionId={sessionId}
          rows={seData}
          focusExercises={focusExercises}
          supersets={supersets}
          currentIndex={safeIndex}
          color={workoutColor}
          sessionName={session?.name ?? ''}
          onSetCompleted={handleListSetCompleted}
          onOpenInFocus={(i) => {
            goToExercise(i);
            setMode('focus');
          }}
        />
      )}

      {/* v1.9: süperset "Sıradaki" barı (tüm liste) */}
      {mode === 'list' && nextHint && nextHint.fromIndex === currentExerciseIndex && (
        <View className="bg-bg px-4 pt-3 border-t border-border">
          <Pressable
            onPress={() => {
              goToExercise(nextHint.exerciseIndex);
              setNextHint(null);
            }}
            accessibilityRole="button"
            className="flex-row items-center justify-between min-h-[48px] px-4 rounded-2xl bg-accent/10 border border-accent/50 active:opacity-70"
          >
            <Text className="text-accent text-base font-semibold shrink" numberOfLines={1}>
              {nextHint.label}
            </Text>
            <ChevronRight color={COLORS.accent} size={20} />
          </Pressable>
        </View>
      )}

      {/* Dinlenme alt çubuğu: küçültülmüş (odak) ya da tüm liste */}
      <RestTimerBar
        controller={restController}
        onExpand={() => {
          setMode('focus');
          setRestMinimized(false);
        }}
      />
    </KeyboardAvoidingView>
  );
}

// ============================================================================
// Hareketin verisi (odak ve liste ortak; önceki ExerciseSetEditor'dan)
// ============================================================================

function useExerciseSessionData(sessionId: string, sessionExerciseId: string, exercise: Exercise) {
  const db = useDb();

  const [lastSession, setLastSession] = useState<LastSessionData | null>(null);
  const [restSeconds, setRestSeconds] = useState<number>(90);
  // v4.0a: rutindeki hedef (odak modunda hazır değer); dinlenmeyle aynı sorgu
  const [target, setTarget] = useState<{ exerciseId: string; weightKg: number | null; reps: string | null } | null>(null);

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
      const result = await getLastSessionForExercise(db, exercise.id, sessionId);
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
        .where(and(eq(routineExercises.routineId, routineId), eq(routineExercises.exerciseId, exercise.id)))
        .limit(1);
      if (!cancelled && re[0]?.restSeconds) {
        setRestSeconds(re[0].restSeconds);
      }
      if (!cancelled && re[0]) {
        setTarget({ exerciseId: exercise.id, weightKg: re[0].targetWeightKg, reps: re[0].targetReps });
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

  // ── v2.1 ilerleme önerisi ─────────────────────────────────────────────
  // Hesap `progression.ts`'te; burada yalnızca okuma. Hangi harekete ait
  // olduğu tutuluyor. Okunamazsa öneri gösterilmiyor, ekran etkilenmiyor.
  const progressionSetting = useProgressionSetting();
  const [progression, setProgression] = useState<{
    sessionExerciseId: string;
    value: ProgressionSuggestion | null;
  } | null>(null);

  useEffect(() => {
    if (!progressionSetting.loaded || !progressionSetting.enabled) return;
    let cancelled = false;
    getProgressionSuggestion(db, { sessionId, sessionExerciseId, exerciseId: exercise.id })
      .then((value) => {
        if (!cancelled) setProgression({ sessionExerciseId, value });
      })
      .catch((err) => {
        console.warn('[PROGRESSION] Öneri hesaplanamadı:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [db, exercise.id, sessionId, sessionExerciseId, progressionSetting.loaded, progressionSetting.enabled]);

  const suggestion =
    progressionSetting.loaded && progressionSetting.enabled && progression?.sessionExerciseId === sessionExerciseId
      ? progression.value
      : null;

  // Rozetler setlerden türetiliyor: geri alınan setin rozeti kalkıyor,
  // egzersiz değiştirip dönünce rozetler duruyor.
  const recordSetIds = useMemo(
    () => (bestLoaded ? findSessionRecordSetIds(setsData ?? [], previousBest.value) : new Set<string>()),
    [bestLoaded, previousBest, setsData]
  );

  /** ✓ anında: bu tamamlama rekor mu (başarı titreşimi için) */
  const isRecordCompletion = (set: WorkoutSet, weightKg: number, reps: number): boolean => {
    if (!bestLoaded || set.setType !== 'normal') return false;
    const others = (setsData ?? []).filter((s) => s.id !== set.id);
    return isNewE1rmRecord(weightKg, reps, sessionRecordBaseline(previousBest.value, others));
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

  return {
    setsData,
    lastSession,
    restSeconds,
    target: target?.exerciseId === exercise.id ? target : null,
    recordSetIds,
    isRecordCompletion,
    suggestion,
    handleAddSet,
  };
}

/**
 * Set tamamlama / geri alma — önceki `SetRow.toggleComplete`'in aynısı:
 * eksik bilgi uyarısı → yazım → titreşim → süperset kararı ve dinlenme →
 * rekor titreşimi. `restStarted`: odak modu dinlenme ekranını açsın mı.
 */
function useSetCompletion({
  restSeconds,
  vibrate,
  isRecordCompletion,
  onSetCompleted,
}: {
  restSeconds: number;
  vibrate: boolean;
  isRecordCompletion: (set: WorkoutSet, weightKg: number, reps: number) => boolean;
  onSetCompleted: (setId: string) => boolean;
}) {
  const db = useDb();
  const startRestTimer = useActiveWorkoutStore((s) => s.startRestTimer);

  return async (
    set: WorkoutSet,
    weight: string,
    reps: string
  ): Promise<{ status: 'completed' | 'uncompleted' | 'invalid'; restStarted: boolean }> => {
    if (set.isCompleted) {
      // Geri al
      await uncompleteSetRecord(db, set.id);
      return { status: 'uncompleted', restStarted: false };
    }

    const parsed = parseSetInput(weight, reps);
    if (!parsed) {
      Alert.alert('Eksik bilgi', 'Ağırlık ve tekrar gir.');
      return { status: 'invalid', restStarted: false };
    }

    // Tamamla
    await completeSetRecord(db, set.id, parsed);
    if (vibrate) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    // v1.9: süpersette tur bitmeden dinlenme başlamaz. Süperset olmayan
    // harekette onSetCompleted hep true döner; koşul eskisiyle aynı kalır.
    let restStarted = false;
    if (onSetCompleted(set.id) && restSeconds > 0) {
      startRestTimer(restSeconds);
      restStarted = true;
    }
    // Rekor kontrolü: tamamlama yazıldıktan sonra, ek olarak. Hata
    // tamamlamayı etkilemesin; set tamamlanmış kalır, yalnızca loglanır.
    try {
      if (vibrate && isRecordCompletion(set, parsed.weightKg, parsed.reps)) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err) {
      console.warn('[PR-CHECK] Rekor kontrolü başarısız:', err);
    }
    return { status: 'completed', restStarted };
  };
}

function useVibrateSetting(): boolean {
  // Titreşim tercihi bir kez okunup set satırlarına geçiliyor
  const { settings } = useAppSettings();
  return settings?.restTimerVibrate ?? FALLBACK_REST_VIBRATE;
}

// ============================================================================
// Odak modu (v4.0a 2.1)
// ============================================================================

interface FocusViewProps {
  sessionId: string;
  row: SessionRow;
  exerciseIndex: number;
  rows: SessionRow[];
  focusExercises: FocusExercise[];
  supersets: ReturnType<typeof supersetPositions>;
  color: ContextKind;
  weightUnit: string;
  onSetCompleted: (setId: string) => boolean;
  onCompleted: (setId: string, restStarted: boolean) => void;
  onOpenList: () => void;
  onGoToExercise: (index: number) => void;
  onFinish: () => void;
}

function FocusView({
  sessionId,
  row,
  exerciseIndex,
  rows,
  focusExercises,
  supersets,
  color,
  weightUnit,
  onSetCompleted,
  onCompleted,
  onOpenList,
  onGoToExercise,
  onFinish,
}: FocusViewProps) {
  const COLORS = useColors();
  const db = useDb();
  const tones = useContextTones(color);
  const outline = useContextOutline(color);
  const vibrate = useVibrateSetting();
  const data = useExerciseSessionData(sessionId, row.se.id, row.exercise);
  const toggle = useSetCompletion({
    restSeconds: data.restSeconds,
    vibrate,
    isRecordCompletion: data.isRecordCompletion,
    onSetCompleted,
  });

  const sets = data.setsData ?? [];
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);
  const setIndex = focusSetIndex(sets, selectedSetId);
  const set = setIndex != null ? sets[setIndex] : undefined;
  const previous = setIndex != null ? data.lastSession?.sets[setIndex] : undefined;

  // Hazır değerler (yazılmaz) + kullanıcının bu sette yazdığı (yazılır)
  const prefill = set
    ? prefillValues({
        weightKg: set.weightKg,
        reps: set.reps,
        earlier: earlierCompletedSet(sets, setIndex!),
        previous: previous ?? null,
        targetWeightKg: data.target?.weightKg ?? null,
        targetReps: data.target?.reps ?? null,
      })
    : null;
  const [edit, setEdit] = useState<{ setId: string; weight?: string; reps?: string } | null>(null);
  const editing = edit && set && edit.setId === set.id ? edit : null;
  const weight = editing?.weight ?? (set?.isCompleted ? (set.weightKg != null ? String(set.weightKg) : '') : prefill?.weight ?? '');
  const reps = editing?.reps ?? (set?.isCompleted ? (set.reps != null ? String(set.reps) : '') : prefill?.reps ?? '');

  const [sheet, setSheet] = useState<'info' | 'note' | null>(null);
  const [busy, setBusy] = useState(false);

  const updateWeight = (raw: string) => {
    if (!set) return;
    const v = sanitizeDecimalInput(raw, weight, DEFAULT_MAX_DECIMAL_DIGITS, MAX_WEIGHT_INTEGER_DIGITS);
    setEdit({ ...(editing ?? { setId: set.id }), weight: v });
    void saveSetWeight(db, set.id, v);
  };
  const updateReps = (raw: string) => {
    if (!set) return;
    const v = digitsOnly(raw);
    setEdit({ ...(editing ?? { setId: set.id }), reps: v });
    void saveSetReps(db, set.id, v);
  };

  const complete = async () => {
    if (!set || busy) return;
    setBusy(true);
    try {
      const result = await toggle(set, weight, reps);
      if (result.status === 'completed') {
        setSelectedSetId(null);
        setEdit(null);
        onCompleted(set.id, result.restStarted);
      } else if (result.status === 'uncompleted') {
        setSelectedSetId(set.id);
      }
    } finally {
      setBusy(false);
    }
  };

  const superset = supersets[exerciseIndex] ?? null;
  const label = focusLabel({
    exerciseIndex,
    exerciseCount: rows.length,
    setIndex,
    setCount: sets.length,
    superset,
    supersetMembers: supersetMemberLabels(supersets, exerciseIndex),
  });
  const muscles = [...muscleLabels(row.exercise.primaryMuscles), ...muscleLabels(row.exercise.secondaryMuscles)];
  const segments = progressSegments(focusExercises);
  const next = set && !set.isCompleted ? nextAfterSet(focusExercises, exerciseIndex, set.id) : null;
  const nextIncomplete = nextIncompleteExercise(focusExercises, exerciseIndex);
  const lastTimeText = previous ? setValueText(previous.weightKg, previous.reps) : null;
  const step = weightStep(weightUnit);
  const unitLabel = weightUnit === 'lbs' ? 'lb' : 'kg';
  const stepText = String(step).replace('.', ',');
  const editable = !!set && !set.isCompleted;

  return (
    <>
      <ScrollView
        className="flex-1"
        contentContainerClassName="pb-4"
        keyboardShouldPersistTaps="handled"
      >
        {/* Bölümlü ilerleme çizgisi: her hareket bir bölüm */}
        <View className="flex-row gap-1 mx-4 mt-3.5" importantForAccessibility="no-hide-descendants">
          {segments.map((fill, i) => (
            <View key={i} className="flex-1 h-1 rounded-full bg-border overflow-hidden">
              <View className="h-full rounded-full" style={{ width: `${fill * 100}%`, backgroundColor: tones.fill }} />
            </View>
          ))}
        </View>

        <View className="px-5 pt-6 gap-2.5">
          <SectionLabel color={color}>{label}</SectionLabel>
          <View className="flex-row items-start gap-2">
            <Text className="font-display text-fg text-[34px] leading-[36px] flex-1" accessibilityRole="header">
              {upperTr(exerciseDisplayName(row.exercise))}
            </Text>
            <IconButton icon={Info} accessibilityLabel="Nasıl yapılır" onPress={() => setSheet('info')} />
            <IconButton
              icon={NotebookPen}
              accessibilityLabel={row.se.notes ? 'Notu düzenle' : 'Not ekle'}
              color={row.se.notes ? tones.ink : undefined}
              onPress={() => setSheet('note')}
            />
          </View>
          {muscles.length > 0 && <Text className="text-muted text-sm">{muscles.join(' · ')}</Text>}
        </View>

        {/* Ağırlık ve tekrar kutuları */}
        <View className="flex-row gap-2.5 mx-4 mt-5">
          <ValueBox
            caption={`Ağırlık · ${unitLabel}`}
            value={weight}
            a11yLabel={weightA11yLabel(weight, weightUnit)}
            keyboardType="decimal-pad"
            editable={editable}
            onChangeText={updateWeight}
            minusLabel={`−${stepText}`}
            plusLabel={`+${stepText}`}
            minusA11y={`${stepText} ${weightUnit === 'lbs' ? 'libre' : 'kilogram'} azalt`}
            plusA11y={`${stepText} ${weightUnit === 'lbs' ? 'libre' : 'kilogram'} artır`}
            onMinus={() => updateWeight(stepWeight(weight, -step))}
            onPlus={() => updateWeight(stepWeight(weight, step))}
          />
          <ValueBox
            caption="Tekrar"
            value={reps}
            a11yLabel={repsA11yLabel(reps)}
            keyboardType="number-pad"
            maxLength={MAX_REP_DIGITS}
            editable={editable}
            onChangeText={updateReps}
            minusLabel="−1"
            plusLabel="+1"
            minusA11y="1 tekrar azalt"
            plusA11y="1 tekrar artır"
            onMinus={() => updateReps(stepReps(reps, -1))}
            onPlus={() => updateReps(stepReps(reps, 1))}
          />
        </View>
        <Text className="text-muted text-[13px] text-center mt-2.5 mx-5">
          {editable ? 'Rakama dokun, yaz' : set ? 'Tamamlandı · düzenlemek için geri al' : 'Hareket tamam'}
          {lastTimeText && (
            <>
              {' · Geçen sefer '}
              <Text className="text-fg font-bold">{lastTimeText}</Text>
            </>
          )}
        </Text>

        {/* v2.1 ilerleme önerisi */}
        {data.suggestion && (
          <View className="mx-4 mt-3 rounded-2xl bg-bg-surface border border-border px-4 pb-3">
            <ProgressionHint
              key={row.se.id}
              suggestion={data.suggestion}
              onApply={(weightKg) => applySuggestedWeight(db, row.se.id, weightKg)}
            />
          </View>
        )}

        {/* Set şeridi */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mt-4"
          contentContainerClassName="px-4 gap-1.5"
        >
          {sets.map((s, i) => {
            const selected = setIndex === i;
            const record = data.recordSetIds.has(s.id);
            const value = s.isCompleted ? setValueText(s.weightKg, s.reps) : selected ? setValueText(weight, reps) : setValueText(s.weightKg, s.reps);
            return (
              <Pressable
                key={s.id}
                onPress={() => setSelectedSetId(s.id)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`Set ${s.setNumber}${s.isCompleted ? ', tamamlandı' : ''}${record ? ', rekor' : ''}, ${value}`}
                className={`w-[84px] min-h-[52px] rounded-[14px] items-center justify-center px-1.5 py-2 active:opacity-70 ${
                  selected ? 'border-2' : s.isCompleted ? 'border border-transparent' : 'border border-border'
                }`}
                style={{
                  borderColor: selected ? outline : undefined,
                  backgroundColor: s.isCompleted ? withAlpha(tones.fill, CHIP_TINT_ALPHA) : undefined,
                }}
              >
                <Text
                  className={`text-xs font-bold ${s.isCompleted ? '' : selected ? 'text-fg' : 'text-muted'}`}
                  style={s.isCompleted ? { color: tones.ink } : undefined}
                >
                  Set {s.setNumber}
                  {s.isCompleted ? ' ✓' : ''}
                  {record ? ' 🏆' : ''}
                </Text>
                <Text className={`font-display text-[15px] ${s.isCompleted || selected ? 'text-fg' : 'text-muted'}`}>
                  {value}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={data.handleAddSet}
            accessibilityRole="button"
            accessibilityLabel="Set ekle"
            className="w-[60px] min-h-[52px] rounded-[14px] items-center justify-center border border-dashed border-border active:opacity-70"
          >
            <Plus color={COLORS.text} size={18} />
          </Pressable>
        </ScrollView>
      </ScrollView>

      {/* Alt: Seti tamamla + Sıradaki */}
      <View className="px-4 pt-2 pb-2 gap-1">
        {set ? (
          set.isCompleted ? (
            <SecondaryButton label="Seti geri al" size="lg" loading={busy} onPress={complete} />
          ) : (
            <PrimaryButton label="Seti tamamla" icon={Check} size="lg" color={color} loading={busy} onPress={complete} />
          )
        ) : nextIncomplete != null ? (
          <PrimaryButton
            label="Sıradaki harekete geç"
            icon={ChevronRight}
            size="lg"
            color={color}
            onPress={() => onGoToExercise(nextIncomplete)}
          />
        ) : (
          <PrimaryButton label="Antrenmanı bitir" size="lg" color={color} onPress={onFinish} />
        )}
        <Pressable
          onPress={onOpenList}
          accessibilityRole="button"
          accessibilityLabel="Tüm listeyi aç"
          className="h-11 flex-row items-center justify-between px-1 active:opacity-70"
        >
          <Text className="text-muted text-sm shrink" numberOfLines={1}>
            Sıradaki: <Text className="text-fg font-bold">{set && !set.isCompleted ? nextUpText(focusExercises, exerciseIndex, next) : nextIncomplete != null ? focusExercises[nextIncomplete]?.name ?? '—' : 'Son set'}</Text>
          </Text>
          <Text className="text-sm font-bold ml-2" style={{ color: tones.ink }}>
            Tüm liste ›
          </Text>
        </Pressable>
      </View>

      <FocusSheet
        mode={sheet}
        onClose={() => setSheet(null)}
        exercise={row.exercise}
        sessionExerciseId={row.se.id}
        initialNote={row.se.notes}
        lastSession={data.lastSession}
      />
    </>
  );
}

/** Büyük kutu: başlık, dev rakam (dokununca klavye), −/+ düğmeleri */
function ValueBox({
  caption,
  value,
  a11yLabel,
  keyboardType,
  maxLength,
  editable,
  onChangeText,
  minusLabel,
  plusLabel,
  minusA11y,
  plusA11y,
  onMinus,
  onPlus,
}: {
  caption: string;
  value: string;
  a11yLabel: string;
  keyboardType: 'decimal-pad' | 'number-pad';
  maxLength?: number;
  editable: boolean;
  onChangeText: (v: string) => void;
  minusLabel: string;
  plusLabel: string;
  minusA11y: string;
  plusA11y: string;
  onMinus: () => void;
  onPlus: () => void;
}) {
  const COLORS = useColors();
  return (
    <View className="flex-1 rounded-[22px] bg-bg-surface border border-border px-3 pt-3.5 pb-3 items-center gap-1.5">
      <Text className="text-muted text-[13px] font-semibold" importantForAccessibility="no">
        {caption}
      </Text>
      <TextInput
        value={value.replace('.', ',')}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        maxLength={maxLength}
        editable={editable}
        selectTextOnFocus
        placeholder="–"
        placeholderTextColor={COLORS.faint}
        accessibilityLabel={a11yLabel}
        className={`font-display text-[56px] leading-[64px] text-center self-stretch p-0 ${editable ? 'text-fg' : 'text-muted'}`}
      />
      <View className="flex-row gap-2 self-stretch">
        <StepButton label={minusLabel} a11y={minusA11y} onPress={onMinus} disabled={!editable} />
        <StepButton label={plusLabel} a11y={plusA11y} onPress={onPlus} disabled={!editable} />
      </View>
    </View>
  );
}

function StepButton({ label, a11y, onPress, disabled }: { label: string; a11y: string; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled }}
      className={`flex-1 h-11 rounded-xl bg-bg-elevated items-center justify-center active:opacity-70 ${disabled ? 'opacity-40' : ''}`}
    >
      <Text className="text-fg text-[15px] font-bold">{label}</Text>
    </Pressable>
  );
}

// ============================================================================
// Tüm liste (v4.0a 2.2): bütün hareketler ve setleri, mevcut editörle
// ============================================================================

function ListView({
  sessionId,
  rows,
  focusExercises,
  supersets,
  currentIndex,
  color,
  sessionName,
  onSetCompleted,
  onOpenInFocus,
}: {
  sessionId: string;
  rows: SessionRow[];
  focusExercises: FocusExercise[];
  supersets: ReturnType<typeof supersetPositions>;
  currentIndex: number;
  color: ContextKind;
  sessionName: string;
  onSetCompleted: (setId: string, exerciseIndex: number) => boolean;
  onOpenInFocus: (index: number) => void;
}) {
  const COLORS = useColors();
  const router = useRouter();
  const tones = useContextTones(color);
  const outline = useContextOutline(color);
  return (
    <ScrollView className="flex-1" contentContainerClassName="px-4 pt-5 gap-3 pb-8" keyboardShouldPersistTaps="handled">
      <Text className="font-display text-fg text-[26px] leading-[30px] px-1" accessibilityRole="header">
        {upperTr(sessionName)}
      </Text>
      {rows.map((r, i) => {
        const ex = focusExercises[i];
        const done = ex ? ex.sets.filter((s) => s.isCompleted).length : 0;
        const total = ex?.sets.length ?? 0;
        const superset = supersets[i];
        const isCurrent = i === currentIndex;
        return (
          <View
            key={r.se.id}
            className="rounded-[20px] bg-bg-surface border px-3.5 pt-3 pb-3"
            style={{ borderColor: isCurrent ? outline : COLORS.border }}
          >
            <View className="flex-row items-center gap-2">
              <Pressable
                onPress={() => onOpenInFocus(i)}
                accessibilityRole="button"
                accessibilityLabel={`${exerciseDisplayName(r.exercise)}, odak modunda aç`}
                className="flex-1 min-h-[44px] justify-center active:opacity-70"
              >
                {superset && (
                  <Text className="text-accent text-xs font-bold tracking-widest">SÜPERSET · {superset.label}</Text>
                )}
                <Text className="text-fg text-[15px] font-bold" numberOfLines={2}>
                  {exerciseDisplayName(r.exercise)}
                </Text>
                <Text className="text-muted text-xs tabular-nums">
                  {done} / {total} set
                </Text>
              </Pressable>
              {/* Hareket detayı ekranı (seans ekranı yığında kalır) */}
              <IconButton
                icon={Info}
                variant="ghost"
                accessibilityLabel="Hareket detayını aç"
                color={COLORS.muted}
                onPress={() => router.push({ pathname: '/exercise/[id]', params: { id: r.exercise.id } })}
              />
            </View>
            <ExerciseSetEditor
              sessionId={sessionId}
              sessionExerciseId={r.se.id}
              exercise={r.exercise}
              initialNote={r.se.notes}
              onSetCompleted={(setId) => onSetCompleted(setId, i)}
            />
          </View>
        );
      })}
    </ScrollView>
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

function ExerciseSetEditor({ sessionId, sessionExerciseId, exercise, initialNote, onSetCompleted }: ExerciseSetEditorProps) {
  const COLORS = useColors();
  const db = useDb();
  const vibrate = useVibrateSetting();
  const data = useExerciseSessionData(sessionId, sessionExerciseId, exercise);
  const { lastSession, suggestion } = data;

  return (
    <View className="gap-2 mt-1">
      {/* Auto-fill bilgisi */}
      {lastSession && (lastSession.sets.length > 0 || lastSession.notes) && (
        <View className="bg-bg-elevated rounded-2xl px-3.5 py-2.5">
          <Text className="text-muted text-xs font-semibold">Son antrenman ({formatDate(lastSession.sessionDate)})</Text>
          {lastSession.sets.length > 0 && (
            <Text className="text-fg text-sm mt-1 tabular-nums">
              {lastSession.sets.map((s) => formatSetSummary(s.weightKg, s.reps, s.rir)).join('  •  ')}
            </Text>
          )}
          {/* Önceki antrenmanın hareket notu (salt okunur) */}
          {lastSession.notes && <Text className="text-muted text-sm mt-1">📝 {lastSession.notes}</Text>}
          {/* v2.1: ilerleme önerisi */}
          {suggestion && (
            <ProgressionHint
              key={sessionExerciseId}
              suggestion={suggestion}
              onApply={(weightKg) => applySuggestedWeight(db, sessionExerciseId, weightKg)}
            />
          )}
        </View>
      )}

      {/* Set başlık satırı */}
      <View className="flex-row px-2 mt-1">
        <Text className="text-muted text-xs w-9">Set</Text>
        <Text className="text-muted text-xs flex-1 text-center">Önceki</Text>
        <Text className="text-muted text-xs w-20 text-center">Ağırlık · kg</Text>
        <Text className="text-muted text-xs w-16 text-center ml-2">Tekrar</Text>
        <Text className="text-muted text-xs w-12 ml-2"></Text>
      </View>

      {/* Setler */}
      {data.setsData?.map((set, idx) => (
        <SetRow
          key={set.id}
          set={set}
          previousSet={lastSession?.sets[idx]}
          restSeconds={data.restSeconds}
          vibrate={vibrate}
          isRecord={data.recordSetIds.has(set.id)}
          isRecordCompletion={data.isRecordCompletion}
          onSetCompleted={onSetCompleted}
        />
      ))}

      {/* Set ekle butonu */}
      <Pressable
        onPress={data.handleAddSet}
        className="min-h-[48px] border border-dashed border-border rounded-2xl items-center flex-row justify-center active:bg-bg-elevated"
      >
        <Plus color={COLORS.text} size={18} />
        <Text className="text-fg text-[15px] font-semibold ml-2">Set ekle</Text>
      </Pressable>

      {/* Hareket notu. key: başka harekete geçince alan yeniden kurulsun,
          önceki hareketin bekleyen notu kaldırılırken kaydedilsin */}
      <NoteEditor
        key={sessionExerciseId}
        initialValue={initialNote}
        onSave={(text) => saveSessionExerciseNote(db, sessionExerciseId, text)}
        addLabel="Not ekle"
        placeholder="Bu hareketle ilgili not (ör. sol omuzda sıkışma)"
      />
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

function SetRow({ set, previousSet, restSeconds, vibrate, isRecord, isRecordCompletion, onSetCompleted }: SetRowProps) {
  const COLORS = useColors();
  const db = useDb();
  const toggle = useSetCompletion({ restSeconds, vibrate, isRecordCompletion, onSetCompleted });

  // Lokal state — daha akıcı UI, complete olunca DB'ye yazılır
  const [weight, setWeight] = useState<string>(set.weightKg != null ? String(set.weightKg) : '');
  const [reps, setReps] = useState<string>(set.reps != null ? String(set.reps) : '');

  // DB'den gelen değişiklikleri lokale yansıt
  useEffect(() => {
    if (set.weightKg != null) setWeight(String(set.weightKg));
    if (set.reps != null) setReps(String(set.reps));
  }, [set.weightKg, set.reps]);

  const previousLabel = previousSet ? `${previousSet.weightKg ?? '-'} × ${previousSet.reps ?? '-'}` : '—';

  // RIR: tamamlanmış sette, girilmemişse ince seçici sırası; girilmişse
  // "RIR 2" etiketi (basınca seçici yeniden açılır). Set geri alınınca
  // değer silinmiyor, yalnızca gizleniyor.
  const [rirEditing, setRirEditing] = useState(false);
  const [rirHelp, setRirHelp] = useState(false);
  const showRirPicker = set.isCompleted && (set.rir == null || rirEditing);
  const showRirLabel = set.isCompleted && set.rir != null && !rirEditing;

  const selectRir = async (value: number) => {
    await saveSetRir(db, set.id, value);
    setRirEditing(false);
    setRirHelp(false);
  };

  const toggleComplete = async () => {
    await toggle(set, weight, reps);
  };

  const updateWeight = async (raw: string) => {
    const v = sanitizeDecimalInput(raw, weight, DEFAULT_MAX_DECIMAL_DIGITS, MAX_WEIGHT_INTEGER_DIGITS);
    setWeight(v);
    await saveSetWeight(db, set.id, v);
  };

  const updateReps = async (raw: string) => {
    const v = digitsOnly(raw);
    setReps(v);
    await saveSetReps(db, set.id, v);
  };

  return (
    <View>
      <View className={`flex-row items-center min-h-[56px] px-2 py-1.5 rounded-xl ${set.isCompleted ? 'bg-success/10' : ''}`}>
        <Text className="text-fg text-base font-bold tabular-nums w-9">{set.setNumber}</Text>
        <View className="flex-1 items-center">
          <Text className="text-muted text-sm tabular-nums text-center" numberOfLines={1}>
            {previousLabel}
          </Text>
          {isRecord && (
            <View className="bg-pr rounded-full px-2 py-0.5 mt-1">
              <Text className="text-pr-fg text-xs font-semibold">🏆 Rekor</Text>
            </View>
          )}
          {showRirLabel && (
            <Pressable
              onPress={() => setRirEditing(true)}
              hitSlop={6}
              accessibilityLabel="RIR değerini değiştir"
              className="border border-border rounded-full px-2 py-0.5 mt-1 active:opacity-60"
            >
              <Text className="text-muted text-xs font-semibold tabular-nums">RIR {rirLabel(set.rir!)}</Text>
            </Pressable>
          )}
        </View>
        <TextInput
          value={weight}
          onChangeText={updateWeight}
          placeholder={previousSet?.weightKg ? String(previousSet.weightKg) : '-'}
          placeholderTextColor={COLORS.faint}
          keyboardType="decimal-pad"
          editable={!set.isCompleted}
          accessibilityLabel={`Set ${set.setNumber} ağırlık`}
          className={`w-20 h-11 text-center text-lg font-display px-2 rounded-xl ${
            set.isCompleted ? 'bg-transparent text-muted' : 'bg-bg-elevated text-fg'
          }`}
        />
        <TextInput
          value={reps}
          onChangeText={updateReps}
          placeholder={previousSet?.reps ? String(previousSet.reps) : '-'}
          placeholderTextColor={COLORS.faint}
          keyboardType="number-pad"
          maxLength={MAX_REP_DIGITS}
          editable={!set.isCompleted}
          accessibilityLabel={`Set ${set.setNumber} tekrar`}
          className={`w-16 h-11 text-center text-lg font-display px-2 rounded-xl ml-2 ${
            set.isCompleted ? 'bg-transparent text-muted' : 'bg-bg-elevated text-fg'
          }`}
        />
        <Pressable
          onPress={toggleComplete}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={set.isCompleted ? `Set ${set.setNumber} tamamlandı, geri al` : `Set ${set.setNumber} tamamla`}
          className="ml-2"
        >
          <View
            className={`w-11 h-11 rounded-xl items-center justify-center ${
              set.isCompleted ? 'bg-success' : 'bg-bg-elevated border border-border'
            }`}
          >
            <Check color={set.isCompleted ? COLORS.successFg : COLORS.muted} size={20} strokeWidth={3} />
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
        <Text className="text-muted text-xs w-9">RIR</Text>
        <Pressable
          onPress={onToggleHelp}
          hitSlop={10}
          accessibilityLabel="RIR nedir?"
          className="w-7 h-7 rounded-full border border-border items-center justify-center mr-2 active:opacity-60"
        >
          <Text className="text-muted text-xs font-semibold">?</Text>
        </Pressable>
        {RIR_OPTIONS.map((value) => {
          const active = selected != null && rirLabel(selected) === rirLabel(value);
          return (
            <Pressable
              key={value}
              onPress={() => onSelect(value)}
              hitSlop={8}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              accessibilityLabel={`RIR ${rirLabel(value)}`}
              className={`h-8 min-w-[36px] px-2 rounded-full items-center justify-center mr-1 ${
                active ? 'bg-ctx-rest' : 'bg-bg-elevated border border-border active:bg-bg-surface'
              }`}
            >
              <Text className={`text-xs font-bold tabular-nums ${active ? 'text-ctx-fg' : 'text-muted'}`}>
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

/**
 * v2.1: "Son antrenman" kutusunun altındaki öneri satırı.
 * "Uygula" yalnızca ağırlık artışında; tamamlanmamış setlerin ağırlığını
 * yazar, onay sormaz (değer elle geri değiştirilebilir).
 */
function ProgressionHint({
  suggestion,
  onApply,
}: {
  suggestion: ProgressionSuggestion;
  onApply: (weightKg: number) => Promise<unknown>;
}) {
  const [applied, setApplied] = useState(false);

  const apply = () => {
    if (suggestion.weightKg == null) return;
    onApply(suggestion.weightKg)
      .then(() => setApplied(true))
      .catch((err) => {
        console.error('[PROGRESSION] Uygulanamadı:', err);
        Alert.alert('Hata', 'Öneri uygulanamadı: ' + String(err));
      });
  };

  return (
    <View className="mt-2.5 pt-2.5 border-t border-border">
      <View className="flex-row items-center">
        <Text className="text-fg text-sm flex-1">
          💡 Bugün <Text className="font-semibold tabular-nums">{suggestion.headline}</Text> dene
        </Text>
        <Pressable
          onPress={() => Alert.alert('İlerleme önerisi', PROGRESSION_HELP)}
          hitSlop={10}
          accessibilityLabel="İlerleme önerisi nedir?"
          className="w-7 h-7 rounded-full border border-border items-center justify-center ml-2 active:opacity-60"
        >
          <Text className="text-muted text-xs font-semibold">?</Text>
        </Pressable>
        {suggestion.canApply && (
          <Pressable
            onPress={apply}
            disabled={applied}
            hitSlop={8}
            accessibilityLabel="Önerilen ağırlığı setlere yaz"
            className={`h-8 px-3 rounded-full items-center justify-center ml-2 ${
              applied ? 'border border-border' : 'bg-accent active:opacity-80'
            }`}
          >
            <Text className={`text-xs font-semibold ${applied ? 'text-muted' : 'text-accent-fg'}`}>
              {applied ? 'Uygulandı' : 'Uygula'}
            </Text>
          </Pressable>
        )}
      </View>
      <Text className="text-muted text-xs mt-1">{suggestion.reason}</Text>
      {suggestion.plateauNote && <Text className="text-muted text-xs mt-1.5">{suggestion.plateauNote}</Text>}
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
