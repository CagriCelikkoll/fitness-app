/**
 * Gerçek sunucu — derse katılım (v3.2c BÖLÜM 5,
 * supabase/migrations/0006_class_rsvps.sql). Uygulamanın kendi
 * fonksiyonlarıyla (src/lib/classRsvps.ts), her rolün kendi oturumuyla.
 *
 * Tarihler gerçek bugüne göre (sunucu "ders başladı mı"yı kendi saatiyle
 * denetliyor): gelecek = bugünden 7 gün sonra, geçmiş = 7 gün önce.
 */

import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { leaveGym } from '@/lib/account';
import {
  addDays,
  createTemplate,
  emptyTemplateDraft,
  gymNow,
  setException,
  occurrencesForDate,
  fetchSchedule,
  updateTemplate,
  weekdayOf,
  type ClassTemplate,
  type TemplateDraft,
} from '@/lib/classes';
import { fetchAttendance, joinClass, leaveClass } from '@/lib/classRsvps';

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

type Key = 'admin' | 'trainer' | 'member' | 'member2' | 'leaver' | 'memberB';
const u = {} as Record<Key, TestUser>;
const c = {} as Record<Key, AppClient>;
let gymA: string;
let gymB: string;

const today = gymNow(Date.now()).date;
const FUTURE = addDays(today, 7);
const PAST = addDays(today, -7);
const WEEKDAY = weekdayOf(FUTURE);

const draft = (over: Partial<TemplateDraft> = {}): TemplateDraft => ({
  ...emptyTemplateDraft(WEEKDAY),
  startTime: '12:00',
  name: 'Zumba',
  instructorName: 'Bilgin Hoca',
  ...over,
});

async function template(over: Partial<TemplateDraft> = {}): Promise<ClassTemplate> {
  const r = await createTemplate(c.admin.client, gymA, draft(over));
  if (!r.ok) throw new Error(`yönetici ders ekleyemedi: ${r.error.kind}`);
  return r.value;
}

const session = (t: ClassTemplate, date = FUTURE) => ({ templateId: t.id, date });
const key = (t: ClassTemplate, date = FUTURE) => `${t.id}:${date}`;

async function attendanceOf(who: Key) {
  const r = await fetchAttendance(c[who].client, u[who].id);
  if (!r.ok) throw new Error(r.error.kind);
  return r.value;
}

async function serverRsvps(t: ClassTemplate, date = FUTURE): Promise<string[]> {
  const { data } = await admin.from('class_rsvps').select('user_id').eq('template_id', t.id).eq('date', date);
  return ((data ?? []) as { user_id: string }[]).map((r) => r.user_id).sort();
}

beforeAll(async () => {
  gymA = await createGym('Katılım A');
  gymB = await createGym('Katılım B');
  for (const k of ['admin', 'trainer', 'member', 'member2', 'leaver', 'memberB'] as Key[]) {
    u[k] = await createUser(`katilim-${k}`);
  }
  await admin.from('gym_members').insert([
    { gym_id: gymA, user_id: u.admin.id, role: 'admin' },
    { gym_id: gymA, user_id: u.trainer.id, role: 'trainer' },
    { gym_id: gymA, user_id: u.member.id, role: 'member' },
    { gym_id: gymA, user_id: u.member2.id, role: 'member' },
    { gym_id: gymA, user_id: u.leaver.id, role: 'member' },
    { gym_id: gymB, user_id: u.memberB.id, role: 'admin' },
  ]);
  await admin.from('profiles').update({ display_name: 'Ayşe Üye' }).eq('id', u.member.id);
  for (const k of Object.keys(u) as Key[]) c[k] = await signedIn(u[k]);
});

afterAll(async () => {
  await stopAppClients();
  await deleteCreatedUsers();
  await admin.from('gyms').delete().in('id', [gymA, gymB].filter(Boolean));
});

describe('Katılım: kim ne yapabilir', () => {
  it('üye kendi katılımını ekler ve siler; ikinci kez eklemek sorun değil', async () => {
    const t = await template();
    expect(await joinClass(c.member.client, session(t))).toEqual({ ok: true, value: null });
    expect(await joinClass(c.member.client, session(t))).toEqual({ ok: true, value: null });
    expect(await serverRsvps(t)).toEqual([u.member.id]);
    expect((await attendanceOf('member')).mine).toContain(key(t));

    expect(await leaveClass(c.member.client, session(t), u.member.id)).toEqual({ ok: true, value: null });
    expect(await serverRsvps(t)).toEqual([]);
  });

  it('başkası adına katılım eklenemez, başkasının katılımı silinemez', async () => {
    const t = await template({ name: 'Başkası' });
    const forged = await c.member.client
      .from('class_rsvps')
      .insert({ template_id: t.id, date: FUTURE, user_id: u.member2.id })
      .select('user_id');
    expect(forged.error).not.toBeNull(); // user_id sütununa yazma yetkisi yok
    expect(await serverRsvps(t)).toEqual([]);

    await joinClass(c.member2.client, session(t));
    const del = await c.member.client
      .from('class_rsvps')
      .delete()
      .eq('template_id', t.id)
      .eq('user_id', u.member2.id)
      .select('user_id');
    expect(del.data).toEqual([]);
    // Yönetici de üyenin katılımını silemez (yalnızca kendisi)
    const byAdmin = await c.admin.client.from('class_rsvps').delete().eq('template_id', t.id).select('user_id');
    expect(byAdmin.data).toEqual([]);
    expect(await serverRsvps(t)).toEqual([u.member2.id]);
  });

  it('başka salonun dersine katılınamaz', async () => {
    const t = await template({ name: 'Yalnızca A' });
    expect(await joinClass(c.memberB.client, session(t))).toMatchObject({ ok: false, error: { kind: 'forbidden' } });
    expect(await serverRsvps(t)).toEqual([]);
  });

  it('ders başladıktan sonra eklenemez, silinemez', async () => {
    const t = await template({ name: 'Geçmiş' });
    expect(await joinClass(c.member.client, session(t, PAST))).toMatchObject({
      ok: false,
      error: { kind: 'class_started' },
    });
    // Geçmiş katılım (service role ile) üye tarafından silinemez
    await admin.from('class_rsvps').insert({ template_id: t.id, date: PAST, user_id: u.member.id });
    expect(await leaveClass(c.member.client, session(t, PAST), u.member.id)).toMatchObject({
      ok: false,
      error: { kind: 'class_started' },
    });
    expect(await serverRsvps(t, PAST)).toEqual([u.member.id]);
  });

  it('iptal edilmiş derse, pasif derse ve dersin günü olmayan tarihe eklenemez', async () => {
    const t = await template({ name: 'İptal' });
    const o = occurrencesForDate(await schedule(), FUTURE).find((x) => x.templateId === t.id)!;
    expect(await setException(c.admin.client, o, { kind: 'cancelled' })).toMatchObject({ ok: true });
    expect(await joinClass(c.member.client, session(t))).toMatchObject({ ok: false, error: { kind: 'class_cancelled' } });

    const inactive = await template({ name: 'Pasif', active: false });
    expect(await joinClass(c.member.client, session(inactive))).toMatchObject({
      ok: false,
      error: { kind: 'class_not_scheduled' },
    });
    const active = await template({ name: 'Yanlış gün' });
    expect(await joinClass(c.member.client, session(active, addDays(FUTURE, 1)))).toMatchObject({
      ok: false,
      error: { kind: 'class_not_scheduled' },
    });
  });

  it('kapasite yumuşak: dolu derse de katılım kaydedilir', async () => {
    const t = await template({ name: 'Kapasiteli', capacity: '1' });
    expect(t.capacity).toBe(1);
    expect(await joinClass(c.member.client, session(t))).toMatchObject({ ok: true });
    expect(await joinClass(c.member2.client, session(t))).toMatchObject({ ok: true });
    expect((await attendanceOf('member')).counts[key(t)]).toBe(2);
  });
});

describe('Katılım: kim neyi görür', () => {
  it('üye kişi sayısını görür ama adları göremez; hoca ve yönetici adları görür', async () => {
    const t = await template({ name: 'Görünürlük' });
    await joinClass(c.member.client, session(t));
    await joinClass(c.trainer.client, session(t));

    const m2 = await attendanceOf('member2');
    expect(m2.counts[key(t)]).toBe(2);
    expect(m2.attendees[key(t)]).toBeUndefined();
    expect(m2.names).toEqual({});
    // Doğrudan sorguda da yalnızca kendisininki (yok)
    const raw = await c.member2.client.from('class_rsvps').select('user_id').eq('template_id', t.id);
    expect(raw.data).toEqual([]);
    const profiles = await c.member2.client.from('profiles').select('display_name').eq('id', u.member.id);
    expect(profiles.data).toEqual([]);

    // Katılan üye de yalnızca kendini görür
    const m = await attendanceOf('member');
    expect(m.attendees[key(t)]).toEqual([u.member.id]);
    expect(m.counts[key(t)]).toBe(2);

    for (const who of ['admin', 'trainer'] as Key[]) {
      const a = await attendanceOf(who);
      expect([...(a.attendees[key(t)] ?? [])].sort()).toEqual([u.member.id, u.trainer.id].sort());
      expect(a.names[u.member.id]).toBe('Ayşe Üye');
    }
  });

  it('başka salon sayıyı da görmez', async () => {
    const t = await template({ name: 'Sayı A' });
    await joinClass(c.member.client, session(t));
    const b = await attendanceOf('memberB');
    expect(b.counts[key(t)]).toBeUndefined();
    const raw = await c.memberB.client.rpc('class_rsvp_counts', { p_from: today, p_to: addDays(today, 30) });
    expect((raw.data as { template_id: string }[]).some((r) => r.template_id === t.id)).toBe(false);
  });
});

describe('Katılım: temizlik', () => {
  it('salondan ayrılanın katılımları gider', async () => {
    const t = await template({ name: 'Ayrılan' });
    await joinClass(c.leaver.client, session(t));
    expect(await serverRsvps(t)).toEqual([u.leaver.id]);
    expect(await leaveGym(c.leaver.client, { gymId: gymA, role: 'member' }, u.leaver.id)).toMatchObject({ ok: true });
    expect(await serverRsvps(t)).toEqual([]);
  });

  it('ders başka güne taşınınca katılımlar gider; saat değişince kalır', async () => {
    const t = await template({ name: 'Taşınan' });
    await joinClass(c.member.client, session(t));
    expect(await updateTemplate(c.admin.client, t.id, draft({ name: 'Taşınan', startTime: '12:30' }))).toMatchObject({ ok: true });
    expect(await serverRsvps(t)).toEqual([u.member.id]);
    const otherDay = (((WEEKDAY % 7) + 1) as TemplateDraft['weekday']);
    expect(await updateTemplate(c.admin.client, t.id, draft({ name: 'Taşınan', weekday: otherDay }))).toMatchObject({ ok: true });
    expect(await serverRsvps(t)).toEqual([]);
  });
});

async function schedule() {
  const r = await fetchSchedule(c.admin.client);
  if (!r.ok) throw new Error(r.error.kind);
  return r.value;
}
