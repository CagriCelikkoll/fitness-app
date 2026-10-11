/**
 * Hesap ve salon (v3.0) — saf yardımcılar: şifre kuralı, hata eşleme,
 * giriş ekranı durum mantığı (şifre, kayıt, şifre sıfırlama, kodla
 * giriş), gizli bayrak ve env yokken (istemci null) çökmeme.
 */

import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_ERROR_MESSAGES,
  INITIAL_AUTH_FORM,
  INITIAL_TAP_COUNTER,
  PASSWORD_MAX_LENGTH,
  RESEND_COOLDOWN_SECONDS,
  VERSION_TAP_GAP_MS,
  authFormReducer,
  canResend,
  canSubmit,
  classifyAccountError,
  isValidEmail,
  isValidJoinCode,
  isValidNewPassword,
  isValidOtp,
  normalizeEmail,
  normalizeJoinCode,
  passwordError,
  registerVersionTap,
  resendSecondsLeft,
  roleLabel,
  type AccountErrorKind,
  type AuthFormAction,
  type AuthFormState,
} from '@/lib/auth';
import {
  fetchMemberships,
  joinGym,
  leaveGym,
  parseMembershipRows,
  previewGym,
  resendSignupCode,
  sendPasswordResetCode,
  sendSignInCode,
  signInWithPassword,
  signOut,
  signUpWithPassword,
  updatePassword,
  verifyRecoveryCode,
  verifySignInCode,
  verifySignupCode,
} from '@/lib/account';
import {
  GYM_FEATURES_KEY,
  getGymFeaturesEnabled,
  isServiceRoleKey,
  parseStoredUser,
  readSupabaseConfig,
  setGymFeaturesEnabled,
} from '@/lib/supabaseConfig';

describe('e-posta', () => {
  it('geçerli adresler', () => {
    expect(isValidEmail('ali@ornek.com')).toBe(true);
    expect(isValidEmail('  Ali.Veli+salon@Ornek.com.tr ')).toBe(true);
  });

  it('geçersiz adresler', () => {
    for (const bad of ['', 'ali', 'ali@', '@ornek.com', 'ali@ornek', 'ali veli@ornek.com', 'a@b@c.com']) {
      expect(isValidEmail(bad)).toBe(false);
    }
  });

  it('normalleştirme: boşluk ve büyük harf', () => {
    expect(normalizeEmail('  Ali@Ornek.COM ')).toBe('ali@ornek.com');
  });
});

describe('salon kodu', () => {
  it('" eu-7k2 " → "EU7K2"', () => {
    expect(normalizeJoinCode(' eu-7k2 ')).toBe('EU7K2');
  });

  it('boşluk, tire ve noktalama atılıyor; küçük i büyük I oluyor', () => {
    expect(normalizeJoinCode('ab c-12.3')).toBe('ABC123');
    expect(normalizeJoinCode('fit24i')).toBe('FIT24I');
  });

  it('geçerli uzunluk 6–8', () => {
    expect(isValidJoinCode('ABC12')).toBe(false);
    expect(isValidJoinCode('abc-123')).toBe(true);
    expect(isValidJoinCode('ABCD1234')).toBe(true);
    expect(isValidJoinCode('ABCD12345')).toBe(false);
  });
});

describe('kod ve rol', () => {
  it('OTP 6 hane', () => {
    expect(isValidOtp('123456')).toBe(true);
    expect(isValidOtp('12345')).toBe(false);
    expect(isValidOtp('12345a')).toBe(false);
  });

  it('rol etiketleri Türkçe', () => {
    expect(roleLabel('member')).toBe('Üye');
    expect(roleLabel('trainer')).toBe('Hoca');
    expect(roleLabel('admin')).toBe('Yönetici');
  });
});

describe('şifre kuralı', () => {
  it('en az 8 karakter', () => {
    expect(passwordError('1234567', '')).toBe('Şifre en az 8 karakter olmalı.');
    expect(passwordError('12345678', '')).toBeNull();
  });

  it('en fazla 72 karakter', () => {
    expect(passwordError('a'.repeat(PASSWORD_MAX_LENGTH), '')).toBeNull();
    expect(passwordError('a'.repeat(PASSWORD_MAX_LENGTH + 1), '')).toBe(
      'Şifre en fazla 72 karakter olabilir.'
    );
  });

  it('yalnızca boşluk olamaz', () => {
    expect(passwordError('        ', '')).toBe('Şifre yalnızca boşluktan oluşamaz.');
  });

  it('tekrar alanı: boşken uyarı yok, farklıysa "aynı değil"', () => {
    expect(passwordError('gizli-sifre', '')).toBeNull();
    expect(passwordError('gizli-sifre', 'gizli-sifr')).toBe('Şifreler aynı değil.');
    expect(passwordError('gizli-sifre', 'gizli-sifre')).toBeNull();
  });

  it('yeni şifre geçerli: kural + tekrar birebir aynı (boş tekrar geçmez)', () => {
    expect(isValidNewPassword('gizli-sifre', '')).toBe(false);
    expect(isValidNewPassword('gizli-sifre', 'gizli-sifre')).toBe(true);
    expect(isValidNewPassword('kisa', 'kisa')).toBe(false);
  });
});

describe('hata eşleme', () => {
  const cases: [string, unknown, AccountErrorKind][] = [
    // İnternet yok: fetch hiç yanıt alamadı
    ['çıplak TypeError', new TypeError('Network request failed'), 'network'],
    ['auth-js, status 0', { name: 'AuthRetryableFetchError', message: 'Network request failed', status: 0 }, 'network'],
    ['postgrest', { message: 'TypeError: Network request failed', code: '' }, 'network'],
    // 500 artık "sunucuya ulaşılamadı" değil
    ['500 e-posta (kayıt)', { name: 'AuthRetryableFetchError', message: 'Error sending confirmation email', status: 500 }, 'email_send_failed'],
    ['500 e-posta (kod)', { name: 'AuthRetryableFetchError', message: 'Error sending magic link email', status: 500 }, 'email_send_failed'],
    ['500 e-posta (sıfırlama)', { name: 'AuthRetryableFetchError', message: 'Error sending recovery email', status: 500 }, 'email_send_failed'],
    ['500 genel', { name: 'AuthRetryableFetchError', message: 'Internal Server Error', status: 500 }, 'server'],
    ['503', { name: 'AuthRetryableFetchError', message: 'Service Unavailable', status: 503 }, 'server'],
    ['bozuk yanıt', { name: 'AuthUnknownError', message: 'Unexpected token <' }, 'server'],
    // Giriş / kayıt
    ['yanlış şifre', { name: 'AuthApiError', code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' }, 'invalid_credentials'],
    ['yanlış şifre (kodsuz)', { status: 400, message: 'Invalid login credentials' }, 'invalid_credentials'],
    ['doğrulanmamış', { code: 'email_not_confirmed', status: 400, message: 'Email not confirmed' }, 'email_not_confirmed'],
    ['zaten kayıtlı', { code: 'user_already_exists', status: 422, message: 'User already registered' }, 'email_taken'],
    ['zaten kayıtlı (email_exists)', { code: 'email_exists', status: 422, message: 'x' }, 'email_taken'],
    ['zayıf şifre', { name: 'AuthWeakPasswordError', code: 'weak_password', status: 422, message: 'weak' }, 'weak_password'],
    ['aynı şifre', { code: 'same_password', status: 422, message: 'x' }, 'same_password'],
    ['geçersiz e-posta', { code: 'email_address_invalid', status: 400, message: 'x' }, 'invalid_email'],
    ['kayıt kapalı', { code: 'signup_disabled', status: 422, message: 'x' }, 'signup_disabled'],
    // Kod
    ['kod süresi dolmuş', { code: 'otp_expired', status: 403, message: 'Token has expired or is invalid' }, 'invalid_otp'],
    ['kod (kodsuz)', { status: 403, message: 'Token has expired or is invalid' }, 'invalid_otp'],
    // Sınırlar
    ['e-posta sınırı', { code: 'over_email_send_rate_limit', status: 429, message: 'x' }, 'rate_limited'],
    ['istek sınırı', { status: 429, message: 'Too Many Requests' }, 'rate_limited'],
    // Salon fonksiyonları
    ['salon deneme sınırı', { message: 'too_many_attempts', code: 'P0001' }, 'too_many_attempts'],
    ['oturumsuz rpc', { message: 'not_authenticated', code: 'P0001' }, 'not_signed_in'],
    ['oturum yok', { name: 'AuthSessionMissingError', message: 'Auth session missing!', status: 400 }, 'not_signed_in'],
    // Bilinmeyen
    ['null', null, 'unknown'],
    ['metin', 'garip', 'unknown'],
  ];

  for (const [label, err, kind] of cases) {
    it(`${label} → ${kind}`, () => {
      expect(classifyAccountError(err)).toBe(kind);
    });
  }

  it('her türün ayrı, boş olmayan Türkçe mesajı var', () => {
    const messages = Object.values(ACCOUNT_ERROR_MESSAGES);
    for (const m of messages) expect(m.length).toBeGreaterThan(0);
    expect(new Set(messages).size).toBe(messages.length);
    expect(ACCOUNT_ERROR_MESSAGES.server).not.toMatch(/ulaşılamadı/);
  });
});

describe('giriş ekranı durumu', () => {
  const run = (actions: AuthFormAction[], start: AuthFormState = INITIAL_AUTH_FORM) =>
    actions.reduce(authFormReducer, start);
  const set = (field: 'email' | 'password' | 'passwordRepeat' | 'code', value: string): AuthFormAction => ({
    type: 'fieldChanged',
    field,
    value,
  });

  it('şifreyle giriş: geçerli e-posta ve boş olmayan şifre', () => {
    expect(canSubmit(run([set('email', 'ali@ornek.com')]))).toBe(false);
    expect(canSubmit(run([set('email', 'ali@'), set('password', 'x')]))).toBe(false);
    // Girişte uzunluk kuralı yok (eski / kodla açılmış hesaplar)
    expect(canSubmit(run([set('email', 'ali@ornek.com'), set('password', 'x')]))).toBe(true);
  });

  it('istek sürerken düğme kapalı', () => {
    const s = run([set('email', 'ali@ornek.com'), set('password', 'x'), { type: 'started' }]);
    expect(canSubmit(s)).toBe(false);
  });

  it('kayıt: kural + tekrar şart', () => {
    const base: AuthFormAction[] = [{ type: 'switchMode', mode: 'signUp' }, set('email', 'ali@ornek.com')];
    expect(canSubmit(run([...base, set('password', 'kisa'), set('passwordRepeat', 'kisa')]))).toBe(false);
    expect(canSubmit(run([...base, set('password', 'gizli-sifre'), set('passwordRepeat', 'gizli')]))).toBe(false);
    expect(canSubmit(run([...base, set('password', 'gizli-sifre'), set('passwordRepeat', 'gizli-sifre')]))).toBe(true);
  });

  it('kayıt → kod gönderildi → doğrulama adımı; kod yalnızca rakam, en fazla 6', () => {
    let s = run([
      { type: 'switchMode', mode: 'signUp' },
      set('email', 'ali@ornek.com'),
      set('password', 'gizli-sifre'),
      set('passwordRepeat', 'gizli-sifre'),
      { type: 'started' },
      { type: 'codeSent', mode: 'verifySignup', now: 1_000 },
    ]);
    expect(s).toMatchObject({ mode: 'verifySignup', busy: false, code: '', sentAt: 1_000 });
    expect(canSubmit(s)).toBe(false);
    s = authFormReducer(s, set('code', '12 34-5'));
    expect(s.code).toBe('12345');
    s = authFormReducer(s, set('code', '1234567'));
    expect(s.code).toBe('123456');
    expect(canSubmit(s)).toBe(true);
  });

  it('girişte doğrulanmamış: bilgi notuyla doğrulama adımına', () => {
    const s = run([
      set('email', 'ali@ornek.com'),
      set('password', 'x'),
      { type: 'started' },
      { type: 'codeSent', mode: 'verifySignup', now: 0, info: 'Doğrulanmamış.' },
    ]);
    expect(s).toMatchObject({ mode: 'verifySignup', info: 'Doğrulanmamış.', error: null });
  });

  it('şifremi unuttum: kod + yeni şifre (+ tekrar) gerekli', () => {
    let s = run([
      set('password', 'eski-yazilan'),
      { type: 'switchMode', mode: 'forgot' },
      set('email', 'ali@ornek.com'),
    ]);
    expect(s.password).toBe('');
    expect(canSubmit(s)).toBe(true);

    s = run([{ type: 'started' }, { type: 'codeSent', mode: 'resetPassword', now: 0 }], s);
    expect(canSubmit(s)).toBe(false);
    s = run([set('code', '123456'), set('password', 'yeni-sifre1')], s);
    expect(canSubmit(s)).toBe(false);
    s = authFormReducer(s, set('passwordRepeat', 'yeni-sifre1'));
    expect(canSubmit(s)).toBe(true);
  });

  it('sıfırlamada "tekrar gönder" yazılan yeni şifreyi silmiyor', () => {
    const s = run([
      { type: 'switchMode', mode: 'forgot' },
      set('email', 'ali@ornek.com'),
      { type: 'codeSent', mode: 'resetPassword', now: 0 },
      set('password', 'yeni-sifre1'),
      set('passwordRepeat', 'yeni-sifre1'),
      { type: 'started' },
      { type: 'codeSent', mode: 'resetPassword', now: 70_000 },
    ]);
    expect(s).toMatchObject({ password: 'yeni-sifre1', passwordRepeat: 'yeni-sifre1', sentAt: 70_000 });
  });

  it('kod doğrulandı ama şifre kaydedilemedi: tekrar denemede kod gerekmiyor', () => {
    let s = run([
      { type: 'switchMode', mode: 'forgot' },
      set('email', 'ali@ornek.com'),
      { type: 'codeSent', mode: 'resetPassword', now: 0 },
      set('code', '123456'),
      set('password', 'yeni-sifre1'),
      set('passwordRepeat', 'yeni-sifre1'),
      { type: 'started' },
      { type: 'recoveryVerified' },
      { type: 'failed', message: 'Sunucuda bir sorun oluştu.' },
    ]);
    expect(s).toMatchObject({ recoveryVerified: true, code: '', busy: false });
    expect(canSubmit(s)).toBe(true);
    expect(canResend(s, 1_000_000)).toBe(false);
    s = authFormReducer(s, set('passwordRepeat', 'baska'));
    expect(canSubmit(s)).toBe(false);
  });

  it('kodla giriş: e-posta → kod', () => {
    let s = run([{ type: 'switchMode', mode: 'otpEmail' }, set('email', 'ali@ornek.com')]);
    expect(canSubmit(s)).toBe(true);
    s = run([{ type: 'codeSent', mode: 'otpCode', now: 0 }, set('code', '654321')], s);
    expect(s.mode).toBe('otpCode');
    expect(canSubmit(s)).toBe(true);
  });

  it('hata gösterilir, yazmaya başlayınca kalkar', () => {
    let s = run([set('email', 'ali@ornek.com'), { type: 'started' }, { type: 'failed', message: 'E-posta ya da şifre yanlış.' }]);
    expect(s).toMatchObject({ busy: false, error: 'E-posta ya da şifre yanlış.' });
    s = authFormReducer(s, set('password', 'y'));
    expect(s.error).toBeNull();
  });

  it('adım değişince e-posta kalır, şifre / kod / hata temizlenir', () => {
    const s = run([
      set('email', 'ali@ornek.com'),
      set('password', 'x'),
      { type: 'failed', message: 'hata' },
      { type: 'switchMode', mode: 'signUp' },
    ]);
    expect(s).toEqual({ ...INITIAL_AUTH_FORM, mode: 'signUp', email: 'ali@ornek.com' });
  });

  it('"Kodu tekrar gönder" 60 sn sonra, yalnızca kod adımlarında', () => {
    const s = run([set('email', 'ali@ornek.com'), { type: 'codeSent', mode: 'otpCode', now: 10_000 }]);
    expect(resendSecondsLeft(s, 10_000)).toBe(RESEND_COOLDOWN_SECONDS);
    expect(canResend(s, 10_000)).toBe(false);
    expect(resendSecondsLeft(s, 10_000 + 59_500)).toBe(1);
    expect(canResend(s, 10_000 + 60_000)).toBe(true);
    expect(canResend(INITIAL_AUTH_FORM, 1_000_000)).toBe(false);
  });
});

describe('gizli bayrak', () => {
  it('art arda 7 dokunuş açar', () => {
    let counter = INITIAL_TAP_COUNTER;
    let unlocked = false;
    for (let i = 0; i < 7; i++) {
      ({ counter, unlocked } = registerVersionTap(counter, 1_000 + i * 300));
      expect(unlocked).toBe(i === 6);
    }
  });

  it('uzun ara sayacı sıfırlar', () => {
    let counter = INITIAL_TAP_COUNTER;
    for (let i = 0; i < 6; i++) ({ counter } = registerVersionTap(counter, i * 300));
    const r = registerVersionTap(counter, 5 * 300 + VERSION_TAP_GAP_MS + 1);
    expect(r).toEqual({ counter: { count: 1, lastAt: 5 * 300 + VERSION_TAP_GAP_MS + 1 }, unlocked: false });
  });

  it('kv-store: varsayılan kapalı, açılıp kapanıyor', async () => {
    const data = new Map<string, string>();
    const store = {
      getItem: async (k: string) => data.get(k) ?? null,
      setItem: async (k: string, v: string) => void data.set(k, v),
    };
    expect(await getGymFeaturesEnabled(store)).toBe(false);
    await setGymFeaturesEnabled(store, true);
    expect(data.get(GYM_FEATURES_KEY)).toBe('true');
    expect(await getGymFeaturesEnabled(store)).toBe(true);
    await setGymFeaturesEnabled(store, false);
    expect(await getGymFeaturesEnabled(store)).toBe(false);
  });
});

describe('Supabase ayarları', () => {
  const jwt = (payload: object) =>
    ['e30', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'imza'].join('.');

  it('env yok / eksik → null', () => {
    expect(readSupabaseConfig({})).toBeNull();
    expect(readSupabaseConfig({ url: 'https://x.supabase.co' })).toBeNull();
    expect(readSupabaseConfig({ anonKey: 'abc' })).toBeNull();
    expect(readSupabaseConfig({ url: '  ', anonKey: ' ' })).toBeNull();
    expect(readSupabaseConfig({ url: 'http://x.supabase.co', anonKey: 'abc' })).toBeNull();
  });

  it('geçerli env', () => {
    expect(readSupabaseConfig({ url: ' https://x.supabase.co/ ', anonKey: ' anon ' })).toEqual({
      url: 'https://x.supabase.co',
      anonKey: 'anon',
    });
  });

  it('service role key reddediliyor', () => {
    expect(isServiceRoleKey('sb_secret_abc')).toBe(true);
    expect(isServiceRoleKey(jwt({ role: 'service_role' }))).toBe(true);
    expect(isServiceRoleKey(jwt({ role: 'anon' }))).toBe(false);
    expect(isServiceRoleKey('sb_publishable_abc')).toBe(false);
    expect(
      readSupabaseConfig({ url: 'https://x.supabase.co', anonKey: jwt({ role: 'service_role' }) })
    ).toBeNull();
  });
});

describe('kayıtlı oturumdan kullanıcı (açılışta ağsız)', () => {
  it('geçerli kayıt', () => {
    expect(parseStoredUser(JSON.stringify({ access_token: 'x', user: { id: 'u1', email: 'a@b.co' } }))).toEqual({
      userId: 'u1',
      email: 'a@b.co',
    });
  });

  it('boş / bozuk kayıt → null', () => {
    expect(parseStoredUser(null)).toBeNull();
    expect(parseStoredUser('{bozuk')).toBeNull();
    expect(parseStoredUser('null')).toBeNull();
    expect(parseStoredUser(JSON.stringify({ user: { id: '' } }))).toBeNull();
  });
});

describe('istemci null (env yok): hiçbir çağrı çökmez, ağa çıkmaz', () => {
  it('her fonksiyon not_configured döner', async () => {
    const results = await Promise.all([
      signInWithPassword(null, 'ali@ornek.com', 'gizli-sifre'),
      signUpWithPassword(null, 'ali@ornek.com', 'gizli-sifre'),
      verifySignupCode(null, 'ali@ornek.com', '123456'),
      resendSignupCode(null, 'ali@ornek.com'),
      sendPasswordResetCode(null, 'ali@ornek.com'),
      verifyRecoveryCode(null, 'ali@ornek.com', '123456'),
      updatePassword(null, 'gizli-sifre'),
      sendSignInCode(null, 'ali@ornek.com'),
      verifySignInCode(null, 'ali@ornek.com', '123456'),
      signOut(null),
      fetchMemberships(null, 'u1'),
      previewGym(null, 'ABC123'),
      joinGym(null, 'ABC123'),
      leaveGym(null, { gymId: 'g1', role: 'member' }, 'u1'),
    ]);
    for (const r of results) {
      expect(r).toEqual({
        ok: false,
        error: { kind: 'not_configured', message: ACCOUNT_ERROR_MESSAGES.not_configured },
      });
    }
  });

  it('istemci fırlatırsa da sonuç döner (ağ hatası)', async () => {
    const throwing = {
      auth: {
        signInWithPassword: async () => {
          throw new TypeError('Network request failed');
        },
      },
    } as unknown as Parameters<typeof signInWithPassword>[0];
    const r = await signInWithPassword(throwing, 'ali@ornek.com', 'x');
    expect(r).toMatchObject({ ok: false, error: { kind: 'network' } });
  });
});

describe('kayıt sonucu', () => {
  const client = (data: unknown, error: unknown = null) =>
    ({ auth: { signUp: async () => ({ data, error }) } }) as unknown as Parameters<
      typeof signUpWithPassword
    >[0];
  const user = (identities: unknown[]) => ({ id: 'u', identities });

  it('doğrulama açık: oturum yok → kod adımı', async () => {
    expect(await signUpWithPassword(client({ user: user([{}]), session: null }), 'a@b.co', 'gizli-sifre')).toEqual({
      ok: true,
      value: { needsVerification: true },
    });
  });

  it('doğrulama kapalı: oturum geldi → doğrudan giriş', async () => {
    expect(await signUpWithPassword(client({ user: user([{}]), session: {} }), 'a@b.co', 'gizli-sifre')).toEqual({
      ok: true,
      value: { needsVerification: false },
    });
  });

  it('e-posta zaten kayıtlı (Supabase boş identities ile gizliyor) → email_taken', async () => {
    expect(await signUpWithPassword(client({ user: user([]), session: null }), 'a@b.co', 'gizli-sifre')).toMatchObject({
      ok: false,
      error: { kind: 'email_taken' },
    });
  });

  it('sunucu SMTP hatası → email_send_failed', async () => {
    const err = { name: 'AuthRetryableFetchError', message: 'Error sending confirmation email', status: 500 };
    expect(
      await signUpWithPassword(client({ user: null, session: null }, err), 'a@b.co', 'gizli-sifre')
    ).toMatchObject({ ok: false, error: { kind: 'email_send_failed' } });
  });
});

describe('üyelik satırları', () => {
  it('geçerli satırlar çevriliyor, en son katılınan önce', () => {
    expect(
      parseMembershipRows([
        { gym_id: 'g1', role: 'member', membership_ends_on: null, joined_at: '2026-01-01T00:00:00Z', gyms: { name: 'A' } },
        { gym_id: 'g2', role: 'admin', membership_ends_on: '2027-01-31', joined_at: '2026-05-01T00:00:00Z', gyms: [{ name: 'B' }] },
      ])
    ).toEqual([
      { gymId: 'g2', gymName: 'B', role: 'admin', membershipEndsOn: '2027-01-31', joinedAt: '2026-05-01T00:00:00Z' },
      { gymId: 'g1', gymName: 'A', role: 'member', membershipEndsOn: null, joinedAt: '2026-01-01T00:00:00Z' },
    ]);
  });

  it('bozuk satırlar atlanıyor', () => {
    expect(parseMembershipRows(null)).toEqual([]);
    expect(
      parseMembershipRows([{ gym_id: 'g1', role: 'patron', gyms: { name: 'A' } }, { gym_id: 'g2', role: 'member' }, 5])
    ).toEqual([]);
  });

  it('ayrılma: yönetici satırı silinmediyse last_admin, üyede zaten yoksa başarılı', async () => {
    const client = (deleted: unknown[]) =>
      ({
        from: () => ({
          delete: () => ({
            eq: () => ({ eq: () => ({ select: async () => ({ data: deleted, error: null }) }) }),
          }),
        }),
      }) as unknown as Parameters<typeof leaveGym>[0];

    expect(await leaveGym(client([]), { gymId: 'g', role: 'admin' }, 'u')).toMatchObject({
      ok: false,
      error: { kind: 'last_admin' },
    });
    expect(await leaveGym(client([]), { gymId: 'g', role: 'member' }, 'u')).toEqual({ ok: true, value: null });
    expect(await leaveGym(client([{ gym_id: 'g' }]), { gymId: 'g', role: 'admin' }, 'u')).toEqual({
      ok: true,
      value: null,
    });
  });
});
