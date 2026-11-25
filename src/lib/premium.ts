/**
 * Premium altyapısı (0.13 Bölüm 7) — saf mantık. **Gizli:** bu sürümde
 * kullanıcı hiçbir ödeme ekranı görmez.
 *
 * Amaç ödeme kütüphanesini (RevenueCat, `react-native-purchases`) bu native
 * derlemeye koymak; premium sonra OTA ile açılabilsin. Kütüphane yalnızca
 * iki koşul birlikteyse başlar:
 * - `PREMIUM_ENABLED` (aşağıda) `true` — bu sürümde `false`
 * - platformun RevenueCat herkese açık SDK anahtarı EAS ortam değişkeninde:
 *   `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` (`goog_…`) / `…_IOS_KEY` (`appl_…`)
 *
 * Bayrak kapalıyken modül yüklenmez, hiçbir ağ isteği yapılmaz,
 * `usePremium()` her zaman "premium değil" döner.
 *
 * Hesap eşleme: giriş yapmış kullanıcı RevenueCat'e Supabase kullanıcı
 * kimliğiyle (`logIn`), çıkışta `logOut` (anonim). Hesapsız kullanıcı
 * anonim. Premium açılırken gizlilik metni ayrı bir güncellemeyle değişir
 * (`docs/premium-notu.md`).
 */

/** Ana anahtar. Bu sürümde kapalı; açmak için önce `docs/premium-notu.md`. */
export const PREMIUM_ENABLED = false;

/** RevenueCat'teki yetki (entitlement) kimliği */
export const PREMIUM_ENTITLEMENT = 'premium';

const KEY_PREFIX: Record<string, string> = { android: 'goog_', ios: 'appl_' };

/** Platformun herkese açık SDK anahtarı; yoksa, biçimi bozuksa ya da gizli anahtarsa null */
export function revenueCatApiKey(
  platform: string,
  keys: { android: string | undefined | null; ios: string | undefined | null }
): string | null {
  const prefix = KEY_PREFIX[platform];
  if (!prefix) return null;
  const key = (platform === 'android' ? keys.android : keys.ios)?.trim();
  return key && key.startsWith(prefix) && /^[A-Za-z0-9_]+$/.test(key) ? key : null;
}

/** Kütüphane başlatılsın mı: bayrak açık ve anahtar var */
export function shouldStartPurchases(input: { enabled: boolean; apiKey: string | null }): boolean {
  return input.enabled && input.apiKey != null;
}

/** `CustomerInfo`'nun kullandığımız kısmı */
export interface PremiumCustomerInfo {
  entitlements: { active: Record<string, unknown> };
}

export function isPremiumFromCustomerInfo(info: PremiumCustomerInfo | null | undefined): boolean {
  return info?.entitlements?.active?.[PREMIUM_ENTITLEMENT] != null;
}

export interface PremiumState {
  isPremium: boolean;
  /** Kütüphane yanıt verdi mi (kapalıyken hemen true) */
  ready: boolean;
}

/** Bayrak kapalıyken sabit sonuç */
export const PREMIUM_OFF: PremiumState = { isPremium: false, ready: true };

/** `usePremium()` sonucu: bayrak kapalıyken saklanan durum ne olursa olsun premium değil */
export function premiumResult(enabled: boolean, state: PremiumState): PremiumState {
  return enabled ? state : PREMIUM_OFF;
}

/** Oturum değişince RevenueCat'te ne yapılacak */
export type PurchasesIdentityAction = { kind: 'logIn'; userId: string } | { kind: 'logOut' } | null;

/**
 * `configuredAs`: kütüphanenin şu an bildiği kullanıcı (anonimse null).
 * Aynıysa hiçbir şey; kullanıcı geldiyse `logIn`; gittiyse `logOut`.
 */
export function purchasesIdentityAction(
  configuredAs: string | null,
  userId: string | null
): PurchasesIdentityAction {
  if (configuredAs === userId) return null;
  if (userId) return { kind: 'logIn', userId };
  return { kind: 'logOut' };
}
