/**
 * Hoca atama akışı (v3.6e): öğrenciye atanabilecek programlar, atama
 * sayısı (bağı biten sayılmaz), onay metni ("Full Body, Ayşe'ye atandı.
 * Ayşe'ye bildirim gitti." — yönelme eki), "Rutinlerimden oluştur"
 * taslağı (kişisel notlar ve kendi eklenen egzersizler geçmez).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/db/client';
import { routineExercises, routines } from '@/db/schema';
import { listRoutinesForProgram, loadRoutineSources } from '@/lib/programRoutines';
import {
  PROGRAM_LIMITS,
  assignedCount,
  assignedMessage,
  routinesToDraft,
  studentProgramChoices,
  validateProgram,
  type GymProgram,
  type RoutineSource,
} from '@/lib/programs';
import { dative, type TrainerLink } from '@/lib/trainers';
import { createTestDb, seedExercise, type TestDb } from './helpers/testDb';

const GYM = 'g1';

const program = (over: Partial<GymProgram> = {}): GymProgram => ({
  id: 'p1',
  gymId: GYM,
  authorId: 'trainer',
  authorName: 'Duygu',
  name: 'Full Body',
  description: '',
  visibility: 'students',
  payload: { schema: 1, days: [{ name: 'A', exercises: [] }] },
  version: 1,
  createdAt: '2026-10-01T10:00:00Z',
  updatedAt: '2026-10-01T10:00:00Z',
  archivedAt: null,
  assignedAt: null,
  ...over,
});

const link = (over: Partial<TrainerLink> = {}): TrainerLink => ({
  id: 'l1',
  gymId: GYM,
  gymName: 'Salon',
  trainerId: 'trainer',
  trainerName: 'Duygu',
  studentId: 'ayse',
  studentName: 'Ayşe',
  status: 'active',
  requestedAt: null,
  respondedAt: null,
  consentedAt: null,
  ...over,
});

describe('yönelme eki', () => {
  it('ünlü uyumu ve kaynaştırma', () => {
    expect(dative('Ayşe')).toBe("Ayşe'ye");
    expect(dative('Mehmet')).toBe("Mehmet'e");
    expect(dative('Oğuz')).toBe("Oğuz'a");
    expect(dative('Burak')).toBe("Burak'a");
    expect(dative('Ali')).toBe("Ali'ye");
    expect(dative('Duygu')).toBe("Duygu'ya");
    expect(dative('Ümit')).toBe("Ümit'e");
    expect(dative('Ali Kaya')).toBe("Ali Kaya'ya");
    expect(dative('  Can ')).toBe("Can'a");
    expect(dative('İLKNUR')).toBe("İLKNUR'a");
  });
});

describe('atama onayı', () => {
  it('tek öğrenci, adsız, birden çok', () => {
    expect(assignedMessage('Full Body', ['Ayşe'])).toBe("Full Body, Ayşe'ye atandı. Ayşe'ye bildirim gitti.");
    expect(assignedMessage('Full Body', [null])).toBe('Full Body, öğrencine atandı. Öğrencine bildirim gitti.');
    expect(assignedMessage('PPL', ['Ayşe', 'Mehmet', null])).toBe('PPL, 3 öğrenciye atandı. Öğrencilerine bildirim gitti.');
  });
});

describe('öğrenciden programa', () => {
  const memberships = [{ gymId: GYM, role: 'trainer' as const }];

  it('yalnızca bu hocanın, arşivde olmayan programları; atanmışlar ayrı, en yeni üstte', () => {
    const programs = [
      program({ id: 'old', updatedAt: '2026-09-01T10:00:00Z' }),
      program({ id: 'new', updatedAt: '2026-10-10T10:00:00Z', visibility: 'gym' }),
      program({ id: 'done' }),
      program({ id: 'arch', archivedAt: '2026-10-02T10:00:00Z' }),
      program({ id: 'other', authorId: 'someone' }),
      program({ id: 'g2', gymId: 'g2' }),
    ];
    const assignments = [
      { programId: 'done', studentId: 'ayse' },
      { programId: 'old', studentId: 'mehmet' },
    ];
    const { assigned, available } = studentProgramChoices(programs, assignments, link(), 'trainer', memberships);
    expect(available.map((p) => p.id)).toEqual(['new', 'old']);
    expect(assigned.map((p) => p.id)).toEqual(['done']);
  });

  it('yetkisi yoksa boş', () => {
    const { available } = studentProgramChoices([program()], [], link(), 'trainer', [{ gymId: GYM, role: 'member' }]);
    expect(available).toEqual([]);
  });

  it('atama sayısı: bağı biten öğrenci sayılmaz', () => {
    const assignments = [
      { programId: 'p1', studentId: 'ayse' },
      { programId: 'p1', studentId: 'eski' },
      { programId: 'p2', studentId: 'ayse' },
    ];
    const links = [link(), link({ id: 'l2', studentId: 'eski', status: 'ended' })];
    expect(assignedCount(program(), assignments, links)).toBe(1);
  });
});

describe('rutinlerimden oluştur', () => {
  const source = (over: Partial<RoutineSource> = {}): RoutineSource => ({
    name: 'Push Günü',
    exercises: [
      { exerciseId: 'Bench', isCustom: false, targetSets: 4, targetReps: '8-12', restSeconds: 120 },
      { exerciseId: 'Benim', isCustom: true, targetSets: 3, targetReps: '10', restSeconds: 90 },
      { exerciseId: 'Koşu', isCustom: false, targetSets: null, targetReps: null, restSeconds: 9999 },
    ],
    ...over,
  });

  it('her rutin bir gün; kendi egzersizi atlanır; boş alanlar varsayılan', () => {
    const d = routinesToDraft([source(), source({ name: 'Pull Günü', exercises: [] })]);
    expect(d.name).toBe('');
    expect(d.skippedCustom).toBe(1);
    expect(d.payload.days.map((x) => x.name)).toEqual(['Push Günü', 'Pull Günü']);
    expect(d.payload.days[0].exercises).toEqual([
      { exerciseId: 'Bench', sets: 4, repsMin: 8, repsMax: 12, restSec: 120, notes: null },
      { exerciseId: 'Koşu', sets: 3, repsMin: 10, repsMax: 10, restSec: PROGRAM_LIMITS.restMax, notes: null },
    ]);
  });

  it('tek rutin: program adı rutinin adı; sınırlar uygulanıyor, taslak geçerli', () => {
    const many = Array.from({ length: 10 }, (_, i) => source({ name: `R${i}` }));
    expect(routinesToDraft(many).payload.days).toHaveLength(PROGRAM_LIMITS.daysMax);
    const one = routinesToDraft([source({ name: '  Full Body  ' })]);
    expect(one.name).toBe('Full Body');
    expect(validateProgram(one)).toBeNull();
  });

  describe('yerel veritabanından', () => {
    let testDb: TestDb;
    let db: Db;

    beforeEach(async () => {
      testDb = createTestDb();
      db = testDb.db;
      await seedExercise(db, { id: 'Bench', name: 'Bench Press' });
      await seedExercise(db, { id: 'Row', name: 'Row' });
      await seedExercise(db, { id: 'Mine', name: 'Benim hareketim', isCustom: true });
    });

    afterEach(() => testDb.close());

    it('seçim sırasıyla, egzersiz sırasıyla; arşivdeki rutin listede yok', async () => {
      await db.insert(routines).values([
        { id: 'r1', name: 'Push' },
        { id: 'r2', name: 'Pull' },
        { id: 'r3', name: 'Eski', isArchived: true },
      ]);
      await db.insert(routineExercises).values([
        { id: 'a2', routineId: 'r1', exerciseId: 'Mine', orderIndex: 1, targetSets: 3, targetReps: '10', notes: 'sağ omuz' },
        { id: 'a1', routineId: 'r1', exerciseId: 'Bench', orderIndex: 0, targetSets: 4, targetReps: '6-8' },
        { id: 'b1', routineId: 'r2', exerciseId: 'Row', orderIndex: 0, targetSets: 3, targetReps: '12' },
      ]);

      const list = await listRoutinesForProgram(db);
      expect(list).toEqual([
        { id: 'r2', name: 'Pull', exerciseCount: 1 },
        { id: 'r1', name: 'Push', exerciseCount: 2 },
      ]);

      const sources = await loadRoutineSources(db, ['r2', 'r1', 'yok']);
      expect(sources.map((s) => s.name)).toEqual(['Pull', 'Push']);
      expect(sources[1].exercises.map((e) => [e.exerciseId, e.isCustom])).toEqual([
        ['Bench', false],
        ['Mine', true],
      ]);
      const draft = routinesToDraft(sources);
      expect(draft.skippedCustom).toBe(1);
      expect(JSON.stringify(draft)).not.toContain('sağ omuz');
      expect(draft.payload.days[1].exercises[0]).toMatchObject({ exerciseId: 'Bench', sets: 4, repsMin: 6, repsMax: 8 });
    });
  });
});
