/**
 * Supabase bağlantı ayarları, istemcinin ne zaman başlayacağı ve canlı /
 * test sunucusu kontrolü — saf, testte kullanılabilir. İstemcinin kendisi
 * `supabase.ts`'te.
 *
 * v3.7: "Salon özellikleri (deneysel)" gizli bayrağı kaldırıldı (pentest
 * DNC-06). Hesap herkese açık; salon ekranları üyeliğe bağlı.
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
// Ne zaman başlar (v3.7)
//
// Hesap herkese açık ama hesapsız kullanıcıda hiçbir ağ isteği olmamalı
// (Gizlilik Politikası: "hesap açmazsan her şey telefonda kalır").
// İstemci yalnızca iki durumda kurulur:
// - cihazda kayıtlı bir oturum var (kv-store, ağsız okunuyor), ya da
// - kullanıcı giriş ekranını açtı.
// Kayıtlı oturum yoksa istemci hiç kurulmuyor. Kurulsa da oturumsuz
// supabase-js istek atmıyor (test/accountBoot.test.ts ikisini de deniyor).
// ============================================================================

export type AccountBootDecision =
  | { kind: 'not_configured' }
  | { kind: 'signed_out' }
  | { kind: 'start'; user: StoredUser };

/**
 * Açılışta: env yoksa hiçbir şey; kayıtlı oturum yoksa "çıkış yapılmış"
 * (istemci kurulmaz); varsa istemci başlar. Depo okunamazsa çıkış
 * yapılmış sayılır (istek atmamak güvenli taraf).
 */
export async function decideAccountBoot(input: {
  configured: boolean;
  sessionKey: string | null;
  storage: Pick<SessionStorage, 'getItem'>;
}): Promise<AccountBootDecision> {
  if (!input.configured || !input.sessionKey) return { kind: 'not_configured' };
  let raw: string | null;
  try {
    raw = await input.storage.getItem(input.sessionKey);
  } catch (err) {
    console.error('[ACCOUNT] Kayıtlı oturum okunamadı:', err);
    return { kind: 'signed_out' };
  }
  const user = parseStoredUser(raw);
  return user ? { kind: 'start', user } : { kind: 'signed_out' };
}

// ============================================================================
// Canlı / test sunucusu (v3.7)
//
// OTA güncellemesi sunucu adresini derleme anındaki ortamdan alıyor.
// Yanlış ortamla yayınlanan güncelleme herkesi test projesine bağlayabilir.
// Geliştirme dışı bir pakette adres canlı proje değilse geliştirici loguna
// uyarı (kullanıcı görmez). Test projesinin adresi uygulamaya girmiyor:
// yalnızca canlının kimliği biliniyor.
// ============================================================================

/** Canlı Supabase projesinin kimliği (adres herkese açık; anahtar değil) */
export const LIVE_PROJECT_REF = 'iuugvgpcwqiwyrrouwrn';

export function projectRefOf(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.endsWith('.supabase.co') ? host.split('.')[0]! : host;
  } catch {
    return null;
  }
}

/** Uyarı metni ya da null */
export function serverEnvironmentWarning(
  config: SupabaseConfig | null,
  { isDev }: { isDev: boolean }
): string | null {
  if (isDev) return null;
  if (!config) {
    return '[CONFIG] Bu pakette Supabase adresi yok: hesap özellikleri kapalı. OTA komutuna --environment verildi mi?';
  }
  const ref = projectRefOf(config.url);
  if (ref !== LIVE_PROJECT_REF) {
    return `[CONFIG] Bu paket canlı olmayan bir Supabase projesine bağlı (${ref ?? 'bilinmiyor'}). Test projesiyle yayın yapılmış olabilir.`;
  }
  return null;
}
