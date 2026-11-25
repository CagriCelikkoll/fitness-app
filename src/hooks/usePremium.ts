import { useEffect } from 'react';
import { create } from 'zustand';

import { useSession } from '@/hooks/useSession';
import {
  PREMIUM_ENABLED,
  isPremiumFromCustomerInfo,
  premiumResult,
  type PremiumCustomerInfo,
  type PremiumState,
} from '@/lib/premium';
import { syncPurchases } from '@/lib/purchasesNative';

/**
 * Premium durumu (0.13 Bölüm 7). İleride özellikler bu kancayla kilitlenir.
 * Bayrak (`PREMIUM_ENABLED`) kapalıyken her zaman "premium değil"; hiçbir
 * şey yüklenmez.
 */
const usePremiumStore = create<{ state: PremiumState; setInfo: (info: PremiumCustomerInfo) => void }>((set) => ({
  state: { isPremium: false, ready: false },
  setInfo: (info) => set({ state: { isPremium: isPremiumFromCustomerInfo(info), ready: true } }),
}));

export function usePremium(): PremiumState {
  const state = usePremiumStore((s) => s.state);
  return premiumResult(PREMIUM_ENABLED, state);
}

/**
 * Kökte bir kez (`app/_layout.tsx`): oturuma göre RevenueCat'i başlatır,
 * girişte `logIn`, çıkışta `logOut`. Bayrak kapalıyken hiçbir şey yapmaz.
 */
export function usePurchasesSync(): void {
  const { userId, ready } = useSession();
  useEffect(() => {
    if (!PREMIUM_ENABLED || !ready) return;
    void syncPurchases(userId, usePremiumStore.getState().setInfo);
  }, [userId, ready]);
}
