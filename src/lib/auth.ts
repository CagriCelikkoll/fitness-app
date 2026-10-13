/**
 * Hesap ve salon (v3.0) — saf yardımcılar.
 *
 * E-posta ve şifre kuralları, salon kodu normalleştirme, rol etiketleri,
 * hata eşleme ve giriş ekranının durum mantığı (şifreyle giriş, kayıt +
 * doğrulama kodu, şifremi unuttum, kodla giriş). React ve Supabase
 * bilmez; test/auth.test.ts.
 */

import { digitsOnly } from '@/lib/format';

// ============================================================================
// E-posta, şifre ve kod
// ============================================================================

export function normalizeEmail(text: string): string {
  return text.trim().toLowerCase();
}

/** Kaba kontrol: bir @, iki tarafta da boşluksuz metin, alan adında nokta */
export function isValidEmail(text: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(text));
}

export const PASSWORD_MIN_LENGTH = 8;
/** bcrypt 72 bayttan sonrasını yok sayar; Supabase de 72'de kesiyor */
export const PASSWORD_MAX_LENGTH = 72;

/**
 * Yeni şifre kuralı (kayıt ve şifre sıfırlama). Hata yoksa null.
 * Tekrar alanı boşken "aynı değil" denmiyor; kullanıcı henüz yazmadı.
 */
export function passwordError(password: string, repeat: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Şifre en az ${PASSWORD_MIN_LENGTH} karakter olmalı.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Şifre en fazla ${PASSWORD_MAX_LENGTH} karakter olabilir.`;
  }
  if (password.trim().length === 0) return 'Şifre yalnızca boşluktan oluşamaz.';
  if (repeat.length > 0 && repeat !== password) return 'Şifreler aynı değil.';
  return null;
}

export function isValidNewPassword(password: string, repeat: string): boolean {
  return passwordError(password, repeat) == null && repeat === password;
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
  | 'server'
  | 'email_send_failed'
  | 'rate_limited'
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'email_taken'
  | 'invalid_email'
  | 'weak_password'
  | 'same_password'
  | 'signup_disabled'
  | 'invalid_otp'
  | 'invalid_code'
  | 'too_many_attempts'
  | 'not_signed_in'
  | 'last_admin'
  | 'sole_admin'
  | 'unknown';

export const ACCOUNT_ERROR_MESSAGES: Record<AccountErrorKind, string> = {
  not_configured: 'Hesap özellikleri bu sürümde kullanılamıyor.',
  network: 'İnternet bağlantısı yok gibi görünüyor. Bağlantını kontrol edip tekrar dene.',
  server: 'Sunucuda bir sorun oluştu. Biraz sonra tekrar dene.',
  email_send_failed: 'E-posta gönderilemedi. Biraz sonra tekrar dene.',
  rate_limited: 'Çok fazla deneme yapıldı. Biraz sonra tekrar dene.',
  invalid_credentials: 'E-posta ya da şifre yanlış.',
  email_not_confirmed: 'E-posta adresin henüz doğrulanmamış.',
  email_taken: 'Bu e-posta zaten kayıtlı. Giriş yap ya da şifreni sıfırla.',
  invalid_email: 'Bu e-posta adresi kabul edilmedi. Kontrol edip tekrar dene.',
  weak_password: 'Şifre çok zayıf. Daha uzun ya da tahmin edilmesi zor bir şifre seç.',
  same_password: 'Yeni şifre eskisiyle aynı olamaz.',
  signup_disabled: 'Yeni kayıt şu an kapalı.',
  invalid_otp: 'Kod yanlış ya da süresi dolmuş.',
  invalid_code: 'Bu kodla bir salon bulunamadı.',
  too_many_attempts: 'Çok fazla hatalı kod denendi. Bir saat sonra tekrar dene.',
  not_signed_in: 'Oturumun kapanmış. Tekrar giriş yap.',
  last_admin:
    'Salonun tek yöneticisi sensin. Ayrılmadan önce başka birini yönetici yapmalısın.',
  sole_admin:
    'Salonunun tek yöneticisi sensin. Hesabını silmeden önce başka birini yönetici yap; salon yöneticisiz kalmasın.',
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
 * Supabase Auth'un e-posta (SMTP) hatası mesajları: "Error sending
 * confirmation email", "Error sending recovery email", özel SMTP'de
 * "gomail: could not send email…", "535 Authentication failed" vb.
 */
const EMAIL_SEND_MESSAGE =
  /error sending|sending .*e-?mail|smtp|gomail|mailer|could not send|e-?mail.*(send|deliver)|(421|450|451|452|535|550|551|552|553|554)/i;
/**
 * fetch'in kendisi başarısız oldu: sunucuya hiç ulaşılamadı. Android'de
 * uçak modunda bağlantı zaman aşımına düşebiliyor ("Network request timed
 * out"); DNS / bağlantı hataları da aynı sınıf.
 */
const NETWORK_MESSAGE =
  /network request (failed|timed out)|failed to fetch|load failed|network ?error|timed? ?out|unable to resolve host|failed to connect|connection (refused|reset|abort|closed|lost)|internet connection|not connected|offline|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up/i;
/**
 * PostgREST (RPC) fetch başarısızlığını yanıt yerine nesneye çeviriyor:
 * { message: "TypeError: …", details: <yığın>, hint, code: '' }. Sunucudan
 * gelen hatalarda code dolu (PGRST…, P0001). Mesaj ne olursa olsun bu
 * biçim "sunucuya ulaşılamadı" demek.
 */
function isPostgrestFetchFailure(e: { message?: unknown; code?: unknown; details?: unknown }): boolean {
  return (
    e.code === '' &&
    typeof e.details === 'string' &&
    typeof e.message === 'string' &&
    /^(TypeError|FetchError|AbortError|TimeoutError|Error)/.test(e.message)
  );
}

/**
 * Supabase / fetch hatasını sınıflandırır.
 *
 * Dikkat: auth-js 5xx yanıtlarını da `AuthRetryableFetchError` olarak
 * fırlatıyor (status = HTTP kodu). İnternet yokluğu yalnızca status 0
 * (fetch hiç yanıt alamadı). 500 "sunucuya ulaşılamadı" değil; SMTP
 * hatasıysa "e-posta gönderilemedi", değilse "sunucu hatası".
 *
 * Diğer biçimler: AuthApiError (`code` + `status`), PostgrestError
 * (`message` + `code`), çıplak TypeError.
 */
export function classifyAccountError(err: unknown): AccountErrorKind {
  if (err == null) return 'unknown';
  const e = err as { name?: unknown; message?: unknown; code?: unknown; status?: unknown };
  const message = typeof e.message === 'string' ? e.message : String(err);
  const code = typeof e.code === 'string' ? e.code : '';
  const name = typeof e.name === 'string' ? e.name : '';
  const status = typeof e.status === 'number' ? e.status : null;

  // Sunucu fonksiyonlarımızın (join_gym / preview_gym) hataları
  if (message.includes('too_many_attempts')) return 'too_many_attempts';
  if (message.includes('invalid_code')) return 'invalid_code';
  if (message.includes('not_authenticated')) return 'not_signed_in';
  if (message.includes('sole_admin')) return 'sole_admin';

  // Sunucuya hiç ulaşılamadı
  if (isPostgrestFetchFailure(err as object)) return 'network';
  if (name === 'AuthRetryableFetchError' && (status === 0 || status == null)) return 'network';
  if ((status == null || status === 0) && NETWORK_MESSAGE.test(message)) return 'network';

  // Sunucu yanıt verdi ama hata (5xx). Kod alanı bu hatalarda gelmiyor.
  if (status != null && status >= 500) {
    return EMAIL_SEND_MESSAGE.test(message) ? 'email_send_failed' : 'server';
  }
  if (name === 'AuthUnknownError') return 'server';

  switch (code) {
    case 'invalid_credentials':
      return 'invalid_credentials';
    case 'email_not_confirmed':
      return 'email_not_confirmed';
    case 'user_already_exists':
    case 'email_exists':
      return 'email_taken';
    case 'email_address_invalid':
      return 'invalid_email';
    case 'weak_password':
      return 'weak_password';
    case 'same_password':
      return 'same_password';
    case 'signup_disabled':
    case 'email_provider_disabled':
      return 'signup_disabled';
    case 'otp_expired':
      return 'invalid_otp';
    case 'session_not_found':
      return 'not_signed_in';
  }
  if (name === 'AuthWeakPasswordError') return 'weak_password';
  if (name === 'AuthSessionMissingError') return 'not_signed_in';
  if (status === 429 || code.startsWith('over_') || /rate limit/i.test(message)) {
    return 'rate_limited';
  }

  // Eski API sürümleri kodsuz, yalnızca mesajla dönebiliyor
  if (/invalid login credentials/i.test(message)) return 'invalid_credentials';
  if (/email not confirmed/i.test(message)) return 'email_not_confirmed';
  if (/already (been )?registered|already exists/i.test(message)) return 'email_taken';
  if (/token has expired|otp.*(expired|invalid)|invalid.*otp/i.test(message)) return 'invalid_otp';
  if (/jwt expired|auth session missing/i.test(message)) return 'not_signed_in';
  return 'unknown';
}

export function toAccountError(err: unknown): AccountError {
  return accountError(classifyAccountError(err));
}

// ============================================================================
// Giriş ekranı durumu
//
//   signIn ──"Hesap oluştur"──> signUp ──kod gönderildi──> verifySignup
//     │  └─"Şifremi unuttum"──> forgot ──kod gönderildi──> resetPassword
//     └────"Kodla giriş yap"──> otpEmail ──kod gönderildi──> otpCode
//
// signIn'de "e-posta doğrulanmamış" gelirse yeni kod gönderilip
// verifySignup'a geçiliyor.
// ============================================================================

export type AuthMode =
  | 'signIn'
  | 'signUp'
  | 'verifySignup'
  | 'forgot'
  | 'resetPassword'
  | 'otpEmail'
  | 'otpCode';

/** Kod girilen adımlar */
export const CODE_MODES: readonly AuthMode[] = ['verifySignup', 'resetPassword', 'otpCode'];

export function isCodeMode(mode: AuthMode): boolean {
  return CODE_MODES.includes(mode);
}

/**
 * Kod adımından "düzelt" / "E-postayı değiştir" ile dönülen, e-postanın
 * yazıldığı adım. Kod adımı değilse olduğu yerde kalır.
 */
export function emailStepOf(mode: AuthMode): AuthMode {
  switch (mode) {
    case 'verifySignup':
      return 'signUp';
    case 'resetPassword':
      return 'forgot';
    case 'otpCode':
      return 'otpEmail';
    default:
      return mode;
  }
}

/** "Kodu tekrar gönder" bu kadar saniye sonra açılır */
export const RESEND_COOLDOWN_SECONDS = 60;

export interface AuthFormState {
  mode: AuthMode;
  email: string;
  /** signIn: şifre; signUp / resetPassword: yeni şifre */
  password: string;
  passwordRepeat: string;
  code: string;
  /** Son kod gönderiminin zamanı (ms) */
  sentAt: number | null;
  /**
   * resetPassword: kod doğrulandı (oturum açıldı) ama yeni şifre
   * kaydedilemedi. Kod tek kullanımlık; tekrar denemede yalnızca şifre
   * güncelleniyor.
   */
  recoveryVerified: boolean;
  busy: boolean;
  error: string | null;
  /** Bilgi notu (ör. "doğrulanmamış, yeni kod gönderdik") */
  info: string | null;
}

export type AuthFormField = 'email' | 'password' | 'passwordRepeat' | 'code';

export type AuthFormAction =
  | { type: 'fieldChanged'; field: AuthFormField; value: string }
  | { type: 'switchMode'; mode: AuthMode }
  | { type: 'started' }
  | { type: 'failed'; message: string }
  | { type: 'codeSent'; mode: AuthMode; now: number; info?: string }
  | { type: 'recoveryVerified' };

export const INITIAL_AUTH_FORM: AuthFormState = {
  mode: 'signIn',
  email: '',
  password: '',
  passwordRepeat: '',
  code: '',
  sentAt: null,
  recoveryVerified: false,
  busy: false,
  error: null,
  info: null,
};

export function authFormReducer(state: AuthFormState, action: AuthFormAction): AuthFormState {
  switch (action.type) {
    case 'fieldChanged': {
      const value =
        // Yapıştırılan "123 456" de kabul; en fazla 6 hane
        action.field === 'code' ? digitsOnly(action.value).slice(0, OTP_LENGTH) : action.value;
      return { ...state, [action.field]: value, error: null };
    }
    case 'switchMode':
      // E-posta kalıyor; şifre ve kod adımlar arasında taşınmıyor
      return {
        ...INITIAL_AUTH_FORM,
        mode: action.mode,
        email: state.email,
      };
    case 'started':
      return { ...state, busy: true, error: null, info: null };
    case 'failed':
      return { ...state, busy: false, error: action.message };
    case 'codeSent': {
      // Sıfırlamada yeni şifre kod adımında giriliyor: adıma ilk girişte
      // boş başlasın, "tekrar gönder"de yazılan şifre silinmesin
      const enteringReset = action.mode === 'resetPassword' && state.mode !== 'resetPassword';
      return {
        ...state,
        mode: action.mode,
        code: '',
        password: enteringReset ? '' : state.password,
        passwordRepeat: enteringReset ? '' : state.passwordRepeat,
        sentAt: action.now,
        recoveryVerified: false,
        busy: false,
        error: null,
        info: action.info ?? null,
      };
    }
    case 'recoveryVerified':
      return { ...state, recoveryVerified: true, code: '' };
  }
}

/** Ana düğme basılabilir mi */
export function canSubmit(state: AuthFormState): boolean {
  if (state.busy) return false;
  switch (state.mode) {
    case 'signIn':
      return isValidEmail(state.email) && state.password.length > 0;
    case 'signUp':
      return isValidEmail(state.email) && isValidNewPassword(state.password, state.passwordRepeat);
    case 'forgot':
    case 'otpEmail':
      return isValidEmail(state.email);
    case 'verifySignup':
    case 'otpCode':
      return isValidOtp(state.code);
    case 'resetPassword':
      return (
        (state.recoveryVerified || isValidOtp(state.code)) &&
        isValidNewPassword(state.password, state.passwordRepeat)
      );
  }
}

/** Tekrar göndermeye kalan saniye; 0 = gönderilebilir */
export function resendSecondsLeft(state: AuthFormState, now: number): number {
  if (state.sentAt == null) return 0;
  const elapsed = Math.floor((now - state.sentAt) / 1000);
  return Math.max(0, RESEND_COOLDOWN_SECONDS - elapsed);
}

export function canResend(state: AuthFormState, now: number): boolean {
  return (
    isCodeMode(state.mode) &&
    !state.busy &&
    !state.recoveryVerified &&
    resendSecondsLeft(state, now) === 0
  );
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
