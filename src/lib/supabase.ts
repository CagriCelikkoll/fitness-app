/**
 * Supabase istemcisi (v3.0 hesap ve salon; v3.7 herkese açık).
 *
 * - Tembel kuruluyor ve yalnızca gerektiğinde: cihazda kayıtlı oturum
 *   varsa (açılışta, `useSession`) ya da kullanıcı giriş ekranını açınca.
 *   Hesapsız kullanıcıda istemci hiç oluşmuyor, ağa istek gitmiyor
 *   (karar `decideAccountBoot`, supabaseConfig.ts).
 * - Env (`EXPO_PUBLIC_SUPABASE_URL` / `_ANON_KEY`) yoksa `null`; hesap
 *   özellikleri gizleniyor, uygulama çökmüyor.
 * - Oturum kv-store'da (expo-sqlite, zaten kurulu); AsyncStorage yok.
 * - Token yenileme yalnızca uygulama ön plandayken.
 *
 * React Native modülü içe aktarıyor; testte kullanılmaz (saf kısım
 * `supabaseConfig.ts`).
 */

import { AppState } from 'react-native';
import Storage from 'expo-sqlite/kv-store';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import {
  readSupabaseConfig,
  serverEnvironmentWarning,
  sessionStorageKey,
  supabaseAuthOptions,
} from '@/lib/supabaseConfig';

// process.env.EXPO_PUBLIC_* derleme sırasında yerine yazılıyor; tam bu
// biçimde (nokta erişimi) kalmalı.
const config = readSupabaseConfig({
  url: process.env.EXPO_PUBLIC_SUPABASE_URL,
  anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
});

// Yanlış ortamla yayınlanmış paket: yalnızca geliştirici logu (v3.7)
const envWarning = serverEnvironmentWarning(config, { isDev: __DEV__ });
if (envWarning) console.warn(envWarning);

let client: SupabaseClient | null = null;
let active = false;

/** Env tanımlı mı (istemci kurmadan) */
export function isSupabaseConfigured(): boolean {
  return config != null;
}

/** Depodaki oturumun anahtarı; env yoksa null */
export function getSessionStorageKey(): string | null {
  return config ? sessionStorageKey(config.url) : null;
}

/** İstemci kuruldu mu (kurmadan) */
export function isSupabaseStarted(): boolean {
  return client != null;
}

/**
 * İstemci; env yoksa null. İlk çağrıda kurulur. Ekranlar ve kancalar
 * yalnızca giriş yapılmışken çağırıyor (userId kontrolünden sonra).
 */
export function getSupabase(): SupabaseClient | null {
  if (!config) return null;
  if (client) return client;

  client = createClient(config.url, config.anonKey, {
    auth: supabaseAuthOptions(Storage),
  });

  AppState.addEventListener('change', (state) => {
    if (!client) return;
    if (state === 'active' && active) {
      void client.auth.startAutoRefresh();
    } else {
      void client.auth.stopAutoRefresh();
    }
  });

  return client;
}

/** Kayıtlı oturum bulununca ya da giriş ekranında: istemciyi kur, token yenilemeyi başlat */
export function activateSupabase(): SupabaseClient | null {
  const c = getSupabase();
  if (!c) return null;
  active = true;
  if (AppState.currentState === 'active') void c.auth.startAutoRefresh();
  return c;
}
