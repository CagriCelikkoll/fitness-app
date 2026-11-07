/**
 * Hesap ve salon (v3.0) — saf yardımcılar.
 *
 * E-posta kuralı, salon kodu normalleştirme, rol etiketleri, hata eşleme
 * ve giriş ekranının durum mantığı (e-posta → kod). React ve Supabase
 * bilmez; test/auth.test.ts.
 *
 * v3.7: şifre yok. Giriş ve hesap açma tek akış: e-postaya 6 haneli kod
 * (DNC-09; sunucuda şifre supabase/migrations/0014_auth_hardening.sql ile
 * kapalı).
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
  | 'server'
  | 'email_send_failed'
  | 'rate_limited'
  | 'invalid_email'
  | 'signup_disabled'
  | 'invalid_otp'
  | 'invalid_code'
  | 'too_many_attempts'
  | 'not_signed_in'
  | 'last_admin'
  | 'sole_admin'
  | 'forbidden'
  | 'pin_admin_only'
  | 'invalid_input'
  | 'already_exists'
  | 'class_cancelled'
  | 'class_started'
  | 'class_not_scheduled'
  | 'student_not_member'
  | 'trainer_self'
  | 'trainer_already_linked'
  | 'trainer_link_closed'
  | 'consent_outdated'
  | 'program_invalid'
  | 'program_archived'
  | 'student_not_active'
  | 'checkin_key_invalid'
  | 'checkin_not_member'
  | 'visit_invalid'
  | 'feedback_invalid'
  | 'feedback_daily_limit'
  | 'unknown';

export const ACCOUNT_ERROR_MESSAGES: Record<AccountErrorKind, string> = {
  not_configured: 'Hesap özellikleri bu sürümde kullanılamıyor.',
  network: 'İnternet bağlantısı yok gibi görünüyor. Bağlantını kontrol edip tekrar dene.',
  server: 'Sunucuda bir sorun oluştu. Biraz sonra tekrar dene.',
  email_send_failed: 'E-posta gönderilemedi. Biraz sonra tekrar dene.',
  rate_limited: 'Çok fazla deneme yapıldı. Biraz sonra tekrar dene.',
  invalid_email: 'Bu e-posta adresi kabul edilmedi. Kontrol edip tekrar dene.',
  signup_disabled: 'Yeni kayıt şu an kapalı.',
  invalid_otp: 'Kod yanlış ya da süresi dolmuş.',
  invalid_code: 'Bu kodla bir salon bulunamadı.',
  too_many_attempts: 'Çok fazla hatalı kod denendi. Bir saat sonra tekrar dene.',
  not_signed_in: 'Oturumun kapanmış. Tekrar giriş yap.',
  last_admin:
    'Salonun tek yöneticisi sensin. Ayrılmadan önce başka birini yönetici yapmalısın.',
  sole_admin:
    'Salonunun tek yöneticisi sensin. Hesabını silmeden önce başka birini yönetici yap; salon yöneticisiz kalmasın.',
  forbidden: 'Bu işlem için yetkin yok.',
  pin_admin_only: 'Duyuruyu yalnızca salon yöneticisi sabitleyebilir.',
  invalid_input: 'Girilen bilgi kabul edilmedi. Uzunluğu kontrol edip tekrar dene.',
  already_exists: 'Bu kayıt az önce değişti. Listeyi yenileyip tekrar dene.',
  class_cancelled: 'Bu ders iptal edildi.',
  class_started: 'Ders başladı; katılım artık değiştirilemiyor.',
  class_not_scheduled: 'Bu ders programda yok. Programı yenileyip tekrar dene.',
  student_not_member: 'Bu kişi salonun üyesi değil.',
  trainer_self: 'Kendini öğrenci olarak ekleyemezsin.',
  trainer_already_linked: 'Bu kişiye zaten istek gönderilmiş ya da zaten öğrencin.',
  trainer_link_closed: 'Bu istek artık geçerli değil. Listeyi yenile.',
  consent_outdated: 'İzin metni güncellendi. Uygulamayı güncelleyip tekrar dene.',
  program_invalid: 'Program kaydedilemedi: gün, egzersiz ya da sayılar sınırların dışında.',
  program_archived: 'Bu program arşivde. Önce arşivden çıkar.',
  student_not_active: 'Program yalnızca aktif öğrencilere atanabilir. Listeyi yenile.',
  checkin_key_invalid: 'Bu QR artık geçersiz, salona sor.',
  checkin_not_member: 'Bu salonun üyesi değilsin.',
  visit_invalid: 'Giriş ve çıkış saatlerini kontrol et.',
  feedback_invalid: 'Geri bildirim gönderilemedi: kategori ve metni kontrol et.',
  feedback_daily_limit: 'Bugün en fazla 5 geri bildirim gönderebilirsin. Yarın tekrar dene.',
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
  if (message.includes('only_admin_can_pin')) return 'pin_admin_only';
  // Derse katılım (v3.2c, 0006_class_rsvps.sql)
  if (message.includes('class_cancelled')) return 'class_cancelled';
  if (message.includes('class_started')) return 'class_started';
  if (message.includes('class_not_scheduled')) return 'class_not_scheduled';
  // Hoca–öğrenci (v3.6a, 0010_trainers.sql)
  if (message.includes('student_not_member')) return 'student_not_member';
  if (message.includes('trainer_self')) return 'trainer_self';
  if (message.includes('trainer_already_linked')) return 'trainer_already_linked';
  if (message.includes('trainer_link_closed')) return 'trainer_link_closed';
  if (message.includes('consent_outdated')) return 'consent_outdated';
  // Programlar (v3.6b, 0011_programs.sql)
  if (message.includes('program_invalid')) return 'program_invalid';
  if (message.includes('program_archived')) return 'program_archived';
  if (message.includes('student_not_active')) return 'student_not_active';
  // Salon girişi (v3.6c, 0012_visits.sql)
  if (message.includes('checkin_key_invalid')) return 'checkin_key_invalid';
  if (message.includes('checkin_not_member')) return 'checkin_not_member';
  if (message.includes('visit_invalid')) return 'visit_invalid';
  // Geri bildirim (v3.6d, 0013_feedback.sql)
  if (message.includes('feedback_invalid')) return 'feedback_invalid';
  if (message.includes('feedback_daily_limit')) return 'feedback_daily_limit';
  // PostgREST: RLS / yetki reddi ve CHECK kısıtı (duyurular v3.2b, ders programı v3.2c)
  if (code === '42501' || /row-level security|permission denied/i.test(message)) return 'forbidden';
  if (code === '23514') return 'invalid_input';
  // Tekil kısıt (ders istisnası: aynı ders + tarih, v3.2c)
  if (code === '23505') return 'already_exists';

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
    case 'email_address_invalid':
      return 'invalid_email';
    case 'signup_disabled':
    case 'email_provider_disabled':
      return 'signup_disabled';
    case 'otp_expired':
      return 'invalid_otp';
    case 'session_not_found':
      return 'not_signed_in';
  }
  if (name === 'AuthSessionMissingError') return 'not_signed_in';
  if (status === 429 || code.startsWith('over_') || /rate limit/i.test(message)) {
    return 'rate_limited';
  }

  // Eski API sürümleri kodsuz, yalnızca mesajla dönebiliyor
  if (/token has expired|otp.*(expired|invalid)|invalid.*otp/i.test(message)) return 'invalid_otp';
  if (/jwt expired|auth session missing/i.test(message)) return 'not_signed_in';
  return 'unknown';
}

export function toAccountError(err: unknown): AccountError {
  return accountError(classifyAccountError(err));
}

// ============================================================================
// Giriş ekranı durumu (v3.7: yalnızca kod)
//
//   email ──"Kodu gönder"──> code ──"Giriş yap"──> (oturum açık)
//     ▲                        │
//     └──"düzelt" / "E-postayı değiştir"
//
// Hesabı olmayan için de aynı akış: kod doğrulanınca hesap açılır.
// "Kodu gönder" için Aydınlatma Metni'nin okunduğu işaretlenmeli (KVKK
// aydınlatma; açık rıza değil). Onay giriş sonrası sunucuya yazılır
// (src/lib/privacyNotice.ts).
// ============================================================================

export type AuthMode = 'email' | 'code';

export function isCodeMode(mode: AuthMode): boolean {
  return mode === 'code';
}

/** "Kodu tekrar gönder" bu kadar saniye sonra açılır */
export const RESEND_COOLDOWN_SECONDS = 60;

export interface AuthFormState {
  mode: AuthMode;
  email: string;
  code: string;
  /** "Aydınlatma Metni'ni okudum" işaretli mi */
  noticeRead: boolean;
  /** Son kod gönderiminin zamanı (ms) */
  sentAt: number | null;
  busy: boolean;
  error: string | null;
}

export type AuthFormField = 'email' | 'code';

export type AuthFormAction =
  | { type: 'fieldChanged'; field: AuthFormField; value: string }
  | { type: 'noticeToggled' }
  | { type: 'editEmail' }
  | { type: 'started' }
  | { type: 'failed'; message: string }
  | { type: 'codeSent'; now: number };

export const INITIAL_AUTH_FORM: AuthFormState = {
  mode: 'email',
  email: '',
  code: '',
  noticeRead: false,
  sentAt: null,
  busy: false,
  error: null,
};

export function authFormReducer(state: AuthFormState, action: AuthFormAction): AuthFormState {
  switch (action.type) {
    case 'fieldChanged': {
      const value =
        // Yapıştırılan "123 456" de kabul; en fazla 6 hane
        action.field === 'code' ? digitsOnly(action.value).slice(0, OTP_LENGTH) : action.value;
      return { ...state, [action.field]: value, error: null };
    }
    case 'noticeToggled':
      return { ...state, noticeRead: !state.noticeRead, error: null };
    case 'editEmail':
      // E-posta ve işaret kalıyor; kod ve hata gidiyor
      return { ...state, mode: 'email', code: '', sentAt: null, busy: false, error: null };
    case 'started':
      return { ...state, busy: true, error: null };
    case 'failed':
      return { ...state, busy: false, error: action.message };
    case 'codeSent':
      return { ...state, mode: 'code', code: '', sentAt: action.now, busy: false, error: null };
  }
}

/** Ana düğme basılabilir mi */
export function canSubmit(state: AuthFormState): boolean {
  if (state.busy) return false;
  switch (state.mode) {
    case 'email':
      return isValidEmail(state.email) && state.noticeRead;
    case 'code':
      return isValidOtp(state.code);
  }
}

/** Tekrar göndermeye kalan saniye; 0 = gönderilebilir */
export function resendSecondsLeft(state: AuthFormState, now: number): number {
  if (state.sentAt == null) return 0;
  const elapsed = Math.floor((now - state.sentAt) / 1000);
  return Math.max(0, RESEND_COOLDOWN_SECONDS - elapsed);
}

export function canResend(state: AuthFormState, now: number): boolean {
  return isCodeMode(state.mode) && !state.busy && resendSecondsLeft(state, now) === 0;
}
