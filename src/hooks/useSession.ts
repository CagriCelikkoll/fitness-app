import { useEffect } from 'react';
import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';

import { classifyAccountError } from '@/lib/auth';
import { getSessionStorageKey, getSupabase } from '@/lib/supabase';
import { parseStoredUser, type StoredUser } from '@/lib/supabaseConfig';
import { useGymFeatures } from '@/hooks/useGymFeatures';

/**
 * Supabase oturumu (v3.0). Bayrak kapalıysa ya da env yoksa hiçbir şey
 * yapmaz: `available: false`, istemciye dokunulmaz.
 *
 * Kalıcılık: oturum kv-store'da (persistSession), erişim token'ı
 * kendiliğinden yenileniyor (autoRefreshToken). Açılışta:
 * 1. Kullanıcı depodan hemen okunuyor; ağ beklenmiyor.
 * 2. `getSession()` oturumu doğruluyor, gerekirse token'ı yeniliyor.
 *    İnternet yoksa yenileme ~25 sn denenip boş dönüyor; bu çıkış
 *    sayılmıyor (token depoda duruyor, internet gelince yenileniyor ve
 *    `onAuthStateChange` haber veriyor).
 * 3. Yalnızca SIGNED_OUT (çıkış ya da sunucunun reddettiği token) ve
 *    ağ dışı bir hatayla boş dönen `getSession` oturumu kapatıyor.
 */
const useSessionStore = create<{ user: StoredUser | null; ready: boolean }>(() => ({
  user: null,
  ready: false,
}));

let subscribed = false;

function setUser(user: StoredUser | null): void {
  useSessionStore.setState({ user, ready: true });
}

async function readStoredUser(): Promise<StoredUser | null> {
  const key = getSessionStorageKey();
  if (!key) return null;
  try {
    return parseStoredUser(await Storage.getItem(key));
  } catch (err) {
    console.error('[ACCOUNT] Kayıtlı oturum okunamadı:', err);
    return null;
  }
}

function ensureSubscribed(): void {
  if (subscribed) return;
  const client = getSupabase();
  if (!client) return;
  subscribed = true;

  client.auth.onAuthStateChange((event, session) => {
    if (session) {
      setUser({ userId: session.user.id, email: session.user.email ?? null });
    } else if (event === 'SIGNED_OUT') {
      setUser(null);
    }
    // INITIAL_SESSION boşsa karar getSession'ın sonucunda
  });

  void readStoredUser().then((stored) => {
    // getSession daha önce bittiyse onun sonucu geçerli
    if (!useSessionStore.getState().ready) setUser(stored);
  });

  client.auth
    .getSession()
    .then(({ data, error }) => {
      if (data.session) {
        setUser({ userId: data.session.user.id, email: data.session.user.email ?? null });
      } else if (error && classifyAccountError(error) === 'network') {
        // Çevrimdışı: depodaki kullanıcı kalsın
        if (!useSessionStore.getState().ready) void readStoredUser().then(setUser);
      } else {
        setUser(null);
      }
    })
    .catch((err) => {
      console.error('[ACCOUNT] Oturum okunamadı:', err);
      if (!useSessionStore.getState().ready) setUser(null);
    });
}

export function useSession(): {
  /** Bayrak açık ve env tanımlı */
  available: boolean;
  /** Oturum okundu mu */
  ready: boolean;
  userId: string | null;
  email: string | null;
} {
  const { available } = useGymFeatures();
  const user = useSessionStore((s) => s.user);
  const ready = useSessionStore((s) => s.ready);

  useEffect(() => {
    if (available) ensureSubscribed();
  }, [available]);

  if (!available) {
    return { available: false, ready: false, userId: null, email: null };
  }
  return { available, ready, userId: user?.userId ?? null, email: user?.email ?? null };
}
