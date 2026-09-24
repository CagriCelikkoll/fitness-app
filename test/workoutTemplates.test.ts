/**
 * Hazır programlar.
 *
 * En kritik kontrol ilk blok: şablondaki her `exerciseId` gömülü
 * kütüphanede gerçekten var mı. Yanlış bir id rutin eklerken FK hatasına
 * düşer ya da (FK kapalı bir ortamda) sessizce yarım rutin üretir.
 *
 * `applyTemplate` testleri gerçek kütüphaneyi seed'leyip çalışıyor —
 * böylece FK'ler de id'leri ikinci kez doğruluyor.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asc, eq, inArray } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { seedIfEmpty } from '@/db/seed';
import { routineExercises, routines } from '@/db/schema';
import { applyTemplate, uniqueName } from '@/lib/applyTemplate';
import {
  getTemplate,
  restForReps,
  templateExerciseCount,
  WORKOUT_TEMPLATES,
} from '@/lib/workoutTemplates';
import { countRows, createTestDb, type TestDb } from './helpers/testDb';

const freeExerciseDb = require('../assets/seed/exercises.json') as {
  id: string;
  category: string;
}[];
const exerciseById = new Map(freeExerciseDb.map((e) => [e.id, e]));

describe('şablon verisi', () => {
  it('her exerciseId exercises.json içinde var ve kuvvet hareketi', () => {
    for (const t of WORKOUT_TEMPLATES) {
      for (const day of t.days) {
        for (const e of day.exercises) {
          const found = exerciseById.get(e.exerciseId);
          expect(found, `${t.id} / ${day.name}: ${e.exerciseId}`).toBeDefined();
          expect(found?.category).toBe('strength');
        }
      }
    }
  });

  it('set > 0, reps boş değil, restSeconds > 0', () => {
    for (const t of WORKOUT_TEMPLATES) {
      for (const day of t.days) {
        for (const e of day.exercises) {
          expect(e.sets).toBeGreaterThan(0);
          expect(e.reps.trim()).not.toBe('');
          expect(e.restSeconds).toBeGreaterThan(0);
        }
      }
    }
  });

  it('dayCount gün sayısıyla tutarlı, id\'ler benzersiz', () => {
    for (const t of WORKOUT_TEMPLATES) {
      expect(t.days.length).toBe(t.dayCount);
    }
    const ids = WORKOUT_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('beklenen hareket sayıları', () => {
    expect(templateExerciseCount(getTemplate('ppl')!)).toBe(18);
    expect(templateExerciseCount(getTemplate('split4')!)).toBe(20);
    expect(templateExerciseCount(getTemplate('ant-post')!)).toBe(15);
  });

  it('dinlenme kuralı: 5-8 → 180, 8-10 → 120, 10+ → 90', () => {
    expect(restForReps('5-7')).toBe(180);
    expect(restForReps('6-8')).toBe(180);
    expect(restForReps('8-10')).toBe(120);
    expect(restForReps('10')).toBe(90);
    expect(restForReps('10-12')).toBe(90);
    expect(restForReps('15-20')).toBe(90);
  });
});

describe('uniqueName', () => {
  it('boştaysa olduğu gibi, doluysa ilk boş sayıyı ekliyor', () => {
    expect(uniqueName('PPL — İtme', new Set())).toBe('PPL — İtme');
    expect(uniqueName('A', new Set(['A']))).toBe('A (2)');
    expect(uniqueName('A', new Set(['A', 'A (2)']))).toBe('A (3)');
  });
});

describe('applyTemplate', () => {
  let testDb: TestDb;
  let db: Db;

  beforeEach(async () => {
    testDb = createTestDb();
    db = testDb.db;
    await seedIfEmpty(db);
  });

  afterEach(() => {
    testDb.close();
  });

  it.each(WORKOUT_TEMPLATES.map((t) => [t.id, t] as const))(
    '%s: gün sayısı kadar rutin, toplam hareket kadar satır',
    async (_id, template) => {
      const ids = await applyTemplate(db, template);

      expect(ids).toHaveLength(template.dayCount);
      expect(await countRows(db, routines)).toBe(template.dayCount);
      expect(await countRows(db, routineExercises)).toBe(
        templateExerciseCount(template)
      );
    }
  );

  it('rutin adı ve açıklaması programdan geliyor', async () => {
    const template = getTemplate('ppl')!;
    const ids = await applyTemplate(db, template);

    const rows = await db
      .select()
      .from(routines)
      .where(inArray(routines.id, ids));
    const byId = new Map(rows.map((r) => [r.id, r]));

    expect(ids.map((id) => byId.get(id)?.name)).toEqual([
      'PPL — İtme',
      'PPL — Çekme',
      'PPL — Bacak ve Karın',
    ]);
    for (const r of rows) {
      expect(r.description).toBe(template.description);
    }
  });

  it('orderIndex 0\'dan başlayıp sıralı, hedefler şablonla aynı', async () => {
    const template = getTemplate('split4')!;
    const ids = await applyTemplate(db, template);

    for (let d = 0; d < ids.length; d += 1) {
      const rows = await db
        .select()
        .from(routineExercises)
        .where(eq(routineExercises.routineId, ids[d]!))
        .orderBy(asc(routineExercises.orderIndex));

      const day = template.days[d]!;
      expect(rows.map((r) => r.orderIndex)).toEqual(
        day.exercises.map((_, i) => i)
      );
      expect(
        rows.map((r) => [r.exerciseId, r.targetSets, r.targetReps, r.restSeconds])
      ).toEqual(
        day.exercises.map((e) => [e.exerciseId, e.sets, e.reps, e.restSeconds])
      );
    }
  });

  it('iki kez uygulanınca isim çakışmıyor, ikinci set de oluşuyor', async () => {
    const template = getTemplate('ant-post')!;
    await applyTemplate(db, template);
    const second = await applyTemplate(db, template);

    expect(await countRows(db, routines)).toBe(template.dayCount * 2);
    expect(await countRows(db, routineExercises)).toBe(
      templateExerciseCount(template) * 2
    );

    const names = (await db.select({ name: routines.name }).from(routines)).map(
      (r) => r.name
    );
    expect(new Set(names).size).toBe(names.length);

    const secondNames = await db
      .select({ name: routines.name })
      .from(routines)
      .where(inArray(routines.id, second));
    expect(secondNames.map((r) => r.name).sort()).toEqual(
      ['A/P — Anterior (2)', 'A/P — Posterior (2)'].sort()
    );
  });

  it('eklenen rutin başlatılabilir: routineExercises sorgusu boş değil', async () => {
    const [routineId] = await applyTemplate(db, getTemplate('ppl')!);

    // app/(tabs)/workout.tsx handleStartRoutine'daki sorgu
    const exercisesInRoutine = await db
      .select()
      .from(routineExercises)
      .where(eq(routineExercises.routineId, routineId!))
      .orderBy(asc(routineExercises.orderIndex));

    expect(exercisesInRoutine.length).toBeGreaterThan(0);
    for (const re of exercisesInRoutine) {
      expect(re.targetSets).toBeGreaterThan(0);
    }
  });
});
