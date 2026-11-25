/**
 * Apple ile giriş (0.13 Bölüm 5) — saf mantık. Yalnızca iOS.
 *
 * Apple'ın kuralı: üçüncü taraf girişi (Google) olan uygulamada Apple ile
 * giriş de olmalı. Akış: Apple sayfası (`appleSignInNative.ts`,
 * expo-apple-authentication) → kimlik jetonu (identityToken) → Supabase
 * `signInWithIdToken({ provider: 'apple', token, nonce })` (`account.ts`
 * `signInWithApple`).
 *
 * - Tek kullanımlık değer (nonce): ham hâli Supabase'e, SHA-256 özeti
 *   Apple'a gider; jeton başka bir girişte yeniden kullanılamaz.
 * - "E-postamı gizle" seçilirse Apple'ın yönlendirme adresi
 *   (`…@privaterelay.appleid.com`) olduğu gibi hesabın e-postası olur. Bu
 *   adres kullanıcının gerçek adresinden farklı olduğu için kodla açılmış
 *   hesaba bağlanmaz, ayrı hesap açılır (Apple'ın tasarımı).
 * - Apple adı yalnızca ilk girişte verir; Google'daki gibi profilde ad
 *   yoksa ad ekranına öneri olarak gider, kaydetmeden sunucuya yazılmaz.
 * - Apple'da ayrıca anahtar yok: Supabase jetonu Apple'ın herkese açık
 *   anahtarıyla doğrular (panelde yalnızca bundle id'ler).
 */

import { googleNameSuggestion } from '@/lib/googleAuth';

export type AppleSignInOutcome =
  | { kind: 'success'; idToken: string; name: string | null }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string };

export const APPLE_ERROR_MESSAGES = {
  unavailable: 'Apple ile giriş bu cihazda kullanılamıyor. E-postayla kod alarak gir.',
  noToken: 'Apple girişi tamamlanamadı. Tekrar dene ya da e-postayla kod al.',
  failed: 'Apple ile giriş yapılamadı. Tekrar dene ya da e-postayla kod al.',
} as const;

/** expo-apple-authentication: kullanıcı Apple sayfasını kapattı */
export const APPLE_CANCEL_CODE = 'ERR_REQUEST_CANCELED';

/** Paketin fırlattığı hatayı sonuca çevirir; vazgeçmek hata sayılmaz */
export function appleErrorOutcome(err: unknown): AppleSignInOutcome {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === APPLE_CANCEL_CODE) return { kind: 'cancelled' };
  return { kind: 'error', message: APPLE_ERROR_MESSAGES.failed };
}

/** `signInAsync` sonucunun kullandığımız alanları */
export interface AppleCredential {
  identityToken: string | null;
  fullName: { givenName?: string | null; middleName?: string | null; familyName?: string | null } | null;
}

/** Ad Türkçe sırayla: ad (göbek adı) soyad; hiçbiri yoksa null */
export function appleFullName(fullName: AppleCredential['fullName']): string | null {
  if (!fullName) return null;
  const parts = [fullName.givenName, fullName.middleName, fullName.familyName]
    .map((p) => p?.trim() ?? '')
    .filter((p) => p.length > 0);
  return parts.length > 0 ? parts.join(' ') : null;
}

export function appleCredentialOutcome(credential: AppleCredential): AppleSignInOutcome {
  if (!credential.identityToken) return { kind: 'error', message: APPLE_ERROR_MESSAGES.noToken };
  return { kind: 'success', idToken: credential.identityToken, name: appleFullName(credential.fullName) };
}

/** Ad önerisi: Google'la aynı kural (profilde ad yok, daha önce sorulmadı) */
export function appleNameSuggestion(input: {
  displayName: string | null;
  appleName: string | null;
  prompted: boolean;
}): string | null {
  return googleNameSuggestion({ displayName: input.displayName, googleName: input.appleName, prompted: input.prompted });
}

/** Ham nonce: 32 rastgele bayt, onaltılık (64 karakter) */
export function nonceFromBytes(bytes: Uint8Array): string {
  if (bytes.length < 16) throw new Error('nonce için en az 16 bayt gerekli');
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
