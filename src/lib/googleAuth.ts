/**
 * Google ile giriş (0.13 Bölüm 4) — saf mantık.
 *
 * Akış: Google hesap seçici (`googleSignInNative.ts`,
 * @react-native-google-signin/google-signin) → kimlik jetonu (idToken) →
 * Supabase `signInWithIdToken({ provider: 'google' })` (`account.ts`
 * `signInWithGoogle`). Aynı e-postayla kodla açılmış hesap varsa Supabase
 * kimliği o hesaba bağlar (doğrulanmış e-posta; entegrasyon testi
 * `test/integration/googleLink.int.ts`).
 *
 * - İstemci kimliği (web istemcisi; jetonun `aud`'u) EAS ortam değişkeni
 *   `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`. Kimlik herkese açık bir değer;
 *   istemci gizli anahtarı (client secret) yalnızca Supabase panelinde,
 *   uygulamada ve depoda yok (`test/googleAuth.test.ts` denetliyor).
 * - Android istemcileri (paket + SHA-1) yalnızca Google Cloud'da; Dinç
 *   Test'in ayrı paketi için ayrı Android istemcisi orada açılır, uygulama
 *   ayarında karşılığı yok.
 * - Google'dan yalnızca ad ve e-posta alınır; profil fotoğrafı alınmaz.
 *   Ad, profilde ad yoksa öneri olarak ad ekranına gelir; kullanıcı
 *   kaydetmeden sunucuya yazılmaz.
 */

import { displayNameError, normalizeDisplayName } from '@/lib/profile';

/** Web istemci kimliğinin biçimi: `<sayı>-<harf/rakam>.apps.googleusercontent.com` */
const WEB_CLIENT_ID_PATTERN = /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/;

/** Ortam değişkenindeki kimlik; yoksa ya da biçimi bozuksa null (düğme görünmez) */
export function googleWebClientId(value: string | undefined | null): string | null {
  const id = value?.trim();
  return id && WEB_CLIENT_ID_PATTERN.test(id) ? id : null;
}

/**
 * iOS istemci kimliği (0.13 Bölüm 5). iOS'ta Google SDK'sı kendi
 * istemcisini ister (bundle id'ye bağlı); Dinç ve Dinç Test'in bundle
 * id'leri ayrı olduğu için iki kimlik var:
 * `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` ve `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID_DAHILI`.
 * Hangisi kullanılacağı derlemenin kanalından (`appVariant.ts`; OTA'dan
 * sonra da doğru). Yoksa ya da biçimi bozuksa null: iOS'ta düğme görünmez.
 *
 * Aynı kimlikten `app.config.js` iOS URL şemasını üretir (bkz.
 * `googleIosUrlScheme`; test ikisinin aynı olduğunu denetliyor).
 */
export function googleIosClientId(input: {
  internal: boolean;
  main: string | undefined | null;
  dahili: string | undefined | null;
}): string | null {
  return googleWebClientId(input.internal ? input.dahili : input.main);
}

/** iOS URL şeması: `<sayı>-<x>.apps.googleusercontent.com` → `com.googleusercontent.apps.<sayı>-<x>` */
export function googleIosUrlScheme(clientId: string): string {
  return `com.googleusercontent.apps.${clientId.replace(/\.apps\.googleusercontent\.com$/, '')}`;
}

// ── Hesap seçicinin sonucu ──────────────────────────────────────────────

export type GoogleSignInOutcome =
  | { kind: 'success'; idToken: string; name: string | null }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string };

/** Paketin hata kodları (`statusCodes`); Android'de dize */
export interface GoogleStatusCodes {
  SIGN_IN_CANCELLED: string;
  IN_PROGRESS: string;
  PLAY_SERVICES_NOT_AVAILABLE: string;
}

export const GOOGLE_ERROR_MESSAGES = {
  unavailable: 'Google ile giriş bu sürümde kullanılamıyor. E-postayla kod alarak gir.',
  // Android'e özgü; iOS'ta paket bu hatayı vermez
  playServices: "Google Play Hizmetleri bu telefonda yok ya da güncel değil. E-postayla kod alarak gir.",
  noToken: 'Google girişi tamamlanamadı. Tekrar dene ya da e-postayla kod al.',
  failed: 'Google ile giriş yapılamadı. Tekrar dene ya da e-postayla kod al.',
} as const;

/**
 * Paketin fırlattığı hatayı sonuca çevirir. Seçiciyi kapatmak ve
 * "zaten sürüyor" hata sayılmaz (sessizce vazgeçilir).
 */
export function googleErrorOutcome(err: unknown, codes: GoogleStatusCodes): GoogleSignInOutcome {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === codes.SIGN_IN_CANCELLED || code === codes.IN_PROGRESS) return { kind: 'cancelled' };
  if (code === codes.PLAY_SERVICES_NOT_AVAILABLE) {
    return { kind: 'error', message: GOOGLE_ERROR_MESSAGES.playServices };
  }
  return { kind: 'error', message: GOOGLE_ERROR_MESSAGES.failed };
}

/** `GoogleSignin.signIn()` yanıtı (yalnızca kullandığımız alanlar) */
export type GoogleSignInResponse =
  | { type: 'success'; data: { idToken: string | null; user: { name: string | null } } }
  | { type: 'cancelled'; data: null };

export function googleResponseOutcome(response: GoogleSignInResponse): GoogleSignInOutcome {
  if (response.type !== 'success') return { kind: 'cancelled' };
  const { idToken, user } = response.data;
  if (!idToken) return { kind: 'error', message: GOOGLE_ERROR_MESSAGES.noToken };
  return { kind: 'success', idToken, name: user.name };
}

// ── Ad önerisi ──────────────────────────────────────────────────────────

/**
 * Giriş sonrası ad ekranına gidilecekse önerilecek ad; gidilmeyecekse
 * null. Yalnızca profilde ad yoksa, ad bu hesapta daha önce sorulmadıysa
 * (`profile.namePrompted.<kullanıcı>`, ana sayfadaki "Adını ekle" ile
 * ortak: bir kez sorulur) ve Google ad verdiyse. Ad kurala uymasa da
 * önerilir: ekran hatayı gösterir, kullanıcı düzeltir.
 */
export function googleNameSuggestion(input: {
  displayName: string | null;
  googleName: string | null;
  prompted: boolean;
}): string | null {
  if (input.displayName != null || input.prompted) return null;
  const name = normalizeDisplayName(input.googleName ?? '');
  return name ? name : null;
}

/** Önerilen adın hatası (ekranda hemen gösterilir); geçerliyse null */
export function suggestionError(name: string): string | null {
  return displayNameError(name, { required: true });
}
