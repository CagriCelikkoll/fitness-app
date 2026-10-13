import { useEffect } from 'react';
import { AppState } from 'react-native';
import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';

import { useSession } from '@/hooks/useSession';
import type { AccountError } from '@/lib/auth';
import {
  fetchSchedule,
  readScheduleCache,
  writeScheduleCache,
  type ClassException,
  type ClassTemplate,
} from '@/lib/classes';
import { getSupabase } from '@/lib/supabase';
import { createTriggerClock, type SyncTrigger } from '@/lib/sync/runner';

/**
 * Grup ders programı (v3.2c) — ortak durum. Ana sayfadaki "Bugün" kartı
 * ve program ekranı aynı veriyi kullanıyor.
 *
 * Duyurularla aynı kurallar: önce önbellek (kv-store, kullanıcıya göre),
 * internetsizken o kalır ve "çevrimdışı"; yenileme girişte / açılışta,
 * öne gelince (en fazla 5 dk'da bir), ekran açılınca ve aşağı çekince.
 * Bayrak kapalıyken ya da giriş yokken hiçbir şey yapmaz.
 */

interface ScheduleState {
  userId: string | null;
  templates: ClassTemplate[];
  exceptions: ClassException[];
  fetchedAt: string | null;
  loaded: boolean;
  loading: boolean;
  offline: boolean;
  error: AccountError | null;
}

const EMPTY: ScheduleState = {
  userId: null,
  templates: [],
  exceptions: [],
  fetchedAt: null,
  loaded: false,
  loading: false,
  offline: false,
  error: null,
};

const useStore = create<ScheduleState>(() => EMPTY);
const clock = createTriggerClock();

async function loadCache(userId: string): Promise<void> {
  if (useStore.getState().userId === userId && useStore.getState().loaded) return;
  useStore.setState({ ...EMPTY, userId });
  const cache = await readScheduleCache(Storage, userId);
  if (useStore.getState().userId !== userId) return;
  useStore.setState({
    templates: cache?.templates ?? [],
    exceptions: cache?.exceptions ?? [],
    fetchedAt: cache?.fetchedAt ?? null,
    loaded: true,
  });
}

async function refresh(userId: string): Promise<void> {
  await loadCache(userId);
  if (useStore.getState().userId !== userId) return;
  useStore.setState({ loading: true });
  const result = await fetchSchedule(getSupabase());
  if (useStore.getState().userId !== userId) return; // bu arada çıkış / başka hesap
  if (!result.ok) {
    useStore.setState({
      loading: false,
      offline: result.error.kind === 'network',
      error: result.error.kind === 'network' ? null : result.error,
    });
    return;
  }
  const fetchedAt = new Date().toISOString();
  useStore.setState({ ...result.value, fetchedAt, loading: false, offline: false, error: null });
  writeScheduleCache(Storage, userId, { fetchedAt, ...result.value }).catch((err) =>
    console.warn('[CLASSES] Önbellek yazılamadı:', err)
  );
}

function trigger(kind: SyncTrigger): void {
  const userId = useStore.getState().userId;
  if (!userId) return;
  if (!clock.take(kind, Date.now())) return;
  void refresh(userId);
}

/** Kök layout'ta bir kez: açılış / giriş ve öne gelme (5 dk) */
export function useClassScheduleTriggers(): void {
  const { available, ready, userId } = useSession();

  useEffect(() => {
    if (!available || !ready || !userId) {
      if (useStore.getState().userId != null) useStore.setState(EMPTY);
      return;
    }
    useStore.setState((s) => (s.userId === userId ? s : { ...EMPTY, userId }));
    trigger('login');
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') trigger('foreground');
    });
    return () => {
      sub.remove();
      clock.reset();
    };
  }, [available, ready, userId]);
}

export function useClassSchedule(): ScheduleState & {
  /** Ekran açılınca / aşağı çekince / düzenlemeden sonra (5 dk kuralı yok) */
  refresh: () => Promise<void>;
} {
  const { available, userId } = useSession();
  const state = useStore();
  const current = available && userId != null && state.userId === userId;

  useEffect(() => {
    if (available && userId) void loadCache(userId);
  }, [available, userId]);

  return {
    ...(current ? state : { ...EMPTY, userId }),
    refresh: async () => {
      if (available && userId) await refresh(userId);
    },
  };
}
