/**
 * Oturum, uygulama kapanıp açılınca korunuyor mu (v3.0).
 *
 * Gerçek supabase-js istemcisi, uygulamadaki auth ayarlarıyla
 * (`supabaseAuthOptions`) kuruluyor; sunucu sahte `fetch`. "Uygulamayı
 * kapatıp açmak" = aynı depoyla yeni istemci kurmak.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { classifyAccountError } from '@/lib/auth';
import { createSecureSessionStorage } from '@/lib/secureSessionStorage';
import {
  parseStoredUser,
  sessionStorageKey,
  supabaseAuthOptions,
  type SessionStorage,
} from '@/lib/supabaseConfig';

const URL_ = 'https://test-proje.supabase.co';
const KEY = 'anon-test';
const USER_ID = '00000000-0000-0000-0000-000000000001';

function memoryStorage(): SessionStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => void data.set(k, v),
    removeItem: async (k) => void data.delete(k),
  };
}

function fakeJwt(expiresAt: number): string {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return [
    enc({ alg: 'HS256', typ: 'JWT' }),
    enc({ sub: USER_ID, exp: expiresAt, role: 'authenticated', aud: 'authenticated' }),
    'imza',
  ].join('.');
}

function sessionBody(expiresIn: number, refreshToken: string) {
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
  return {
    access_token: fakeJwt(expiresAt),
    token_type: 'bearer',
    expires_in: expiresIn,
    expires_at: expiresAt,
    refresh_token: refreshToken,
    user: {
      id: USER_ID,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'ali@ornek.com',
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-10-01T00:00:00Z',
    },
  };
}

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function fakeFetch(handler: Handler) {
  const calls: string[] = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    return handler(url, init);
  };
  return { fetch: fn as typeof fetch, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const clients: SupabaseClient[] = [];

function openApp(storage: SessionStorage, f: typeof fetch): SupabaseClient {
  const c = createClient(URL_, KEY, {
    auth: supabaseAuthOptions(storage),
    global: { fetch: f },
  });
  clients.push(c);
  return c;
}

afterEach(async () => {
  for (const c of clients.splice(0)) await c.auth.stopAutoRefresh();
});

describe('oturum kalıcılığı', () => {
  it('şifreyle giriş → uygulama kapanıp açılınca oturum ağsız geri geliyor', async () => {
    const storage = memoryStorage();
    const server = fakeFetch((url) =>
      url.includes('/token?grant_type=password') ? json(sessionBody(3600, 'r1')) : json({}, 404)
    );
    const first = openApp(storage, server.fetch);
    const { error } = await first.auth.signInWithPassword({ email: 'ali@ornek.com', password: '12345678' });
    expect(error).toBeNull();
    expect(storage.data.size).toBeGreaterThan(0);
    await first.auth.stopAutoRefresh();

    // "Yeniden açılış": aynı depo, ağ yok
    const offline = fakeFetch(() => {
      throw new TypeError('Network request failed');
    });
    const second = openApp(storage, offline.fetch);
    const { data } = await second.auth.getSession();
    expect(data.session?.user.id).toBe(USER_ID);
    expect(offline.calls).toEqual([]);
  });

  it('erişim token\'ı süresi dolmuşsa açılışta yenileme token\'ıyla yenileniyor', async () => {
    const storage = memoryStorage();
    const seed = fakeFetch(() => json(sessionBody(-60, 'eski-r')));
    const first = openApp(storage, seed.fetch);
    await first.auth.signInWithPassword({ email: 'ali@ornek.com', password: '12345678' });
    await first.auth.stopAutoRefresh();

    const server = fakeFetch((url) =>
      url.includes('grant_type=refresh_token') ? json(sessionBody(3600, 'yeni-r')) : json({}, 404)
    );
    const second = openApp(storage, server.fetch);
    const { data } = await second.auth.getSession();
    expect(data.session?.user.id).toBe(USER_ID);
    expect(data.session?.refresh_token).toBe('yeni-r');
    expect(server.calls.some((u) => u.includes('grant_type=refresh_token'))).toBe(true);
  });

  it('token süresi dolmuş + internet yok: ağ hatası döner, oturum depoda kalır, kullanıcı okunabilir', async () => {
    const storage = memoryStorage();
    const seed = fakeFetch(() => json(sessionBody(-60, 'r')));
    const first = openApp(storage, seed.fetch);
    await first.auth.signInWithPassword({ email: 'ali@ornek.com', password: '12345678' });
    await first.auth.stopAutoRefresh();
    const stored = [...storage.data.values()].join();

    // supabase-js yenilemeyi ~25 sn tekrar deniyor; sahte saatle hızlandır
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] });
    try {
      const offline = fakeFetch(() => {
        throw new TypeError('Network request failed');
      });
      const second = openApp(storage, offline.fetch);
      let result: Awaited<ReturnType<typeof second.auth.getSession>> | null = null;
      const pending = second.auth.getSession().then((r) => (result = r));
      for (let i = 0; i < 100 && result == null; i++) await vi.advanceTimersByTimeAsync(1_000);
      await pending;

      // Uygulama bunu "çıkış" değil "çevrimdışı" sayıyor (useSession)
      expect(result!.data.session).toBeNull();
      expect(classifyAccountError(result!.error)).toBe('network');
    } finally {
      vi.useRealTimers();
    }

    // İnternet gelince yenilenebilsin diye token yerinde; kullanıcı ağsız okunuyor
    expect([...storage.data.values()].join()).toBe(stored);
    expect(parseStoredUser(storage.data.get(sessionStorageKey(URL_)) ?? null)).toEqual({
      userId: USER_ID,
      email: 'ali@ornek.com',
    });
  });

  it('istemci oturumu beklenen anahtara yazıyor (useSession açılışta oradan okuyor)', async () => {
    const storage = memoryStorage();
    const server = fakeFetch(() => json(sessionBody(3600, 'r1')));
    const c = openApp(storage, server.fetch);
    await c.auth.signInWithPassword({ email: 'ali@ornek.com', password: '12345678' });
    expect([...storage.data.keys()]).toEqual([sessionStorageKey(URL_)]);
    expect(sessionStorageKey(URL_)).toBe('sb-test-proje-auth-token');
  });

  it('çıkış yapınca depo temizleniyor, yeniden açılışta oturum yok', async () => {
    const storage = memoryStorage();
    const server = fakeFetch((url) =>
      url.includes('/token?grant_type=password') ? json(sessionBody(3600, 'r1')) : json({})
    );
    const first = openApp(storage, server.fetch);
    await first.auth.signInWithPassword({ email: 'ali@ornek.com', password: '12345678' });
    await first.auth.signOut({ scope: 'local' });
    await first.auth.stopAutoRefresh();

    const second = openApp(storage, server.fetch);
    const { data } = await second.auth.getSession();
    expect(data.session).toBeNull();
  });
});

describe('v0.13 güvenli depo (DNC-02) gerçek istemciyle', () => {
  /** SecureStore gibi: 2048 bayt üstünü reddeden bellek deposu */
  function strictSecure() {
    const data = new Map<string, string>();
    return {
      data,
      getItemAsync: async (k: string) => data.get(k) ?? null,
      setItemAsync: async (k: string, v: string) => {
        if (v.length > 2048) throw new Error('değer çok büyük');
        data.set(k, v);
      },
      deleteItemAsync: async (k: string) => void data.delete(k),
    };
  }

  it('oturum parçalı yazılıyor, düz depoda kopya kalmıyor, yeniden açılışta ağsız geri geliyor', async () => {
    const secure = strictSecure();
    const legacy = memoryStorage();
    const storage = createSecureSessionStorage({ secure, legacy });
    const big = sessionBody(3600, 'r1');
    // Google kimliğiyle büyüyen kullanıcı nesnesi
    (big.user as Record<string, unknown>).identities = [{ provider: 'google', identity_data: { x: 'y'.repeat(3000) } }];
    const server = fakeFetch(() => json(big));
    const first = openApp(storage, server.fetch);
    await first.auth.signInWithPassword({ email: 'ali@ornek.com', password: '12345678' });
    await first.auth.stopAutoRefresh();
    expect(Number(secure.data.get(`${sessionStorageKey(URL_)}__n`))).toBeGreaterThan(1);
    expect(legacy.data.size).toBe(0);

    const offline = fakeFetch(() => {
      throw new TypeError('Network request failed');
    });
    const second = openApp(storage, offline.fetch);
    const { data } = await second.auth.getSession();
    expect(data.session?.user.id).toBe(USER_ID);
    expect(offline.calls).toEqual([]);
  });

  it('0.12\'de kv-store\'a yazılmış oturum 0.13 istemcisinde geri geliyor ve taşınıyor', async () => {
    const legacy = memoryStorage();
    const seed = fakeFetch(() => json(sessionBody(3600, 'r1')));
    const old = openApp(legacy, seed.fetch);
    await old.auth.signInWithPassword({ email: 'ali@ornek.com', password: '12345678' });
    await old.auth.stopAutoRefresh();
    expect(legacy.data.size).toBe(1);

    const secure = strictSecure();
    const offline = fakeFetch(() => {
      throw new TypeError('Network request failed');
    });
    const updated = openApp(createSecureSessionStorage({ secure, legacy }), offline.fetch);
    const { data } = await updated.auth.getSession();
    expect(data.session?.user.id).toBe(USER_ID);
    expect(legacy.data.size).toBe(0);
    expect(secure.data.size).toBeGreaterThan(0);
  });
});
