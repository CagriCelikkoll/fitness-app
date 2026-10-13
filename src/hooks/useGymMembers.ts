import { useCallback, useEffect } from 'react';
import { create } from 'zustand';

import type { AccountError } from '@/lib/auth';
import { fetchGymMembers, type GymMember } from '@/lib/gymAdmin';
import { getSupabase } from '@/lib/supabase';
import { useSession } from '@/hooks/useSession';

/**
 * Salonun üye listesi (v3.2d) — "Üyeler" ve "Üye" ekranları aynı listeyi
 * paylaşıyor; değişiklikten sonra yeniden çekilir. Önbellek yok (kişisel
 * veri, yalnızca açıkken). Giriş yokken istek atmaz.
 */
interface State {
  userId: string | null;
  gymId: string | null;
  members: GymMember[];
  loaded: boolean;
  loading: boolean;
  error: AccountError | null;
}

const EMPTY: State = { userId: null, gymId: null, members: [], loaded: false, loading: false, error: null };
const useStore = create<State>(() => EMPTY);

async function load(userId: string, gymId: string): Promise<void> {
  useStore.setState((s) =>
    s.userId === userId && s.gymId === gymId
      ? { loading: true, error: null }
      : { ...EMPTY, userId, gymId, loading: true }
  );
  const result = await fetchGymMembers(getSupabase(), gymId);
  const s = useStore.getState();
  if (s.userId !== userId || s.gymId !== gymId) return;
  useStore.setState(
    result.ok
      ? { members: result.value, loaded: true, loading: false, error: null }
      : { loading: false, error: result.error }
  );
}

export function useGymMembers(gymId: string | null): State & {
  refresh: () => Promise<void>;
  /** Değişiklikten hemen sonra listeyi yerelde güncelle */
  replace: (member: GymMember) => void;
  remove: (userId: string) => void;
} {
  const { available, userId } = useSession();
  const state = useStore();

  useEffect(() => {
    if (!available || !userId || !gymId) return;
    const s = useStore.getState();
    if (s.userId !== userId || s.gymId !== gymId) void load(userId, gymId);
  }, [available, userId, gymId]);

  const refresh = useCallback(async () => {
    if (available && userId && gymId) await load(userId, gymId);
  }, [available, userId, gymId]);

  const replace = useCallback((member: GymMember) => {
    useStore.setState((s) => ({
      members: s.members.map((m) => (m.userId === member.userId ? { ...member, name: m.name } : m)),
    }));
  }, []);

  const remove = useCallback((target: string) => {
    useStore.setState((s) => ({ members: s.members.filter((m) => m.userId !== target) }));
  }, []);

  const current = available && userId != null && state.userId === userId && state.gymId === gymId;
  return { ...(current ? state : { ...EMPTY, userId, gymId }), refresh, replace, remove };
}
