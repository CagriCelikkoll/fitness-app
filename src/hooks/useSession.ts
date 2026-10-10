import { useEffect } from 'react';
import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

import { getSupabase } from '@/lib/supabase';
import { useGymFeatures } from '@/hooks/useGymFeatures';

/**
 * Supabase oturumu (v3.0). Bayrak kapalıysa ya da env yoksa hiçbir şey
 * yapmaz: `available: false`, istemciye dokunulmaz.
 *
 * Oturum kv-store'dan okunuyor; `onAuthStateChange` ile güncel kalıyor
 * (giriş, çıkış, token yenileme). Dinleyici uygulama ömrü boyunca bir
 * kez kuruluyor.
 */
const useSessionStore = create<{ session: Session | null; ready: boolean }>(() => ({
  session: null,
  ready: false,
}));

let subscribed = false;

function ensureSubscribed(): void {
  if (subscribed) return;
  const client = getSupabase();
  if (!client) return;
  subscribed = true;

  client.auth.onAuthStateChange((_event, session) => {
    useSessionStore.setState({ session, ready: true });
  });
  client.auth
    .getSession()
    .then(({ data }) => useSessionStore.setState({ session: data.session, ready: true }))
    .catch((err) => {
      console.error('[ACCOUNT] Oturum okunamadı:', err);
      useSessionStore.setState({ session: null, ready: true });
    });
}

export function useSession(): {
  /** Bayrak açık ve env tanımlı */
  available: boolean;
  /** Oturum okundu mu */
  ready: boolean;
  session: Session | null;
  userId: string | null;
  email: string | null;
} {
  const { available } = useGymFeatures();
  const session = useSessionStore((s) => s.session);
  const ready = useSessionStore((s) => s.ready);

  useEffect(() => {
    if (available) ensureSubscribed();
  }, [available]);

  if (!available) {
    return { available: false, ready: false, session: null, userId: null, email: null };
  }
  return {
    available,
    ready,
    session,
    userId: session?.user.id ?? null,
    email: session?.user.email ?? null,
  };
}
