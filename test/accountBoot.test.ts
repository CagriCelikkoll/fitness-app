/**
 * Hesapsız açılışta Supabase'e istek gitmiyor (v3.7, spec Bölüm 4.3).
 *
 * Gizlilik Politikası "hesap açmazsan her şey telefonda kalır" diyor.
 * Hesap artık bayraksız herkese açık; bu yüzden:
 * 1. Açılış kararı (`decideAccountBoot`, useSession'ın kullandığı): kayıtlı
 *    oturum yoksa istemci HİÇ kurulmuyor.
 * 2. Kurulsa bile (giriş ekranı açıldı ama kod istenmedi) oturumsuz gerçek
 *    supabase-js istemcisi, uygulamadaki auth ayarlarıyla, ağa çıkmıyor:
 *    başlatma, oturum okuma ve token yenileme döngüsü dahil.
 * 3. Kaynakta istemciyi başlatan yalnızca iki yer var: kayıtlı oturum
 *    (useSession) ve giriş ekranı. Modül düzeyinde (açılışta) çağrı yok.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LIVE_PROJECT_REF,
  decideAccountBoot,
  projectRefOf,
  serverEnvironmentWarning,
  sessionStorageKey,
  supabaseAuthOptions,
  type SessionStorage,
} from '@/lib/supabaseConfig';

const URL_ = 'https://test-proje.supabase.co';
const KEY = 'anon-test';
const SESSION_KEY = sessionStorageKey(URL_);

function memoryStorage(initial: Record<string, string> = {}): SessionStorage & { data: Map<string, string> } {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    data,
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => void data.set(k, v),
    removeItem: async (k) => void data.delete(k),
  };
}

describe('açılış kararı (ağsız)', () => {
  it('kayıtlı oturum yok → istemci kurulmaz', async () => {
    expect(
      await decideAccountBoot({ configured: true, sessionKey: SESSION_KEY, storage: memoryStorage() })
    ).toEqual({ kind: 'signed_out' });
  });

  it('kayıtlı oturum var → başlar, kullanıcı ağ beklemeden belli', async () => {
    const storage = memoryStorage({
      [SESSION_KEY]: JSON.stringify({ access_token: 'x', user: { id: 'u1', email: 'a@b.co' } }),
    });
    expect(await decideAccountBoot({ configured: true, sessionKey: SESSION_KEY, storage })).toEqual({
      kind: 'start',
      user: { userId: 'u1', email: 'a@b.co' },
    });
  });

  it('bozuk kayıt / depo hatası → çıkış yapılmış sayılır (istek yok)', async () => {
    expect(
      await decideAccountBoot({
        configured: true,
        sessionKey: SESSION_KEY,
        storage: memoryStorage({ [SESSION_KEY]: '{bozuk' }),
      })
    ).toEqual({ kind: 'signed_out' });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(
      await decideAccountBoot({
        configured: true,
        sessionKey: SESSION_KEY,
        storage: {
          getItem: async () => {
            throw new Error('disk');
          },
        },
      })
    ).toEqual({ kind: 'signed_out' });
    error.mockRestore();
  });

  it('env yok → hiçbir şey', async () => {
    const storage = { getItem: vi.fn(async () => null) };
    expect(await decideAccountBoot({ configured: false, sessionKey: null, storage })).toEqual({
      kind: 'not_configured',
    });
    expect(storage.getItem).not.toHaveBeenCalled();
  });
});

describe('oturumsuz gerçek istemci ağa çıkmıyor', () => {
  const clients: SupabaseClient[] = [];
  afterEach(async () => {
    for (const c of clients.splice(0)) await c.auth.stopAutoRefresh();
    vi.useRealTimers();
  });

  it('kurulum, oturum okuma, kullanıcı sorgusu yok, token yenileme döngüsü: 0 istek', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calls: string[] = [];
    const recordingFetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const storage = memoryStorage();
    const c = createClient(URL_, KEY, {
      auth: supabaseAuthOptions(storage),
      global: { fetch: recordingFetch },
    });
    clients.push(c);

    await c.auth.initialize();
    expect((await c.auth.getSession()).data.session).toBeNull();
    // Uygulama ön plandayken yenileme döngüsü çalışıyor; 5 dakika ilerlet
    await c.auth.startAutoRefresh();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await c.auth.stopAutoRefresh();

    expect(calls).toEqual([]);
    expect(storage.data.size).toBe(0);
  });
});

describe('istemciyi yalnızca kayıtlı oturum ve giriş ekranı başlatıyor', () => {
  const root = path.resolve(__dirname, '..');
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return files(full);
      return /\.(ts|tsx)$/.test(name) ? [full] : [];
    });
  const sources = [...files(path.join(root, 'src')), ...files(path.join(root, 'app'))].map((f) => ({
    rel: path.relative(root, f).split(path.sep).join('/'),
    text: readFileSync(f, 'utf8'),
  }));

  it('activateSupabase yalnızca useSession.ts, startAccountClient yalnızca giriş ekranı', () => {
    const users = (name: string) =>
      sources.filter((s) => new RegExp(`\\b${name}\\(`).test(s.text)).map((s) => s.rel).sort();
    expect(users('activateSupabase')).toEqual(['src/hooks/useSession.ts', 'src/lib/supabase.ts']);
    expect(users('startAccountClient')).toEqual(['app/account/sign-in.tsx', 'src/hooks/useSession.ts']);
  });

  it('modül düzeyinde (açılışta) istemci çağrısı yok', () => {
    for (const s of sources) {
      const topLevel = s.text
        .split('\n')
        .filter((line) => /^(const|let|var|void|export const)\b.*\b(getSupabase|activateSupabase|createClient)\(/.test(line));
      expect(topLevel, s.rel).toEqual([]);
    }
  });

  it('gizli bayrak kaldırıldı (DNC-06)', () => {
    for (const s of sources) {
      expect(s.text, s.rel).not.toMatch(/gymFeatures\.enabled|useGymFeatures|registerVersionTap/);
    }
  });
});

describe('canlı / test sunucusu uyarısı (geliştirici logu)', () => {
  const live = { url: `https://${LIVE_PROJECT_REF}.supabase.co`, anonKey: 'k' };

  it('canlı projede uyarı yok', () => {
    expect(serverEnvironmentWarning(live, { isDev: false })).toBeNull();
  });

  it('yayın paketinde başka proje → uyarı (kimliğiyle)', () => {
    const w = serverEnvironmentWarning({ url: 'https://baskaproje.supabase.co', anonKey: 'k' }, { isDev: false });
    expect(w).toMatch(/^\[CONFIG\]/);
    expect(w).toContain('baskaproje');
  });

  it('yayın paketinde adres yok → uyarı', () => {
    expect(serverEnvironmentWarning(null, { isDev: false })).toMatch(/--environment/);
  });

  it('geliştirmede uyarı yok', () => {
    expect(serverEnvironmentWarning({ url: 'https://baskaproje.supabase.co', anonKey: 'k' }, { isDev: true })).toBeNull();
    expect(serverEnvironmentWarning(null, { isDev: true })).toBeNull();
  });

  it('proje kimliği', () => {
    expect(projectRefOf(`https://${LIVE_PROJECT_REF}.supabase.co`)).toBe(LIVE_PROJECT_REF);
    expect(projectRefOf('bozuk')).toBeNull();
  });

  it('eas.json yayın profilleri canlı projeye bağlı', () => {
    const eas = JSON.parse(readFileSync(path.resolve(__dirname, '../eas.json'), 'utf8')) as {
      build: Record<string, { env?: Record<string, string> }>;
    };
    for (const profile of ['preview', 'production']) {
      const url = eas.build[profile]?.env?.EXPO_PUBLIC_SUPABASE_URL;
      if (url) expect(projectRefOf(url), profile).toBe(LIVE_PROJECT_REF);
    }
  });
});
