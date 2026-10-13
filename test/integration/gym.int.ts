/**
 * Gerçek sunucu — salon ve güvenlik kuralları (v3.2a). Salonlar ve
 * üyelikler service role ile tohumlanıyor (uygulamada salon açılamaz);
 * her şey uygulamanın fonksiyonları ya da uygulama istemcisiyle,
 * kullanıcının kendi oturumuyla deneniyor.
 */

import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { fetchMemberships, joinGym, leaveGym, previewGym } from '@/lib/account';

import {
  admin,
  createUser,
  deleteCreatedUsers,
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

interface Gym {
  id: string;
  code: string;
}

async function createGym(name: string): Promise<Gym> {
  const code = joinCode();
  const { data, error } = await admin
    .from('gyms')
    .insert({ name: `INT ${name}`, join_code: code })
    .select('id')
    .single();
  if (error) throw new Error(`Salon açılamadı: ${error.message}`);
  return { id: data.id as string, code };
}

async function addMember(gym: Gym, user: TestUser, role: 'member' | 'trainer' | 'admin') {
  const { error } = await admin.from('gym_members').insert({ gym_id: gym.id, user_id: user.id, role });
  if (error) throw new Error(`Üye eklenemedi: ${error.message}`);
}

async function roleOf(gym: Gym, user: TestUser): Promise<string | null> {
  const { data } = await admin
    .from('gym_members')
    .select('role')
    .eq('gym_id', gym.id)
    .eq('user_id', user.id)
    .maybeSingle();
  return (data?.role as string | undefined) ?? null;
}

let gymA: Gym;
let gymB: Gym;
const u = {} as Record<'adminA' | 'trainerA' | 'memberA' | 'memberB' | 'outsider' | 'brute', TestUser>;
const c = {} as Record<keyof typeof u, AppClient>;

beforeAll(async () => {
  gymA = await createGym('Salon A');
  gymB = await createGym('Salon B');
  for (const key of Object.keys({ adminA: 1, trainerA: 1, memberA: 1, memberB: 1, outsider: 1, brute: 1 }) as (keyof typeof u)[]) {
    u[key] = await createUser(key);
  }
  await addMember(gymA, u.adminA, 'admin');
  await addMember(gymA, u.trainerA, 'trainer');
  await addMember(gymA, u.memberA, 'member');
  await addMember(gymB, u.memberB, 'member');
  for (const key of Object.keys(u) as (keyof typeof u)[]) c[key] = await signedIn(u[key]);
});

afterAll(async () => {
  await stopAppClients();
  await deleteCreatedUsers();
  await admin.from('gyms').delete().in('id', [gymA?.id, gymB?.id].filter(Boolean));
});

describe('Salon: katılma kodu', () => {
  it('geçerli kod: önizleme yalnızca adı gösteriyor, katılınca üye oluyor (boşluk / küçük harf tolere)', async () => {
    const messy = ` ${gymA.code.slice(0, 3).toLowerCase()}-${gymA.code.slice(3)} `;
    expect(await previewGym(c.outsider.client, messy)).toEqual({ ok: true, value: 'INT Salon A' });
    expect(await joinGym(c.outsider.client, messy)).toMatchObject({
      ok: true,
      value: { gymId: gymA.id, gymName: 'INT Salon A', role: 'member' },
    });
    const memberships = await fetchMemberships(c.outsider.client, u.outsider.id);
    expect(memberships).toMatchObject({ ok: true, value: [{ gymId: gymA.id, role: 'member' }] });

    // Ayrılma (uygulamanın akışı)
    expect(await leaveGym(c.outsider.client, { gymId: gymA.id, role: 'member' }, u.outsider.id)).toEqual({
      ok: true,
      value: null,
    });
    expect(await roleOf(gymA, u.outsider)).toBeNull();
  });

  it('yanlış kod → "Bu kodla bir salon bulunamadı"', async () => {
    expect(await previewGym(c.outsider.client, 'YANLIS99')).toMatchObject({
      ok: false,
      error: { kind: 'invalid_code' },
    });
    expect(await joinGym(c.outsider.client, 'YANLIS99')).toMatchObject({ ok: false, error: { kind: 'invalid_code' } });
  });

  it('deneme sınırı: 10 hatalı denemeden sonra doğru kod da reddediliyor', async () => {
    for (let i = 0; i < 10; i++) {
      expect(await previewGym(c.brute.client, `ZZZZZZ${i % 10}`)).toMatchObject({ ok: false, error: { kind: 'invalid_code' } });
    }
    expect(await joinGym(c.brute.client, gymA.code)).toMatchObject({
      ok: false,
      error: { kind: 'too_many_attempts' },
    });
    expect(await roleOf(gymA, u.brute)).toBeNull();
  });
});

describe('Salon: kim neyi görür', () => {
  it('üye yalnızca kendi salonunu ve kendi üyelik satırını görür', async () => {
    const gyms = await c.memberA.client.from('gyms').select('id');
    expect(gyms.data?.map((g) => g.id)).toEqual([gymA.id]);
    const members = await c.memberA.client.from('gym_members').select('user_id');
    expect(members.data?.map((m) => m.user_id)).toEqual([u.memberA.id]);
    const profiles = await c.memberA.client.from('profiles').select('id');
    expect(profiles.data?.map((p) => p.id)).toEqual([u.memberA.id]);
  });

  it('başka salonun üyesi A salonunu ve üyelerini görmez', async () => {
    const gyms = await c.memberB.client.from('gyms').select('id');
    expect(gyms.data?.map((g) => g.id)).toEqual([gymB.id]);
    const members = await c.memberB.client.from('gym_members').select('user_id').eq('gym_id', gymA.id);
    expect(members.data).toEqual([]);
  });

  it('hoca ve yönetici kendi salonunun bütün üyelerini (ve profillerini) görür, başka salonu görmez', async () => {
    for (const staff of [c.trainerA, c.adminA]) {
      const members = await staff.client.from('gym_members').select('user_id').eq('gym_id', gymA.id);
      expect(new Set(members.data?.map((m) => m.user_id))).toEqual(
        new Set([u.adminA.id, u.trainerA.id, u.memberA.id])
      );
      const other = await staff.client.from('gym_members').select('user_id').eq('gym_id', gymB.id);
      expect(other.data).toEqual([]);
      const profiles = await staff.client.from('profiles').select('id').in('id', [u.memberA.id, u.memberB.id]);
      expect(profiles.data?.map((p) => p.id)).toEqual([u.memberA.id]);
    }
  });

  it('uygulamadan salon açılamaz, kodu değiştirilemez, üye / hoca salonu değiştiremez, üyelik doğrudan eklenemez', async () => {
    const insertGym = await c.adminA.client.from('gyms').insert({ name: 'INT sahte', join_code: 'SAHTE123' });
    expect(insertGym.error).not.toBeNull();
    // Ad / renk yalnızca yönetici (v3.2d, gymAdmin.int.ts); üye ve hoca değiştiremez, kod hiç kimse
    for (const who of [c.memberA, c.trainerA]) {
      const rename = await who.client.from('gyms').update({ name: 'değişti' }).eq('id', gymA.id).select('id');
      expect(rename.error != null || (rename.data ?? []).length === 0).toBe(true);
    }
    const code = await c.adminA.client.from('gyms').update({ join_code: 'SAHTE9' }).eq('id', gymA.id).select('id');
    expect(code.error).not.toBeNull();
    const join = await c.outsider.client.from('gym_members').insert({ gym_id: gymB.id, user_id: u.outsider.id });
    expect(join.error).not.toBeNull();
    expect(await roleOf(gymB, u.outsider)).toBeNull();
  });
});

describe('Salon: roller', () => {
  it('üye ve hoca rol yükseltemez (kendisininkini de başkasınınkini de)', async () => {
    for (const [who, target] of [
      [c.memberA, u.memberA],
      [c.trainerA, u.trainerA],
      [c.trainerA, u.memberA],
    ] as const) {
      await who.client.from('gym_members').update({ role: 'admin' }).eq('gym_id', gymA.id).eq('user_id', target.id);
    }
    expect(await roleOf(gymA, u.memberA)).toBe('member');
    expect(await roleOf(gymA, u.trainerA)).toBe('trainer');
  });

  it('yönetici üyenin rolünü ve üyelik bitişini değiştirir', async () => {
    const r = await c.adminA.client
      .from('gym_members')
      .update({ role: 'trainer', membership_ends_on: '2027-01-31' })
      .eq('gym_id', gymA.id)
      .eq('user_id', u.memberA.id)
      .select('role, membership_ends_on');
    expect(r.error).toBeNull();
    expect(r.data).toEqual([{ role: 'trainer', membership_ends_on: '2027-01-31' }]);
    await admin.from('gym_members').update({ role: 'member' }).eq('gym_id', gymA.id).eq('user_id', u.memberA.id);
  });

  it('yönetici kendi rolünü düşüremez; başka salonun üyesine dokunamaz', async () => {
    await c.adminA.client.from('gym_members').update({ role: 'member' }).eq('gym_id', gymA.id).eq('user_id', u.adminA.id);
    expect(await roleOf(gymA, u.adminA)).toBe('admin');
    await c.adminA.client.from('gym_members').update({ role: 'admin' }).eq('gym_id', gymB.id).eq('user_id', u.memberB.id);
    expect(await roleOf(gymB, u.memberB)).toBe('member');
  });

  it('salonun tek yöneticisi ayrılamaz', async () => {
    expect(await leaveGym(c.adminA.client, { gymId: gymA.id, role: 'admin' }, u.adminA.id)).toMatchObject({
      ok: false,
      error: { kind: 'last_admin' },
    });
    expect(await roleOf(gymA, u.adminA)).toBe('admin');
  });
});
