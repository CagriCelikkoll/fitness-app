import { useCallback, useEffect } from 'react';
import { create } from 'zustand';

import { fetchMemberships, type GymMembership } from '@/lib/account';
import type { AccountError } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { useSession } from '@/hooks/useSession';

/**
 * Giriş yapmış kullanıcının salon üyelikleri (v3.0). Ayarlar ve ana
 * sayfa aynı durumu paylaşıyor; kullanıcı değişince (giriş / çıkış)
 * yeniden yükleniyor. Hata lokal kısmı etkilemiyor, yalnızca Ayarlar'da
 * gösteriliyor.
 */
interface MembershipState {
  userId: string | null;
  memberships: GymMembership[];
  loading: boolean;
  error: AccountError | null;
}

const useMembershipStore = create<MembershipState>(() => ({
  userId: null,
  memberships: [],
  loading: false,
  error: null,
}));

async function load(userId: string): Promise<void> {
  useMembershipStore.setState((s) => ({
    userId,
    loading: true,
    error: null,
    // Başka kullanıcının üyeliği bir an bile görünmesin
    memberships: s.userId === userId ? s.memberships : [],
  }));
  const result = await fetchMemberships(getSupabase(), userId);
  // Bu arada çıkış / başka giriş olduysa sonucu bırak
  if (useMembershipStore.getState().userId !== userId) return;
  useMembershipStore.setState(
    result.ok
      ? { memberships: result.value, loading: false, error: null }
      : { loading: false, error: result.error }
  );
}

export function useGymMembership(): {
  available: boolean;
  userId: string | null;
  memberships: GymMembership[];
  /** Ana sayfa ve özet için: en son katılınan salon */
  primary: GymMembership | null;
  loading: boolean;
  error: AccountError | null;
  refresh: () => Promise<void>;
} {
  const { available, userId } = useSession();
  const state = useMembershipStore();

  useEffect(() => {
    if (!available || !userId) {
      if (useMembershipStore.getState().userId != null) {
        useMembershipStore.setState({ userId: null, memberships: [], loading: false, error: null });
      }
      return;
    }
    if (useMembershipStore.getState().userId !== userId) void load(userId);
  }, [available, userId]);

  const refresh = useCallback(async () => {
    if (available && userId) await load(userId);
  }, [available, userId]);

  const current = available && userId && state.userId === userId;
  const memberships = current ? state.memberships : [];
  return {
    available,
    userId,
    memberships,
    primary: memberships[0] ?? null,
    loading: current ? state.loading : false,
    error: current ? state.error : null,
    refresh,
  };
}
