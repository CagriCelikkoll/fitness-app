import { useCallback, useEffect } from 'react';
import { create } from 'zustand';

import type { AccountError } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { fetchTrainerLinks, type TrainerLink } from '@/lib/trainers';
import { useGymMembership } from '@/hooks/useGymMembership';

/**
 * Görebildiğim açık hoca–öğrenci bağları (v3.6a): hoca olarak, öğrenci
 * olarak, yönetici olarak. Ana sayfa (istek kartı), Öğrencilerim,
 * Hocalarım, izin ekranı ve üye ayrıntısı aynı listeyi paylaşıyor.
 *
 * Bayrak kapalıyken / giriş yokken / hiçbir salona üye değilken istek
 * atmaz. Önbellek yok; ekranlar odaklanınca yeniler.
 */
interface State {
  userId: string | null;
  links: TrainerLink[];
  loaded: boolean;
  loading: boolean;
  error: AccountError | null;
  /** Son başarılı yükleme (ms) */
  loadedAt: number;
}

const EMPTY: State = { userId: null, links: [], loaded: false, loading: false, error: null, loadedAt: 0 };

/** Ana sayfa odaklanınca en fazla bu sıklıkta yeniler */
export const TRAINER_LINKS_STALE_MS = 60_000;

const useStore = create<State>(() => EMPTY);

async function load(userId: string): Promise<void> {
  useStore.setState((s) => (s.userId === userId ? { loading: true, error: null } : { ...EMPTY, userId, loading: true }));
  const result = await fetchTrainerLinks(getSupabase());
  if (useStore.getState().userId !== userId) return;
  useStore.setState(
    result.ok
      ? { links: result.value, loaded: true, loading: false, error: null, loadedAt: Date.now() }
      : { loading: false, error: result.error }
  );
}

export function useTrainerLinks(): State & {
  /** Salona üye ve bayrak açık: hoca özellikleri görünür */
  enabled: boolean;
  refresh: () => Promise<void>;
  /** Son yüklemeden bu yana `TRAINER_LINKS_STALE_MS` geçtiyse yenile */
  refreshIfStale: () => void;
} {
  const { available, userId, memberships } = useGymMembership();
  const enabled = available && userId != null && memberships.length > 0;
  const state = useStore();

  useEffect(() => {
    if (!enabled || !userId) {
      if (useStore.getState().userId != null) useStore.setState(EMPTY);
      return;
    }
    if (useStore.getState().userId !== userId) void load(userId);
  }, [enabled, userId]);

  const refresh = useCallback(async () => {
    if (enabled && userId) await load(userId);
  }, [enabled, userId]);

  const refreshIfStale = useCallback(() => {
    const s = useStore.getState();
    if (!enabled || !userId || s.loading) return;
    if (s.userId !== userId || Date.now() - s.loadedAt >= TRAINER_LINKS_STALE_MS) void load(userId);
  }, [enabled, userId]);

  const current = enabled && state.userId === userId;
  return {
    ...(current ? state : EMPTY),
    userId,
    enabled,
    refresh,
    refreshIfStale,
  };
}
