/**
 * Gerçek sunucu — push token'ları, bildirim tercihleri, salon logosu
 * (v3.3, 0009_push.sql). Uygulamanın kendi fonksiyonlarıyla
 * (src/lib/push.ts, gymLogo.ts), her rolün kendi oturumuyla. Gönderimin
 * kendisi (Edge Function → Expo) burada yok; mantığı test/pushNotify.test.ts.
 */

import { randomBytes, randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { deleteMyAccount, fetchMemberships } from '@/lib/account';
import { GYM_LOGO_BUCKET, removeGymLogo, uploadGymLogo } from '@/lib/gymLogo';
import {
  createPushRegistrar,
  fetchNotificationPrefs,
  registerPushToken,
  saveNotificationPrefs,
  type PushDeviceApi,
} from '@/lib/push';

import {
  admin,
  createUser,
  deleteCreatedUsers,
  env,
  memoryStorage,
  serverRowCounts,
  signedIn,
  stopAppClients,
  type AppClient,
  type TestUser,
} from './support';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const joinCode = () =>
  Array.from(randomBytes(8))
    .map((b) => ALPHABET[b % ALPHABET.length])
    .join('');
const pushToken = () => `ExponentPushToken[${randomUUID().replace(/-/g, '').slice(0, 22)}]`;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 0xff, 0xd9]);

type Key = 'owner' | 'other' | 'leaver' | 'adminA' | 'trainerA' | 'adminB';
const u = {} as Record<Key, TestUser>;
const c = {} as Record<Key, AppClient>;
const gyms = {} as Record<'A' | 'B', string>;

async function createGym(name: string): Promise<string> {
  const { data, error } = await admin
    .from('gyms')
    .insert({ name: `INT ${name}`, join_code: joinCode() })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

const tokenRow = async (token: string) =>
  ((await admin.from('push_tokens').select('user_id, platform').eq('token', token)).data ?? [])[0] as
    | { user_id: string; platform: string }
    | undefined;

const logoOf = async (gymId: string) =>
  ((await admin.from('gyms').select('logo_url').eq('id', gymId).single()).data as { logo_url: string | null }).logo_url;

const objectsIn = async (gymId: string) =>
  ((await admin.storage.from(GYM_LOGO_BUCKET).list(gymId)).data ?? []).map((o) => `${gymId}/${o.name}`);

beforeAll(async () => {
  gyms.A = await createGym('Push A');
  gyms.B = await createGym('Push B');
  for (const k of ['owner', 'other', 'leaver', 'adminA', 'trainerA', 'adminB'] as Key[]) {
    u[k] = await createUser(`push-${k}`);
  }
  await admin.from('gym_members').insert([
    { gym_id: gyms.A, user_id: u.owner.id, role: 'member' },
    { gym_id: gyms.A, user_id: u.other.id, role: 'member' },
    { gym_id: gyms.A, user_id: u.leaver.id, role: 'member' },
    { gym_id: gyms.A, user_id: u.adminA.id, role: 'admin' },
    { gym_id: gyms.A, user_id: u.trainerA.id, role: 'trainer' },
    { gym_id: gyms.B, user_id: u.adminB.id, role: 'admin' },
  ]);
  for (const k of Object.keys(u) as Key[]) c[k] = await signedIn(u[k]);
});

afterAll(async () => {
  await stopAppClients();
  for (const g of [gyms.A, gyms.B].filter(Boolean)) {
    const paths = await objectsIn(g);
    if (paths.length > 0) await admin.storage.from(GYM_LOGO_BUCKET).remove(paths);
  }
  await deleteCreatedUsers();
  await admin.from('gyms').delete().in('id', [gyms.A, gyms.B].filter(Boolean));
});

describe('push_tokens: herkes yalnızca kendi token’ı', () => {
  const t = pushToken();

  it('kaydeder ve yalnızca kendisi görür', async () => {
    expect((await registerPushToken(c.owner.client, t, 'android')).error).toBeNull();
    expect(await tokenRow(t)).toEqual({ user_id: u.owner.id, platform: 'android' });
    const own = await c.owner.client.from('push_tokens').select('token');
    expect(own.data?.map((r) => r.token)).toEqual([t]);
    const others = await c.other.client.from('push_tokens').select('token').eq('token', t);
    expect(others.data).toEqual([]);
    const staff = await c.adminA.client.from('push_tokens').select('token').eq('token', t);
    expect(staff.data).toEqual([]);
  });

  it('başkasının token’ını silemez; kendisininkini siler', async () => {
    const del = await c.other.client.from('push_tokens').delete().eq('token', t).select('token');
    expect(del.data ?? []).toEqual([]);
    expect(await tokenRow(t)).toBeDefined();

    const t2 = pushToken();
    await registerPushToken(c.owner.client, t2, 'ios');
    const mine = await c.owner.client.from('push_tokens').delete().eq('token', t2).select('token');
    expect(mine.data?.map((r) => r.token)).toEqual([t2]);
    expect(await tokenRow(t2)).toBeUndefined();
  });

  it('doğrudan ekleme / değiştirme yok (yalnızca register_push_token)', async () => {
    const ins = await c.owner.client.from('push_tokens').insert({ token: pushToken(), user_id: u.other.id, platform: 'android' });
    expect(ins.error).not.toBeNull();
    const upd = await c.owner.client.from('push_tokens').update({ user_id: u.other.id }).eq('token', t).select('token');
    expect(upd.error).not.toBeNull();
    expect((await tokenRow(t))?.user_id).toBe(u.owner.id);
  });

  it('biçim ve platform sunucuda; girişsiz kayıt yok', async () => {
    expect((await registerPushToken(c.owner.client, 'merhaba', 'android')).error?.code).toBe('23514');
    expect((await registerPushToken(c.owner.client, pushToken(), 'windows' as never)).error?.code).toBe('23514');
    const anon = createClient(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    expect((await registerPushToken(anon, pushToken(), 'android')).error).not.toBeNull();
  });

  it('aynı telefonda başka hesap: token yeni hesaba geçer, eskisi görmez', async () => {
    expect((await registerPushToken(c.other.client, t, 'android')).error).toBeNull();
    expect((await tokenRow(t))?.user_id).toBe(u.other.id);
    const own = await c.owner.client.from('push_tokens').select('token').eq('token', t);
    expect(own.data).toEqual([]);
  });

  it('kullanıcı başına en çok 10 cihaz (en son görülenler)', async () => {
    const tokens = Array.from({ length: 12 }, pushToken);
    for (const tk of tokens) await registerPushToken(c.trainerA.client, tk, 'android');
    const { data } = await admin.from('push_tokens').select('token').eq('user_id', u.trainerA.id);
    expect(data?.map((r) => r.token).sort()).toEqual(tokens.slice(2).sort());
  });

  it('çıkıştan önce uygulama token’ı siler (createPushRegistrar)', async () => {
    const tk = pushToken();
    const api: PushDeviceApi = {
      platform: 'android',
      isGranted: async () => true,
      ensureChannels: async () => {},
      getToken: async () => tk,
    };
    const registrar = createPushRegistrar(api, memoryStorage());
    expect(await registrar.register(c.adminB.client, u.adminB.id)).toBe('registered');
    expect((await tokenRow(tk))?.user_id).toBe(u.adminB.id);
    await registrar.unregister(c.adminB.client);
    expect(await tokenRow(tk)).toBeUndefined();
  });
});

describe('bildirim tercihleri', () => {
  it('satır yokken ikisi de açık; kaydeder ve günceller', async () => {
    expect(await fetchNotificationPrefs(c.owner.client, u.owner.id)).toEqual({
      ok: true,
      value: { announcements: true, classChanges: true },
    });
    expect(await saveNotificationPrefs(c.owner.client, u.owner.id, { announcements: false, classChanges: true })).toEqual({
      ok: true,
      value: { announcements: false, classChanges: true },
    });
    expect(await saveNotificationPrefs(c.owner.client, u.owner.id, { announcements: false, classChanges: false })).toMatchObject({
      ok: true,
      value: { classChanges: false },
    });
    const { data } = await admin.from('notification_prefs').select('*').eq('user_id', u.owner.id).single();
    expect(data).toMatchObject({ notify_announcements: false, notify_class_changes: false });
  });

  it('başkası okuyamaz ve yazamaz (salonun yöneticisi de)', async () => {
    const seen = await c.adminA.client.from('notification_prefs').select('*').eq('user_id', u.owner.id);
    expect(seen.data).toEqual([]);
    const write = await saveNotificationPrefs(c.adminA.client, u.owner.id, { announcements: true, classChanges: true });
    expect(write.ok).toBe(false);
    const upd = await c.adminA.client
      .from('notification_prefs')
      .update({ notify_announcements: true })
      .eq('user_id', u.owner.id)
      .select('user_id');
    expect(upd.data ?? []).toEqual([]);
    const { data } = await admin.from('notification_prefs').select('*').eq('user_id', u.owner.id).single();
    expect(data).toMatchObject({ notify_announcements: false, notify_class_changes: false });
  });
});

describe('hesap silinince token ve tercih gider', () => {
  it('cascade', async () => {
    await registerPushToken(c.leaver.client, pushToken(), 'android');
    await saveNotificationPrefs(c.leaver.client, u.leaver.id, { announcements: false, classChanges: true });
    const before = await serverRowCounts(u.leaver.id);
    expect(before.push_tokens).toBe(1);
    expect(before.notification_prefs).toBe(1);
    expect((await deleteMyAccount(c.leaver.client)).ok).toBe(true);
    const after = await serverRowCounts(u.leaver.id);
    expect(after.push_tokens).toBe(0);
    expect(after.notification_prefs).toBe(0);
  });
});

describe('Storage: gym-logos', () => {
  const upload = (who: Key, path: string, body: Uint8Array = JPEG, contentType = 'image/jpeg') =>
    c[who].client.storage.from(GYM_LOGO_BUCKET).upload(path, body, { contentType });

  it('yalnızca o salonun yöneticisi yazar; okuma herkese açık', async () => {
    const path = `${gyms.A}/elle.jpg`;
    expect((await upload('adminA', path)).error).toBeNull();
    const url = admin.storage.from(GYM_LOGO_BUCKET).getPublicUrl(path).data.publicUrl;
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG);

    expect((await upload('trainerA', `${gyms.A}/hoca.jpg`)).error).not.toBeNull();
    expect((await upload('owner', `${gyms.A}/uye.jpg`)).error).not.toBeNull();
    expect((await upload('adminB', `${gyms.A}/baska.jpg`)).error).not.toBeNull();
    expect((await upload('adminB', `${gyms.B}/kendi.jpg`)).error).toBeNull();
    expect(await objectsIn(gyms.A)).toEqual([path]);
  });

  it('başkası silemez / üstüne yazamaz', async () => {
    const path = `${gyms.A}/elle.jpg`;
    await c.trainerA.client.storage.from(GYM_LOGO_BUCKET).remove([path]);
    await c.adminB.client.storage.from(GYM_LOGO_BUCKET).remove([path]);
    expect(await objectsIn(gyms.A)).toEqual([path]);
    const over = await c.adminB.client.storage
      .from(GYM_LOGO_BUCKET)
      .upload(path, new Uint8Array([1, 2, 3]), { contentType: 'image/jpeg', upsert: true });
    expect(over.error).not.toBeNull();
  });

  it('yol, tür ve boyut sınırı', async () => {
    expect((await upload('adminA', `${gyms.A}/alt/klasor.jpg`)).error).not.toBeNull();
    expect((await upload('adminA', 'kok.jpg')).error).not.toBeNull();
    expect((await upload('adminA', `${gyms.A}/yazi.jpg`, JPEG, 'text/plain')).error).not.toBeNull();
    expect((await upload('adminA', `${gyms.A}/buyuk.jpg`, new Uint8Array(600 * 1024))).error).not.toBeNull();
  });
});

describe('logo_url', () => {
  it('yönetici yükler, değiştirir, kaldırır; üyeler logoyu görür; eski dosya silinir', async () => {
    const first = await uploadGymLogo(c.adminA.client, gyms.A, JPEG, randomUUID(), null);
    if (!first.ok) throw new Error(first.error.kind);
    expect(await logoOf(gyms.A)).toBe(first.value);

    const seen = await fetchMemberships(c.owner.client, u.owner.id);
    expect(seen.ok && seen.value.find((m) => m.gymId === gyms.A)?.logoUrl).toBe(first.value);

    const second = await uploadGymLogo(c.adminA.client, gyms.A, JPEG, randomUUID(), first.value);
    if (!second.ok) throw new Error(second.error.kind);
    expect(await logoOf(gyms.A)).toBe(second.value);
    const objects = await objectsIn(gyms.A);
    expect(objects).toContain(second.value.split(`/${GYM_LOGO_BUCKET}/`)[1]);
    expect(objects).not.toContain(first.value.split(`/${GYM_LOGO_BUCKET}/`)[1]);

    expect(await removeGymLogo(c.adminA.client, gyms.A, second.value)).toEqual({ ok: true, value: null });
    expect(await logoOf(gyms.A)).toBeNull();
    expect(await objectsIn(gyms.A)).not.toContain(second.value.split(`/${GYM_LOGO_BUCKET}/`)[1]);
  });

  it('hoca / üye / başka salonun yöneticisi değiştiremez', async () => {
    const valid = `${env.url}/storage/v1/object/public/${GYM_LOGO_BUCKET}/${gyms.A}/elle.jpg`;
    for (const who of ['trainerA', 'owner', 'adminB'] as Key[]) {
      const r = await c[who].client.from('gyms').update({ logo_url: valid }).eq('id', gyms.A).select('id');
      expect(r.data ?? []).toEqual([]);
    }
    expect(await logoOf(gyms.A)).toBeNull();
    const viaApp = await uploadGymLogo(c.trainerA.client, gyms.A, JPEG, randomUUID(), null);
    expect(viaApp.ok).toBe(false);
  });

  it('yalnızca kendi salonunun klasörü; dış adres yok', async () => {
    const set = (url: string) => c.adminA.client.from('gyms').update({ logo_url: url }).eq('id', gyms.A).select('id');
    const base = `${env.url}/storage/v1/object/public/${GYM_LOGO_BUCKET}`;
    expect((await set(`${base}/${gyms.B}/kendi.jpg`)).error?.code).toBe('23514');
    expect((await set(`https://evil.example/storage/v1/object/public/${GYM_LOGO_BUCKET}/${gyms.A}/x.jpg`)).error?.code).toBe('23514');
    expect((await set(`${base}/${gyms.A}/x.gif`)).error?.code).toBe('23514');
    expect((await set(`${base}/${gyms.A}/elle.jpg`)).error).toBeNull();
    expect(await logoOf(gyms.A)).toBe(`${base}/${gyms.A}/elle.jpg`);
  });
});
