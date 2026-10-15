import { useEffect } from 'react';
import { AppState } from 'react-native';
import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';

import { useSession } from '@/hooks/useSession';
import {
  emitNewAnnouncements,
  fetchAnnouncements,
  findNewAnnouncements,
  readCache,
  readLastSeen,
  writeCache,
  writeLastSeen,
  type Announcement,
} from '@/lib/announcements';
import type { AccountError } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { createTriggerClock, type SyncTrigger } from '@/lib/sync/runner';

/**
 * Salon duyuruları (v3.2b) — ortak durum. Ana sayfa kartı ve duyurular
 * ekranı aynı listeyi kullanıyor.
 *
 * - Liste ve son açılış zamanı kv-store'da (kullanıcıya göre); açılışta
 *   önce önbellek gösterilir, internetsizken o kalır ve "çevrimdışı".
 * - Yenileme: girişte / açılışta, uygulama öne gelince (en fazla 5 dk'da
 *   bir, eşitlemeyle aynı kural), duyurular ekranı açılınca, aşağı çekince.
 * - Bayrak kapalıyken ya da giriş yokken hiçbir şey yapmaz.
 */

interface AnnouncementsState {
  userId: string | null;
  items: Announcement[];
  fetchedAt: string | null;
  lastSeenAt: string | null;
  /** Önbellek okundu mu (ilk anda boş liste "duyuru yok" sanılmasın) */
  loaded: boolean;
  loading: boolean;
  offline: boolean;
  error: AccountError | null;
}

const EMPTY: AnnouncementsState = {
  userId: null,
  items: [],
  fetchedAt: null,
  lastSeenAt: null,
  loaded: false,
  loading: false,
  offline: false,
  error: null,
};

const useStore = create<AnnouncementsState>(() => EMPTY);
const clock = createTriggerClock();
/** Bu oturumda sunucudan en az bir kez çekildi mi ("yeni" hesabı için) */
let hadCache = false;

async function loadCache(userId: string): Promise<void> {
  if (useStore.getState().userId === userId && useStore.getState().loaded) return;
  useStore.setState({ ...EMPTY, userId });
  const [cache, lastSeenAt] = await Promise.all([readCache(Storage, userId), readLastSeen(Storage, userId)]);
  if (useStore.getState().userId !== userId) return;
  hadCache = cache != null;
  useStore.setState({
    items: cache?.items ?? [],
    fetchedAt: cache?.fetchedAt ?? null,
    lastSeenAt,
    loaded: true,
  });
}

async function refresh(userId: string): Promise<void> {
  await loadCache(userId);
  const before = useStore.getState();
  if (before.userId !== userId) return;
  useStore.setState({ loading: true });
  const result = await fetchAnnouncements(getSupabase());
  const state = useStore.getState();
  if (state.userId !== userId) return; // bu arada çıkış / başka hesap
  if (!result.ok) {
    useStore.setState({
      loading: false,
      offline: result.error.kind === 'network',
      error: result.error.kind === 'network' ? null : result.error,
    });
    return;
  }
  // "Yeni duyuru" olayı tek yerden (push bildirimi buraya bağlanacak)
  emitNewAnnouncements(findNewAnnouncements(hadCache ? before.items : null, result.value, state.lastSeenAt));
  hadCache = true;
  const fetchedAt = new Date().toISOString();
  useStore.setState({ items: result.value, fetchedAt, loading: false, offline: false, error: null });
  writeCache(Storage, userId, { fetchedAt, items: result.value }).catch((err) =>
    console.warn('[ANNOUNCEMENTS] Önbellek yazılamadı:', err)
  );
}

function trigger(kind: SyncTrigger): void {
  const userId = useStore.getState().userId;
  if (!userId) return;
  if (!clock.take(kind, Date.now())) return;
  void refresh(userId);
}

/** Kök layout'ta bir kez: açılış / giriş ve öne gelme (5 dk) */
export function useAnnouncementTriggers(): void {
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

export function useAnnouncements(): AnnouncementsState & {
  /** Ekran açılınca / aşağı çekince (5 dk kuralı yok) */
  refresh: () => Promise<void>;
  /** Ekran açıldı: son açılış = şimdi (yalnızca telefonda) */
  markSeen: () => void;
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
    markSeen: () => {
      if (!available || !userId) return;
      const now = new Date().toISOString();
      useStore.setState({ lastSeenAt: now });
      writeLastSeen(Storage, userId, now).catch((err) =>
        console.warn('[ANNOUNCEMENTS] Son açılış yazılamadı:', err)
      );
    },
  };
}
