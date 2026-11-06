import { useCallback, useEffect } from 'react';
import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';

import { useSession } from '@/hooks/useSession';
import type { AccountError } from '@/lib/auth';
import {
  PRIVACY_NOTICE_VERSION,
  ackPrivacyNotice,
  clearPendingAck,
  fetchPrivacyAck,
  needsPrivacyAck,
  readPendingAck,
} from '@/lib/privacyNotice';
import { getSupabase } from '@/lib/supabase';

/**
 * Aydınlatma metni onayı (v3.7). Mantık src/lib/privacyNotice.ts.
 *
 * - Giriş ekranı onayı cihazda "bekleyen" olarak bırakıyor; giriş yapılınca
 *   `usePrivacyAckSync` (app/_layout.tsx) sunucuya yazıyor. Yazılamazsa
 *   bekleyen kalır, bir sonraki açılışta yeniden denenir.
 * - Ardından kayıtlı sürüm okunur; eskiyse / yoksa ana sayfada kart
 *   (`usePrivacyNotice().needsAck`). Okunamazsa kart çıkmaz.
 * - Giriş yokken istek atmaz.
 */
interface PrivacyState {
  userId: string | null;
  version: string | null;
  loaded: boolean;
}

const EMPTY: PrivacyState = { userId: null, version: null, loaded: false };
const useStore = create<PrivacyState>(() => EMPTY);

async function sync(userId: string): Promise<void> {
  useStore.setState({ ...EMPTY, userId });
  const pending = await readPendingAck(Storage);
  if (pending) {
    const r = await ackPrivacyNotice(getSupabase(), pending);
    if (r.ok) await clearPendingAck(Storage);
    else console.warn('[PRIVACY] Onay yazılamadı, sonra yeniden denenecek:', r.error.kind);
  }
  if (useStore.getState().userId !== userId) return;
  const result = await fetchPrivacyAck(getSupabase());
  if (useStore.getState().userId !== userId) return;
  if (result.ok) useStore.setState({ version: result.value.version, loaded: true });
}

/** Kök düzende bir kez: giriş yapılınca bekleyen onayı yaz, kayıtlı sürümü oku */
export function usePrivacyAckSync(): void {
  const { available, ready, userId } = useSession();
  useEffect(() => {
    if (!available || !ready || !userId) {
      if (useStore.getState().userId != null) useStore.setState(EMPTY);
      return;
    }
    if (useStore.getState().userId !== userId) void sync(userId);
  }, [available, ready, userId]);
}

export function usePrivacyNotice(): {
  needsAck: boolean;
  storedVersion: string | null;
  /** Okudum: sunucuya yaz; hata varsa döner */
  acknowledge: () => Promise<AccountError | null>;
} {
  const { userId } = useSession();
  const state = useStore();
  const current = userId != null && state.userId === userId;

  const acknowledge = useCallback(async () => {
    const result = await ackPrivacyNotice(getSupabase(), PRIVACY_NOTICE_VERSION);
    if (!result.ok) return result.error;
    if (useStore.getState().userId === userId) {
      useStore.setState({ version: PRIVACY_NOTICE_VERSION, loaded: true });
    }
    return null;
  }, [userId]);

  return {
    needsAck: current && state.loaded && needsPrivacyAck(state.version),
    storedVersion: current ? state.version : null,
    acknowledge,
  };
}
