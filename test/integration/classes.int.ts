/**
 * Gerçek sunucu — grup ders programı (v3.2c,
 * supabase/migrations/0005_classes.sql). Uygulamanın kendi
 * fonksiyonlarıyla (src/lib/classes.ts), her rolün kendi oturumuyla.
 * Salonlar ve üyelikler service role ile tohumlanıyor.
 */

import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createTemplate,
  deleteTemplate,
  emptyTemplateDraft,
  fetchSchedule,
  occurrencesForDate,
  removeException,
  setException,
  updateTemplate,
  type ClassOccurrence,
  type ClassTemplate,
  type TemplateDraft,
} from '@/lib/classes';

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

type Key = 'admin' | 'trainer' | 'member' | 'adminB';
const u = {} as Record<Key, TestUser>;
const c = {} as Record<Key, AppClient>;
let gymA: string;
let gymB: string;

// Perşembe dersleri: tarih 2030'da, bugünden bağımsız (istisna tarihi
// sunucuda yalnızca gün uyumuyla denetleniyor)
const THURSDAY = '2030-10-17';
const NEXT_THURSDAY = '2030-10-24';
const FRIDAY = '2030-10-18';
const NOW = Date.parse('2030-10-01T09:00:00Z'); // istisnalar çekme penceresinde

const draft = (over: Partial<TemplateDraft> = {}): TemplateDraft => ({
  ...emptyTemplateDraft(4),
  startTime: '18:00',
  name: 'Zumba',
  instructorName: 'Bilgin Hoca',
  tagline: 'Enerjiyi Paylaş',
  ...over,
});

async function template(over: Partial<TemplateDraft> = {}): Promise<ClassTemplate> {
  const r = await createTemplate(c.admin.client, gymA, draft(over));
  if (!r.ok) throw new Error(`yönetici ders ekleyemedi: ${r.error.kind}`);
  return r.value;
}

async function scheduleOf(who: Key) {
  const r = await fetchSchedule(c[who].client, NOW);
  if (!r.ok) throw new Error(r.error.kind);
  return r.value;
}

async function occurrence(who: Key, templateId: string, date: string): Promise<ClassOccurrence> {
  const o = occurrencesForDate(await scheduleOf(who), date).find((x) => x.templateId === templateId);
  if (!o) throw new Error(`${templateId} ${date} tarihinde yok`);
  return o;
}

const templateExists = async (id: string) =>
  ((await admin.from('class_templates').select('id').eq('id', id)).data ?? []).length > 0;

beforeAll(async () => {
  gymA = await createGym('Program A');
  gymB = await createGym('Program B');
  for (const k of ['admin', 'trainer', 'member', 'adminB'] as Key[]) u[k] = await createUser(`program-${k}`);
  await admin.from('gym_members').insert([
    { gym_id: gymA, user_id: u.admin.id, role: 'admin' },
    { gym_id: gymA, user_id: u.trainer.id, role: 'trainer' },
    { gym_id: gymA, user_id: u.member.id, role: 'member' },
    { gym_id: gymB, user_id: u.adminB.id, role: 'admin' },
  ]);
  for (const k of Object.keys(u) as Key[]) c[k] = await signedIn(u[k]);
});

afterAll(async () => {
  await stopAppClients();
  await deleteCreatedUsers();
  await admin.from('gyms').delete().in('id', [gymA, gymB].filter(Boolean));
});

describe('Ders programı: okuma ve yazma', () => {
  it('yönetici ders ekler, düzenler, siler; üye ve hoca okur', async () => {
    const t = await template();
    expect(t).toMatchObject({ gymId: gymA, weekday: 4, startTime: '18:00', durationMin: 60, active: true });

    for (const who of ['member', 'trainer'] as Key[]) {
      expect((await scheduleOf(who)).templates.map((x) => x.id)).toContain(t.id);
    }

    const updated = await updateTemplate(c.admin.client, t.id, draft({ startTime: '18:30', durationMin: '45', active: false }));
    expect(updated).toMatchObject({ ok: true, value: { startTime: '18:30', durationMin: 45, active: false } });
    // Pasif ders üyeye de gelir ama programda görünmez
    expect(occurrencesForDate(await scheduleOf('member'), THURSDAY).map((o) => o.templateId)).not.toContain(t.id);

    expect(await deleteTemplate(c.admin.client, t.id)).toEqual({ ok: true, value: null });
    expect(await templateExists(t.id)).toBe(false);
  });

  it('üye ve hoca ders ekleyemez, düzenleyemez, silemez', async () => {
    const t = await template({ name: 'Dokunulmaz' });
    for (const who of ['member', 'trainer'] as Key[]) {
      expect(await createTemplate(c[who].client, gymA, draft())).toMatchObject({ ok: false, error: { kind: 'forbidden' } });
      expect(await updateTemplate(c[who].client, t.id, draft({ name: 'Değişti' }))).toMatchObject({
        ok: false,
        error: { kind: 'forbidden' },
      });
      expect(await deleteTemplate(c[who].client, t.id)).toMatchObject({ ok: false, error: { kind: 'forbidden' } });
    }
    const { data } = await admin.from('class_templates').select('name').eq('id', t.id).single();
    expect(data).toEqual({ name: 'Dokunulmaz' });
  });

  it('üye ve hoca bir dersi iptal edemez, değiştiremez; yönetici edebilir ve kaldırabilir', async () => {
    const t = await template({ name: 'İstisna' });
    const o = await occurrence('member', t.id, THURSDAY);
    for (const who of ['member', 'trainer'] as Key[]) {
      expect(await setException(c[who].client, o, { kind: 'cancelled' })).toMatchObject({
        ok: false,
        error: { kind: 'forbidden' },
      });
    }

    const cancelled = await setException(c.admin.client, o, { kind: 'cancelled' });
    expect(cancelled).toMatchObject({ ok: true, value: { kind: 'cancelled', date: THURSDAY, gymId: gymA } });
    expect(await occurrence('member', t.id, THURSDAY)).toMatchObject({ status: 'cancelled' });
    // Yalnızca o tarih
    expect(await occurrence('member', t.id, NEXT_THURSDAY)).toMatchObject({ status: 'normal' });

    // Üye istisnayı kaldıramaz, değiştiremez
    const withEx = await occurrence('member', t.id, THURSDAY);
    expect(await removeException(c.member.client, withEx.exception!.id)).toMatchObject({ ok: false });
    expect(
      await setException(c.trainer.client, withEx, { kind: 'changed', start_time: '19:30', instructor_name: null, note: null })
    ).toMatchObject({ ok: false, error: { kind: 'forbidden' } });

    // Yönetici iptali değişikliğe çevirir (aynı satır güncellenir)
    const changed = await setException(c.admin.client, withEx, {
      kind: 'changed',
      start_time: '19:30',
      instructor_name: 'Ayşe Hoca',
      note: 'Büyük salonda',
    });
    expect(changed).toMatchObject({ ok: true, value: { id: withEx.exception!.id, kind: 'changed', startTime: '19:30' } });
    expect(await occurrence('member', t.id, THURSDAY)).toMatchObject({
      status: 'changed',
      startTime: '19:30',
      instructorName: 'Ayşe Hoca',
      note: 'Büyük salonda',
    });

    expect(await removeException(c.admin.client, withEx.exception!.id)).toEqual({ ok: true, value: null });
    expect(await occurrence('member', t.id, THURSDAY)).toMatchObject({ status: 'normal', exception: null });
  });
});

describe('Ders programı: salon sınırları', () => {
  it('başka salonun programı görünmez, değiştirilemez', async () => {
    const t = await template({ name: 'Yalnızca A' });
    const o = await occurrence('admin', t.id, THURSDAY);
    await setException(c.admin.client, o, { kind: 'cancelled' });

    const seenByB = await scheduleOf('adminB');
    expect(seenByB.templates.filter((x) => x.gymId === gymA)).toEqual([]);
    expect(seenByB.exceptions.filter((x) => x.gymId === gymA)).toEqual([]);

    // B'nin yöneticisi A'ya ders ekleyemez, A'nın dersini değiştiremez / silemez
    expect(await createTemplate(c.adminB.client, gymA, draft())).toMatchObject({ ok: false, error: { kind: 'forbidden' } });
    expect(await updateTemplate(c.adminB.client, t.id, draft({ name: 'B' }))).toMatchObject({ ok: false });
    expect(await deleteTemplate(c.adminB.client, t.id)).toMatchObject({ ok: false });
    // A'nın dersine istisna yazamaz (salon şablondan geliyor, istemci veremez)
    const other = { ...o, date: NEXT_THURSDAY, exception: null };
    expect(await setException(c.adminB.client, other, { kind: 'cancelled' })).toMatchObject({
      ok: false,
      error: { kind: 'forbidden' },
    });
    const forged = await c.adminB.client
      .from('class_exceptions')
      .insert({ template_id: t.id, date: NEXT_THURSDAY, kind: 'cancelled', gym_id: gymB })
      .select('id');
    expect(forged.error).not.toBeNull(); // gym_id sütununa yazma yetkisi yok
    expect(await templateExists(t.id)).toBe(true);
  });

  it('ders başka salona taşınamaz', async () => {
    const t = await template({ name: 'Taşınamaz' });
    const move = await c.admin.client.from('class_templates').update({ gym_id: gymB }).eq('id', t.id).select('id');
    expect(move.error).not.toBeNull();
  });
});

describe('Ders programı: sunucu kuralları', () => {
  it('aynı ders + tarih için tek istisna', async () => {
    const t = await template({ name: 'Tekil' });
    const o = await occurrence('admin', t.id, THURSDAY);
    expect(await setException(c.admin.client, o, { kind: 'cancelled' })).toMatchObject({ ok: true });
    // Elindeki eski görünümle (istisna yok sanarak) ikinci kez eklemeye çalışan
    expect(
      await setException(c.admin.client, o, { kind: 'changed', start_time: '20:00', instructor_name: null, note: null })
    ).toMatchObject({ ok: false, error: { kind: 'already_exists' } });
    const { count } = await admin
      .from('class_exceptions')
      .select('*', { count: 'exact', head: true })
      .eq('template_id', t.id)
      .eq('date', THURSDAY);
    expect(count).toBe(1);
  });

  it('istisna tarihi dersin günüyle aynı olmalı; boş değişiklik kabul edilmez', async () => {
    const t = await template({ name: 'Gün denetimi' });
    const o = await occurrence('admin', t.id, THURSDAY);
    expect(await setException(c.admin.client, { ...o, date: FRIDAY }, { kind: 'cancelled' })).toMatchObject({
      ok: false,
      error: { kind: 'invalid_input' },
    });
    expect(
      await setException(c.admin.client, o, { kind: 'changed', start_time: null, instructor_name: null, note: null })
    ).toMatchObject({ ok: false, error: { kind: 'invalid_input' } });
  });

  it('alan uzunlukları sunucuda (istemci denetimi atlansa da)', async () => {
    const insert = (over: Record<string, unknown>) =>
      c.admin.client
        .from('class_templates')
        .insert({ gym_id: gymA, weekday: 1, start_time: '10:00', name: 'Ders', instructor_name: 'Hoca', ...over })
        .select('id');
    expect((await insert({ name: 'x'.repeat(41) })).error?.code).toBe('23514');
    expect((await insert({ name: '   ' })).error?.code).toBe('23514');
    expect((await insert({ instructor_name: 'x'.repeat(41) })).error?.code).toBe('23514');
    expect((await insert({ instructor_name: '' })).error?.code).toBe('23514');
    expect((await insert({ tagline: 'x'.repeat(61) })).error?.code).toBe('23514');
    expect((await insert({ weekday: 8 })).error?.code).toBe('23514');
    expect((await insert({ weekday: 0 })).error?.code).toBe('23514');
    expect((await insert({ duration_min: 0 })).error?.code).toBe('23514');
    expect(
      (await insert({ name: 'x'.repeat(40), instructor_name: 'y'.repeat(40), tagline: 'z'.repeat(60) })).error
    ).toBeNull();
    // Emoji tek karakter (istemcideki sayaç da öyle)
    expect((await insert({ name: '💪'.repeat(40) })).error).toBeNull();
    expect(await createTemplate(c.admin.client, gymA, draft({ name: 'x'.repeat(41) }))).toMatchObject({
      ok: false,
      error: { kind: 'invalid_input' },
    });

    const t = await template({ name: 'Not sınırı' });
    const o = await occurrence('admin', t.id, THURSDAY);
    expect(
      await setException(c.admin.client, o, { kind: 'changed', start_time: null, instructor_name: null, note: 'n'.repeat(121) })
    ).toMatchObject({ ok: false, error: { kind: 'invalid_input' } });
    expect(
      await setException(c.admin.client, o, { kind: 'changed', start_time: null, instructor_name: 'h'.repeat(41), note: null })
    ).toMatchObject({ ok: false, error: { kind: 'invalid_input' } });
  });

  it('saat sunucuya yerel saat olarak gider ve aynen döner (dilim dönüşümü yok)', async () => {
    const t = await template({ name: 'Saat', startTime: '07:05' });
    const { data } = await admin.from('class_templates').select('start_time').eq('id', t.id).single();
    expect(data).toEqual({ start_time: '07:05:00' });
    expect((await scheduleOf('member')).templates.find((x) => x.id === t.id)?.startTime).toBe('07:05');
  });

  it('ders başka güne taşınınca istisnaları silinir; ders silinince de', async () => {
    const t = await template({ name: 'Taşınan' });
    await setException(c.admin.client, await occurrence('admin', t.id, THURSDAY), { kind: 'cancelled' });
    const count = async () =>
      (await admin.from('class_exceptions').select('*', { count: 'exact', head: true }).eq('template_id', t.id)).count;
    expect(await count()).toBe(1);

    // Saat değişince istisna kalır
    expect(await updateTemplate(c.admin.client, t.id, draft({ name: 'Taşınan', startTime: '18:15' }))).toMatchObject({ ok: true });
    expect(await count()).toBe(1);
    // Gün değişince gider
    expect(await updateTemplate(c.admin.client, t.id, draft({ name: 'Taşınan', weekday: 5 }))).toMatchObject({ ok: true });
    expect(await count()).toBe(0);

    await setException(c.admin.client, await occurrence('admin', t.id, FRIDAY), { kind: 'cancelled' });
    expect(await count()).toBe(1);
    expect(await deleteTemplate(c.admin.client, t.id)).toMatchObject({ ok: true });
    expect(await count()).toBe(0);
  });
});
