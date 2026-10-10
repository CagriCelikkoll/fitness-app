/**
 * Hesap ve salon (v3.0) — saf yardımcılar.
 *
 * E-posta doğrulama, salon kodu normalleştirme, rol etiketleri, hata
 * mesajları ve giriş ekranının (e-posta → 6 haneli kod) durum mantığı.
 * React ve Supabase bilmez; test/auth.test.ts.
 */

import { digitsOnly } from '@/lib/format';

// ============================================================================
// E-posta ve kod
// ============================================================================

export function normalizeEmail(text: string): string {
  return text.trim().toLowerCase();
}

/** Kaba kontrol: bir @, iki tarafta da boşluksuz metin, alan adında nokta */
export function isValidEmail(text: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(text));
}

export const OTP_LENGTH = 6;

export function isValidOtp(code: string): boolean {
  return new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code);
}

/**
 * Salon kodu: büyük harf, yalnızca A–Z ve 0–9.
 * `" eu-7k2 "` → `"EU7K2"`. Sunucudaki `normalize_join_code` ile aynı.
 */
export function normalizeJoinCode(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Sunucudaki biçim: 6–8 karakter */
export const JOIN_CODE_MIN = 6;
export const JOIN_CODE_MAX = 8;

export function isValidJoinCode(text: string): boolean {
  const code = normalizeJoinCode(text);
  return code.length >= JOIN_CODE_MIN && code.length <= JOIN_CODE_MAX;
}

// ============================================================================
// Rol
// ============================================================================

export type GymRole = 'member' | 'trainer' | 'admin';

const ROLE_LABELS: Record<GymRole, string> = {
  member: 'Üye',
  trainer: 'Hoca',
  admin: 'Yönetici',
};

export function isGymRole(value: unknown): value is GymRole {
  return value === 'member' || value === 'trainer' || value === 'admin';
}

export function roleLabel(role: GymRole): string {
  return ROLE_LABELS[role];
}

// ============================================================================
// Hatalar
// ============================================================================

export type AccountErrorKind =
  | 'not_configured'
  | 'network'
  | 'rate_limited'
  | 'invalid_otp'
  | 'invalid_code'
  | 'too_many_attempts'
  | 'not_signed_in'
  | 'last_admin'
  | 'unknown';

export const ACCOUNT_ERROR_MESSAGES: Record<AccountErrorKind, string> = {
  not_configured: 'Hesap özellikleri bu sürümde kullanılamıyor.',
  network: 'Sunucuya ulaşılamadı. İnternet bağlantını kontrol edip tekrar dene.',
  rate_limited: 'Çok fazla istek gönderildi. Biraz bekleyip tekrar dene.',
  invalid_otp: 'Kod hatalı ya da süresi dolmuş. Kontrol edip tekrar dene.',
  invalid_code: 'Bu kodla bir salon bulunamadı.',
  too_many_attempts: 'Çok fazla hatalı kod denendi. Bir saat sonra tekrar dene.',
  not_signed_in: 'Oturumun kapanmış. Tekrar giriş yap.',
  last_admin:
    'Salonun tek yöneticisi sensin. Ayrılmadan önce başka birini yönetici yapmalısın.',
  unknown: 'Bir şeyler ters gitti. Tekrar dene.',
};

export interface AccountError {
  kind: AccountErrorKind;
  message: string;
}

export function accountError(kind: AccountErrorKind): AccountError {
  return { kind, message: ACCOUNT_ERROR_MESSAGES[kind] };
}

/**
 * Supabase / fetch hatasını sınıflandırır. Hata nesneleri farklı
 * biçimlerde geliyor (AuthApiError: `code` + `status`, PostgrestError:
 * `message` + `code`, ağ: TypeError "Network request failed"); alanlara
 * tek tek bakılıyor, hiçbiri yoksa `unknown`.
 */
export function classifyAccountError(err: unknown): AccountErrorKind {
  if (err == null) return 'unknown';
  const e = err as { name?: unknown; message?: unknown; code?: unknown; status?: unknown };
  const message = typeof e.message === 'string' ? e.message : String(err);
  const code = typeof e.code === 'string' ? e.code : '';
  const name = typeof e.name === 'string' ? e.name : '';

  if (message.includes('too_many_attempts')) return 'too_many_attempts';
  if (message.includes('invalid_code')) return 'invalid_code';
  if (message.includes('not_authenticated')) return 'not_signed_in';

  if (
    name === 'AuthRetryableFetchError' ||
    /network request failed|failed to fetch|network ?error|timed? ?out|aborted/i.test(message)
  ) {
    return 'network';
  }

  if (code === 'otp_expired' || /token has expired|otp.*(expired|invalid)|invalid.*otp/i.test(message)) {
    return 'invalid_otp';
  }
  if (e.status === 429 || code.startsWith('over_') || /rate limit/i.test(message)) {
    return 'rate_limited';
  }
  if (code === 'session_not_found' || /jwt expired|auth session missing/i.test(message)) {
    return 'not_signed_in';
  }
  return 'unknown';
}

export function toAccountError(err: unknown): AccountError {
  return accountError(classifyAccountError(err));
}

// ============================================================================
// Giriş ekranı durumu: e-posta → kod gönder → 6 haneli kod → giriş
// ============================================================================

/** "Kodu tekrar gönder" bu kadar saniye sonra açılır */
export const RESEND_COOLDOWN_SECONDS = 60;

export interface OtpState {
  step: 'email' | 'code';
  email: string;
  code: string;
  /** Son kod gönderiminin zamanı (ms) */
  sentAt: number | null;
  busy: boolean;
  error: string | null;
}

export type OtpAction =
  | { type: 'emailChanged'; email: string }
  | { type: 'codeChanged'; code: string }
  | { type: 'sendStarted' }
  | { type: 'sendSucceeded'; now: number }
  | { type: 'verifyStarted' }
  | { type: 'failed'; message: string }
  | { type: 'editEmail' };

export const INITIAL_OTP_STATE: OtpState = {
  step: 'email',
  email: '',
  code: '',
  sentAt: null,
  busy: false,
  error: null,
};

export function otpReducer(state: OtpState, action: OtpAction): OtpState {
  switch (action.type) {
    case 'emailChanged':
      return { ...state, email: action.email, error: null };
    case 'codeChanged':
      // Yapıştırılan "123 456" de kabul; en fazla 6 hane
      return { ...state, code: digitsOnly(action.code).slice(0, OTP_LENGTH), error: null };
    case 'sendStarted':
    case 'verifyStarted':
      return { ...state, busy: true, error: null };
    case 'sendSucceeded':
      return { ...state, step: 'code', code: '', sentAt: action.now, busy: false, error: null };
    case 'failed':
      return { ...state, busy: false, error: action.message };
    case 'editEmail':
      return { ...state, step: 'email', code: '', busy: false, error: null };
  }
}

export function canSendCode(state: OtpState): boolean {
  return state.step === 'email' && !state.busy && isValidEmail(state.email);
}

export function canVerify(state: OtpState): boolean {
  return state.step === 'code' && !state.busy && isValidOtp(state.code);
}

/** Tekrar göndermeye kalan saniye; 0 = gönderilebilir */
export function resendSecondsLeft(state: OtpState, now: number): number {
  if (state.sentAt == null) return 0;
  const elapsed = Math.floor((now - state.sentAt) / 1000);
  return Math.max(0, RESEND_COOLDOWN_SECONDS - elapsed);
}

export function canResend(state: OtpState, now: number): boolean {
  return state.step === 'code' && !state.busy && resendSecondsLeft(state, now) === 0;
}

// ============================================================================
// Gizli bayrak: sürüm satırına art arda 7 dokunuş
// ============================================================================

export const VERSION_TAPS_TO_UNLOCK = 7;
/** İki dokunuş arasında bundan uzun ara olursa sayaç sıfırlanır */
export const VERSION_TAP_GAP_MS = 1500;

export interface TapCounter {
  count: number;
  lastAt: number;
}

export const INITIAL_TAP_COUNTER: TapCounter = { count: 0, lastAt: 0 };

export function registerVersionTap(
  prev: TapCounter,
  now: number
): { counter: TapCounter; unlocked: boolean } {
  const count = prev.count > 0 && now - prev.lastAt <= VERSION_TAP_GAP_MS ? prev.count + 1 : 1;
  return { counter: { count, lastAt: now }, unlocked: count >= VERSION_TAPS_TO_UNLOCK };
}
