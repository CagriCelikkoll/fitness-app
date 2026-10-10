/**
 * Hesap ve salon (v3.0) — saf yardımcılar, giriş ekranı durum mantığı,
 * gizli bayrak ve env yokken (istemci null) çökmeme.
 */

import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_ERROR_MESSAGES,
  INITIAL_OTP_STATE,
  INITIAL_TAP_COUNTER,
  RESEND_COOLDOWN_SECONDS,
  VERSION_TAP_GAP_MS,
  canResend,
  canSendCode,
  canVerify,
  classifyAccountError,
  isValidEmail,
  isValidJoinCode,
  isValidOtp,
  normalizeEmail,
  normalizeJoinCode,
  otpReducer,
  registerVersionTap,
  resendSecondsLeft,
  roleLabel,
  type OtpAction,
  type OtpState,
} from '@/lib/auth';
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
import {
  GYM_FEATURES_KEY,
  getGymFeaturesEnabled,
  isServiceRoleKey,
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

describe('hata sınıflandırma', () => {
  it('sunucu fonksiyonu hataları', () => {
    expect(classifyAccountError({ message: 'too_many_attempts', code: 'P0001' })).toBe('too_many_attempts');
    expect(classifyAccountError({ message: 'not_authenticated' })).toBe('not_signed_in');
  });

  it('ağ hataları', () => {
    expect(classifyAccountError(new TypeError('Network request failed'))).toBe('network');
    expect(classifyAccountError({ message: 'TypeError: Network request failed', code: '' })).toBe('network');
    expect(classifyAccountError({ name: 'AuthRetryableFetchError', message: '{}', status: 0 })).toBe('network');
  });

  it('giriş hataları', () => {
    expect(classifyAccountError({ code: 'otp_expired', status: 403, message: 'Token has expired or is invalid' })).toBe(
      'invalid_otp'
    );
    expect(classifyAccountError({ code: 'over_email_send_rate_limit', status: 429, message: 'x' })).toBe(
      'rate_limited'
    );
  });

  it('bilinmeyen → unknown; her türün Türkçe mesajı var', () => {
    expect(classifyAccountError(null)).toBe('unknown');
    expect(classifyAccountError('garip')).toBe('unknown');
    for (const message of Object.values(ACCOUNT_ERROR_MESSAGES)) expect(message.length).toBeGreaterThan(0);
  });
});

describe('giriş ekranı durumu', () => {
  const run = (actions: OtpAction[], start: OtpState = INITIAL_OTP_STATE) =>
    actions.reduce(otpReducer, start);

  it('geçersiz e-postayla kod gönderilemez', () => {
    expect(canSendCode(run([{ type: 'emailChanged', email: 'ali@' }]))).toBe(false);
    expect(canSendCode(run([{ type: 'emailChanged', email: 'ali@ornek.com' }]))).toBe(true);
  });

  it('gönderim sürerken tekrar basılamaz', () => {
    const s = run([{ type: 'emailChanged', email: 'ali@ornek.com' }, { type: 'sendStarted' }]);
    expect(s.busy).toBe(true);
    expect(canSendCode(s)).toBe(false);
  });

  it('gönderim başarılı → kod adımı; kod yalnızca rakam, en fazla 6', () => {
    let s = run([
      { type: 'emailChanged', email: 'ali@ornek.com' },
      { type: 'sendStarted' },
      { type: 'sendSucceeded', now: 1_000 },
    ]);
    expect(s.step).toBe('code');
    expect(canVerify(s)).toBe(false);

    s = otpReducer(s, { type: 'codeChanged', code: '12 34-5' });
    expect(s.code).toBe('12345');
    expect(canVerify(s)).toBe(false);

    s = otpReducer(s, { type: 'codeChanged', code: '1234567' });
    expect(s.code).toBe('123456');
    expect(canVerify(s)).toBe(true);
  });

  it('hata mesajı gösterilir, yazmaya başlayınca kalkar', () => {
    let s = run([
      { type: 'emailChanged', email: 'ali@ornek.com' },
      { type: 'sendStarted' },
      { type: 'failed', message: 'Sunucuya ulaşılamadı.' },
    ]);
    expect(s).toMatchObject({ step: 'email', busy: false, error: 'Sunucuya ulaşılamadı.' });
    s = otpReducer(s, { type: 'emailChanged', email: 'ali@ornek.co' });
    expect(s.error).toBeNull();
  });

  it('yanlış kod: kod adımında kalır, tekrar denenebilir', () => {
    const s = run([
      { type: 'emailChanged', email: 'ali@ornek.com' },
      { type: 'sendSucceeded', now: 0 },
      { type: 'codeChanged', code: '111111' },
      { type: 'verifyStarted' },
      { type: 'failed', message: 'Kod hatalı' },
    ]);
    expect(s.step).toBe('code');
    expect(canVerify(s)).toBe(true);
  });

  it('"Kodu tekrar gönder" 60 sn sonra açılır', () => {
    const s = run([
      { type: 'emailChanged', email: 'ali@ornek.com' },
      { type: 'sendSucceeded', now: 10_000 },
    ]);
    expect(resendSecondsLeft(s, 10_000)).toBe(RESEND_COOLDOWN_SECONDS);
    expect(canResend(s, 10_000)).toBe(false);
    expect(resendSecondsLeft(s, 10_000 + 59_500)).toBe(1);
    expect(canResend(s, 10_000 + 59_999)).toBe(false);
    expect(canResend(s, 10_000 + 60_000)).toBe(true);
  });

  it('e-postayı değiştir: kod temizlenir, e-posta adımına dönülür', () => {
    const s = run([
      { type: 'emailChanged', email: 'ali@ornek.com' },
      { type: 'sendSucceeded', now: 0 },
      { type: 'codeChanged', code: '123' },
      { type: 'editEmail' },
    ]);
    expect(s).toMatchObject({ step: 'email', code: '', email: 'ali@ornek.com' });
    expect(canResend(s, 1_000_000)).toBe(false);
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
