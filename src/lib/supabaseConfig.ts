/**
 * Supabase bağlantı ayarları ve "Salon özellikleri (deneysel)" bayrağı
 * — saf, testte kullanılabilir. İstemcinin kendisi `supabase.ts`'te.
 */

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

/**
 * Env değerlerinden ayar. Eksik / geçersizse null: istemci kurulmaz,
 * hesap özellikleri gizlenir, uygulama çökmez.
 *
 * Service role key (gizli anahtar) verilmişse de null: o anahtar RLS'yi
 * atlar ve uygulamaya hiçbir koşulda girmemeli.
 */
export function readSupabaseConfig(env: {
  url?: string | null;
  anonKey?: string | null;
}): SupabaseConfig | null {
  const url = (env.url ?? '').trim().replace(/\/+$/, '');
  const anonKey = (env.anonKey ?? '').trim();
  if (!/^https:\/\/\S+$/.test(url) || anonKey.length === 0) return null;
  if (isServiceRoleKey(anonKey)) {
    console.error('[ACCOUNT] Service role key uygulamada kullanılamaz; hesap özellikleri kapalı.');
    return null;
  }
  return { url, anonKey };
}

/** Oturumun tutulduğu anahtar-değer deposu (uygulamada expo-sqlite kv-store) */
export interface SessionStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * İstemcinin auth ayarları. Uygulama (`supabase.ts`) ve oturum testi
 * (test/sessionPersistence.test.ts) aynı ayarı kullanıyor.
 *
 * - persistSession: oturum depoya yazılıyor, uygulama kapanıp açılınca
 *   oradan okunuyor
 * - autoRefreshToken: erişim token'ı (1 saat) süresi dolmadan yenileniyor;
 *   uygulama açılırken süresi dolmuşsa yenileme token'ıyla yenileniyor
 * - detectSessionInUrl: false — React Native'de URL'den oturum yok
 */
export function supabaseAuthOptions(storage: SessionStorage) {
  return {
    storage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  } as const;
}

/**
 * supabase-js'in oturumu yazdığı anahtar (varsayılan). Testte gerçek
 * istemcinin bu anahtarı kullandığı doğrulanıyor.
 */
export function sessionStorageKey(url: string): string {
  return `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
}

export interface StoredUser {
  userId: string;
  email: string | null;
}

/**
 * Depodaki oturumdan kullanıcı. Açılışta ağ beklemeden "giriş yapılmış"
 * gösterebilmek için: erişim token'ının süresi dolmuşsa ve internet
 * yoksa supabase-js yenilemeyi ~25 sn deneyip oturumsuz dönüyor, ama
 * token depoda kalıyor ve internet gelince yenileniyor.
 */
export function parseStoredUser(raw: string | null): StoredUser | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { user?: { id?: unknown; email?: unknown } } | null;
    const user = parsed?.user;
    if (!user || typeof user.id !== 'string' || user.id.length === 0) return null;
    return { userId: user.id, email: typeof user.email === 'string' ? user.email : null };
  } catch {
    return null;
  }
}

/** Yeni biçim `sb_secret_…` ya da JWT'de `role: service_role` */
export function isServiceRoleKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true;
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  try {
    const json = base64UrlDecode(parts[1]!);
    const payload = JSON.parse(json) as { role?: unknown };
    return payload.role === 'service_role';
  } catch {
    return false;
  }
}

function base64UrlDecode(input: string): string {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return atob(padded);
}

// ============================================================================
// Gizli bayrak (kv-store, varsayılan kapalı)
// ============================================================================

export const GYM_FEATURES_KEY = 'gymFeatures.enabled';

interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export async function getGymFeaturesEnabled(store: KeyValueStore): Promise<boolean> {
  return (await store.getItem(GYM_FEATURES_KEY)) === 'true';
}

export async function setGymFeaturesEnabled(store: KeyValueStore, enabled: boolean): Promise<void> {
  await store.setItem(GYM_FEATURES_KEY, enabled ? 'true' : 'false');
}
