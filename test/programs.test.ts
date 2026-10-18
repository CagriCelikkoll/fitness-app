/**
 * Hoca ve salon programları (v3.6b): payload ↔ sunucu biçimi, doğrulama
 * (sunucuyla aynı sınırlar), hazır programdan taslak, program → yerel
 * rutin dönüşümü (bilinmeyen egzersiz atlanır), sürüm farkı / rozet,
 * güncelleme akışı (geçmiş antrenmanlar bozulmaz), bildirim olayları ve
 * metinleri, push → ekran.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';

import {
  CHANNEL_TRAINER,
  buildMessages,
  parseWebhook,
  programContent,
  programUpdateRecipients,
  type ProgramEvent,
} from '../supabase/functions/notify/logic';
import type { Db } from '@/db/client';
import { routineExercises, routines, sessionExercises, workoutSessions } from '@/db/schema';
import { classifyAccountError } from '@/lib/auth';
import { addProgramRoutines, updateProgramRoutines } from '@/lib/programRoutines';
import {
  PROGRAM_LIMITS,
  assignedPrograms,
  canManageProgram,
  dismissUpdate,
  gymPrograms,
  managedPrograms,
  parsePayload,
  parseProgramRows,
  parseRepRange,
  parseRoutineLinks,
  planRoutines,
  programRoutineName,
  programUpdates,
  pruneLinks,
  readProgramCache,
  replaceProgramLinks,
  repsText,
  restText,
  skippedText,
  templateToDraft,
  toServerPayload,
  updateBadgeText,
  validateProgram,
  writeProgramCache,
  type GymProgram,
  type ProgramPayload,
  type ProgramRoutineLink,
} from '@/lib/programs';
import { pushTarget } from '@/lib/push';
import { WORKOUT_TEMPLATES } from '@/lib/workoutTemplates';
import { createCompletedSession, createTestDb, seedExercise, type TestDb } from './helpers/testDb';

const ROOT = path.resolve(__dirname, '..');
const GYM = 'g1';

const ex = (exerciseId: string, over: Partial<ProgramPayload['days'][0]['exercises'][0]> = {}) => ({
  exerciseId,
  sets: 3,
  repsMin: 8,
  repsMax: 10,
  restSec: 90,
  notes: null,
  ...over,
});

const payload = (days: ProgramPayload['days']): ProgramPayload => ({ schema: 1, days });

const program = (over: Partial<GymProgram> = {}): GymProgram => ({
  id: 'p1',
  gymId: GYM,
  authorId: 'trainer',
  authorName: 'Duygu',
  name: 'Full Body',
  description: '',
  visibility: 'students',
  payload: payload([{ name: 'A', exercises: [ex('squat')] }]),
  version: 1,
  createdAt: '2026-10-01T10:00:00Z',
  updatedAt: '2026-10-01T10:00:00Z',
  archivedAt: null,
  assignedAt: null,
  ...over,
});

function memoryStore() {
  const data = new Map<string, string>();
  return { data, getItem: async (k: string) => data.get(k) ?? null, setItem: async (k: string, v: string) => void data.set(k, v) };
}

describe('payload', () => {
  const server = {
    schema: 1,
    days: [
      {
        name: 'A',
        exercises: [
          { exercise_id: 'Barbell_Squat', sets: 3, reps_min: 8, reps_max: 10, rest_sec: 120, notes: 'Diz içe kaçmasın' },
          { exercise_id: 'Leg_Press', sets: 2, reps_min: 12, reps_max: 12, rest_sec: 90, notes: null },
        ],
      },
    ],
  };

  it('sunucu biçimi ↔ uygulama, gidiş dönüş aynı', () => {
    const p = parsePayload(server)!;
    expect(p.days[0].exercises[0]).toEqual({
      exerciseId: 'Barbell_Squat',
      sets: 3,
      repsMin: 8,
      repsMax: 10,
      restSec: 120,
      notes: 'Diz içe kaçmasın',
    });
    expect(toServerPayload(p)).toEqual(server);
  });

  it('tanımadığımız şema ya da bozuk alan → null (uygulamayı güncelle)', () => {
    expect(parsePayload({ ...server, schema: 2 })).toBeNull();
    expect(parsePayload({ schema: 1, days: [{ name: 'A', exercises: [{ exercise_id: 'x', sets: '3' }] }] })).toBeNull();
    expect(parsePayload(null)).toBeNull();
  });

  it('boş not null, notlar ve gün adı kırpılır', () => {
    const p = payload([{ name: ' A ', exercises: [ex('x', { notes: '   ' }), ex('y', { notes: ' yavaş ' })] }]);
    const s = toServerPayload(p);
    expect(s.days[0].name).toBe('A');
    expect(s.days[0].exercises.map((e) => e.notes)).toEqual([null, 'yavaş']);
  });

  it('satırlar: bozuk satır atlanır, payload okunamazsa null kalır', () => {
    const rows = parseProgramRows([
      { id: 'p1', gym_id: GYM, name: 'X', visibility: 'gym', version: 2, payload: server, author_name: 'Duygu', assigned_at: null },
      { id: 'p2', gym_id: GYM, name: 'Y', visibility: 'students', version: 1, payload: { schema: 9 } },
      { id: 'p3', gym_id: GYM, name: 'Z', visibility: 'herkes', version: 1, payload: server },
    ]);
    expect(rows.map((r) => r.id)).toEqual(['p1', 'p2']);
    expect(rows[1].payload).toBeNull();
    expect(rows[0].authorName).toBe('Duygu');
  });
});

describe('tekrar, dinlenme', () => {
  it('tekrar aralığı', () => {
    expect(repsText(8, 10)).toBe('8-10');
    expect(repsText(10, 10)).toBe('10');
    expect(parseRepRange('8-12')).toEqual({ min: 8, max: 12 });
    expect(parseRepRange('10')).toEqual({ min: 10, max: 10 });
    expect(parseRepRange('8-')).toEqual({ min: 8, max: 8 });
    expect(parseRepRange('12-8')).toBeNull();
    expect(parseRepRange('0')).toBeNull();
    expect(parseRepRange('5-150')).toBeNull();
    expect(parseRepRange('')).toBeNull();
  });

  it('dinlenme metni', () => {
    expect(restText(0)).toBe('Dinlenme yok');
    expect(restText(45)).toBe('45 sn');
    expect(restText(90)).toBe('90 sn');
    expect(restText(120)).toBe('2 dk');
    expect(restText(150)).toBe('2 dk 30 sn');
  });
});

describe('doğrulama (sunucuyla aynı sınırlar)', () => {
  const ok = { name: 'Full Body', description: '', payload: payload([{ name: 'A', exercises: [ex('x')] }]) };

  it('geçerli program', () => {
    expect(validateProgram(ok)).toBeNull();
  });

  it('fazla gün, boş gün, boş ad, uçuk sayılar', () => {
    const day = { name: 'A', exercises: [ex('x')] };
    expect(validateProgram({ ...ok, name: '  ' })).toMatch(/ad ver/);
    expect(validateProgram({ ...ok, payload: payload([]) })).toMatch(/En az bir gün/);
    expect(validateProgram({ ...ok, payload: payload(Array.from({ length: 8 }, () => day)) })).toMatch(/en fazla 7 gün/);
    expect(validateProgram({ ...ok, payload: payload([{ name: 'A', exercises: [] }]) })).toMatch(/en az bir egzersiz/);
    expect(validateProgram({ ...ok, payload: payload([{ name: 'A', exercises: Array.from({ length: 21 }, () => ex('x')) }]) })).toMatch(
      /en fazla 20 egzersiz/
    );
    expect(validateProgram({ ...ok, payload: payload([{ name: 'A', exercises: [ex('x', { sets: 50 })] }]) })).toMatch(/set/);
    expect(validateProgram({ ...ok, payload: payload([{ name: 'A', exercises: [ex('x', { repsMin: 12, repsMax: 8 })] }]) })).toMatch(
      /tekrar/
    );
    expect(validateProgram({ ...ok, payload: payload([{ name: 'A', exercises: [ex('x', { restSec: 3600 })] }]) })).toMatch(
      /dinlenme/
    );
  });

  it('sınırlar migration\'daki sayılarla aynı', () => {
    const sql = readFileSync(path.join(ROOT, 'supabase/migrations/0011_programs.sql'), 'utf8');
    const L = PROGRAM_LIMITS;
    expect(sql).toContain(`v_n < 1 or v_n > ${L.daysMax}`);
    expect(sql).toContain(`v_n < 1 or v_n > ${L.exercisesMax}`);
    expect(sql).toContain(`char_length(v_day ->> 'name') > ${L.dayNameMax}`);
    expect(sql).toContain(`program_int_ok(v_ex -> 'sets', 1, ${L.setsMax})`);
    expect(sql).toContain(`program_int_ok(v_ex -> 'reps_min', 1, ${L.repsMax})`);
    expect(sql).toContain(`program_int_ok(v_ex -> 'rest_sec', 0, ${L.restMax})`);
    expect(sql).toContain(`char_length(v_ex ->> 'notes') > ${L.notesMax}`);
    expect(sql).toContain(`char_length(name) <= ${L.nameMax}`);
    expect(sql).toContain(`char_length(description) <= ${L.descriptionMax}`);
  });

  it('sunucu hata kodları Türkçe mesaja dönüşüyor', () => {
    expect(classifyAccountError({ message: 'program_invalid' })).toBe('program_invalid');
    expect(classifyAccountError({ message: 'student_not_active' })).toBe('student_not_active');
    expect(classifyAccountError({ message: 'program_archived' })).toBe('program_archived');
  });
});

describe('hazır programdan başla', () => {
  it.each(WORKOUT_TEMPLATES.map((t) => [t.id, t] as const))('%s taslağı geçerli', (_id, t) => {
    const draft = templateToDraft(t);
    expect(validateProgram(draft)).toBeNull();
    expect(draft.payload.days).toHaveLength(t.days.length);
    expect(draft.payload.days[0].exercises[0].exerciseId).toBe(t.days[0].exercises[0].exerciseId);
    const first = t.days[0].exercises[0];
    expect(repsText(draft.payload.days[0].exercises[0].repsMin, draft.payload.days[0].exercises[0].repsMax)).toBe(first.reps);
  });
});

describe('program → yerel rutin planı', () => {
  it('rutin adı', () => {
    expect(programRoutineName('Full Body', 'A', 'Duygu')).toBe('Full Body – A · Duygu Hoca');
    expect(programRoutineName('Full Body', 'A', null)).toBe('Full Body – A');
  });

  it('bilinmeyen egzersiz atlanır, boş kalan gün rutin olmaz, uyarı', () => {
    const p = payload([
      { name: 'A', exercises: [ex('known'), ex('yeni-hareket')] },
      { name: 'B', exercises: [ex('baska-yeni')] },
      { name: 'C', exercises: [ex('known')] },
    ]);
    const plan = planRoutines(p, new Set(['known']));
    expect(plan.days.map((d) => [d.dayIndex, d.exercises.length])).toEqual([
      [0, 1],
      [2, 1],
    ]);
    expect(plan.skippedExercises).toBe(2);
    expect(plan.skippedDays).toEqual(['B']);
    expect(skippedText(plan)).toBe(
      '2 egzersiz bu uygulamanın kütüphanesinde bulunamadı ve atlandı. "B" günü boş kaldığı için eklenmedi.'
    );
    expect(skippedText(planRoutines(p, new Set(['known', 'yeni-hareket', 'baska-yeni'])))).toBeNull();
  });
});

describe('sürüm farkı ve rozet', () => {
  const link = (over: Partial<ProgramRoutineLink> = {}): ProgramRoutineLink => ({
    routineId: 'r1',
    programId: 'p1',
    version: 1,
    dayIndex: 0,
    ...over,
  });

  it('program yeni sürümdeyse güncelleme var; aynıysa yok', () => {
    const links = [link(), link({ routineId: 'r2', dayIndex: 1 })];
    expect(programUpdates(links, [program({ version: 1 })])).toEqual([]);
    const u = programUpdates(links, [program({ version: 3 })]);
    expect(u).toHaveLength(1);
    expect(u[0].routineIds).toEqual(['r1', 'r2']);
  });

  it('arşivlenen, görünmeyen ya da okunamayan program rozet çıkarmaz', () => {
    expect(programUpdates([link()], [program({ version: 2, archivedAt: '2026-10-02' })])).toEqual([]);
    expect(programUpdates([link()], [program({ id: 'baska', version: 2 })])).toEqual([]);
    expect(programUpdates([link()], [program({ version: 2, payload: null })])).toEqual([]);
  });

  it('"Böyle kalsın" rozeti bu sürüm için kaldırır, sonraki sürümde yine çıkar', () => {
    const kept = dismissUpdate([link(), link({ programId: 'p2', routineId: 'r9' })], 'p1', 2);
    expect(kept.map((l) => l.version)).toEqual([2, 1]);
    expect(programUpdates(kept, [program({ version: 2 })])).toEqual([]);
    expect(programUpdates(kept, [program({ version: 3 })])).toHaveLength(1);
  });

  it('silinen rutinin bağı düşer; bağlar yenileriyle değişir', () => {
    expect(pruneLinks([link(), link({ routineId: 'gitti' })], new Set(['r1']))).toEqual([link()]);
    const next = replaceProgramLinks([link(), link({ programId: 'p2' })], 'p1', [link({ routineId: 'r5', version: 2 })]);
    expect(next.map((l) => `${l.programId}:${l.routineId}`)).toEqual(['p2:r1', 'p1:r5']);
  });

  it('bozuk kayıt boş liste', () => {
    expect(parseRoutineLinks('bozuk')).toEqual([]);
    expect(parseRoutineLinks(JSON.stringify([link(), { routineId: 1 }]))).toEqual([link()]);
  });

  it('rozet metni', () => {
    expect(updateBadgeText(program({ visibility: 'students' }))).toBe('Hocan programı güncelledi');
    expect(updateBadgeText(program({ visibility: 'gym', assignedAt: '2026-10-01' }))).toBe('Hocan programı güncelledi');
    expect(updateBadgeText(program({ visibility: 'gym' }))).toBe('Salon programı güncellendi');
  });
});

describe('listeler ve yetki', () => {
  const memberships = [
    { gymId: GYM, role: 'trainer' as const },
    { gymId: 'g2', role: 'admin' as const },
  ];

  it('Hocamın programları / Salon programları', () => {
    const list = [
      program({ id: 'a', assignedAt: '2026-10-02' }),
      program({ id: 'b', visibility: 'gym', name: 'Başlangıç' }),
      program({ id: 'c', visibility: 'gym', assignedAt: '2026-10-03' }),
      program({ id: 'd', visibility: 'gym', archivedAt: '2026-10-04' }),
      program({ id: 'e', visibility: 'students' }),
    ];
    expect(assignedPrograms(list).map((p) => p.id)).toEqual(['c', 'a']);
    expect(gymPrograms(list).map((p) => p.id)).toEqual(['b']);
  });

  it('hoca kendi programını, yönetici salondakileri yönetir', () => {
    expect(canManageProgram(program({ authorId: 'me' }), 'me', memberships)).toBe(true);
    expect(canManageProgram(program({ authorId: 'other' }), 'me', memberships)).toBe(false);
    expect(canManageProgram(program({ gymId: 'g2', authorId: 'other' }), 'me', memberships)).toBe(true);
    expect(canManageProgram(program({ authorId: 'me' }), 'me', [{ gymId: GYM, role: 'member' }])).toBe(false);
    const { active, archived } = managedPrograms(
      [program({ id: 'x', authorId: 'me' }), program({ id: 'y', authorId: 'other' }), program({ id: 'z', authorId: 'me', archivedAt: '2026-10-05' })],
      GYM,
      'me',
      memberships
    );
    expect(active.map((p) => p.id)).toEqual(['x']);
    expect(archived.map((p) => p.id)).toEqual(['z']);
  });
});

describe('önbellek (çevrimdışı)', () => {
  it('ham satırlar yazılıp aynı ayrıştırıcıdan okunuyor; kullanıcıya göre', async () => {
    const store = memoryStore();
    const rows = [{ id: 'p1', gym_id: GYM, name: 'X', visibility: 'gym', version: 1, payload: toServerPayload(program().payload!) }];
    await writeProgramCache(store, 'u1', '2026-10-19T10:00:00Z', rows);
    const cache = await readProgramCache(store, 'u1');
    expect(cache?.programs.map((p) => p.id)).toEqual(['p1']);
    expect(cache?.programs[0].payload?.days[0].exercises[0].exerciseId).toBe('squat');
    expect(await readProgramCache(store, 'u2')).toBeNull();
    store.data.set('programs.cache.u3', 'bozuk');
    expect(await readProgramCache(store, 'u3')).toBeNull();
  });
});

describe('rutinlere ekleme ve güncelleme (gerçek SQLite)', () => {
  let testDb: TestDb;
  let db: Db;
  let squat: string;
  let press: string;
  let row: string;

  beforeEach(async () => {
    testDb = createTestDb();
    db = testDb.db;
    squat = await seedExercise(db, { id: 'Barbell_Squat', name: 'Squat', nameTr: 'Squat' });
    press = await seedExercise(db, { id: 'Bench', name: 'Bench Press' });
    row = await seedExercise(db, { id: 'Row', name: 'Row' });
  });

  afterEach(() => testDb.close());

  const source = (p: ProgramPayload, version = 1) => ({
    id: 'p1',
    name: 'Full Body',
    description: 'Haftada 2 gün',
    authorName: 'Duygu',
    version,
    payload: p,
  });

  async function routineRows() {
    const list = await db.select().from(routines).orderBy(asc(routines.name));
    const out = [];
    for (const r of list) {
      const ex = await db
        .select()
        .from(routineExercises)
        .where(eq(routineExercises.routineId, r.id))
        .orderBy(asc(routineExercises.orderIndex));
      out.push({ id: r.id, name: r.name, ex: ex.map((e) => [e.exerciseId, e.targetSets, e.targetReps, e.restSeconds, e.notes]) });
    }
    return out;
  }

  it('her gün bir rutin; set, tekrar, dinlenme, not; bilinmeyen egzersiz atlanır', async () => {
    const p = payload([
      { name: 'A', exercises: [ex(squat, { notes: 'Derin in' }), ex('Yok_Boyle_Bir_Hareket')] },
      { name: 'B', exercises: [ex(press, { sets: 4, repsMin: 6, repsMax: 6, restSec: 180 })] },
    ]);
    const { links, plan } = await addProgramRoutines(db, source(p));
    expect(plan.skippedExercises).toBe(1);
    expect(links.map((l) => [l.programId, l.version, l.dayIndex])).toEqual([
      ['p1', 1, 0],
      ['p1', 1, 1],
    ]);
    const rows = await routineRows();
    expect(rows.map((r) => r.name)).toEqual(['Full Body – A · Duygu Hoca', 'Full Body – B · Duygu Hoca']);
    expect(rows[0].ex).toEqual([[squat, 3, '8-10', 90, 'Derin in']]);
    expect(rows[1].ex).toEqual([[press, 4, '6', 180, null]]);
  });

  it('aynı program ikinci kez eklenince ad çakışmaz', async () => {
    const p = payload([{ name: 'A', exercises: [ex(squat)] }]);
    await addProgramRoutines(db, source(p));
    await addProgramRoutines(db, source(p));
    expect((await routineRows()).map((r) => r.name)).toEqual(['Full Body – A · Duygu Hoca', 'Full Body – A · Duygu Hoca (2)']);
  });

  it('güncelleme: rutin kimliği aynı, egzersizler yeni; yeni gün eklenir, kalkan gün dokunulmaz; geçmiş bozulmaz', async () => {
    const v1 = payload([
      { name: 'A', exercises: [ex(squat)] },
      { name: 'B', exercises: [ex(press)] },
    ]);
    const first = await addProgramRoutines(db, source(v1));
    const [routineA, routineB] = first.links.map((l) => l.routineId);

    // Rutinle yapılmış geçmiş antrenman
    const session = await createCompletedSession(db, { exerciseId: squat, startedAt: '2026-10-10T10:00:00Z', routineId: routineA });
    const before = await db.select().from(sessionExercises).where(eq(sessionExercises.sessionId, session.sessionId));

    // v2: A değişti, B kalktı, C eklendi (eski A'nın yerinde C değil, sırayla)
    const v2 = payload([
      { name: 'A', exercises: [ex(row, { sets: 5 }), ex(squat, { repsMin: 5, repsMax: 5 })] },
      { name: 'C', exercises: [ex(press)] },
    ]);
    // B'nin günü (index 1) artık "C": aynı gün sırası, rutin yeniden kullanılır
    const second = await updateProgramRoutines(db, source(v2, 2), first.links);
    expect(second.links.every((l) => l.version === 2)).toBe(true);
    expect(second.links.map((l) => l.routineId)).toEqual([routineA, routineB]);

    const rows = await routineRows();
    const a = rows.find((r) => r.id === routineA)!;
    expect(a.name).toBe('Full Body – A · Duygu Hoca');
    expect(a.ex).toEqual([
      [row, 5, '8-10', 90, null],
      [squat, 3, '5', 90, null],
    ]);
    expect(rows.find((r) => r.id === routineB)!.name).toBe('Full Body – C · Duygu Hoca');

    // Geçmiş: seans ve snapshot aynı
    const [s] = await db.select().from(workoutSessions).where(eq(workoutSessions.id, session.sessionId));
    expect(s.routineId).toBe(routineA);
    expect(await db.select().from(sessionExercises).where(eq(sessionExercises.sessionId, session.sessionId))).toEqual(before);

    // v3: tek gün kaldı → B/C rutini dokunulmadan kalır, bağı düşer
    const third = await updateProgramRoutines(db, source(payload([{ name: 'A', exercises: [ex(squat)] }]), 3), second.links);
    expect(third.links.map((l) => l.routineId)).toEqual([routineA]);
    expect((await routineRows()).find((r) => r.id === routineB)?.ex).toEqual([[press, 3, '8-10', 90, null]]);
  });

  it('güncelleme: kullanıcının sildiği günün rutini yeniden oluşur', async () => {
    const v1 = payload([
      { name: 'A', exercises: [ex(squat)] },
      { name: 'B', exercises: [ex(press)] },
    ]);
    const first = await addProgramRoutines(db, source(v1));
    await db.delete(routines).where(eq(routines.id, first.links[1].routineId));
    const next = await updateProgramRoutines(db, source(v1, 2), first.links);
    expect(next.links).toHaveLength(2);
    expect(next.links[1].routineId).not.toBe(first.links[1].routineId);
    expect((await routineRows()).map((r) => r.name)).toEqual(['Full Body – A · Duygu Hoca', 'Full Body – B · Duygu Hoca']);
  });
});

describe('bildirim (notify)', () => {
  it('atama INSERT → atandı; kaldırılmış satır yok', () => {
    const base = { type: 'INSERT', table: 'program_assignments', schema: 'public' };
    expect(parseWebhook({ ...base, record: { id: 'a1', program_id: 'p1', student_id: 's1', removed_at: null } })).toEqual({
      kind: 'program',
      change: 'assigned',
      programId: 'p1',
      studentId: 's1',
      gymId: null,
    });
    expect(parseWebhook({ ...base, type: 'UPDATE', record: { id: 'a1', program_id: 'p1', student_id: 's1', removed_at: 'x' } })).toBeNull();
  });

  it('program UPDATE: yalnızca sürüm arttıysa ve arşivde değilse', () => {
    const base = { type: 'UPDATE', table: 'gym_programs', schema: 'public' };
    const rec = { id: 'p1', gym_id: GYM, version: 3, archived_at: null };
    expect(parseWebhook({ ...base, record: rec, old_record: { ...rec, version: 2 } })).toEqual({
      kind: 'program',
      change: 'updated',
      programId: 'p1',
      studentId: null,
      gymId: GYM,
    });
    // Arşivleme / değişmeyen sürüm / yeni program bildirim değil
    expect(parseWebhook({ ...base, record: rec, old_record: rec })).toBeNull();
    expect(parseWebhook({ ...base, record: { ...rec, archived_at: 'x' }, old_record: { ...rec, version: 2 } })).toBeNull();
    expect(parseWebhook({ ...base, type: 'INSERT', record: rec })).toBeNull();
  });

  it('metinler (spec)', () => {
    const assigned: ProgramEvent = { kind: 'program', change: 'assigned', programId: 'p1', studentId: 's1', gymId: GYM };
    expect(programContent(assigned, { programName: 'Full Body', authorName: 'Duygu' })).toEqual({
      title: 'Yeni program',
      body: 'Duygu Hoca sana yeni bir program atadı: Full Body.',
    });
    expect(programContent({ ...assigned, change: 'updated' }, { programName: 'Full Body', authorName: 'Duygu' })).toEqual({
      title: 'Full Body',
      body: 'Duygu Hoca programını güncelledi.',
    });
    expect(programContent(assigned, { programName: 'X', authorName: null }).body).toBe('Hocan sana yeni bir program atadı: X.');
  });

  it('güncelleme alıcıları: açık ataması ve aktif bağı olanlar', () => {
    expect(programUpdateRecipients(['s1', 's2', 's1', 's3'], ['s1', 's3', 's9'])).toEqual(['s1', 's3']);
  });

  it('mesaj Hoca kanalından; dokununca program ayrıntısı', () => {
    const e: ProgramEvent = { kind: 'program', change: 'updated', programId: 'p1', studentId: null, gymId: GYM };
    const [m] = buildMessages(['T'], e, { title: 't', body: 'b' });
    expect(m.channelId).toBe(CHANNEL_TRAINER);
    expect(m.data).toEqual({ type: 'program-updated', gymId: GYM, programId: 'p1' });
    expect(pushTarget(m.data)).toEqual({ pathname: '/programs/[id]', params: { id: 'p1' } });
    expect(pushTarget({ type: 'program-assigned', gymId: GYM, programId: 'p2' })).toEqual({
      pathname: '/programs/[id]',
      params: { id: 'p2' },
    });
    expect(pushTarget({ type: 'program-assigned', gymId: GYM })).toBeNull();
  });
});
