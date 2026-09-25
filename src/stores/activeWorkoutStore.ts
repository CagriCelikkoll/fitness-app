/**
 * Aktif antrenmanın UI state'i.
 *
 * Veri kaynağı SQLite'tır (sets/session_exercises/workout_sessions tabloları).
 * Burada sadece "şu an hangi session'dayız, hangi egzersize bakıyoruz,
 * dinlenme zamanlayıcısı çalışıyor mu" gibi ergonomik state tutuluyor.
 *
 * Uygulama crash'lerse activeSessionId hala SQLite'taki açık session'a
 * (ended_at IS NULL) bakılarak geri yüklenebilir.
 */

import { create } from 'zustand';

interface RestTimer {
  startedAt: number; // ms timestamp
  durationSeconds: number;
}

/** Dinlenme süresinin üst sınırı (saniye) */
export const MAX_REST_SECONDS = 15 * 60;

/**
 * +/- düğmesinden sonraki toplam süre. startedAt değişmiyor, yalnızca
 * toplam süre kayıyor; kalan süre tam olarak delta kadar değişir.
 *
 * - Azaltma kalan süreyi 0'a ya da altına indirirse toplam süre geçen
 *   süreye eşitlenir: sayaç bir sonraki tıkta biter, normal bitiş akışı
 *   (titreşim, 3 sn sonra kapanma) çalışır.
 * - Sayaç bitmişken artırma onu canlandırır: şu andan itibaren delta
 *   kadar sayar. Bitmişken azaltma bir şey yapmaz.
 * - Toplam süre MAX_REST_SECONDS'ı geçmez.
 *
 * Geçen süre, zamanlayıcı bileşenindeki gibi tam saniyeye aşağı yuvarlanıyor.
 */
export function adjustedRestDuration(
  timer: RestTimer,
  deltaSeconds: number,
  nowMs: number
): number {
  const elapsed = Math.max(0, Math.floor((nowMs - timer.startedAt) / 1000));
  const remaining = timer.durationSeconds - elapsed;

  let next: number;
  if (remaining <= 0) {
    if (deltaSeconds <= 0) return timer.durationSeconds;
    next = elapsed + deltaSeconds;
  } else if (remaining + deltaSeconds <= 0) {
    next = elapsed;
  } else {
    next = timer.durationSeconds + deltaSeconds;
  }
  return Math.min(MAX_REST_SECONDS, next);
}

interface ActiveWorkoutState {
  // Aktif session id (SQLite'a yansır)
  activeSessionId: string | null;

  // UI ergonomisi
  currentExerciseIndex: number;
  restTimer: RestTimer | null;

  // Actions
  startSession: (sessionId: string) => void;
  endSession: () => void;
  setCurrentExerciseIndex: (index: number) => void;
  nextExercise: () => void;
  prevExercise: () => void;
  startRestTimer: (durationSeconds: number) => void;
  /** Çalışan sayacın toplam süresini kaydırır, startedAt'e dokunmaz */
  adjustRestTimer: (deltaSeconds: number) => void;
  stopRestTimer: () => void;
}

export const useActiveWorkoutStore = create<ActiveWorkoutState>((set) => ({
  activeSessionId: null,
  currentExerciseIndex: 0,
  restTimer: null,

  startSession: (sessionId) =>
    set({
      activeSessionId: sessionId,
      currentExerciseIndex: 0,
      restTimer: null,
    }),

  endSession: () =>
    set({
      activeSessionId: null,
      currentExerciseIndex: 0,
      restTimer: null,
    }),

  setCurrentExerciseIndex: (index) => set({ currentExerciseIndex: index }),

  nextExercise: () =>
    set((s) => ({ currentExerciseIndex: s.currentExerciseIndex + 1 })),

  prevExercise: () =>
    set((s) => ({
      currentExerciseIndex: Math.max(0, s.currentExerciseIndex - 1),
    })),

  startRestTimer: (durationSeconds) =>
    set({
      restTimer: { startedAt: Date.now(), durationSeconds },
    }),

  adjustRestTimer: (deltaSeconds) =>
    set((s) => {
      if (!s.restTimer) return {};
      const durationSeconds = adjustedRestDuration(
        s.restTimer,
        deltaSeconds,
        Date.now()
      );
      if (durationSeconds === s.restTimer.durationSeconds) return {};
      return { restTimer: { ...s.restTimer, durationSeconds } };
    }),

  stopRestTimer: () => set({ restTimer: null }),
}));
