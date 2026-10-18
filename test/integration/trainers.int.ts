/**
 * Gerçek sunucu — hoca–öğrenci bağı (v3.6a, 0010_trainers.sql).
 * Uygulamanın kendi fonksiyonlarıyla (src/lib/trainers.ts), her rolün
 * kendi oturumuyla.
 */

import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { leaveGym } from '@/lib/account';
import { removeMember, updateMember } from '@/lib/gymAdmin';
import { updateDisplayName } from '@/lib/profile';
import {
  TRAINER_CONSENT_VERSION,
  endTrainerLink,
  fetchTrainerLinks,
  requestStudent,
  respondTrainerRequest,
  type TrainerLink,
} from '@/lib/trainers';

import { admin, createUser, deleteCreatedUsers, signedIn, stopAppClients, type AppClient, type TestUser } from './support';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const joinCode = () =>
  Array.from(randomBytes(8))
    .map((b) => ALPHABET[b % ALPHABET.length])
    .join('');

type Key =
  | 'admin'
  | 'trainer'
  | 'trainer2'
  | 'student'
  | 'student2'
  | 'student3'
  | 'leaver'
  | 'kicked'
  | 'outsider'
  | 'trainerB';
const KEYS: Key[] = ['admin', 'trainer', 'trainer2', 'student', 'student2', 'student3', 'leaver', 'kicked', 'outsider', 'trainerB'];
const u = {} as Record<Key, TestUser>;
const c = {} as Record<Key, AppClient>;
const gyms = {} as Record<'A' | 'B', string>;

async function createGym(name: string) {
  const { data, error } = await admin.from('gyms').insert({ name: `INT ${name}`, join_code: joinCode() }).select('id').single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

/** Sunucudaki gerçek satır (RLS'siz) */
async function row(id: string) {
  const { data, error } = await admin.from('trainer_students').select('*').eq('id', id).single();
  if (error) throw new Error(error.message);
  return data as Record<string, unknown>;
}

function value<T>(r: { ok: true; value: T } | { ok: false; error: { kind: string } }): T {
  if (!r.ok) throw new Error(r.error.kind);
  return r.value;
}

async function linksOf(who: Key, gymId: string | null = null): Promise<TrainerLink[]> {
  return value(await fetchTrainerLinks(c[who].client, gymId));
}

beforeAll(async () => {
  gyms.A = await createGym('Hoca A');
  gyms.B = await createGym('Hoca B');
  for (const k of KEYS) u[k] = await createUser(`hoca-${k}`);
  await admin.from('gym_members').insert([
    { gym_id: gyms.A, user_id: u.admin.id, role: 'admin' },
    { gym_id: gyms.A, user_id: u.trainer.id, role: 'trainer' },
    { gym_id: gyms.A, user_id: u.trainer2.id, role: 'trainer' },
    { gym_id: gyms.A, user_id: u.student.id, role: 'member' },
    { gym_id: gyms.A, user_id: u.student2.id, role: 'member' },
    { gym_id: gyms.A, user_id: u.student3.id, role: 'member' },
    { gym_id: gyms.A, user_id: u.leaver.id, role: 'member' },
    { gym_id: gyms.A, user_id: u.kicked.id, role: 'member' },
    { gym_id: gyms.B, user_id: u.trainerB.id, role: 'trainer' },
    { gym_id: gyms.B, user_id: u.outsider.id, role: 'member' },
  ]);
  for (const k of KEYS) c[k] = await signedIn(u[k]);
  await updateDisplayName(c.trainer.client, u.trainer.id, 'Duygu');
  await updateDisplayName(c.student.client, u.student.id, 'Ayşe');
});

afterAll(async () => {
  await stopAppClients();
  await deleteCreatedUsers();
  await admin.from('gyms').delete().in('id', [gyms.A, gyms.B].filter(Boolean));
});

describe('istek', () => {
  let linkId: string;

  it('hoca kendi salonunun üyesine istek gönderir; öğrenci hocanın adını görür', async () => {
    linkId = value(await requestStudent(c.trainer.client, gyms.A, u.student.id));
    expect(await row(linkId)).toMatchObject({ status: 'pending', trainer_id: u.trainer.id, student_id: u.student.id, consent_version: null });

    const mine = await linksOf('student');
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: linkId, status: 'pending', trainerName: 'Duygu', gymName: 'INT Hoca A' });
  });

  it('çift istek reddedilir', async () => {
    const r = await requestStudent(c.trainer.client, gyms.A, u.student.id);
    expect(!r.ok && r.error.kind).toBe('trainer_already_linked');
  });

  it('üye olmayana, kendine, üye (hoca değil) olarak, başka salonun hocası olarak gönderilemez', async () => {
    const notMember = await requestStudent(c.trainer.client, gyms.A, u.outsider.id);
    expect(!notMember.ok && notMember.error.kind).toBe('student_not_member');
    const self = await requestStudent(c.trainer.client, gyms.A, u.trainer.id);
    expect(!self.ok && self.error.kind).toBe('trainer_self');
    const byMember = await requestStudent(c.student2.client, gyms.A, u.student3.id);
    expect(!byMember.ok && byMember.error.kind).toBe('forbidden');
    const otherGym = await requestStudent(c.trainerB.client, gyms.A, u.student2.id);
    expect(!otherGym.ok && otherGym.error.kind).toBe('forbidden');
    const { count } = await admin.from('trainer_students').select('*', { count: 'exact', head: true }).eq('gym_id', gyms.A);
    expect(count).toBe(1);
  });

  it('yalnızca öğrenci kabul eder; hoca, yönetici ve başkası edemez', async () => {
    for (const who of ['trainer', 'admin', 'student2'] as Key[]) {
      const r = await respondTrainerRequest(c[who].client, linkId, true);
      expect(!r.ok && r.error.kind, who).toBe('forbidden');
    }
    expect((await row(linkId)).status).toBe('pending');
  });

  it('eski metinle onay kabul edilmez', async () => {
    const { error } = await c.student.client.rpc('respond_trainer_request', {
      p_id: linkId,
      p_accept: true,
      p_consent_version: '2020-01',
    });
    expect(error?.message).toContain('consent_outdated');
    const noVersion = await c.student.client.rpc('respond_trainer_request', { p_id: linkId, p_accept: true });
    expect(noVersion.error?.message).toContain('consent_outdated');
  });

  it('öğrenci kabul eder: rıza sürümü ve zamanı yazılır; ikinci yanıt reddedilir', async () => {
    value(await respondTrainerRequest(c.student.client, linkId, true));
    const r = await row(linkId);
    expect(r).toMatchObject({ status: 'active', consent_version: TRAINER_CONSENT_VERSION });
    expect(r.consented_at).toBeTruthy();
    expect(r.responded_at).toBeTruthy();
    const again = await respondTrainerRequest(c.student.client, linkId, false);
    expect(!again.ok && again.error.kind).toBe('trainer_link_closed');
  });

  it('istemci tabloya doğrudan yazamaz', async () => {
    const insert = await c.trainer.client
      .from('trainer_students')
      .insert({ gym_id: gyms.A, trainer_id: u.trainer.id, student_id: u.student2.id });
    expect(insert.error).not.toBeNull();
    const update = await c.trainer.client.from('trainer_students').update({ status: 'active' }).eq('id', linkId).select('id');
    expect(update.error != null || (update.data ?? []).length === 0).toBe(true);
  });

  it('öğrenci reddeder: declined; sonra yeniden istenebilir', async () => {
    const id = value(await requestStudent(c.trainer.client, gyms.A, u.student2.id));
    value(await respondTrainerRequest(c.student2.client, id, false));
    expect((await row(id)).status).toBe('declined');
    // Açık listede görünmez
    expect((await linksOf('student2')).map((l) => l.id)).not.toContain(id);
    const again = value(await requestStudent(c.trainer.client, gyms.A, u.student2.id));
    expect(again).not.toBe(id);
  });
});

describe('kim görür', () => {
  it('hoca yalnızca kendi bağlarını görür, başka hocanınkileri görmez', async () => {
    const other = value(await requestStudent(c.trainer2.client, gyms.A, u.student3.id));
    const mine = await linksOf('trainer');
    expect(mine.every((l) => l.trainerId === u.trainer.id)).toBe(true);
    expect(mine.map((l) => l.id)).not.toContain(other);
    const direct = await c.trainer.client.from('trainer_students').select('id').eq('id', other);
    expect(direct.data).toEqual([]);
  });

  it('yönetici salondaki bağları (adlarla) görür ama kuramaz', async () => {
    const all = await linksOf('admin', gyms.A);
    const active = all.find((l) => l.studentId === u.student.id && l.status === 'active');
    expect(active).toMatchObject({ trainerName: 'Duygu', studentName: 'Ayşe' });
    expect(all.some((l) => l.trainerId === u.trainer2.id)).toBe(true);
    // Yönetici kendisi istek gönderebilir (hoca gibi) ama başkası adına bağ kuramaz / kabul edemez
    const pending = all.find((l) => l.status === 'pending')!;
    const accept = await respondTrainerRequest(c.admin.client, pending.id, true);
    expect(!accept.ok && accept.error.kind).toBe('forbidden');
  });

  it('başka salonun hocası ve üyesi hiçbir şey görmez', async () => {
    expect(await linksOf('trainerB')).toEqual([]);
    expect(await linksOf('outsider')).toEqual([]);
    expect(await linksOf('trainerB', gyms.A)).toEqual([]);
  });
});

describe('bitiş', () => {
  it('hoca bitirir; öğrenci bitirir; bitmiş bağ yeniden bitirilemez', async () => {
    const id = value(await requestStudent(c.trainer2.client, gyms.A, u.student.id));
    value(await respondTrainerRequest(c.student.client, id, true));
    value(await endTrainerLink(c.trainer2.client, id));
    expect(await row(id)).toMatchObject({ status: 'ended', ended_by: u.trainer2.id });
    const again = await endTrainerLink(c.student.client, id);
    expect(!again.ok && again.error.kind).toBe('trainer_link_closed');

    const mine = (await linksOf('student')).find((l) => l.trainerId === u.trainer.id && l.status === 'active')!;
    value(await endTrainerLink(c.student.client, mine.id));
    expect(await row(mine.id)).toMatchObject({ status: 'ended', ended_by: u.student.id });
  });

  it('bağın tarafı olmayan bitiremez', async () => {
    const id = value(await requestStudent(c.trainer.client, gyms.A, u.student.id));
    for (const who of ['admin', 'student2', 'trainer2'] as Key[]) {
      const r = await endTrainerLink(c[who].client, id);
      expect(!r.ok && r.error.kind, who).toBe('forbidden');
    }
    value(await endTrainerLink(c.trainer.client, id)); // istek geri çekildi
    expect((await row(id)).status).toBe('ended');
  });

  it('öğrenci salondan ayrılınca bağ biter', async () => {
    const id = value(await requestStudent(c.trainer.client, gyms.A, u.leaver.id));
    value(await respondTrainerRequest(c.leaver.client, id, true));
    value(await leaveGym(c.leaver.client, { gymId: gyms.A, role: 'member' }, u.leaver.id));
    expect((await row(id)).status).toBe('ended');
  });

  it('yönetici üyeyi çıkarınca bağ biter', async () => {
    const id = value(await requestStudent(c.trainer.client, gyms.A, u.kicked.id));
    value(await respondTrainerRequest(c.kicked.client, id, true));
    value(await removeMember(c.admin.client, gyms.A, u.kicked.id));
    expect(await row(id)).toMatchObject({ status: 'ended', ended_by: u.admin.id });
  });

  it('hoca rolü kalkınca hocalık bağları biter (bekleyen istek dahil)', async () => {
    const active = value(await requestStudent(c.trainer.client, gyms.A, u.student.id));
    value(await respondTrainerRequest(c.student.client, active, true));
    const pending = value(await requestStudent(c.trainer.client, gyms.A, u.student3.id));
    value(await updateMember(c.admin.client, gyms.A, u.trainer.id, { role: 'member' }));
    expect((await row(active)).status).toBe('ended');
    expect((await row(pending)).status).toBe('ended');
    // Artık istek gönderemez
    const r = await requestStudent(c.trainer.client, gyms.A, u.student.id);
    expect(!r.ok && r.error.kind).toBe('forbidden');
  });

  it('hesap silinince bağlar silinir', async () => {
    const id = value(await requestStudent(c.trainer2.client, gyms.A, u.student2.id));
    await admin.auth.admin.deleteUser(u.student2.id);
    const { data } = await admin.from('trainer_students').select('id').eq('id', id);
    expect(data).toEqual([]);
  });
});
