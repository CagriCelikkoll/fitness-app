/**
 * RevenueCat (0.13 Bölüm 7) — native katman; karar `premium.ts`'te (saf).
 * Testte kullanılmaz.
 *
 * `react-native-purchases` yalnızca `startPurchases` içinde, koşullar
 * sağlanınca `require` ile yükleniyor: bayrak kapalıyken modül hiç
 * yüklenmez, ağ isteği yapılmaz. Native modülü olmayan eski derlemeye OTA
 * gitse de çökmez (başlamaz).
 */

import { Platform } from 'react-native';

import {
  PREMIUM_ENABLED,
  purchasesIdentityAction,
  revenueCatApiKey,
  shouldStartPurchases,
  type PremiumCustomerInfo,
} from '@/lib/premium';

type PurchasesModule = typeof import('react-native-purchases');
type Purchases = PurchasesModule['default'];

// process.env.EXPO_PUBLIC_* derleme sırasında yerine yazılıyor; tam bu biçimde
const API_KEY = revenueCatApiKey(Platform.OS, {
  android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY,
  ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY,
});

let purchases: Purchases | null = null;
/** Kütüphanenin bildiği kullanıcı (anonimse null) */
let configuredAs: string | null = null;
let queue: Promise<void> = Promise.resolve();

/** İşlemler sırayla (giriş / çıkış üst üste gelmesin) */
function serial(task: () => Promise<void>): Promise<void> {
  queue = queue.then(task).catch((err) => console.warn('[PREMIUM] Hata:', err));
  return queue;
}

/**
 * Oturuma göre başlatır ya da kullanıcıyı eşler. Bayrak kapalıysa ya da
 * anahtar yoksa hiçbir şey yapmaz. `onCustomerInfo`: yetki değişince.
 */
export function syncPurchases(
  userId: string | null,
  onCustomerInfo: (info: PremiumCustomerInfo) => void
): Promise<void> {
  if (!shouldStartPurchases({ enabled: PREMIUM_ENABLED, apiKey: API_KEY })) return Promise.resolve();
  return serial(async () => {
    if (!purchases) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('react-native-purchases') as PurchasesModule;
      const p = mod.default;
      p.configure({ apiKey: API_KEY!, appUserID: userId ?? undefined });
      p.addCustomerInfoUpdateListener((info) => onCustomerInfo(info));
      purchases = p;
      configuredAs = userId;
      onCustomerInfo(await p.getCustomerInfo());
      return;
    }
    const action = purchasesIdentityAction(configuredAs, userId);
    if (!action) return;
    if (action.kind === 'logIn') {
      const { customerInfo } = await purchases.logIn(action.userId);
      configuredAs = action.userId;
      onCustomerInfo(customerInfo);
    } else {
      onCustomerInfo(await purchases.logOut());
      configuredAs = null;
    }
  });
}
