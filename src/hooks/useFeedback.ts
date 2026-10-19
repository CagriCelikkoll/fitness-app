import { useCallback, useEffect } from 'react';
import { create } from 'zustand';

import { useGymMembership } from '@/hooks/useGymMembership';
import type { AccountError } from '@/lib/auth';
import { fetchGymFeedback, fetchMyFeedback, photoUrls, type Feedback } from '@/lib/feedback';
import { canManageGym } from '@/lib/gymAdmin';
import { getSupabase } from '@/lib/supabase';

/**
 * Geri bildirimler (v3.6d) — ortak durum. "Gönderdiklerim" (yazar) ve
 * yönetici listesi / ayrıntısı / panel özeti. Fotoğraflar için süreli
 * adresler listeyle birlikte alınır. Önbellek yok; ekranlar odaklanınca
 * yeniler. Bayrak kapalıyken / giriş yokken / salon yokken istek atmaz.
 */
interface ListState {
  list: Feedback[];
  /** photo_path → süreli adres */
  photos: Record<string, string>;
  loaded: boolean;
  loading: boolean;
  error: AccountError | null;
}

interface State {
  userId: string | null;
  mine: ListState;
  byGym: Record<string, ListState>;
}

const EMPTY_LIST: ListState = { list: [], photos: {}, loaded: false, loading: false, error: null };
const EMPTY: State = { userId: null, mine: EMPTY_LIST, byGym: {} };
const useStore = create<State>(() => EMPTY);

function ensureUser(userId: string): void {
  if (useStore.getState().userId !== userId) useStore.setState({ ...EMPTY, userId });
}

async function withPhotos(list: Feedback[]): Promise<Record<string, string>> {
  const paths = list.map((f) => f.photoPath).filter((p): p is string => p != null);
  if (paths.length === 0) return {};
  const result = await photoUrls(getSupabase(), paths);
  return result.ok ? result.value : {};
}

async function loadMine(userId: string): Promise<void> {
  ensureUser(userId);
  useStore.setState((s) => ({ mine: { ...s.mine, loading: true } }));
  const result = await fetchMyFeedback(getSupabase());
  const photos = result.ok ? await withPhotos(result.value) : {};
  if (useStore.getState().userId !== userId) return;
  useStore.setState((s) => ({
    mine: result.ok
      ? { list: result.value, photos, loaded: true, loading: false, error: null }
      : { ...s.mine, loading: false, error: result.error },
  }));
}

async function loadGym(userId: string, gymId: string): Promise<void> {
  ensureUser(userId);
  const patch = (p: Partial<ListState>) =>
    useStore.setState((s) => ({ byGym: { ...s.byGym, [gymId]: { ...(s.byGym[gymId] ?? EMPTY_LIST), ...p } } }));
  patch({ loading: true });
  const result = await fetchGymFeedback(getSupabase(), gymId);
  const photos = result.ok ? await withPhotos(result.value) : {};
  if (useStore.getState().userId !== userId) return;
  if (result.ok) patch({ list: result.value, photos, loaded: true, loading: false, error: null });
  else patch({ loading: false, error: result.error });
}

function useEnabled() {
  const { available, userId, memberships } = useGymMembership();
  useEffect(() => {
    if ((!available || !userId) && useStore.getState().userId != null) useStore.setState(EMPTY);
  }, [available, userId]);
  return { enabled: available && userId != null && memberships.length > 0, userId, memberships };
}

export function useMyFeedback(): ListState & { refresh: () => Promise<void> } {
  const { enabled, userId } = useEnabled();
  const state = useStore();
  const refresh = useCallback(async () => {
    if (enabled && userId) await loadMine(userId);
  }, [enabled, userId]);
  const current = enabled && state.userId === userId ? state.mine : EMPTY_LIST;
  return { ...current, refresh };
}

/** Yönetici: salonun geri bildirimleri (yönetici değilse istek atmaz) */
export function useGymFeedback(gymId: string | null): ListState & { allowed: boolean; refresh: () => Promise<void> } {
  const { enabled, userId, memberships } = useEnabled();
  const allowed = enabled && gymId != null && canManageGym(gymId, memberships);
  const state = useStore();
  const refresh = useCallback(async () => {
    if (allowed && userId && gymId) await loadGym(userId, gymId);
  }, [allowed, userId, gymId]);
  const current = allowed && state.userId === userId && gymId ? (state.byGym[gymId] ?? EMPTY_LIST) : EMPTY_LIST;
  return { ...current, allowed, refresh };
}
