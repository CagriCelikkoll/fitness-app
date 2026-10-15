import { useCallback, useEffect } from 'react';
import { create } from 'zustand';

import { useSession } from '@/hooks/useSession';
import type { AccountError } from '@/lib/auth';
import { fetchMyDisplayName, updateDisplayName } from '@/lib/profile';
import { getSupabase } from '@/lib/supabase';

/**
 * Giriş yapmış kullanıcının adı (profiles.display_name). Ayarlar, salona
 * katılma ve ana sayfadaki "Adını ekle" kartı aynı durumu paylaşıyor.
 * Bayrak kapalıyken ya da giriş yokken istek atmaz.
 */
interface ProfileState {
  userId: string | null;
  displayName: string | null;
  loaded: boolean;
  loading: boolean;
  error: AccountError | null;
}

const EMPTY: ProfileState = { userId: null, displayName: null, loaded: false, loading: false, error: null };
const useStore = create<ProfileState>(() => EMPTY);

async function load(userId: string): Promise<void> {
  useStore.setState((s) => (s.userId === userId ? { loading: true, error: null } : { ...EMPTY, userId, loading: true }));
  const result = await fetchMyDisplayName(getSupabase(), userId);
  if (useStore.getState().userId !== userId) return;
  useStore.setState(
    result.ok
      ? { displayName: result.value, loaded: true, loading: false, error: null }
      : { loading: false, error: result.error }
  );
}

export function useProfile(): ProfileState & {
  refresh: () => Promise<void>;
  /** Kaydet; hata varsa döner */
  save: (text: string) => Promise<AccountError | null>;
} {
  const { available, userId } = useSession();
  const state = useStore();

  useEffect(() => {
    if (!available || !userId) {
      if (useStore.getState().userId != null) useStore.setState(EMPTY);
      return;
    }
    if (useStore.getState().userId !== userId) void load(userId);
  }, [available, userId]);

  const refresh = useCallback(async () => {
    if (available && userId) await load(userId);
  }, [available, userId]);

  const save = useCallback(
    async (text: string) => {
      if (!available || !userId) return null;
      const result = await updateDisplayName(getSupabase(), userId, text);
      if (!result.ok) return result.error;
      if (useStore.getState().userId === userId) {
        useStore.setState({ displayName: result.value, loaded: true, error: null });
      }
      return null;
    },
    [available, userId]
  );

  const current = available && userId != null && state.userId === userId;
  return { ...(current ? state : { ...EMPTY, userId }), refresh, save };
}
