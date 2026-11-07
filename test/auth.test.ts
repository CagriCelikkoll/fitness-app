/**
 * Hesap ve salon (v3.0; v3.7 yalnızca kod) — saf yardımcılar: hata eşleme,
 * giriş ekranı durum mantığı (e-posta → aydınlatma onayı → kod), env
 * yokken (istemci null) çökmeme. Şifre yok (pentest DNC-09).
 */

import { describe, expect, it } from 'vitest';

import * as authLib from '@/lib/auth';
import {
  ACCOUNT_ERROR_MESSAGES,
  INITIAL_AUTH_FORM,
  RESEND_COOLDOWN_SECONDS,
  authFormReducer,
  canResend,
  canSubmit,
  classifyAccountError,
  isValidEmail,
  isValidJoinCode,
  isValidOtp,
  normalizeEmail,
  normalizeJoinCode,
  resendSecondsLeft,
  roleLabel,
  type AccountErrorKind,
  type AuthFormAction,
  type AuthFormState,
} from '@/lib/auth';
import * as account from '@/lib/account';
import {
  fetchMemberships,
  joinGym,
  leaveGym,
  parseMembershipRows,
  previewGym,
  sendSignInCode,
  signOut,
  verifySignInCode,
} from '@/lib/account';
import { isServiceRoleKey, parseStoredUser, readSupabaseConfig } from '@/lib/supabaseConfig';

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

describe('giriş ekranı durumu (yalnızca kod)', () => {
  const run = (actions: AuthFormAction[], start: AuthFormState = INITIAL_AUTH_FORM) =>
    actions.reduce(authFormReducer, start);
  const set = (field: 'email' | 'code', value: string): AuthFormAction => ({
    type: 'fieldChanged',
    field,
    value,
  });
  const read: AuthFormAction = { type: 'noticeToggled' };

  it('açılış e-posta adımı; şifre alanı yok', () => {
    expect(INITIAL_AUTH_FORM.mode).toBe('email');
    expect(Object.keys(INITIAL_AUTH_FORM).some((k) => /password/i.test(k))).toBe(false);
  });

  it('"Kodu gönder": geçerli e-posta VE aydınlatma metni okundu işaretli', () => {
    expect(canSubmit(run([set('email', 'ali@ornek.com')]))).toBe(false);
    expect(canSubmit(run([set('email', 'ali@'), read]))).toBe(false);
    expect(canSubmit(run([set('email', 'ali@ornek.com'), read]))).toBe(true);
    // İşaret kaldırılırsa yine kapalı
    expect(canSubmit(run([set('email', 'ali@ornek.com'), read, read]))).toBe(false);
  });

  it('istek sürerken düğme kapalı', () => {
    expect(canSubmit(run([set('email', 'ali@ornek.com'), read, { type: 'started' }]))).toBe(false);
  });

  it('kod gönderildi → kod adımı; kod yalnızca rakam, en fazla 6', () => {
    let s = run([set('email', 'ali@ornek.com'), read, { type: 'started' }, { type: 'codeSent', now: 1_000 }]);
    expect(s).toMatchObject({ mode: 'code', busy: false, code: '', sentAt: 1_000 });
    expect(canSubmit(s)).toBe(false);
    s = authFormReducer(s, set('code', '12 34-5'));
    expect(s.code).toBe('12345');
    s = authFormReducer(s, set('code', '1234567'));
    expect(s.code).toBe('123456');
    expect(canSubmit(s)).toBe(true);
  });

  it('hata gösterilir, yazmaya başlayınca kalkar', () => {
    let s = run([set('email', 'ali@ornek.com'), { type: 'started' }, { type: 'failed', message: 'Kod yanlış.' }]);
    expect(s).toMatchObject({ busy: false, error: 'Kod yanlış.' });
    s = authFormReducer(s, set('code', '1'));
    expect(s.error).toBeNull();
  });

  it('"Kodu tekrar gönder" 60 sn sonra, yalnızca kod adımında', () => {
    const s = run([set('email', 'ali@ornek.com'), read, { type: 'codeSent', now: 10_000 }]);
    expect(resendSecondsLeft(s, 10_000)).toBe(RESEND_COOLDOWN_SECONDS);
    expect(canResend(s, 10_000)).toBe(false);
    expect(resendSecondsLeft(s, 10_000 + 59_500)).toBe(1);
    expect(canResend(s, 10_000 + 60_000)).toBe(true);
    expect(canResend(INITIAL_AUTH_FORM, 1_000_000)).toBe(false);
  });

  it('"düzelt": e-posta adımına; e-posta ve işaret korunur, kod gider', () => {
    const s = run([
      set('email', 'ali@ornk.com'),
      read,
      { type: 'codeSent', now: 1 },
      set('code', '123'),
      { type: 'editEmail' },
    ]);
    expect(s).toMatchObject({ mode: 'email', email: 'ali@ornk.com', noticeRead: true, code: '', sentAt: null });
  });
});

describe('şifre akışı kaldırıldı (DNC-09)', () => {
  it('account.ts şifreyle giriş / kayıt / sıfırlama dışa vermiyor', () => {
    for (const name of [
      'signInWithPassword',
      'signUpWithPassword',
      'verifySignupCode',
      'resendSignupCode',
      'sendPasswordResetCode',
      'verifyRecoveryCode',
      'updatePassword',
    ]) {
      expect(account, name).not.toHaveProperty(name);
    }
    expect(authLib).not.toHaveProperty('passwordError');
    expect(authLib).not.toHaveProperty('PASSWORD_MIN_LENGTH');
  });

  it('hata mesajlarında şifre geçmiyor', () => {
    for (const m of Object.values(ACCOUNT_ERROR_MESSAGES)) expect(m).not.toMatch(/şifre/i);
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
        signInWithOtp: async () => {
          throw new TypeError('Network request failed');
        },
      },
    } as unknown as Parameters<typeof sendSignInCode>[0];
    const r = await sendSignInCode(throwing, 'ali@ornek.com');
    expect(r).toMatchObject({ ok: false, error: { kind: 'network' } });
  });
});

describe('kod gönderme sonucu', () => {
  const client = (error: unknown, seen: unknown[] = []) =>
    ({
      auth: {
        signInWithOtp: async (params: unknown) => {
          seen.push(params);
          return { data: {}, error };
        },
      },
    }) as unknown as Parameters<typeof sendSignInCode>[0];

  it('hesap yoksa da açılır (shouldCreateUser), adres normalleştirilir, kullanıcı verisi gönderilmez', async () => {
    const seen: unknown[] = [];
    expect(await sendSignInCode(client(null, seen), '  Ali@Ornek.COM ')).toEqual({ ok: true, value: null });
    expect(seen).toEqual([{ email: 'ali@ornek.com', options: { shouldCreateUser: true } }]);
  });

  it('sunucu SMTP hatası → email_send_failed', async () => {
    const err = { name: 'AuthRetryableFetchError', message: 'Error sending magic link email', status: 500 };
    expect(await sendSignInCode(client(err), 'a@b.co')).toMatchObject({
      ok: false,
      error: { kind: 'email_send_failed' },
    });
  });
});

describe('üyelik satırları', () => {
  it('geçerli satırlar çevriliyor, en son katılınan önce', () => {
    expect(
      parseMembershipRows([
        { gym_id: 'g1', role: 'member', membership_ends_on: null, joined_at: '2026-01-01T00:00:00Z', gyms: { name: 'A' } },
        { gym_id: 'g2', role: 'admin', membership_ends_on: '2027-01-31', joined_at: '2026-05-01T00:00:00Z', gyms: [{ name: 'B', primary_color: '#3EC5FF', logo_url: 'https://x.supabase.co/storage/v1/object/public/gym-logos/g2/a.jpg' }] },
      ])
    ).toEqual([
      { gymId: 'g2', gymName: 'B', role: 'admin', membershipEndsOn: '2027-01-31', joinedAt: '2026-05-01T00:00:00Z', primaryColor: '#3EC5FF', logoUrl: 'https://x.supabase.co/storage/v1/object/public/gym-logos/g2/a.jpg' },
      { gymId: 'g1', gymName: 'A', role: 'member', membershipEndsOn: null, joinedAt: '2026-01-01T00:00:00Z', primaryColor: null, logoUrl: null },
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
