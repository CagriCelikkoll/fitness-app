/**
 * Gerçek supabase-js istemcisiyle (uygulamadaki auth ayarları), sahte
 * sunucu yanıtlarına karşı — tur c cihaz testinde görülenler:
 *
 * 1. Hesap silinince /logout 403 döner (sunucuda oturum yok): yerel
 *    oturum yine temizlenir, kullanıcıya hata gösterilmez. Çıkış + başka
 *    hesapla giriş sonrası istekler YENİ token'la gider; eski token hiç
 *    kullanılmaz.
 * 2. Uçak modu: fetch'in her başarısızlık biçimi (failed / timed out /
 *    DNS) eşitleme kartında "İnternet yok" olarak görünür.
 * 3. Kayıt e-postası: 500 + SMTP → "E-posta gönderilemedi"; 429 →
 *    "Çok fazla deneme"; "Kodu tekrar gönder" akışı.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { deleteMyAccount, resendSignupCode, signOut, signUpWithPassword } from '@/lib/account';
import {
  ACCOUNT_ERROR_MESSAGES,
  INITIAL_AUTH_FORM,
  authFormReducer,
  canResend,
  type AuthFormAction,
  type AuthFormState,
} from '@/lib/auth';
import { getSyncStatus, runSync } from '@/lib/sync/engine';
import { supabaseTransport } from '@/lib/sync/supabaseTransport';
import { OFFLINE_TEXT, syncCardView } from '@/lib/sync/ui';
import { supabaseAuthOptions, type SessionStorage } from '@/lib/supabaseConfig';

import { closePhones, phone } from './helpers/syncPhones';

const URL_ = 'https://test-proje.supabase.co';
const KEY = 'anon-test';
const USER_A = '00000000-0000-0000-0000-00000000000a';
const USER_B = '00000000-0000-0000-0000-00000000000b';

function memoryStorage(): SessionStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => void data.set(k, v),
    removeItem: async (k) => void data.delete(k),
  };
}

function fakeJwt(sub: string): string {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return [enc({ alg: 'HS256', typ: 'JWT' }), enc({ sub, exp, role: 'authenticated', aud: 'authenticated' }), 'imza'].join('.');
}

function sessionBody(userId: string, email: string) {
  return {
    access_token: fakeJwt(userId),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: `refresh-${userId}`,
    user: {
      id: userId,
      aud: 'authenticated',
      role: 'authenticated',
      email,
      app_metadata: {},
      user_metadata: {},
      identities: [{ id: 'i' }],
      created_at: '2026-10-01T00:00:00Z',
    },
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface Call {
  url: string;
  method: string;
  auth: string | null;
}

function fakeServer(handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, method: init?.method ?? 'GET', auth: headers.get('Authorization') });
    return handler(url, init);
  };
  return { fetch: fetchFn as typeof fetch, calls };
}

const clients: SupabaseClient[] = [];
function client(storage: SessionStorage, f: typeof fetch): SupabaseClient {
  const c = createClient(URL_, KEY, { auth: supabaseAuthOptions(storage), global: { fetch: f } });
  clients.push(c);
  return c;
}

afterEach(async () => {
  for (const c of clients.splice(0)) await c.auth.stopAutoRefresh();
  closePhones();
});

// ============================================================================
// 1. Hesap silme, 403 çıkış, hesap değiştirme
// ============================================================================

describe('hesap silme ve çıkış', () => {
  function accountServer(logoutStatus: number) {
    const deleted = new Set<string>();
    return fakeServer(async (url, init) => {
      if (url.includes('/token?grant_type=password')) {
        const { email } = JSON.parse(String(init?.body)) as { email: string };
        return json(sessionBody(email.startsWith('b') ? USER_B : USER_A, email));
      }
      if (url.includes('/rest/v1/rpc/delete_my_account')) {
        const sub = new Headers(init?.headers).get('Authorization')!.split('.')[1];
        deleted.add(JSON.parse(Buffer.from(sub, 'base64url').toString()).sub);
        return new Response(null, { status: 204 });
      }
      if (url.includes('/auth/v1/logout')) {
        return json(
          { code: logoutStatus, error_code: 'user_not_found', msg: 'User from sub claim in JWT does not exist' },
          logoutStatus
        );
      }
      if (url.includes('/rest/v1/rpc/sync_server_time')) return json('2026-10-13T10:00:00.000000+00:00');
      return json({}, 404);
    });
  }

  it.each([403, 404, 500])(
    'silme sonrası /logout %i dönse de yerel oturum temizleniyor, hata gösterilmiyor',
    async (logoutStatus) => {
      const storage = memoryStorage();
      const server = accountServer(logoutStatus);
      const c = client(storage, server.fetch);
      const events: string[] = [];
      c.auth.onAuthStateChange((event) => void events.push(event));
      await c.auth.signInWithPassword({ email: 'a@ornek.com', password: '12345678' });
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(await deleteMyAccount(c)).toEqual({ ok: true, value: null });
      error.mockRestore();

      expect((await c.auth.getSession()).data.session).toBeNull();
      expect(storage.data.size).toBe(0);
      expect(events).toContain('SIGNED_OUT');
      expect(server.calls.some((x) => x.url.includes('/logout'))).toBe(true);
    }
  );

  it('normal çıkışta da 403 hata sayılmıyor', async () => {
    const storage = memoryStorage();
    const c = client(storage, accountServer(403).fetch);
    await c.auth.signInWithPassword({ email: 'a@ornek.com', password: '12345678' });
    expect(await signOut(c)).toEqual({ ok: true, value: null });
    expect(storage.data.size).toBe(0);
  });

  it('silme yalnızca o anki oturumun kullanıcısını hedefliyor; başka hesapla girişten sonra eski token hiç kullanılmıyor', async () => {
    const storage = memoryStorage();
    const server = accountServer(403);
    const c = client(storage, server.fetch);

    await c.auth.signInWithPassword({ email: 'a@ornek.com', password: '12345678' });
    const tokenA = `Bearer ${fakeJwt(USER_A)}`.split('.').slice(0, 2).join('.');
    expect(await deleteMyAccount(c)).toMatchObject({ ok: true });
    const deleteCall = server.calls.find((x) => x.url.includes('delete_my_account'))!;
    expect(deleteCall.auth?.startsWith(tokenA)).toBe(true);

    const afterSignOut = server.calls.length;
    await c.auth.signInWithPassword({ email: 'b@ornek.com', password: '12345678' });
    await supabaseTransport(c).serverTime();
    const tokenB = `Bearer ${fakeJwt(USER_B)}`.split('.').slice(0, 2).join('.');

    const later = server.calls.slice(afterSignOut).filter((x) => x.url.includes('/rest/v1/'));
    expect(later.length).toBeGreaterThan(0);
    expect(later.every((x) => x.auth?.startsWith(tokenB))).toBe(true);
    expect(server.calls.slice(afterSignOut).some((x) => x.auth?.startsWith(tokenA))).toBe(false);
  });
});

// ============================================================================
// 2. Uçak modu → eşitleme kartı "İnternet yok"
// ============================================================================

describe('internetsiz eşitleme', () => {
  it.each([
    'Network request failed',
    'Network request timed out',
    'Unable to resolve host "test-proje.supabase.co": No address associated with hostname',
    'Failed to connect to test-proje.supabase.co/1.2.3.4:443',
    'The Internet connection appears to be offline.',
  ])('fetch "%s" → kartta "İnternet yok"', async (message) => {
    const storage = memoryStorage();
    const c = client(
      storage,
      (async () => {
        throw new TypeError(message);
      }) as typeof fetch
    );
    const t = await phone();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await runSync({ db: t.db, transport: supabaseTransport(c), userId: USER_A });
    warn.mockRestore();

    expect(r).toMatchObject({ status: 'error', issue: { errorKind: 'network' } });
    const view = syncCardView(await getSyncStatus(t.db), false, Date.now());
    expect(view).toMatchObject({ kind: 'status', text: OFFLINE_TEXT, retry: false, detail: null });
  });

  it('tanınmayan hata: genel mesaj + teşhis için ham metin', async () => {
    const c = client(
      memoryStorage(),
      (async () => json({ code: 'XX000', message: 'beklenmedik', details: null, hint: null }, 418)) as typeof fetch
    );
    const t = await phone();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await runSync({ db: t.db, transport: supabaseTransport(c), userId: USER_A });
    warn.mockRestore();
    const view = syncCardView(await getSyncStatus(t.db), false, Date.now());
    expect(view).toMatchObject({ kind: 'status', retry: true, detail: 'beklenmedik (XX000)' });
  });
});

// ============================================================================
// 3. Kayıt e-postası: 500 + SMTP, 429, kodu tekrar gönder
// ============================================================================

describe('kayıt e-postası hataları', () => {
  const authError = (status: number, error_code: string, msg: string) => () => json({ code: status, error_code, msg }, status);

  it.each([
    ['Supabase SMTP', authError(500, 'unexpected_failure', 'Error sending confirmation email'), 'email_send_failed'],
    ['özel SMTP (gomail)', authError(500, 'unexpected_failure', 'gomail: could not send email 1: 535 Authentication failed'), 'email_send_failed'],
    ['SMTP dışı 500', authError(500, 'unexpected_failure', 'Database error saving new user'), 'server'],
    ['e-posta sınırı (429)', authError(429, 'over_email_send_rate_limit', 'For security purposes, you can only request this after 52 seconds.'), 'rate_limited'],
    ['internet yok', () => { throw new TypeError('Network request timed out'); }, 'network'],
  ] as const)('kayıt: %s', async (_name, respond, kind) => {
    const c = client(memoryStorage(), (async () => respond()) as typeof fetch);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await signUpWithPassword(c, 'ali@ornek.com', 'gizli-sifre');
    error.mockRestore();
    expect(r).toMatchObject({ ok: false, error: { kind, message: ACCOUNT_ERROR_MESSAGES[kind] } });
  });

  it('mesajlar', () => {
    expect(ACCOUNT_ERROR_MESSAGES.email_send_failed).toBe('E-posta gönderilemedi. Biraz sonra tekrar dene.');
    expect(ACCOUNT_ERROR_MESSAGES.rate_limited).toBe('Çok fazla deneme yapıldı. Biraz sonra tekrar dene.');
  });

  it('kodu tekrar gönder: 429 → hata görünür, kod adımında kalınır, tekrar denenebilir; başarıda süre baştan başlar', async () => {
    let next: () => Response = authError(429, 'over_email_send_rate_limit', 'For security purposes, you can only request this after 30 seconds.');
    const c = client(memoryStorage(), (async (url: string) =>
      String(url).includes('/resend') ? next() : json({}, 404)) as typeof fetch);

    const step = (s: AuthFormState, a: AuthFormAction) => authFormReducer(s, a);
    const setup: AuthFormAction[] = [
      { type: 'fieldChanged', field: 'email', value: 'ali@ornek.com' },
      { type: 'codeSent', mode: 'verifySignup', now: 0 },
    ];
    let s = setup.reduce(step, INITIAL_AUTH_FORM);
    expect(canResend(s, 30_000)).toBe(false);
    expect(canResend(s, 60_000)).toBe(true);

    // Ekrandaki resend(): started → istek → başarısızsa failed
    s = step(s, { type: 'started' });
    const failed = await resendSignupCode(c, s.email);
    expect(failed).toMatchObject({ ok: false, error: { kind: 'rate_limited' } });
    if (!failed.ok) s = step(s, { type: 'failed', message: failed.error.message });
    expect(s).toMatchObject({ mode: 'verifySignup', busy: false, error: ACCOUNT_ERROR_MESSAGES.rate_limited });
    expect(canResend(s, 60_000)).toBe(true);

    next = () => json({});
    s = step(s, { type: 'started' });
    const sent = await resendSignupCode(c, s.email);
    expect(sent).toEqual({ ok: true, value: null });
    s = step(s, { type: 'codeSent', mode: 'verifySignup', now: 60_000 });
    expect(s).toMatchObject({ mode: 'verifySignup', busy: false, error: null });
    expect(canResend(s, 60_000 + 30_000)).toBe(false);
    expect(canResend(s, 60_000 + 60_000)).toBe(true);
  });
});
