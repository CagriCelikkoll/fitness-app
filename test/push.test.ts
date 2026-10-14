/**
 * Push bildirim (v3.3) — uygulama tarafı: bildirime dokununca açılacak
 * ekran, token kaydı (izin yoksa atla, tazelik, kullanıcı değişince
 * yeniden, çıkışta sil), tercih satırı, izin açıklaması. Ayrıca salon
 * logosu yardımcıları.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  PUSH_REFRESH_MS,
  PUSH_REGISTRATION_KEY,
  createPushRegistrar,
  parsePrefsRow,
  parsePushData,
  pushTarget,
  shouldExplainPushPermission,
  type PushDeviceApi,
} from '@/lib/push';
import { centerSquare, gymInitial, logoObjectPath, logoPathFromUrl } from '@/lib/gymLogo';

describe('bildirime dokununca', () => {
  it('duyuru → duyurular; ders → program ekranında o ders', () => {
    expect(pushTarget({ type: 'announcement', gymId: 'g', announcementId: 'a' })).toEqual({ pathname: '/announcements' });
    expect(pushTarget({ type: 'class-change', gymId: 'g', templateId: 't', date: '2026-10-15' })).toEqual({
      pathname: '/classes',
      params: { date: '2026-10-15', focus: 't:2026-10-15', gymId: 'g' },
    });
  });

  it('bizim olmayan / bozuk veri hiçbir şey açmaz', () => {
    expect(pushTarget(null)).toBeNull();
    expect(pushTarget({ type: 'class-reminder', gymId: 'g', templateId: 't', date: '2026-10-15' })).toBeNull();
    expect(pushTarget({ type: 'class-change', gymId: 'g', templateId: 't', date: 'yarın' })).toBeNull();
    expect(pushTarget({ type: 'announcement', gymId: 'g' })).toBeNull();
    expect(parsePushData('x')).toBeNull();
  });
});

function memoryStore() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (k: string) => data.get(k) ?? null,
    setItem: async (k: string, v: string) => void data.set(k, v),
    removeItem: async (k: string) => void data.delete(k),
  };
}

function fakeClient() {
  const rpc = vi.fn(async () => ({ data: null, error: null }));
  const eq = vi.fn(async () => ({ data: null, error: null }));
  const del = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ delete: del }));
  return { client: { rpc, from } as never, rpc, from, eq };
}

function setup(granted = true, token = 'ExponentPushToken[abc]') {
  let now = 1_000_000;
  const api: PushDeviceApi & { granted: boolean; token: string } = {
    platform: 'android',
    granted,
    token,
    isGranted: vi.fn(async () => api.granted),
    ensureChannels: vi.fn(async () => {}),
    getToken: vi.fn(async () => api.token),
  };
  const store = memoryStore();
  const registrar = createPushRegistrar(api, store, { now: () => now });
  return { api, store, registrar, tick: (ms: number) => (now += ms) };
}

describe('token kaydı', () => {
  it('izin yoksa sessizce atlanır: token alınmaz, ağa çıkılmaz', async () => {
    const { api, registrar } = setup(false);
    const { client, rpc } = fakeClient();
    expect(await registrar.register(client, 'u1')).toBe('no-permission');
    expect(api.getToken).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('kaydeder; aynı gün tekrar ağa çıkmaz; bir gün sonra tazeler', async () => {
    const { api, store, registrar, tick } = setup();
    const { client, rpc } = fakeClient();
    expect(await registrar.register(client, 'u1')).toBe('registered');
    expect(rpc).toHaveBeenCalledWith('register_push_token', { p_token: 'ExponentPushToken[abc]', p_platform: 'android' });
    expect(api.ensureChannels).toHaveBeenCalled();
    expect(JSON.parse(store.data.get(PUSH_REGISTRATION_KEY)!)).toMatchObject({ userId: 'u1', token: 'ExponentPushToken[abc]' });

    tick(60_000);
    expect(await registrar.register(client, 'u1')).toBe('fresh');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(api.getToken).toHaveBeenCalledTimes(1);

    tick(PUSH_REFRESH_MS);
    expect(await registrar.register(client, 'u1')).toBe('registered');
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('başka kullanıcı girince yeniden kaydeder; token değişince force', async () => {
    const { api, registrar } = setup();
    const { client, rpc } = fakeClient();
    await registrar.register(client, 'u1');
    expect(await registrar.register(client, 'u2')).toBe('registered');
    api.token = 'ExponentPushToken[new]';
    expect(await registrar.register(client, 'u2', { force: true })).toBe('registered');
    expect(rpc).toHaveBeenLastCalledWith('register_push_token', { p_token: 'ExponentPushToken[new]', p_platform: 'android' });
  });

  it('sunucu hatası: kayıt yazılmaz, sonra yeniden denenir', async () => {
    const { store, registrar } = setup();
    const onError = vi.fn();
    const failing = { rpc: vi.fn(async () => ({ data: null, error: { message: 'x' } })) } as never;
    const r2 = createPushRegistrar(
      { platform: 'android', isGranted: async () => true, ensureChannels: async () => {}, getToken: async () => 'T' },
      store,
      { onError }
    );
    expect(await r2.register(failing, 'u1')).toBe('failed');
    expect(onError).toHaveBeenCalled();
    expect(store.data.has(PUSH_REGISTRATION_KEY)).toBe(false);
    expect(await registrar.register(null, 'u1')).toBe('failed');
  });

  it('çıkış: sunucudaki token silinir, telefondaki kayıt unutulur; sonraki giriş yeniden kaydeder', async () => {
    const { store, registrar } = setup();
    const { client, rpc, from, eq } = fakeClient();
    await registrar.register(client, 'u1');
    await registrar.unregister(client);
    expect(from).toHaveBeenCalledWith('push_tokens');
    expect(eq).toHaveBeenCalledWith('token', 'ExponentPushToken[abc]');
    expect(store.data.has(PUSH_REGISTRATION_KEY)).toBe(false);
    expect(await registrar.register(client, 'u1')).toBe('registered');
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('kayıt yokken çıkış ağa çıkmaz; hesap silinince yalnızca unutulur', async () => {
    const { store, registrar } = setup();
    const { client, from } = fakeClient();
    await registrar.unregister(client);
    expect(from).not.toHaveBeenCalled();
    store.data.set(PUSH_REGISTRATION_KEY, JSON.stringify({ userId: 'u', token: 't', at: 1 }));
    await registrar.forget();
    expect(store.data.has(PUSH_REGISTRATION_KEY)).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });
});

describe('tercihler ve izin', () => {
  it('satır yoksa ikisi de açık', () => {
    expect(parsePrefsRow(null)).toEqual({ announcements: true, classChanges: true });
    expect(parsePrefsRow({ notify_announcements: false, notify_class_changes: true })).toEqual({
      announcements: false,
      classChanges: true,
    });
  });

  it('açıklama yalnızca izin yok ve hiç sorulmadıysa', () => {
    expect(shouldExplainPushPermission(false, false)).toBe(true);
    expect(shouldExplainPushPermission(false, true)).toBe(false);
    expect(shouldExplainPushPermission(true, false)).toBe(false);
  });
});

describe('salon logosu', () => {
  const GYM = '11111111-1111-1111-1111-111111111111';

  it('ortadan kare', () => {
    expect(centerSquare(1200, 800)).toEqual({ originX: 200, originY: 0, width: 800, height: 800 });
    expect(centerSquare(801, 1200)).toEqual({ originX: 0, originY: 199, width: 801, height: 801 });
    expect(centerSquare(500, 500)).toEqual({ originX: 0, originY: 0, width: 500, height: 500 });
  });

  it('yol ve adresten yol (yalnızca kendi salonu)', () => {
    expect(logoObjectPath(GYM, 'abc')).toBe(`${GYM}/abc.jpg`);
    const url = `https://x.supabase.co/storage/v1/object/public/gym-logos/${GYM}/abc.jpg`;
    expect(logoPathFromUrl(url, GYM)).toBe(`${GYM}/abc.jpg`);
    expect(logoPathFromUrl(`${url}?v=2`, GYM)).toBe(`${GYM}/abc.jpg`);
    expect(logoPathFromUrl(url, '22222222-2222-2222-2222-222222222222')).toBeNull();
    expect(logoPathFromUrl('https://evil.example/a.jpg', GYM)).toBeNull();
    expect(logoPathFromUrl(null, GYM)).toBeNull();
  });

  it('baş harf Türkçe büyük harf', () => {
    expect(gymInitial('istanbul Spor')).toBe('İ');
    expect(gymInitial('  ılgaz')).toBe('I');
    expect(gymInitial('')).toBe('?');
  });
});
