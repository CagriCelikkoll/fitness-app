/**
 * Gerçek sunucu — salon girişi, ziyaretler, doluluk (v3.6c,
 * 0012_visits.sql). Uygulamanın kendi fonksiyonlarıyla
 * (src/lib/visits.ts), her rolün kendi oturumuyla. Saat gerektiren
 * durumlar (3 / 4 saat) service role ile eski tarihli satır yazarak.
 */

import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TRAINER_CONSENT_VERSION, endTrainerLink } from '@/lib/trainers';
import {
  checkIn,
  checkOut,
  fetchCheckinKey,
  fetchOccupancy,
  fetchVisits,
  linkWorkoutToVisit,
  manualVisit,
  rotateCheckinKey,
  type Visit,
} from '@/lib/visits';

import { admin, createUser, deleteCreatedUsers, signedIn, stopAppClients, type AppClient, type TestUser } from './support';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const joinCode = () =>
  Array.from(randomBytes(8))
    .map((b) => ALPHABET[b % ALPHABET.length])
    .join('');

type Key = 'admin' | 'trainer' | 'student' | 'member' | 'outsider' | 'stranger';
const KEYS: Key[] = ['admin', 'trainer', 'student', 'member', 'outsider', 'stranger'];
const u = {} as Record<Key, TestUser>;
const c = {} as Record<Key, AppClient>;
const gyms = {} as Record<'A' | 'B', string>;
const keys = {} as Record<'A' | 'B', string>;
let linkId: string;

const HOUR = 3_600_000;
const SINCE = new Date(Date.now() - 60 * 24 * HOUR).toISOString();

async function createGym(name: string) {
  const { data, error } = await admin.from('gyms').insert({ name: `INT ${name}`, join_code: joinCode() }).select('id').single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

function value<T>(r: { ok: true; value: T } | { ok: false; error: { kind: string } }): T {
  if (!r.ok) throw new Error(r.error.kind);
  return r.value;
}

async function visible(who: Key, gymId = gyms.A): Promise<Visit[]> {
  return value(await fetchVisits(c[who].client, { gymId, sinceIso: SINCE }));
}

async function serverVisit(id: string) {
  const { data, error } = await admin.from('gym_visits').select('*').eq('id', id).single();
  if (error) throw new Error(error.message);
  return data as Record<string, unknown>;
}

/** Service role ile geçmiş tarihli açık ziyaret */
async function oldOpenVisit(userId: string, hoursAgo: number): Promise<string> {
  const { data, error } = await admin
    .from('gym_visits')
    .insert({ gym_id: gyms.A, user_id: userId, checked_in_at: new Date(Date.now() - hoursAgo * HOUR).toISOString() })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

beforeAll(async () => {
  gyms.A = await createGym('Giriş A');
  gyms.B = await createGym('Giriş B');
  for (const k of KEYS) u[k] = await createUser(`visit-${k}`);
  await admin.from('gym_members').insert([
    { gym_id: gyms.A, user_id: u.admin.id, role: 'admin' },
    { gym_id: gyms.A, user_id: u.trainer.id, role: 'trainer' },
    { gym_id: gyms.A, user_id: u.student.id, role: 'member' },
    { gym_id: gyms.A, user_id: u.member.id, role: 'member' },
    { gym_id: gyms.B, user_id: u.outsider.id, role: 'admin' },
  ]);
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from('trainer_students')
    .insert({
      gym_id: gyms.A,
      trainer_id: u.trainer.id,
      student_id: u.student.id,
      status: 'active',
      responded_at: now,
      consent_version: TRAINER_CONSENT_VERSION,
      consented_at: now,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  linkId = data.id as string;
  for (const k of KEYS) c[k] = await signedIn(u[k]);
});

afterAll(async () => {
  await stopAppClients();
  await deleteCreatedUsers();
  await admin.from('gyms').delete().in('id', [gyms.A, gyms.B].filter(Boolean));
});

describe('salon girişi', () => {
  let studentVisit: string;
  let memberVisit: string;

  it('yönetici anahtarı alır (yoksa oluşur, ikinci çağrıda aynı); başkası alamaz; tablo okunamaz', async () => {
    keys.A = value(await fetchCheckinKey(c.admin.client, gyms.A)).secret;
    expect(keys.A).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(value(await fetchCheckinKey(c.admin.client, gyms.A)).secret).toBe(keys.A);
    keys.B = value(await fetchCheckinKey(c.outsider.client, gyms.B)).secret;
    expect(keys.B).not.toBe(keys.A);

    for (const who of ['trainer', 'member', 'outsider', 'stranger'] as const) {
      const r = await fetchCheckinKey(c[who].client, gyms.A);
      expect(!r.ok && r.error.kind, who).toBe('forbidden');
      const rot = await rotateCheckinKey(c[who].client, gyms.A);
      expect(!rot.ok && rot.error.kind, who).toBe('forbidden');
    }
    const { data, error } = await c.admin.client.from('gym_checkin_keys').select('secret');
    expect(error != null || (data ?? []).length === 0).toBe(true);
  });

  it('üye doğru anahtarla giriş yapar; 3 saat içinde ikinci okutma yeni ziyaret açmaz', async () => {
    const first = value(await checkIn(c.student.client, gyms.A, keys.A));
    expect(first.reused).toBe(false);
    studentVisit = first.id;
    const again = value(await checkIn(c.student.client, gyms.A, keys.A));
    expect(again).toMatchObject({ id: first.id, reused: true });
    expect(await serverVisit(first.id)).toMatchObject({
      user_id: u.student.id,
      source: 'qr',
      checked_out_at: null,
      created_by: u.student.id,
    });
    memberVisit = value(await checkIn(c.member.client, gyms.A, keys.A)).id;
  });

  it('yanlış anahtar, başka salonun anahtarı, üye olmayan reddedilir', async () => {
    const wrong = await checkIn(c.member.client, gyms.A, 'YanlisAnahtarYanlis12');
    expect(!wrong.ok && wrong.error.kind).toBe('checkin_key_invalid');
    const otherKey = await checkIn(c.member.client, gyms.A, keys.B);
    expect(!otherKey.ok && otherKey.error.kind).toBe('checkin_key_invalid');
    const otherGym = await checkIn(c.member.client, gyms.B, keys.B);
    expect(!otherGym.ok && otherGym.error.kind).toBe('checkin_not_member');
    for (const who of ['stranger', 'outsider'] as const) {
      const r = await checkIn(c[who].client, gyms.A, keys.A);
      expect(!r.ok && r.error.kind, who).toBe('checkin_not_member');
    }
  });

  it('üye doluluk sayısını görür ama kimin olduğunu göremez; üye olmayan sayıyı da göremez', async () => {
    expect(value(await fetchOccupancy(c.member.client, gyms.A))).toBe(2);
    expect((await visible('member')).map((v) => v.userId)).toEqual([u.member.id]);
    const r = await fetchOccupancy(c.stranger.client, gyms.A);
    expect(!r.ok && r.error.kind).toBe('forbidden');
    const o = await fetchOccupancy(c.outsider.client, gyms.A);
    expect(!o.ok && o.error.kind).toBe('forbidden');
  });

  it('hoca yalnızca aktif öğrencisinin ziyaretini görür; yönetici hepsini; başka salon hiçbirini', async () => {
    expect((await visible('trainer')).map((v) => v.userId)).toEqual([u.student.id]);
    expect((await visible('admin')).map((v) => v.userId).sort()).toEqual([u.member.id, u.student.id].sort());
    expect(await visible('outsider')).toEqual([]);
    expect(await visible('stranger')).toEqual([]);
  });

  it('başkasının ziyaretini kapatamaz / bağlayamaz; sahibi kapatır, ikinci kez değişmez', async () => {
    for (const who of ['member', 'trainer', 'admin'] as const) {
      const r = await checkOut(c[who].client, studentVisit);
      expect(!r.ok && r.error.kind, who).toBe('forbidden');
      const l = await linkWorkoutToVisit(c[who].client, studentVisit, 'w1', new Date().toISOString());
      expect(!l.ok && l.error.kind, who).toBe('forbidden');
    }
    expect(value(await checkOut(c.member.client, memberVisit))).toBe(true);
    const out = (await serverVisit(memberVisit)).checked_out_at;
    expect(out).not.toBeNull();
    expect(value(await checkOut(c.member.client, memberVisit))).toBe(false);
    expect((await serverVisit(memberVisit)).checked_out_at).toBe(out);
    expect(value(await fetchOccupancy(c.member.client, gyms.A))).toBe(1);
  });

  it('antrenman açık ziyaretin içinde bittiyse çıkış olur; dışındaysa olmaz', async () => {
    const before = await linkWorkoutToVisit(
      c.student.client,
      studentVisit,
      'oturum-1',
      new Date(Date.now() - 5 * HOUR).toISOString()
    );
    expect(value(before)).toBe(false);
    const future = await linkWorkoutToVisit(c.student.client, studentVisit, 'oturum-1', new Date(Date.now() + HOUR).toISOString());
    expect(value(future)).toBe(false);
    const endedAt = new Date().toISOString();
    expect(value(await linkWorkoutToVisit(c.student.client, studentVisit, 'oturum-1', endedAt))).toBe(true);
    const row = await serverVisit(studentVisit);
    expect(row.workout_client_id).toBe('oturum-1');
    expect(Date.parse(row.checked_out_at as string)).toBe(Date.parse(endedAt));
    // Kapanmış ziyarete ikinci bağlama yok
    expect(value(await linkWorkoutToVisit(c.student.client, studentVisit, 'oturum-2', endedAt))).toBe(false);
  });

  it('4 saatten eski açık ziyaret: çıkış yazılmaz, salonda sayılmaz; yeni okutma yeni ziyaret açar', async () => {
    const stale = await oldOpenVisit(u.member.id, 5);
    expect(value(await checkOut(c.member.client, stale))).toBe(false);
    expect((await serverVisit(stale)).checked_out_at).toBeNull();
    // 3 saatten eski açık ziyaret yeniden kullanılmaz
    const middle = await oldOpenVisit(u.member.id, 3.5);
    const fresh = value(await checkIn(c.member.client, gyms.A, keys.A));
    expect(fresh.reused).toBe(false);
    expect([stale, middle]).not.toContain(fresh.id);
    expect(value(await fetchOccupancy(c.member.client, gyms.A))).toBe(1);
    value(await checkOut(c.member.client, fresh.id));
  });

  it('yönetici elle ekler (manual); hoca / üye ekleyemez; saat ve üye denetlenir', async () => {
    const inAt = new Date(Date.now() - 26 * HOUR).toISOString();
    const outAt = new Date(Date.now() - 25 * HOUR).toISOString();
    const id = value(await manualVisit(c.admin.client, { gymId: gyms.A, userId: u.member.id, checkedInAt: inAt, checkedOutAt: outAt }));
    expect(await serverVisit(id)).toMatchObject({ source: 'manual', created_by: u.admin.id, user_id: u.member.id });

    for (const who of ['trainer', 'member', 'outsider'] as const) {
      const r = await manualVisit(c[who].client, { gymId: gyms.A, userId: u.member.id, checkedInAt: inAt, checkedOutAt: null });
      expect(!r.ok && r.error.kind, who).toBe('forbidden');
    }
    const backwards = await manualVisit(c.admin.client, { gymId: gyms.A, userId: u.member.id, checkedInAt: outAt, checkedOutAt: inAt });
    expect(!backwards.ok && backwards.error.kind).toBe('visit_invalid');
    const future = await manualVisit(c.admin.client, {
      gymId: gyms.A,
      userId: u.member.id,
      checkedInAt: new Date(Date.now() + 2 * HOUR).toISOString(),
      checkedOutAt: null,
    });
    expect(!future.ok && future.error.kind).toBe('visit_invalid');
    const notMember = await manualVisit(c.admin.client, { gymId: gyms.A, userId: u.stranger.id, checkedInAt: inAt, checkedOutAt: null });
    expect(!notMember.ok && notMember.error.kind).toBe('student_not_member');
  });

  it('anahtar yenilenince eski QR reddedilir, yenisi çalışır', async () => {
    const rotated = value(await rotateCheckinKey(c.admin.client, gyms.A)).secret;
    expect(rotated).not.toBe(keys.A);
    const old = await checkIn(c.member.client, gyms.A, keys.A);
    expect(!old.ok && old.error.kind).toBe('checkin_key_invalid');
    const ok = value(await checkIn(c.member.client, gyms.A, rotated));
    value(await checkOut(c.member.client, ok.id));
  });

  it('bağ bitince hoca öğrencinin ziyaretlerini göremez', async () => {
    expect((await visible('trainer')).length).toBeGreaterThan(0);
    value(await endTrainerLink(c.student.client, linkId));
    expect(await visible('trainer')).toEqual([]);
    // Öğrenci kendininkini görmeye devam eder
    expect((await visible('student')).map((v) => v.id)).toContain(studentVisit);
  });

  it('(salon, external_id) tekil: turnike kayıtları iki kez içe aktarılmaz', async () => {
    const row = { gym_id: gyms.A, user_id: u.member.id, source: 'turnstile', external_id: 'T-1001' };
    const first = await admin.from('gym_visits').insert(row);
    expect(first.error).toBeNull();
    const dup = await admin.from('gym_visits').insert(row);
    expect(dup.error?.code).toBe('23505');
    const otherGym = await admin.from('gym_visits').insert({ ...row, gym_id: gyms.B, user_id: u.outsider.id });
    expect(otherGym.error).toBeNull();
    // İstemci doğrudan yazamaz
    const direct = await c.admin.client.from('gym_visits').insert({ gym_id: gyms.A, user_id: u.admin.id });
    expect(direct.error).not.toBeNull();
  });
});
