/**
 * Uygulamanın oturum deposu (v0.13, DNC-02): expo-secure-store, 0.12'den
 * kalan kv-store kopyası ilk okumada taşınıp siliniyor. Mantık
 * `secureSessionStorage.ts`'te (saf, test edilir). Native modül içe
 * aktarıyor; testte kullanılmaz.
 *
 * iOS: `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` — iCloud Keychain'e / başka
 * cihaza geçmez. Android: Keystore anahtarı cihazdan çıkmaz; şifreli
 * değerler de otomatik yedeklemeden hariç (`plugins/withBackupRules.js`).
 */

import * as SecureStore from 'expo-secure-store';
import Storage from 'expo-sqlite/kv-store';

import { createSecureSessionStorage } from '@/lib/secureSessionStorage';

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export const appSessionStorage = createSecureSessionStorage({
  secure: {
    getItemAsync: (key) => SecureStore.getItemAsync(key, OPTIONS),
    setItemAsync: (key, value) => SecureStore.setItemAsync(key, value, OPTIONS),
    deleteItemAsync: (key) => SecureStore.deleteItemAsync(key, OPTIONS),
  },
  legacy: Storage,
});
