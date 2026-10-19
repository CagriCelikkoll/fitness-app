/**
 * Gerçek sunucu — hoca ve salon programları (v3.6b, 0011_programs.sql).
 * Uygulamanın kendi fonksiyonlarıyla (src/lib/programs.ts), her rolün
 * kendi oturumuyla. Hoca–öğrenci bağları service role ile hazır kuruluyor
 * (rıza akışı trainers.int.ts'te deneniyor); bağı bitirme uygulamanın
 * fonksiyonuyla.
 */

import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { updateDisplayName } from '@/lib/profile';
import {
  assignProgram,
  fetchAssignments,
  fetchPrograms,
  saveProgram,
  setProgramArchived,
  unassignProgram,
  type GymProgram,
  type ProgramInput,
  type ProgramPayload,
} from '@/lib/programs';
import { TRAINER_CONSENT_VERSION, endTrainerLink } from '@/lib/trainers';

import { admin, createUser, deleteCreatedUsers, signedIn, stopAppClients, type AppClient, type TestUser } from './support';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const joinCode = () =>
  Array.from(randomBytes(8))
    .map((b) => ALPHABET[b % ALPHABET.length])
    .join('');

type Key = 'admin' | 'trainer' | 'trainer2' | 'student' | 'pending' | 'member' | 'outsider';
const KEYS: Key[] = ['admin', 'trainer', 'trainer2', 'student', 'pending', 'member', 'outsider'];
const u = {} as Record<Key, TestUser>;
const c = {} as Record<Key, AppClient>;
const gyms = {} as Record<'A' | 'B', string>;
const links = {} as Record<'student' | 'pending', string>;

const PAYLOAD: ProgramPayload = {
  schema: 1,
  days: [
    {
      name: 'A',
      exercises: [
        { exerciseId: 'Barbell_Squat', sets: 3, repsMin: 8, repsMax: 10, restSec: 120, notes: 'Diz içe kaçmasın' },
        { exerciseId: 'Leg_Press', sets: 2, repsMin: 12, repsMax: 12, restSec: 90, notes: null },
      ],
    },
  ],
};

async function createGym(name: string) {
  const { data, error } = await admin.from('gyms').insert({ name: `INT ${name}`, join_code: joinCode() }).select('id').single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

function value<T>(r: { ok: true; value: T } | { ok: false; error: { kind: string } }): T {
  if (!r.ok) throw new Error(r.error.kind);
  return r.value;
}

const input = (over: Partial<ProgramInput> = {}): ProgramInput => ({
  id: null,
  gymId: gyms.A,
  name: 'Full Body',
  description: 'Haftada 2 gün',
  visibility: 'students',
  payload: PAYLOAD,
  ...over,
});

async function visible(who: Key): Promise<GymProgram[]> {
  return value(await fetchPrograms(c[who].client)).programs;
}

/** Tabloyu doğrudan okuma (RLS) */
async function directIds(who: Key): Promise<string[]> {
  const { data, error } = await c[who].client.from('gym_programs').select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: { id: string }) => r.id);
}

async function serverRow(id: string) {
  const { data, error } = await admin.from('gym_programs').select('*').eq('id', id).single();
  if (error) throw new Error(error.message);
  return data as Record<string, unknown>;
}

beforeAll(async () => {
  gyms.A = await createGym('Program A');
  gyms.B = await createGym('Program B');
  for (const k of KEYS) u[k] = await createUser(`prog-${k}`);
  await admin.from('gym_members').insert([
    { gym_id: gyms.A, user_id: u.admin.id, role: 'admin' },
    { gym_id: gyms.A, user_id: u.trainer.id, role: 'trainer' },
    { gym_id: gyms.A, user_id: u.trainer2.id, role: 'trainer' },
    { gym_id: gyms.A, user_id: u.student.id, role: 'member' },
    { gym_id: gyms.A, user_id: u.pending.id, role: 'member' },
    { gym_id: gyms.A, user_id: u.member.id, role: 'member' },
    { gym_id: gyms.B, user_id: u.outsider.id, role: 'member' },
  ]);
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from('trainer_students')
    .insert([
      {
        gym_id: gyms.A,
        trainer_id: u.trainer.id,
        student_id: u.student.id,
        status: 'active',
        responded_at: now,
        consent_version: TRAINER_CONSENT_VERSION,
        consented_at: now,
      },
      { gym_id: gyms.A, trainer_id: u.trainer.id, student_id: u.pending.id, status: 'pending' },
    ])
    .select('id, student_id');
  if (error) throw new Error(error.message);
  for (const r of data as { id: string; student_id: string }[]) {
    if (r.student_id === u.student.id) links.student = r.id;
    else links.pending = r.id;
  }
  for (const k of KEYS) c[k] = await signedIn(u[k]);
  await updateDisplayName(c.trainer.client, u.trainer.id, 'Duygu');
});

afterAll(async () => {
  await stopAppClients();
  await deleteCreatedUsers();
  await admin.from('gyms').delete().in('id', [gyms.A, gyms.B].filter(Boolean));
});

describe('programlar', () => {
  let gymProgram: string;
  let studentProgram: string;
  let otherProgram: string;

  it('hoca salon ve öğrenci programı oluşturur; üye oluşturamaz; istemci tabloya yazamaz', async () => {
    gymProgram = value(await saveProgram(c.trainer.client, input({ name: 'Başlangıç', visibility: 'gym' })));
    studentProgram = value(await saveProgram(c.trainer.client, input()));
    otherProgram = value(await saveProgram(c.trainer2.client, input({ name: 'Trainer2' })));
    expect(await serverRow(studentProgram)).toMatchObject({ author_id: u.trainer.id, version: 1, visibility: 'students' });

    const byMember = await saveProgram(c.member.client, input());
    expect(!byMember.ok && byMember.error.kind).toBe('forbidden');
    const otherGym = await saveProgram(c.outsider.client, input());
    expect(!otherGym.ok && otherGym.error.kind).toBe('forbidden');

    const { error } = await c.trainer.client.from('gym_programs').insert({
      gym_id: gyms.A,
      author_id: u.trainer.id,
      name: 'Doğrudan',
      visibility: 'gym',
      payload: { schema: 1, days: [] },
    });
    expect(error).not.toBeNull();
    const { error: aErr } = await c.trainer.client
      .from('program_assignments')
      .insert({ program_id: studentProgram, student_id: u.student.id });
    expect(aErr).not.toBeNull();
  });

  it('şema doğrulaması sunucuda: fazla gün, boş egzersiz, uçuk sayılar, bozuk biçim', async () => {
    const day = PAYLOAD.days[0];
    const bad: ProgramPayload[] = [
      { schema: 1, days: Array.from({ length: 8 }, () => day) },
      { schema: 1, days: [] },
      { schema: 1, days: [{ name: 'A', exercises: [] }] },
      { schema: 1, days: [{ name: ' ', exercises: day.exercises }] },
      { schema: 1, days: [{ name: 'A', exercises: Array.from({ length: 21 }, () => day.exercises[0]) }] },
      { schema: 1, days: [{ name: 'A', exercises: [{ ...day.exercises[0], sets: 99 }] }] },
      { schema: 1, days: [{ name: 'A', exercises: [{ ...day.exercises[0], repsMin: 12, repsMax: 8 }] }] },
      { schema: 1, days: [{ name: 'A', exercises: [{ ...day.exercises[0], restSec: 5000 }] }] },
      { schema: 1, days: [{ name: 'A', exercises: [{ ...day.exercises[0], sets: 2.5 }] }] },
      { schema: 1, days: [{ name: 'A', exercises: [{ ...day.exercises[0], notes: 'x'.repeat(201) }] }] },
    ];
    for (const [i, payload] of bad.entries()) {
      const r = await saveProgram(c.trainer.client, input({ payload }));
      expect(!r.ok && r.error.kind, `#${i}`).toBe('program_invalid');
    }
    // Uygulamanın göndermeyeceği biçimler (doğrudan RPC)
    for (const p_payload of [
      { schema: 2, days: [{ name: 'A', exercises: [] }] },
      { schema: 1, days: [{ name: 'A', exercises: [{ exercise_id: 'x', sets: '3', reps_min: 8, reps_max: 10, rest_sec: 90 }] }] },
      'metin',
    ]) {
      const { error } = await c.trainer.client.rpc('save_program', {
        p_id: null,
        p_gym_id: gyms.A,
        p_name: 'X',
        p_description: '',
        p_visibility: 'gym',
        p_payload,
      });
      expect(error?.message).toContain('program_invalid');
    }
    const longName = await saveProgram(c.trainer.client, input({ name: 'x'.repeat(61) }));
    expect(!longName.ok && longName.error.kind).toBe('program_invalid');
  });

  it('üye salon programını okur, atanmamış öğrenci programını okuyamaz', async () => {
    for (const who of ['member', 'student', 'pending'] as const) {
      const ids = (await visible(who)).map((p) => p.id);
      expect(ids, who).toContain(gymProgram);
      expect(ids, who).not.toContain(studentProgram);
      expect(await directIds(who), who).not.toContain(studentProgram);
    }
    const p = (await visible('member')).find((x) => x.id === gymProgram)!;
    expect(p).toMatchObject({ authorName: 'Duygu', assignedAt: null, visibility: 'gym' });
    expect(p.payload?.days[0].exercises[0]).toMatchObject({ exerciseId: 'Barbell_Squat', notes: 'Diz içe kaçmasın' });
  });

  it('başka salon hiçbir şey görmez', async () => {
    expect(await visible('outsider')).toEqual([]);
    expect(await directIds('outsider')).toEqual([]);
    expect(value(await fetchAssignments(c.outsider.client))).toEqual([]);
  });

  it('aktif olmayan öğrenciye atama reddedilir (bekleyen, bağsız, başka hocanın, başka salon)', async () => {
    for (const who of ['pending', 'member', 'outsider', 'trainer2'] as const) {
      const r = await assignProgram(c.trainer.client, studentProgram, [u[who].id]);
      expect(!r.ok && r.error.kind, who).toBe('student_not_active');
    }
    // Biri geçersizse hiçbiri atanmaz
    const mixed = await assignProgram(c.trainer.client, studentProgram, [u.student.id, u.member.id]);
    expect(!mixed.ok && mixed.error.kind).toBe('student_not_active');
    const { count } = await admin.from('program_assignments').select('*', { count: 'exact', head: true }).eq('program_id', studentProgram);
    expect(count).toBe(0);
  });

  it('hoca başka hocanın programını düzenleyemez, atayamaz, arşivleyemez; üye de', async () => {
    for (const who of ['trainer', 'member', 'student'] as const) {
      const edit = await saveProgram(c[who].client, input({ id: otherProgram, name: 'Ele geçirildi' }));
      expect(!edit.ok && edit.error.kind, who).toBe('forbidden');
      const archive = await setProgramArchived(c[who].client, otherProgram, true);
      expect(!archive.ok && archive.error.kind, who).toBe('forbidden');
      const assign = await assignProgram(c[who].client, otherProgram, [u.student.id]);
      expect(!assign.ok && assign.error.kind, who).toBe('forbidden');
    }
    expect(await serverRow(otherProgram)).toMatchObject({ name: 'Trainer2', archived_at: null, version: 1 });
    // Hoca başka hocanın öğrenci programını göremez bile
    expect((await visible('trainer')).map((p) => p.id)).not.toContain(otherProgram);
  });

  it('atanmış aktif öğrenci okur; hoca atamayı görür; bildirim için satır yazılır', async () => {
    expect(value(await assignProgram(c.trainer.client, studentProgram, [u.student.id]))).toBe(1);
    // Zaten atanmış: tekrar sayılmaz
    expect(value(await assignProgram(c.trainer.client, studentProgram, [u.student.id]))).toBe(0);

    const mine = (await visible('student')).find((p) => p.id === studentProgram);
    expect(mine?.assignedAt).not.toBeNull();
    expect(mine?.authorName).toBe('Duygu');
    expect(await directIds('student')).toContain(studentProgram);
    expect((await visible('member')).map((p) => p.id)).not.toContain(studentProgram);

    const asTrainer = value(await fetchAssignments(c.trainer.client));
    expect(asTrainer.map((a) => [a.programId, a.studentId])).toEqual([[studentProgram, u.student.id]]);
    expect(value(await fetchAssignments(c.student.client)).map((a) => a.programId)).toEqual([studentProgram]);
    // Başka hoca atamayı görmez
    expect(value(await fetchAssignments(c.trainer2.client))).toEqual([]);
  });

  it('düzenleme sürümü artırır; içerik aynıysa artmaz', async () => {
    value(await saveProgram(c.trainer.client, input({ id: studentProgram })));
    expect((await serverRow(studentProgram)).version).toBe(1);
    const changed: ProgramPayload = { ...PAYLOAD, days: [...PAYLOAD.days, { name: 'B', exercises: PAYLOAD.days[0].exercises }] };
    value(await saveProgram(c.trainer.client, input({ id: studentProgram, payload: changed })));
    expect((await serverRow(studentProgram)).version).toBe(2);
    const seen = (await visible('student')).find((p) => p.id === studentProgram);
    expect(seen?.version).toBe(2);
    expect(seen?.payload?.days.map((d) => d.name)).toEqual(['A', 'B']);
  });

  it('yönetici salondaki programı düzenler, arşivler; arşivdeki program üyeye görünmez, atanamaz', async () => {
    value(await saveProgram(c.admin.client, input({ id: otherProgram, name: 'Yönetici düzeltti' })));
    expect(await serverRow(otherProgram)).toMatchObject({ name: 'Yönetici düzeltti', version: 2, author_id: u.trainer2.id });
    expect((await visible('admin')).map((p) => p.id)).toEqual(expect.arrayContaining([gymProgram, studentProgram, otherProgram]));

    value(await setProgramArchived(c.admin.client, gymProgram, true));
    expect((await visible('member')).map((p) => p.id)).not.toContain(gymProgram);
    // Yazar arşivdekini görür ve geri alabilir
    expect((await visible('trainer')).find((p) => p.id === gymProgram)?.archivedAt).not.toBeNull();
    const assign = await assignProgram(c.trainer.client, gymProgram, [u.student.id]);
    expect(!assign.ok && assign.error.kind).toBe('program_archived');
    value(await setProgramArchived(c.trainer.client, gymProgram, false));
    expect((await visible('member')).map((p) => p.id)).toContain(gymProgram);
  });

  it('atama kaldırılınca öğrenci okuyamaz; yeniden atanabilir', async () => {
    value(await unassignProgram(c.trainer.client, studentProgram, u.student.id));
    expect((await visible('student')).map((p) => p.id)).not.toContain(studentProgram);
    expect(value(await fetchAssignments(c.student.client))).toEqual([]);
    const { data } = await admin.from('program_assignments').select('removed_at').eq('program_id', studentProgram);
    expect(data?.every((r) => r.removed_at != null)).toBe(true);
    expect(value(await assignProgram(c.trainer.client, studentProgram, [u.student.id]))).toBe(1);
    expect((await visible('student')).map((p) => p.id)).toContain(studentProgram);
  });

  it('bağ bitince atama görünmez (silinmez); yeniden atanamaz', async () => {
    value(await endTrainerLink(c.student.client, links.student));
    expect((await visible('student')).map((p) => p.id)).not.toContain(studentProgram);
    expect(await directIds('student')).not.toContain(studentProgram);
    expect(value(await fetchAssignments(c.student.client))).toEqual([]);
    // Satır duruyor, hoca hâlâ görüyor (arayüz bağı biteni göstermiyor)
    const { count } = await admin
      .from('program_assignments')
      .select('*', { count: 'exact', head: true })
      .eq('program_id', studentProgram)
      .is('removed_at', null);
    expect(count).toBe(1);
    const again = await assignProgram(c.trainer.client, studentProgram, [u.student.id]);
    expect(!again.ok && again.error.kind).toBe('student_not_active');
    // Salon programı üye olarak hâlâ açık
    expect((await visible('student')).map((p) => p.id)).toContain(gymProgram);
  });

  it('hoca rolü kalkınca kendi programını düzenleyemez; yönetici düzenleyebilir', async () => {
    await admin.from('gym_members').update({ role: 'member' }).eq('gym_id', gyms.A).eq('user_id', u.trainer2.id);
    const r = await saveProgram(c.trainer2.client, input({ id: otherProgram, name: 'Artık hoca değil' }));
    expect(!r.ok && r.error.kind).toBe('forbidden');
    expect((await visible('trainer2')).map((p) => p.id)).not.toContain(otherProgram);
    value(await saveProgram(c.admin.client, input({ id: otherProgram, name: 'Devraldı' })));
  });
});
