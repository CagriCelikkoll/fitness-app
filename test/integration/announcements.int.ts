/**
 * Gerçek sunucu — salon duyuruları (v3.2b,
 * supabase/migrations/0004_announcements.sql). Uygulamanın kendi
 * fonksiyonlarıyla (src/lib/announcements.ts), her rolün kendi
 * oturumuyla. Salonlar ve üyelikler service role ile tohumlanıyor.
 */

import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { deleteMyAccount, leaveGym } from '@/lib/account';
import {
  createAnnouncement,
  deleteAnnouncement,
  fetchAnnouncements,
  updateAnnouncement,
  type Announcement,
} from '@/lib/announcements';

import { admin, createUser, deleteCreatedUsers, signedIn, stopAppClients, type AppClient, type TestUser } from './support';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const joinCode = () =>
  Array.from(randomBytes(8))
    .map((b) => ALPHABET[b % ALPHABET.length])
    .join('');

async function createGym(name: string): Promise<string> {
  const { data, error } = await admin
    .from('gyms')
    .insert({ name: `INT ${name}`, join_code: joinCode() })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

type Key = 'admin' | 'trainer1' | 'trainer2' | 'member' | 'leaver' | 'memberB';
const u = {} as Record<Key, TestUser>;
const c = {} as Record<Key, AppClient>;
let gymA: string;
let gymB: string;
let gymBNotice: string;

const draft = (title: string, pinned = false) => ({ title, body: `${title} metni`, pinned });

async function create(who: Key, title: string, pinned = false): Promise<Announcement> {
  const r = await createAnnouncement(c[who].client, gymA, draft(title, pinned));
  if (!r.ok) throw new Error(`${who} duyuru yazamadı: ${r.error.kind}`);
  return r.value;
}

const visibleIds = async (who: Key) => {
  const r = await fetchAnnouncements(c[who].client);
  if (!r.ok) throw new Error(r.error.kind);
  return r.value.map((a) => a.id);
};

const exists = async (id: string) =>
  ((await admin.from('announcements').select('id').eq('id', id)).data ?? []).length > 0;

beforeAll(async () => {
  gymA = await createGym('Duyuru A');
  gymB = await createGym('Duyuru B');
  for (const k of ['admin', 'trainer1', 'trainer2', 'member', 'leaver', 'memberB'] as Key[]) {
    u[k] = await createUser(`duyuru-${k}`);
  }
  await admin.from('gym_members').insert([
    { gym_id: gymA, user_id: u.admin.id, role: 'admin' },
    { gym_id: gymA, user_id: u.trainer1.id, role: 'trainer' },
    { gym_id: gymA, user_id: u.trainer2.id, role: 'trainer' },
    { gym_id: gymA, user_id: u.member.id, role: 'member' },
    { gym_id: gymA, user_id: u.leaver.id, role: 'member' },
    { gym_id: gymB, user_id: u.memberB.id, role: 'admin' },
  ]);
  const { data } = await admin
    .from('announcements')
    .insert({ gym_id: gymB, author_id: u.memberB.id, title: 'B salonu', body: 'Yalnızca B' })
    .select('id')
    .single();
  gymBNotice = data!.id as string;
  for (const k of Object.keys(u) as Key[]) c[k] = await signedIn(u[k]);
});

afterAll(async () => {
  await stopAppClients();
  await deleteCreatedUsers();
  await admin.from('gyms').delete().in('id', [gymA, gymB].filter(Boolean));
});

describe('Duyurular: okuma ve yazma', () => {
  it('üye okuyabilir, yazamaz', async () => {
    const a = await create('trainer1', 'Pazartesi kapalıyız');
    expect(await visibleIds('member')).toContain(a.id);
    expect(await createAnnouncement(c.member.client, gymA, draft('Üye yazdı'))).toMatchObject({
      ok: false,
      error: { kind: 'forbidden' },
    });
  });

  it('hoca yazar, kendi duyurusunu düzenler ve siler; başka hocanınkini düzenleyemez, silemez', async () => {
    const a = await create('trainer1', 'Hoca 1 duyurusu');
    expect(a.authorId).toBe(u.trainer1.id);
    expect(await updateAnnouncement(c.trainer1.client, a.id, { title: 'Düzenlendi' })).toMatchObject({
      ok: true,
      value: { title: 'Düzenlendi' },
    });
    expect(await updateAnnouncement(c.trainer2.client, a.id, { title: 'Hoca 2' })).toMatchObject({
      ok: false,
      error: { kind: 'forbidden' },
    });
    expect(await deleteAnnouncement(c.trainer2.client, a.id)).toMatchObject({ ok: false, error: { kind: 'forbidden' } });
    expect(await exists(a.id)).toBe(true);
    expect(await deleteAnnouncement(c.trainer1.client, a.id)).toEqual({ ok: true, value: null });
    expect(await exists(a.id)).toBe(false);
  });

  it('yönetici her duyuruyu düzenler, sabitler ve siler; hoca sabitleyemez ve sabitlemeyi kaldıramaz', async () => {
    expect(await createAnnouncement(c.trainer1.client, gymA, draft('Sabitli hoca', true))).toMatchObject({
      ok: false,
      error: { kind: 'pin_admin_only' },
    });
    const a = await create('trainer1', 'Yönetici sabitleyecek');
    expect(await updateAnnouncement(c.trainer1.client, a.id, { pinned: true })).toMatchObject({
      ok: false,
      error: { kind: 'pin_admin_only' },
    });
    expect(await updateAnnouncement(c.admin.client, a.id, { pinned: true, title: 'Yönetici düzenledi' })).toMatchObject({
      ok: true,
      value: { pinned: true, title: 'Yönetici düzenledi' },
    });
    expect(await updateAnnouncement(c.trainer1.client, a.id, { pinned: false })).toMatchObject({
      ok: false,
      error: { kind: 'pin_admin_only' },
    });
    // Yazar sabitlemeye dokunmadan metnini yine düzenleyebilir
    expect(await updateAnnouncement(c.trainer1.client, a.id, { body: 'Yeni metin' })).toMatchObject({
      ok: true,
      value: { pinned: true, body: 'Yeni metin' },
    });
    const own = await createAnnouncement(c.admin.client, gymA, draft('Yönetici kendi sabitli', true));
    expect(own).toMatchObject({ ok: true, value: { pinned: true } });
    expect(await deleteAnnouncement(c.admin.client, a.id)).toEqual({ ok: true, value: null });
  });

  it('sabitlenmiş duyuru listede üstte, sonra yeniden eskiye', async () => {
    const r = await fetchAnnouncements(c.member.client);
    if (!r.ok) throw new Error(r.error.kind);
    const pins = r.value.map((a) => a.pinned);
    expect(pins).toEqual([...pins].sort((x, y) => Number(y) - Number(x)));
    const unpinned = r.value.filter((a) => !a.pinned).map((a) => Date.parse(a.createdAt));
    expect(unpinned).toEqual([...unpinned].sort((x, y) => y - x));
  });
});

describe('Duyurular: salon sınırları', () => {
  it('başka salonun üyesi hiçbir duyuruyu göremez, değiştiremez', async () => {
    const a = await create('trainer1', 'Yalnızca A');
    const seenByB = await visibleIds('memberB');
    expect(seenByB).toEqual([gymBNotice]);
    expect(await updateAnnouncement(c.memberB.client, a.id, { title: 'B değiştirdi' })).toMatchObject({
      ok: false,
      error: { kind: 'forbidden' },
    });
    expect(await deleteAnnouncement(c.memberB.client, a.id)).toMatchObject({ ok: false });
    expect(await createAnnouncement(c.memberB.client, gymA, draft('B, A’ya yazdı'))).toMatchObject({ ok: false });

    // A'nın yöneticisi de B'ninkini görmez, silemez
    expect(await visibleIds('admin')).not.toContain(gymBNotice);
    expect(await deleteAnnouncement(c.admin.client, gymBNotice)).toMatchObject({ ok: false });
    expect(await exists(gymBNotice)).toBe(true);
  });

  it('salondan ayrılan duyuruları görmeyi bırakır', async () => {
    const a = await create('trainer1', 'Ayrılan görmeyecek');
    expect(await visibleIds('leaver')).toContain(a.id);
    expect(await leaveGym(c.leaver.client, { gymId: gymA, role: 'member' }, u.leaver.id)).toMatchObject({ ok: true });
    expect(await visibleIds('leaver')).toEqual([]);
  });
});

describe('Duyurular: sunucu kuralları', () => {
  it('başlık 1–80, metin 1–1000 karakter (istemci denetimi atlansa da)', async () => {
    const insert = (title: string, body: string) =>
      c.trainer1.client.from('announcements').insert({ gym_id: gymA, title, body }).select('id');
    expect((await insert('x'.repeat(81), 'metin')).error?.code).toBe('23514');
    expect((await insert('başlık', 'y'.repeat(1001))).error?.code).toBe('23514');
    expect((await insert('   ', 'metin')).error?.code).toBe('23514');
    expect((await insert('başlık', '')).error?.code).toBe('23514');
    expect((await insert('x'.repeat(80), 'y'.repeat(1000))).error).toBeNull();
    // Emoji tek karakter sayılıyor (istemcideki sayaç da öyle)
    expect((await insert('💪'.repeat(80), 'metin')).error).toBeNull();
    expect(
      await createAnnouncement(c.trainer1.client, gymA, { title: 'x'.repeat(81), body: 'a', pinned: false })
    ).toMatchObject({ ok: false, error: { kind: 'invalid_input' } });
  });

  it('yazar, salon ve tarih istemciden değiştirilemez; yazar her zaman oturumdaki kişi', async () => {
    const forged = await c.trainer1.client
      .from('announcements')
      .insert({ gym_id: gymA, title: 'Sahte yazar', body: 'x', author_id: u.admin.id })
      .select('author_id');
    expect(forged.error).not.toBeNull(); // author_id sütununa yazma yetkisi yok

    const a = await create('trainer1', 'Taşınamaz');
    const move = await c.trainer1.client.from('announcements').update({ gym_id: gymB }).eq('id', a.id).select('id');
    expect(move.error).not.toBeNull();
    const backdate = await c.trainer1.client
      .from('announcements')
      .update({ created_at: '2020-01-01T00:00:00Z' })
      .eq('id', a.id)
      .select('id');
    expect(backdate.error).not.toBeNull();

    const { data } = await admin.from('announcements').select('gym_id, author_id, created_at').eq('id', a.id).single();
    expect(data).toMatchObject({ gym_id: gymA, author_id: u.trainer1.id });
    expect(Date.parse(data!.created_at as string)).toBeGreaterThan(Date.parse('2026-01-01'));
  });

  it('yazar hesabını uygulamadan silince duyurusu salonda kalıyor (yazarsız)', async () => {
    const a = await create('trainer2', 'Yazarı silinecek');
    expect(await deleteMyAccount(c.trainer2.client)).toEqual({ ok: true, value: null });
    expect((await admin.auth.admin.getUserById(u.trainer2.id)).data.user).toBeNull();
    const { data } = await admin.from('announcements').select('author_id').eq('id', a.id).single();
    expect(data).toEqual({ author_id: null });
    expect(await visibleIds('member')).toContain(a.id);
  });
});
