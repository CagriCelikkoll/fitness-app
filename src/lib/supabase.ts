/**
 * Supabase istemcisi (v3.0 hesap ve salon).
 *
 * - Tembel kuruluyor: yalnızca "Salon özellikleri" bayrağı açıkken
 *   `getSupabase()` çağrılıyor. Bayrak kapalıyken istemci hiç
 *   oluşmuyor, ağa istek gitmiyor.
 * - Env (`EXPO_PUBLIC_SUPABASE_URL` / `_ANON_KEY`) yoksa `null`; hesap
 *   özellikleri gizleniyor, uygulama çökmüyor.
 * - Oturum kv-store'da (expo-sqlite, zaten kurulu); AsyncStorage yok.
 * - Token yenileme yalnızca uygulama ön plandayken ve bayrak açıkken.
 *
 * React Native modülü içe aktarıyor; testte kullanılmaz (saf kısım
 * `supabaseConfig.ts`).
 */

import { AppState } from 'react-native';
import Storage from 'expo-sqlite/kv-store';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { readSupabaseConfig } from '@/lib/supabaseConfig';

// process.env.EXPO_PUBLIC_* derleme sırasında yerine yazılıyor; tam bu
// biçimde (nokta erişimi) kalmalı.
const config = readSupabaseConfig({
  url: process.env.EXPO_PUBLIC_SUPABASE_URL,
  anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
});

let client: SupabaseClient | null = null;
let active = false;

/** Env tanımlı mı (istemci kurmadan) */
export function isSupabaseConfigured(): boolean {
  return config != null;
}

/** İstemci; env yoksa null. İlk çağrıda kurulur. */
export function getSupabase(): SupabaseClient | null {
  if (!config) return null;
  if (client) return client;

  client = createClient(config.url, config.anonKey, {
    auth: {
      storage: Storage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
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

/** Bayrak açılınca: istemciyi kur, token yenilemeyi başlat */
export function activateSupabase(): SupabaseClient | null {
  const c = getSupabase();
  if (!c) return null;
  active = true;
  if (AppState.currentState === 'active') void c.auth.startAutoRefresh();
  return c;
}

/** Bayrak kapanınca: arka plan istekleri dursun (oturum silinmez) */
export function deactivateSupabase(): void {
  active = false;
  if (client) void client.auth.stopAutoRefresh();
}
