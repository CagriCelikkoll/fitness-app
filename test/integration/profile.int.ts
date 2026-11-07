/**
 * Gerçek sunucu — ad alanı (supabase/migrations/0007_display_name.sql;
 * v3.7 kuralı 0014_auth_hardening.sql, pentest DNC-04).
 * Uygulamanın kendi fonksiyonlarıyla (src/lib/profile.ts), her rolün
 * kendi oturumuyla. Salonlar ve üyelikler service role ile tohumlanıyor.
 */

import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAnnouncement, fetchAnnouncements } from '@/lib/announcements';
import { fetchMyDisplayName, updateDisplayName } from '@/lib/profile';

import {
  admin,
  createUser,
  deleteCreatedUsers,
  signedIn,
  stopAppClients,
  testEmail,
  track,
  type AppClient,
  type TestUser,
} from './support';

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

type Key = 'admin' | 'trainer' | 'member' | 'member2' | 'trainerB';
const u = {} as Record<Key, TestUser>;
const c = {} as Record<Key, AppClient>;
let gymA: string;
let gymB: string;

const NAMES: Record<Key, string> = {
  admin: 'Yönetici Yasemin',
  trainer: 'Hoca Hakan',
  member: 'Üye Ayşe',
  member2: 'Üye Mehmet',
  trainerB: 'B Hocası',
};

/** `who` kişisinin `target` adını görüp göremediği (RLS) */
async function seesName(who: Key, target: Key): Promise<string | null> {
  const { data, error } = await c[who].client.from('profiles').select('display_name').eq('id', u[target].id);
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as { display_name: string | null } | undefined)?.display_name ?? null;
}

beforeAll(async () => {
  gymA = await createGym('Ad A');
  gymB = await createGym('Ad B');
  for (const k of Object.keys(NAMES) as Key[]) u[k] = await createUser(`ad-${k}`);
  await admin.from('gym_members').insert([
    { gym_id: gymA, user_id: u.admin.id, role: 'admin' },
    { gym_id: gymA, user_id: u.trainer.id, role: 'trainer' },
    { gym_id: gymA, user_id: u.member.id, role: 'member' },
    { gym_id: gymA, user_id: u.member2.id, role: 'member' },
    { gym_id: gymB, user_id: u.trainerB.id, role: 'trainer' },
  ]);
  for (const k of Object.keys(u) as Key[]) c[k] = await signedIn(u[k]);
  for (const k of Object.keys(u) as Key[]) {
    const r = await updateDisplayName(c[k].client, u[k].id, NAMES[k]);
    if (!r.ok) throw new Error(`${k} adını yazamadı: ${r.error.kind}`);
  }
});

afterAll(async () => {
  await stopAppClients();
  await deleteCreatedUsers();
  await admin.from('gyms').delete().in('id', [gymA, gymB].filter(Boolean));
});

describe('Ad: kim görür', () => {
  it('kişi kendi adını görür ve değiştirir', async () => {
    expect(await fetchMyDisplayName(c.member.client, u.member.id)).toEqual({ ok: true, value: 'Üye Ayşe' });
    expect(await updateDisplayName(c.member.client, u.member.id, '  Ayşe   Yılmaz ')).toEqual({
      ok: true,
      value: 'Ayşe Yılmaz',
    });
    await updateDisplayName(c.member.client, u.member.id, NAMES.member);
  });

  it('üye başka üyenin adını göremez (aynı salonda da)', async () => {
    expect(await seesName('member', 'member2')).toBeNull();
    expect(await seesName('member2', 'member')).toBeNull();
    // Hoca ve yöneticinin profilini de doğrudan göremez
    expect(await seesName('member', 'trainer')).toBeNull();
    expect(await seesName('member', 'admin')).toBeNull();
  });

  it('salonun hocası ve yöneticisi üyelerin adını görür', async () => {
    expect(await seesName('trainer', 'member')).toBe('Üye Ayşe');
    expect(await seesName('admin', 'member2')).toBe('Üye Mehmet');
  });

  it('başka salonun hocası göremez', async () => {
    expect(await seesName('trainerB', 'member')).toBeNull();
    expect(await seesName('trainerB', 'trainer')).toBeNull();
  });

  it('başkasının adı değiştirilemez', async () => {
    expect(await updateDisplayName(c.admin.client, u.member.id, 'Değişti')).toMatchObject({
      ok: false,
      error: { kind: 'forbidden' },
    });
    const { data } = await admin.from('profiles').select('display_name').eq('id', u.member.id).single();
    expect(data).toEqual({ display_name: 'Üye Ayşe' });
  });
});

describe('Ad: duyuru yazarı', () => {
  it('salonun üyesi duyuru yazarının adını görür; başka salon görmez', async () => {
    const r = await createAnnouncement(c.trainer.client, gymA, { title: 'Yazar adı', body: 'x', pinned: false });
    if (!r.ok) throw new Error(r.error.kind);
    const list = await fetchAnnouncements(c.member.client);
    expect(list.ok && list.value.find((a) => a.id === r.value.id)?.authorName).toBe('Hoca Hakan');

    const rpc = await c.trainerB.client.rpc('announcement_author_names');
    expect((rpc.data as { announcement_id: string }[]).some((x) => x.announcement_id === r.value.id)).toBe(false);
    // RPC yalnızca yazarların adını verir: üyelerin adı hiç çıkmaz
    const own = await c.member.client.rpc('announcement_author_names');
    expect((own.data as { author_name: string }[]).map((x) => x.author_name)).not.toContain('Üye Mehmet');
  });
});

describe('Ad: sunucu kuralları', () => {
  it('uzunluk 1–40, baş / son boşluk ve satır sonu sunucuda reddedilir (v3.7)', async () => {
    const raw = (display_name: string | null) =>
      c.member2.client.from('profiles').update({ display_name }).eq('id', u.member2.id).select('id');
    expect((await raw('A')).error).toBeNull();
    expect((await raw('x'.repeat(41))).error?.code).toBe('23514');
    expect((await raw(' Mehmet')).error?.code).toBe('23514');
    expect((await raw('Meh\nmet')).error?.code).toBe('23514');
    expect((await raw('x'.repeat(40))).error).toBeNull();
    expect((await raw(null)).error).toBeNull(); // ad silinebilir
    expect(await updateDisplayName(c.member2.client, u.member2.id, 'x'.repeat(41))).toMatchObject({
      ok: false,
      error: { kind: 'invalid_input' },
    });
  });

  it('DNC-04: geçerli ad kabul (Türkçe dahil), <script> ve işaretler reddedilir', async () => {
    const raw = (display_name: string) =>
      c.member2.client.from('profiles').update({ display_name }).eq('id', u.member2.id).select('display_name');
    for (const ok of ['Çağrı Şükrü Öğüt', 'İsmail Işık', "O'Brien", 'Ayşe K.', 'Ali-Veli 2']) {
      const r = await raw(ok);
      expect(r.error, ok).toBeNull();
      expect(r.data, ok).toEqual([{ display_name: ok }]);
    }
    for (const bad of ['<script>', 'Ali <b>', 'a>b', 'Ali💪', 'Ali@Veli', 'Ali;']) {
      expect((await raw(bad)).error?.code, bad).toBe('23514');
    }
    // Uygulamanın kendi fonksiyonu: <script> → anlaşılır hata türü, ad değişmez
    expect(await updateDisplayName(c.member2.client, u.member2.id, '<script>')).toMatchObject({
      ok: false,
      error: { kind: 'invalid_input' },
    });
    expect(await fetchMyDisplayName(c.member2.client, u.member2.id)).toEqual({ ok: true, value: 'Ali-Veli 2' });
  });

  it('kayıtta gelen kullanıcı verisindeki ad profile YAZILMAZ (v3.7; kayıt bozulmaz)', async () => {
    const signUp = async (name: unknown) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: testEmail('kayit-ad'),
        email_confirm: true,
        user_metadata: { display_name: name },
      });
      if (error || !data.user) throw new Error(error?.message);
      track(data.user.id);
      const { data: p } = await admin.from('profiles').select('display_name').eq('id', data.user.id).single();
      return (p as { display_name: string | null }).display_name;
    };
    expect(await signUp('Zeynep Kaya')).toBeNull();
    expect(await signUp('<script>')).toBeNull();
    expect(await signUp(42)).toBeNull();
  });
});
