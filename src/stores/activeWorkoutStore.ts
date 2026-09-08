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

  stopRestTimer: () => set({ restTimer: null }),
}));
