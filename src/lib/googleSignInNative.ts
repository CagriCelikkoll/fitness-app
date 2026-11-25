/**
 * Google hesap seçicisi (0.13 Bölüm 4) — native modül burada; mantık
 * `googleAuth.ts`'te (saf). Testte kullanılmaz.
 *
 * Modül `require` ile yükleniyor: native modülü olmayan derlemede (Expo Go,
 * eski APK) açılışta çökmez, düğme gizlenir.
 */

import {
  GOOGLE_ERROR_MESSAGES,
  googleErrorOutcome,
  googleResponseOutcome,
  googleWebClientId,
  type GoogleSignInOutcome,
  type GoogleSignInResponse,
  type GoogleStatusCodes,
} from '@/lib/googleAuth';

interface GoogleSigninModule {
  GoogleSignin: {
    configure(options: { webClientId: string; scopes?: string[]; offlineAccess?: boolean }): void;
    hasPlayServices(options?: { showPlayServicesUpdateDialog?: boolean }): Promise<boolean>;
    signIn(): Promise<GoogleSignInResponse>;
    signOut(): Promise<null>;
  };
  statusCodes: GoogleStatusCodes;
}

// process.env.EXPO_PUBLIC_* derleme sırasında yerine yazılıyor; tam bu
// biçimde yazılmalı
const WEB_CLIENT_ID = googleWebClientId(process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID);

let cached: GoogleSigninModule | null | undefined;
let configured = false;

function load(): GoogleSigninModule | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('@react-native-google-signin/google-signin') as GoogleSigninModule;
  } catch (err) {
    console.warn('[GOOGLE] Modül yüklenemedi:', err);
    cached = null;
  }
  return cached;
}

function ready(): GoogleSigninModule | null {
  if (!WEB_CLIENT_ID) return null;
  const mod = load();
  if (!mod) return null;
  if (!configured) {
    // Yalnızca ad ve e-posta (varsayılan "profile email"); sunucuya
    // erişim kodu (offlineAccess) yok
    mod.GoogleSignin.configure({ webClientId: WEB_CLIENT_ID, offlineAccess: false });
    configured = true;
  }
  return mod;
}

/** Düğme gösterilsin mi: kimlik tanımlı ve native modül var */
export function googleSignInAvailable(): boolean {
  return WEB_CLIENT_ID != null && load() != null;
}

/** Hesap seçiciyi açar; Supabase'e henüz bir şey gitmez */
export async function startGoogleSignIn(): Promise<GoogleSignInOutcome> {
  const mod = ready();
  if (!mod) return { kind: 'error', message: GOOGLE_ERROR_MESSAGES.unavailable };
  try {
    await mod.GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    return googleResponseOutcome(await mod.GoogleSignin.signIn());
  } catch (err) {
    console.error('[GOOGLE] Giriş hatası:', err);
    return googleErrorOutcome(err, mod.statusCodes);
  }
}

/**
 * Uygulamadan çıkışta: bir sonraki girişte hesap seçici yeniden sorsun.
 * Hata yutulur (Google ile hiç girilmediyse de sorun değil).
 */
export async function googleSignOut(): Promise<void> {
  const mod = WEB_CLIENT_ID ? load() : null;
  if (!mod) return;
  try {
    ready();
    await mod.GoogleSignin.signOut();
  } catch (err) {
    console.warn('[GOOGLE] Çıkış:', err);
  }
}
