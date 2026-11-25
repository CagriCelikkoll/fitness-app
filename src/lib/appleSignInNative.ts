/**
 * Apple ile giriş sayfası (0.13 Bölüm 5) — native modül burada; mantık
 * `appleAuth.ts`'te (saf). Testte kullanılmaz. Yalnızca iOS.
 *
 * Modül `require` ile yükleniyor: native modülü olmayan derlemede (Android,
 * Expo Go, eski derleme) açılışta çökmez, düğme gizlenir.
 */

import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';

import {
  APPLE_ERROR_MESSAGES,
  appleCredentialOutcome,
  appleErrorOutcome,
  nonceFromBytes,
  type AppleCredential,
  type AppleSignInOutcome,
} from '@/lib/appleAuth';

export type AppleAuthenticationModule = typeof import('expo-apple-authentication');

let cached: AppleAuthenticationModule | null | undefined;

/** Native modül (düğme bileşeni de buradan); iOS dışında ve yoksa null */
export function loadAppleAuthentication(): AppleAuthenticationModule | null {
  if (cached !== undefined) return cached;
  if (Platform.OS !== 'ios') return (cached = null);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('expo-apple-authentication') as AppleAuthenticationModule;
  } catch (err) {
    console.warn('[APPLE] Modül yüklenemedi:', err);
    cached = null;
  }
  return cached;
}

/** Düğme gösterilsin mi: iOS, modül var ve cihaz destekliyor */
export async function appleSignInAvailable(): Promise<boolean> {
  const mod = loadAppleAuthentication();
  if (!mod) return false;
  try {
    return await mod.isAvailableAsync();
  } catch {
    return false;
  }
}

/**
 * Apple sayfasını açar; Supabase'e henüz bir şey gitmez. Başarılıysa ham
 * nonce da döner (Supabase'e o gider).
 */
export async function startAppleSignIn(): Promise<{ outcome: AppleSignInOutcome; nonce: string | null }> {
  const mod = loadAppleAuthentication();
  if (!mod) return { outcome: { kind: 'error', message: APPLE_ERROR_MESSAGES.unavailable }, nonce: null };
  try {
    const nonce = nonceFromBytes(await Crypto.getRandomBytesAsync(32));
    const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
    const credential = await mod.signInAsync({
      requestedScopes: [
        mod.AppleAuthenticationScope.FULL_NAME,
        mod.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashed,
    });
    return { outcome: appleCredentialOutcome(credential as AppleCredential), nonce };
  } catch (err) {
    const outcome = appleErrorOutcome(err);
    if (outcome.kind === 'error') console.error('[APPLE] Giriş hatası:', err);
    return { outcome, nonce: null };
  }
}
