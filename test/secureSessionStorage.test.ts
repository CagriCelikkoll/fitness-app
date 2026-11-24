/**
 * Oturum güvenli depoda (v0.13, DNC-02): parçalama, 0.12'den taşıma,
 * bozuk güvenli depo. Ayrıca gerçek supabase-js istemcisi bu depoyla
 * oturumu yazıp geri okuyabiliyor mu.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  MAX_SECURE_CHUNKS,
  SECURE_CHUNK_SIZE,
  createSecureSessionStorage,
  isValidSecureKey,
  splitIntoChunks,
  type SecureStoreLike,
} from '@/lib/secureSessionStorage';
import { decideAccountBoot, sessionStorageKey, type SessionStorage } from '@/lib/supabaseConfig';

const KEY = sessionStorageKey('https://iuugvgpcwqiwyrrouwrn.supabase.co');

function memorySecure(opts: { failWrites?: boolean; failReads?: boolean } = {}) {
  const map = new Map<string, string>();
  const store: SecureStoreLike & { map: Map<string, string> } = {
    map,
    async getItemAsync(k) {
      if (opts.failReads) throw new Error('keystore okunamadı');
      return map.get(k) ?? null;
    },
    async setItemAsync(k, v) {
      if (opts.failWrites) throw new Error('keystore yazılamadı');
      // Gerçek SecureStore 2048 bayttan büyük değerde uyarıyor / iOS'ta reddedebiliyor
      if (v.length > 2048) throw new Error('değer çok büyük');
      map.set(k, v);
    },
    async deleteItemAsync(k) {
      map.delete(k);
    },
  };
  return store;
}

function memoryLegacy(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const store: SessionStorage & { map: Map<string, string> } = {
    map,
    async getItem(k) {
      return map.get(k) ?? null;
    },
    async setItem(k, v) {
      map.set(k, v);
    },
    async removeItem(k) {
      map.delete(k);
    },
  };
  return store;
}

/** Google girişli oturuma benzer, 2 KB'tan büyük JSON */
function bigSession(userId = 'u-1') {
  return JSON.stringify({
    access_token: 'a'.repeat(1200),
    refresh_token: 'r'.repeat(40),
    user: { id: userId, email: 'x@example.com', identities: [{ provider: 'google', data: 'd'.repeat(2500) }] },
  });
}

describe('parçalama', () => {
  it('2 KB üstü değer parçalanır, birebir geri okunur', async () => {
    const secure = memorySecure();
    const storage = createSecureSessionStorage({ secure, legacy: memoryLegacy() });
    const value = bigSession();
    await storage.setItem(KEY, value);
    expect(await storage.getItem(KEY)).toBe(value);
    const n = Number(secure.map.get(`${KEY}__n`));
    expect(n).toBe(Math.ceil(value.length / SECURE_CHUNK_SIZE));
    for (const v of secure.map.values()) expect(v.length).toBeLessThanOrEqual(2048);
  });

  it('kısalan değerin artakalan parçaları silinir', async () => {
    const secure = memorySecure();
    const storage = createSecureSessionStorage({ secure, legacy: memoryLegacy() });
    await storage.setItem(KEY, bigSession());
    await storage.setItem(KEY, '{"user":{"id":"u"}}');
    expect(await storage.getItem(KEY)).toBe('{"user":{"id":"u"}}');
    expect([...secure.map.keys()].sort()).toEqual([`${KEY}__0`, `${KEY}__n`]);
  });

  it('eksik parça: yarım token kullanılmaz, oturum yok sayılır', async () => {
    const secure = memorySecure();
    const storage = createSecureSessionStorage({ secure, legacy: memoryLegacy() });
    await storage.setItem(KEY, bigSession());
    secure.map.delete(`${KEY}__1`);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await storage.getItem(KEY)).toBeNull();
  });

  it('silme bütün parçaları kaldırır', async () => {
    const secure = memorySecure();
    const legacy = memoryLegacy();
    const storage = createSecureSessionStorage({ secure, legacy });
    await storage.setItem(KEY, bigSession());
    await storage.removeItem(KEY);
    expect(secure.map.size).toBe(0);
    expect(await storage.getItem(KEY)).toBeNull();
  });

  it('çok büyük değer reddedilir (sınır)', () => {
    expect(splitIntoChunks('x'.repeat(SECURE_CHUNK_SIZE * MAX_SECURE_CHUNKS)).length).toBe(MAX_SECURE_CHUNKS);
    expect(splitIntoChunks('')).toEqual(['']);
  });

  it('Supabase anahtarı SecureStore anahtar kuralına uyuyor', () => {
    expect(isValidSecureKey(KEY)).toBe(true);
    expect(isValidSecureKey(`${KEY}__12`)).toBe(true);
    expect(isValidSecureKey('a/b')).toBe(false);
  });
});

describe('0.12 → 0.13 taşıma', () => {
  it('kv-store\'daki oturum ilk okumada güvenli depoya taşınır, eskisi silinir', async () => {
    const value = bigSession();
    const secure = memorySecure();
    const legacy = memoryLegacy({ [KEY]: value, 'baska.anahtar': 'kalir' });
    const storage = createSecureSessionStorage({ secure, legacy });

    expect(await storage.getItem(KEY)).toBe(value);
    expect(legacy.map.has(KEY)).toBe(false);
    expect(legacy.map.get('baska.anahtar')).toBe('kalir');
    // İkinci okuma güvenli depodan
    expect(await storage.getItem(KEY)).toBe(value);
  });

  it('açılış kararı taşınan oturumla "giriş yapılmış" (kullanıcı oturumu kaybetmez)', async () => {
    const legacy = memoryLegacy({ [KEY]: bigSession('kullanici-42') });
    const storage = createSecureSessionStorage({ secure: memorySecure(), legacy });
    expect(await decideAccountBoot({ configured: true, sessionKey: KEY, storage })).toEqual({
      kind: 'start',
      user: { userId: 'kullanici-42', email: 'x@example.com' },
    });
  });

  it('hesapsız kullanıcı: iki depoda da yok → null', async () => {
    const storage = createSecureSessionStorage({ secure: memorySecure(), legacy: memoryLegacy() });
    expect(await storage.getItem(KEY)).toBeNull();
  });

  it('taşıma başarısızsa oturum eski depoda kalır ve yine döner', async () => {
    const value = bigSession();
    const legacy = memoryLegacy({ [KEY]: value });
    const storage = createSecureSessionStorage({ secure: memorySecure({ failWrites: true }), legacy });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await storage.getItem(KEY)).toBe(value);
    expect(legacy.map.get(KEY)).toBe(value);
  });
});

describe('bozuk güvenli depo (Keystore hatası)', () => {
  it('yazma başarısız: oturum kaybolmaz, eski depoya yazılır', async () => {
    const legacy = memoryLegacy();
    const storage = createSecureSessionStorage({ secure: memorySecure({ failWrites: true }), legacy });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await storage.setItem(KEY, '{"user":{"id":"u"}}');
    expect(await storage.getItem(KEY)).toBe('{"user":{"id":"u"}}');
  });

  it('güvenli depo yazınca eski düz kopya silinir', async () => {
    const legacy = memoryLegacy({ [KEY]: 'eski' });
    const storage = createSecureSessionStorage({ secure: memorySecure(), legacy });
    await storage.setItem(KEY, 'yeni');
    expect(legacy.map.has(KEY)).toBe(false);
    expect(await storage.getItem(KEY)).toBe('yeni');
  });
});

describe('uygulama bağlantısı', () => {
  const read = (f: string) => readFileSync(path.resolve(__dirname, '..', f), 'utf8');

  it('istemci ve açılış kararı güvenli depoyu kullanıyor, kv-store oturum için kullanılmıyor', () => {
    const supabase = read('src/lib/supabase.ts');
    expect(supabase).toContain('supabaseAuthOptions(appSessionStorage)');
    expect(supabase).not.toContain("from 'expo-sqlite/kv-store'");
    const session = read('src/hooks/useSession.ts');
    expect(session).toContain('storage: appSessionStorage');
    expect(session).not.toContain("from 'expo-sqlite/kv-store'");
  });

  it('iOS: anahtar zinciri başka cihaza / iCloud\'a geçmiyor', () => {
    expect(read('src/lib/sessionStoreNative.ts')).toContain('AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY');
  });
});
