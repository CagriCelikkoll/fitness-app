/**
 * Gerçek sunucu — yönetici: üye ve salon yönetimi (v3.2d; 0001 üyelik
 * kuralları + 0008_gym_admin.sql). Uygulamanın kendi fonksiyonlarıyla
 * (src/lib/gymAdmin.ts, account.ts), her rolün kendi oturumuyla.
 */

import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { fetchMemberships, joinGym, previewGym } from '@/lib/account';
import {
  fetchGymMembers,
  fetchGymSettings,
  fetchJoinCode,
  regenerateJoinCode,
  removeMember,
  updateGymSettings,
  updateMember,
} from '@/lib/gymAdmin';
import { updateDisplayName } from '@/lib/profile';

import { admin, createUser, deleteCreatedUsers, signedIn, stopAppClients, type AppClient, type TestUser } from './support';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const joinCode = () =>
  Array.from(randomBytes(8))
    .map((b) => ALPHABET[b % ALPHABET.length])
    .join('');

type Key = 'admin' | 'admin2' | 'trainer' | 'member' | 'kicked' | 'adminB' | 'newcomer' | 'late';
const u = {} as Record<Key, TestUser>;
const c = {} as Record<Key, AppClient>;
const gyms = {} as Record<'A' | 'B', { id: string; code: string }>;

async function createGym(name: string) {
  const code = joinCode();
  const { data, error } = await admin.from('gyms').insert({ name: `INT ${name}`, join_code: code }).select('id').single();
  if (error) throw new Error(error.message);
  return { id: data.id as string, code };
}

const A = () => gyms.A.id;
const roleOf = async (gymId: string, who: Key) =>
  (
    (await admin.from('gym_members').select('role').eq('gym_id', gymId).eq('user_id', u[who].id)).data?.[0] as
      | { role: string }
      | undefined
  )?.role ?? null;

beforeAll(async () => {
  gyms.A = await createGym('Yönetim A');
  gyms.B = await createGym('Yönetim B');
  for (const k of ['admin', 'admin2', 'trainer', 'member', 'kicked', 'adminB', 'newcomer', 'late'] as Key[]) {
    u[k] = await createUser(`yonetim-${k}`);
  }
  await admin.from('gym_members').insert([
    { gym_id: A(), user_id: u.admin.id, role: 'admin' },
    { gym_id: A(), user_id: u.admin2.id, role: 'admin' },
    { gym_id: A(), user_id: u.trainer.id, role: 'trainer' },
    { gym_id: A(), user_id: u.member.id, role: 'member' },
    { gym_id: A(), user_id: u.kicked.id, role: 'member' },
    { gym_id: gyms.B.id, user_id: u.adminB.id, role: 'admin' },
  ]);
  for (const k of Object.keys(u) as Key[]) c[k] = await signedIn(u[k]);
  await updateDisplayName(c.member.client, u.member.id, 'Ayşe Üye');
});

afterAll(async () => {
  await stopAppClients();
  await deleteCreatedUsers();
  await admin.from('gyms').delete().in('id', [gyms.A?.id, gyms.B?.id].filter(Boolean));
});

describe('Üyeler: kim görür', () => {
  it('yönetici ve hoca listeyi (adlarla) görür', async () => {
    for (const who of ['admin', 'trainer'] as Key[]) {
      const r = await fetchGymMembers(c[who].client, A());
      if (!r.ok) throw new Error(r.error.kind);
      expect(r.value.map((m) => m.userId).sort()).toEqual(
        [u.admin.id, u.admin2.id, u.trainer.id, u.member.id, u.kicked.id].sort()
      );
      expect(r.value.find((m) => m.userId === u.member.id)?.name).toBe('Ayşe Üye');
    }
  });

  it('üye listeyi göremez (yalnızca kendi satırı); başka salonun yöneticisi hiç göremez', async () => {
    const own = await fetchGymMembers(c.member.client, A());
    expect(own.ok && own.value.map((m) => m.userId)).toEqual([u.member.id]);
    const other = await fetchGymMembers(c.adminB.client, A());
    expect(other).toEqual({ ok: true, value: [] });
  });
});

describe('Üyeler: kim değiştirir', () => {
  it('yönetici rol değiştirir ve bitiş tarihi girer / temizler', async () => {
    expect(await updateMember(c.admin.client, A(), u.member.id, { role: 'trainer' })).toMatchObject({
      ok: true,
      value: { role: 'trainer' },
    });
    expect(await updateMember(c.admin.client, A(), u.member.id, { role: 'member' })).toMatchObject({ ok: true });
    expect(
      await updateMember(c.admin.client, A(), u.member.id, { membershipEndsOn: '2026-12-31' })
    ).toMatchObject({ ok: true, value: { membershipEndsOn: '2026-12-31' } });
    // Üye kendi bitişini görür (ana sayfa uyarısı)
    const mine = await fetchMemberships(c.member.client, u.member.id);
    expect(mine.ok && mine.value[0]?.membershipEndsOn).toBe('2026-12-31');
    expect(await updateMember(c.admin.client, A(), u.member.id, { membershipEndsOn: null })).toMatchObject({
      ok: true,
      value: { membershipEndsOn: null },
    });
  });

  it('hoca listeyi görür ama hiçbir şeyi değiştiremez', async () => {
    expect(await updateMember(c.trainer.client, A(), u.member.id, { role: 'trainer' })).toMatchObject({
      ok: false,
      error: { kind: 'forbidden' },
    });
    expect(await updateMember(c.trainer.client, A(), u.member.id, { membershipEndsOn: '2030-01-01' })).toMatchObject({
      ok: false,
    });
    expect(await updateMember(c.trainer.client, A(), u.trainer.id, { role: 'admin' })).toMatchObject({ ok: false });
    expect(await removeMember(c.trainer.client, A(), u.member.id)).toMatchObject({ ok: false, error: { kind: 'forbidden' } });
    expect(await roleOf(A(), 'member')).toBe('member');
    expect(await roleOf(A(), 'trainer')).toBe('trainer');
  });

  it('üye kendi rolünü / bitişini değiştiremez', async () => {
    expect(await updateMember(c.member.client, A(), u.member.id, { role: 'admin' })).toMatchObject({ ok: false });
    expect(await updateMember(c.member.client, A(), u.member.id, { membershipEndsOn: '2099-01-01' })).toMatchObject({
      ok: false,
    });
    expect(await roleOf(A(), 'member')).toBe('member');
  });

  it('başka salonun yöneticisi hiçbir şey yapamaz', async () => {
    expect(await updateMember(c.adminB.client, A(), u.member.id, { role: 'admin' })).toMatchObject({ ok: false });
    expect(await removeMember(c.adminB.client, A(), u.member.id)).toMatchObject({ ok: false });
    expect(await fetchJoinCode(c.adminB.client, A())).toMatchObject({ ok: false, error: { kind: 'forbidden' } });
    expect(await regenerateJoinCode(c.adminB.client, A())).toMatchObject({ ok: false, error: { kind: 'forbidden' } });
    expect(await updateGymSettings(c.adminB.client, A(), { name: 'Ele geçirildi' })).toMatchObject({ ok: false });
    expect(await roleOf(A(), 'member')).toBe('member');
  });

  it('yönetici kendi rolünü düşüremez; başka yöneticiyi düşürebilir; hep bir yönetici kalır', async () => {
    expect(await updateMember(c.admin.client, A(), u.admin.id, { role: 'member' })).toMatchObject({ ok: false });
    expect(await roleOf(A(), 'admin')).toBe('admin');
    expect(await updateMember(c.admin.client, A(), u.admin2.id, { role: 'trainer' })).toMatchObject({ ok: true });
    // Tek yönetici kaldı: yine kendini düşüremez
    expect(await updateMember(c.admin.client, A(), u.admin.id, { role: 'trainer' })).toMatchObject({ ok: false });
    expect(await roleOf(A(), 'admin')).toBe('admin');
  });

  it('yönetici üyeyi çıkarır; çıkarılan salonu ve üyeliğini artık görmez', async () => {
    expect(await removeMember(c.admin.client, A(), u.kicked.id)).toEqual({ ok: true, value: null });
    expect(await roleOf(A(), 'kicked')).toBeNull();
    expect(await fetchMemberships(c.kicked.client, u.kicked.id)).toEqual({ ok: true, value: [] });
    expect(await fetchGymSettings(c.kicked.client, A())).toMatchObject({ ok: false, error: { kind: 'forbidden' } });
  });
});

describe('Salon ayarları', () => {
  it('katılım kodunu yalnızca yönetici görür; üye ve hoca salon satırından da okuyamaz', async () => {
    expect(await fetchJoinCode(c.admin.client, A())).toEqual({ ok: true, value: gyms.A.code });
    expect(await fetchJoinCode(c.trainer.client, A())).toMatchObject({ ok: false, error: { kind: 'forbidden' } });
    expect(await fetchJoinCode(c.member.client, A())).toMatchObject({ ok: false });
    for (const who of ['member', 'trainer', 'admin'] as Key[]) {
      const raw = await c[who].client.from('gyms').select('join_code').eq('id', A());
      expect(raw.error).not.toBeNull();
    }
    // Ad ve renk herkese (üyelik kartı, ana sayfa)
    expect(await fetchGymSettings(c.member.client, A())).toMatchObject({ ok: true, value: { name: 'INT Yönetim A' } });
  });

  it('kod yenilenince eski kodla katılım reddedilir, yeniyle kabul edilir; mevcut üyeler etkilenmez', async () => {
    const old = gyms.A.code;
    const r = await regenerateJoinCode(c.admin.client, A());
    if (!r.ok) throw new Error(r.error.kind);
    expect(r.value).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(r.value).not.toBe(old);
    expect(await fetchJoinCode(c.admin.client, A())).toEqual({ ok: true, value: r.value });

    expect(await previewGym(c.newcomer.client, old)).toMatchObject({ ok: false, error: { kind: 'invalid_code' } });
    expect(await joinGym(c.newcomer.client, old)).toMatchObject({ ok: false, error: { kind: 'invalid_code' } });
    expect(await joinGym(c.newcomer.client, r.value)).toMatchObject({ ok: true, value: { gymId: A(), role: 'member' } });
    expect(await roleOf(A(), 'member')).toBe('member');

    // Hoca ve üye kod yenileyemez
    expect(await regenerateJoinCode(c.trainer.client, A())).toMatchObject({ ok: false });
    expect(await regenerateJoinCode(c.member.client, A())).toMatchObject({ ok: false });
    expect(await fetchJoinCode(c.admin.client, A())).toEqual({ ok: true, value: r.value });
    gyms.A.code = r.value;
  });

  it('art arda üretilen kodlar farklı ve biçime uygun', async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const r = await regenerateJoinCode(c.adminB.client, gyms.B.id);
      if (!r.ok) throw new Error(r.error.kind);
      expect(r.value).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
      codes.add(r.value);
    }
    expect(codes.size).toBe(5);
  });

  it('salon adı ve rengi yalnızca yönetici değiştirir; kod doğrudan değiştirilemez', async () => {
    expect(await updateGymSettings(c.admin.client, A(), { name: '  INT  Yeni Ad ', primaryColor: '#3EC5FF' })).toEqual({
      ok: true,
      value: { name: 'INT Yeni Ad', primaryColor: '#3EC5FF', logoUrl: null },
    });
    const mine = await fetchMemberships(c.member.client, u.member.id);
    expect(mine.ok && mine.value[0]).toMatchObject({ gymName: 'INT Yeni Ad', primaryColor: '#3EC5FF' });

    expect(await updateGymSettings(c.trainer.client, A(), { name: 'Hoca' })).toMatchObject({
      ok: false,
      error: { kind: 'forbidden' },
    });
    expect(await updateGymSettings(c.member.client, A(), { primaryColor: '#FF6FAE' })).toMatchObject({ ok: false });

    const code = await c.admin.client.from('gyms').update({ join_code: 'ELLE99' }).eq('id', A()).select('id');
    expect(code.error).not.toBeNull();
    // Logo yalnızca kendi gym-logos klasöründen (v3.3; ayrıntı push.int.ts)
    const logo = await c.admin.client.from('gyms').update({ logo_url: 'x' }).eq('id', A()).select('id');
    expect(logo.error?.code).toBe('23514');
    expect(await fetchGymSettings(c.admin.client, A())).toMatchObject({ ok: true, value: { name: 'INT Yeni Ad' } });
  });

  it('uzunluk ve renk biçimi sunucuda', async () => {
    const update = (values: Record<string, unknown>) => c.admin.client.from('gyms').update(values).eq('id', A()).select('id');
    expect((await update({ name: 'A' })).error?.code).toBe('23514');
    expect((await update({ name: 'x'.repeat(41) })).error?.code).toBe('23514');
    expect((await update({ name: ' Boşluklu' })).error?.code).toBe('23514');
    expect((await update({ primary_color: 'kırmızı' })).error?.code).toBe('23514');
    expect((await update({ primary_color: '#abcdef' })).error?.code).toBe('23514');
    expect((await update({ name: 'x'.repeat(40) })).error).toBeNull();
    expect((await update({ primary_color: null })).error).toBeNull();
    expect(await updateGymSettings(c.admin.client, A(), { name: 'x'.repeat(41) })).toMatchObject({
      ok: false,
      error: { kind: 'invalid_input' },
    });
  });
});
