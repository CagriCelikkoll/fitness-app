import { useEffect } from 'react';
import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';

import { classifyAccountError } from '@/lib/auth';
import {
  activateSupabase,
  getSessionStorageKey,
  isSupabaseConfigured,
} from '@/lib/supabase';
import { decideAccountBoot, type StoredUser } from '@/lib/supabaseConfig';

/**
 * Supabase oturumu (v3.0; v3.7'den beri bayraksız). Env yoksa hiçbir şey
 * yapmaz: `available: false`, istemciye dokunulmaz.
 *
 * Açılış (v3.7):
 * 1. Kayıtlı oturum kv-store'dan okunuyor (ağsız, `decideAccountBoot`).
 *    Yoksa istemci HİÇ kurulmuyor: hesapsız kullanıcıda ağ isteği yok.
 *    Giriş ekranı açılınca `startAccountClient()` kurar.
 * 2. Varsa kullanıcı hemen gösteriliyor; `getSession()` oturumu doğruluyor,
 *    gerekirse token'ı yeniliyor. İnternet yoksa yenileme ~25 sn denenip
 *    boş dönüyor; bu çıkış sayılmıyor (token depoda duruyor, internet
 *    gelince yenileniyor ve `onAuthStateChange` haber veriyor).
 * 3. Yalnızca SIGNED_OUT (çıkış ya da sunucunun reddettiği token) ve ağ
 *    dışı bir hatayla boş dönen `getSession` oturumu kapatıyor.
 */
const useSessionStore = create<{ user: StoredUser | null; ready: boolean }>(() => ({
  user: null,
  ready: false,
}));

let booted = false;
let subscribed = false;

function setUser(user: StoredUser | null): void {
  useSessionStore.setState({ user, ready: true });
}

function ensureBooted(): void {
  if (booted) return;
  booted = true;
  void decideAccountBoot({
    configured: isSupabaseConfigured(),
    sessionKey: getSessionStorageKey(),
    storage: Storage,
  }).then((decision) => {
    if (decision.kind === 'start') {
      // Ağ beklemeden "giriş yapılmış" görünsün
      if (!useSessionStore.getState().ready) setUser(decision.user);
      ensureSubscribed();
    } else if (!subscribed) {
      setUser(null);
    }
  });
}

function ensureSubscribed(): void {
  if (subscribed) return;
  const client = activateSupabase();
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

  client.auth
    .getSession()
    .then(({ data, error }) => {
      if (data.session) {
        setUser({ userId: data.session.user.id, email: data.session.user.email ?? null });
      } else if (error && classifyAccountError(error) === 'network') {
        // Çevrimdışı: depodaki kullanıcı kalsın
        if (!useSessionStore.getState().ready) setUser(null);
      } else {
        setUser(null);
      }
    })
    .catch((err) => {
      console.error('[ACCOUNT] Oturum okunamadı:', err);
      if (!useSessionStore.getState().ready) setUser(null);
    });
}

/**
 * Giriş ekranı açılınca: istemciyi kur ve oturum değişikliklerini dinle.
 * Kod gönderilene kadar istek atılmaz (oturumsuz istemci ağa çıkmıyor).
 */
export function startAccountClient(): void {
  if (!isSupabaseConfigured()) return;
  ensureSubscribed();
}

export function useSession(): {
  /** Env tanımlı: hesap özellikleri gösterilebilir */
  available: boolean;
  /** Oturum okundu mu */
  ready: boolean;
  userId: string | null;
  email: string | null;
} {
  const available = isSupabaseConfigured();
  const user = useSessionStore((s) => s.user);
  const ready = useSessionStore((s) => s.ready);

  useEffect(() => {
    if (available) ensureBooted();
  }, [available]);

  if (!available) {
    return { available: false, ready: false, userId: null, email: null };
  }
  return { available, ready, userId: user?.userId ?? null, email: user?.email ?? null };
}
