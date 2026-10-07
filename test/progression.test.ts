/**
 * İlerleme önerisi (v2.1) — saf karar ve gerçek SQLite'a karşı okuma.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { routineExercises, sets, workoutSessions } from '@/db/schema';
import {
  PLATEAU_NOTE,
  applySuggestedWeight,
  formatKg,
  getProgressionEnabled,
  getProgressionSuggestion,
  isPlateau,
  parseProgressionEnabled,
  parseRepRange,
  setProgressionEnabled,
  suggestProgression,
  weightStepKg,
  type ProgressionInput,
  type ProgressionSet,
} from '@/lib/progression';
import { createSessionFromRoutine } from '@/lib/startSession';
import {
  createCompletedSession,
  createRoutine,
  createTestDb,
  seedExercise,
  type TestDb,
} from './helpers/testDb';

/** Tamamlanmış normal set */
function set(weightKg: number | null, reps: number, rir: number | null = null): ProgressionSet {
  return { weightKg, reps, rir, isCompleted: true, setType: 'normal' };
}

function input(lastSets: ProgressionSet[] | null, overrides: Partial<ProgressionInput> = {}): ProgressionInput {
  return {
    targetReps: '8-12',
    category: 'strength',
    equipment: 'barbell',
    lastSets,
    sessionPoints: [],
    ...overrides,
  };
}

// ============================================================================
// Aralık
// ============================================================================

describe('parseRepRange', () => {
  it('aralık ve tek sayı', () => {
    expect(parseRepRange('8-12')).toEqual({ lower: 8, upper: 12 });
    expect(parseRepRange('10')).toEqual({ lower: 10, upper: 10 });
    expect(parseRepRange('100-120')).toEqual({ lower: 100, upper: 120 });
    expect(parseRepRange(' 8 - 12 ')).toEqual({ lower: 8, upper: 12 });
  });

  it('ayrıştırılamayan → null', () => {
    expect(parseRepRange('')).toBeNull();
    expect(parseRepRange('AMRAP')).toBeNull();
    expect(parseRepRange('max')).toBeNull();
    expect(parseRepRange(null)).toBeNull();
    expect(parseRepRange('12-8')).toBeNull();
    expect(parseRepRange('0')).toBeNull();
    expect(parseRepRange('8-')).toBeNull();
  });
});

// ============================================================================
// Kurallar
// ============================================================================

describe('suggestProgression — kurallar', () => {
  it('kural 1: tüm W setleri üst sınırda → W + adım, alt sınır', () => {
    const s = suggestProgression(input([set(82.5, 12), set(82.5, 12), set(82.5, 13)]))!;
    expect(s).toMatchObject({
      rule: 'increase',
      weightKg: 85,
      reps: 8,
      headline: '85 kg × 8',
      reason: 'Geçen sefer 82,5 kg ile tüm setlerde 12 tekrara ulaştın.',
      canApply: true,
      plateauNote: null,
    });
  });

  it('kural 2: hepsinde RIR ≥ 3 ve alt sınırın üstünde → artır', () => {
    const s = suggestProgression(input([set(80, 10, 3), set(80, 9, 4)]))!;
    expect(s).toMatchObject({
      rule: 'increaseEasy',
      weightKg: 82.5,
      reps: 8,
      reason: 'Geçen sefer setler kolay geldi (RIR 3+).',
      canApply: true,
    });
  });

  it('kural 1 ile 2 birlikte tutarsa kural 1', () => {
    const s = suggestProgression(input([set(80, 12, 3), set(80, 12, 4)]))!;
    expect(s.rule).toBe('increase');
  });

  it('karışık RIR (biri 3, biri boş) → kural 2 tutmaz', () => {
    const s = suggestProgression(input([set(80, 10, 3), set(80, 10, null)]))!;
    expect(s.rule).toBe('addReps');
    expect(s.canApply).toBe(false);
  });

  it('kural 2: alt sınırda olan set varsa tutmaz', () => {
    expect(suggestProgression(input([set(80, 8, 3), set(80, 10, 3)]))!.rule).toBe('addReps');
  });

  it('kural 3: aralıkta, hepsi üstte değil → W, en düşük + 1', () => {
    const s = suggestProgression(input([set(82.5, 12), set(82.5, 10), set(82.5, 9)]))!;
    expect(s).toMatchObject({
      rule: 'addReps',
      weightKg: 82.5,
      reps: 10,
      headline: '82,5 kg × 10',
      reason: 'Önce tüm setlerde 12 tekrara ulaş, sonra ağırlık artır.',
      canApply: false,
    });
  });

  it('kural 3: hedef üst sınırı aşmıyor', () => {
    // Tek sayı aralık: 10-10, setler 10 ve 9 → 10 (11 değil)
    const s = suggestProgression(input([set(60, 10), set(60, 9)], { targetReps: '10' }))!;
    expect(s).toMatchObject({ rule: 'addReps', reps: 10 });
  });

  it('kural 4: yarısından fazlası alt sınırın altında → W, alt sınır', () => {
    const s = suggestProgression(input([set(90, 6), set(90, 7), set(90, 8)]))!;
    expect(s).toMatchObject({
      rule: 'struggled',
      weightKg: 90,
      reps: 8,
      headline: '90 kg × 8',
      reason: 'Geçen sefer zorlandın, bu ağırlıkta kal.',
      canApply: false,
    });
  });

  it('tam yarısı alt sınırın altında → kural 3 gibi', () => {
    const s = suggestProgression(input([set(90, 6), set(90, 10)]))!;
    expect(s).toMatchObject({ rule: 'addReps', weightKg: 90, reps: 7 });
  });

  it('W en ağır set; daha hafif setler değerlendirmeye girmez', () => {
    // Düşüş setleri 8'de kaldı ama W (100) setleri üstte
    const s = suggestProgression(
      input([set(100, 12), set(100, 12), set(80, 8), set(70, 6)])
    )!;
    expect(s).toMatchObject({ rule: 'increase', weightKg: 102.5 });
  });

  it('ısınma ve tamamlanmamış setler hariç', () => {
    const warmup: ProgressionSet = { ...set(120, 3), setType: 'warmup' };
    const undone: ProgressionSet = { ...set(110, 2), isCompleted: false };
    const s = suggestProgression(input([warmup, undone, set(100, 12), set(100, 12)]))!;
    expect(s).toMatchObject({ rule: 'increase', weightKg: 102.5 });
  });

  it('sayılan set kalmazsa öneri yok', () => {
    expect(
      suggestProgression(input([{ ...set(60, 10), setType: 'warmup' }]))
    ).toBeNull();
  });
});

describe('suggestProgression — öneri yok', () => {
  it('ilk kez yapılan hareket', () => {
    expect(suggestProgression(input(null))).toBeNull();
  });

  it('kardiyo', () => {
    expect(suggestProgression(input([set(0, 10)], { category: 'cardio' }))).toBeNull();
  });

  it('hedef aralık yok ya da ayrıştırılamıyor', () => {
    expect(suggestProgression(input([set(60, 10)], { targetReps: null }))).toBeNull();
    expect(suggestProgression(input([set(60, 10)], { targetReps: 'AMRAP' }))).toBeNull();
  });
});

// ============================================================================
// Ekipman ve ağırlıksız
// ============================================================================

describe('ağırlık adımı', () => {
  it('ekipmana göre', () => {
    expect(weightStepKg('barbell')).toBe(2.5);
    expect(weightStepKg('e-z curl bar')).toBe(2.5);
    expect(weightStepKg('dumbbell')).toBe(2);
    expect(weightStepKg('kettlebells')).toBe(2);
    expect(weightStepKg('cable')).toBe(2.5);
    expect(weightStepKg('machine')).toBe(2.5);
    expect(weightStepKg('other')).toBe(2.5);
    expect(weightStepKg(null)).toBe(2.5);
  });

  it('dambıl 82 + 2 = 84, tek adım', () => {
    const s = suggestProgression(input([set(82, 12)], { equipment: 'dumbbell' }))!;
    expect(s).toMatchObject({ weightKg: 84, headline: '84 kg × 8' });
  });

  it('kablo ve makinede "bir sonraki kademe" notu', () => {
    const cable = suggestProgression(input([set(40, 12)], { equipment: 'cable' }))!;
    expect(cable.weightKg).toBe(42.5);
    expect(cable.reason).toContain('bir sonraki kademe');
    const bar = suggestProgression(input([set(40, 12)]))!;
    expect(bar.reason).not.toContain('kademe');
  });

  it('ağırlıksız (W = 0) → ağırlık önerisi yok, +1 tekrar', () => {
    const s = suggestProgression(
      input([set(0, 12), set(null, 13)], { equipment: 'body only' })
    )!;
    expect(s).toMatchObject({
      rule: 'increase',
      weightKg: null,
      reps: 13,
      headline: '13 tekrar',
      canApply: false,
    });
    expect(s.reason).toContain('bir sonraki varyasyona');
    expect(s.headline).not.toContain('kg');
  });

  it('ağırlıksız, kural 3 ve 4 de tekrar üzerinden', () => {
    expect(
      suggestProgression(input([set(null, 9), set(null, 10)], { equipment: 'body only' }))
    ).toMatchObject({ rule: 'addReps', weightKg: null, headline: '10 tekrar' });
    expect(
      suggestProgression(input([set(null, 5), set(null, 6)], { equipment: 'body only' }))
    ).toMatchObject({ rule: 'struggled', weightKg: null, headline: '8 tekrar' });
  });
});

describe('formatKg', () => {
  it('tr-TR biçim', () => {
    expect(formatKg(85)).toBe('85');
    expect(formatKg(84)).toBe('84');
    expect(formatKg(22.5)).toBe('22,5');
    expect(formatKg(1.25)).toBe('1,25');
  });

  it('82,5 + 2,5 = 85 (kayan nokta artığı yok)', () => {
    expect(suggestProgression(input([set(82.5, 12)]))!.weightKg).toBe(85);
    expect(suggestProgression(input([set(0.1 + 0.2, 12)]))!.weightKg).toBe(2.8);
  });
});

// ============================================================================
// Plato
// ============================================================================

describe('isPlateau', () => {
  const pts = (...e1rms: (number | null)[]) => e1rms.map((e1rm) => ({ e1rm }));

  it('5\'ten az seans → kontrol yok', () => {
    expect(isPlateau(pts(100, 100, 100, 100))).toBe(false);
  });

  it('%1 eşiğinin iki tarafı', () => {
    // önce en iyi 100; son 4'ün en iyisi 101 → tam %1, plato
    expect(isPlateau(pts(100, 99, 101, 100, 100))).toBe(true);
    // 101,01 → %1'den fazla, plato değil
    expect(isPlateau(pts(100, 99, 101.01, 100, 100))).toBe(false);
    // geriledi → plato
    expect(isPlateau(pts(100, 95, 96, 97, 98))).toBe(true);
  });

  it('e1RM hesaplanamayan taraf varsa karar yok', () => {
    expect(isPlateau(pts(null, 100, 100, 100, 100))).toBe(false);
    expect(isPlateau(pts(100, null, null, null, null))).toBe(false);
  });

  it('plato notu önerinin altında', () => {
    const s = suggestProgression(
      input([set(80, 10)], { sessionPoints: pts(100, 100, 100, 100, 100) })
    )!;
    expect(s.plateauNote).toBe(PLATEAU_NOTE);
  });
});

// ============================================================================
// Ayar
// ============================================================================

describe('ilerleme önerisi ayarı', () => {
  it('varsayılan açık; kaydedilen değer okunuyor', async () => {
    expect(parseProgressionEnabled(null)).toBe(true);
    expect(parseProgressionEnabled('bozuk')).toBe(true);
    const data = new Map<string, string>();
    const store = {
      async getItem(k: string) {
        return data.get(k) ?? null;
      },
      async setItem(k: string, v: string) {
        data.set(k, v);
      },
    };
    expect(await getProgressionEnabled(store)).toBe(true);
    await setProgressionEnabled(store, false);
    expect(await getProgressionEnabled(store)).toBe(false);
  });
});

// ============================================================================
// Veritabanı
// ============================================================================

describe('getProgressionSuggestion / applySuggestedWeight', () => {
  let t: TestDb;
  let db: Db;

  beforeEach(() => {
    t = createTestDb();
    db = t.db;
  });

  afterEach(() => t.close());

  async function setup(options: { targetReps?: string | null; category?: string } = {}) {
    const exerciseId = await seedExercise(db, {
      equipment: 'barbell',
      category: options.category ?? 'strength',
    });
    const { routineId, routineExerciseIds } = await createRoutine(db, {
      exerciseIds: [exerciseId],
    });
    await db
      .update(routineExercises)
      .set({ targetReps: options.targetReps === undefined ? '8-12' : options.targetReps })
      .where(eq(routineExercises.id, routineExerciseIds[0]!));
    return { exerciseId, routineId };
  }

  async function startFromRoutine(routineId: string) {
    const sessionId = (await createSessionFromRoutine(db, { id: routineId, name: 'Push' }))!;
    const [se] = await db.query.sessionExercises.findMany({
      where: (s, { eq: e }) => e(s.sessionId, sessionId),
    });
    return { sessionId, sessionExerciseId: se!.id };
  }

  it('geçen seansa göre öneri; Uygula yalnızca tamamlanmamış setlerin ağırlığını yazıyor', async () => {
    const { exerciseId, routineId } = await setup();
    await createCompletedSession(db, {
      exerciseId,
      startedAt: '2026-10-01T10:00:00.000Z',
      setSeeds: [
        { weightKg: 82.5, reps: 12 },
        { weightKg: 82.5, reps: 12 },
        { weightKg: 60, reps: 10, setType: 'warmup' },
      ],
    });

    const { sessionId, sessionExerciseId } = await startFromRoutine(routineId);
    const s = await getProgressionSuggestion(db, { sessionId, sessionExerciseId, exerciseId });
    expect(s).toMatchObject({ rule: 'increase', weightKg: 85, headline: '85 kg × 8' });

    // İlk seti tamamla (80 × 9); diğer iki set boş
    const rows = await db.select().from(sets).where(eq(sets.sessionExerciseId, sessionExerciseId));
    const first = rows[0]!;
    await db
      .update(sets)
      .set({ weightKg: 80, reps: 9, isCompleted: true })
      .where(eq(sets.id, first.id));
    await db.update(sets).set({ reps: 7 }).where(eq(sets.id, rows[1]!.id));

    expect(await applySuggestedWeight(db, sessionExerciseId, 85)).toBe(2);

    const after = await db.select().from(sets).where(eq(sets.sessionExerciseId, sessionExerciseId));
    const byId = new Map(after.map((r) => [r.id, r]));
    expect(byId.get(first.id)).toMatchObject({ weightKg: 80, reps: 9, isCompleted: true });
    expect(byId.get(rows[1]!.id)).toMatchObject({ weightKg: 85, reps: 7 });
    expect(byId.get(rows[2]!.id)).toMatchObject({ weightKg: 85, reps: null });
  });

  it('ilk kez yapılıyorsa, hedef yoksa, kardiyoysa ya da rutinsiz seansta öneri yok', async () => {
    const first = await setup();
    const a = await startFromRoutine(first.routineId);
    expect(
      await getProgressionSuggestion(db, { ...a, exerciseId: first.exerciseId })
    ).toBeNull();

    const amrap = await setup({ targetReps: 'AMRAP' });
    await createCompletedSession(db, {
      exerciseId: amrap.exerciseId,
      startedAt: '2026-10-01T10:00:00.000Z',
      setSeeds: [{ weightKg: 60, reps: 10 }],
    });
    const b = await startFromRoutine(amrap.routineId);
    expect(await getProgressionSuggestion(db, { ...b, exerciseId: amrap.exerciseId })).toBeNull();

    const cardio = await setup({ category: 'cardio' });
    await createCompletedSession(db, {
      exerciseId: cardio.exerciseId,
      startedAt: '2026-10-01T10:00:00.000Z',
      setSeeds: [{ weightKg: 0, reps: 10 }],
    });
    const c = await startFromRoutine(cardio.routineId);
    expect(await getProgressionSuggestion(db, { ...c, exerciseId: cardio.exerciseId })).toBeNull();

    // Rutin silinince seansın routineId'si boşalıyor
    const loose = await setup();
    await createCompletedSession(db, {
      exerciseId: loose.exerciseId,
      startedAt: '2026-10-01T10:00:00.000Z',
      setSeeds: [{ weightKg: 60, reps: 12 }],
    });
    const d = await startFromRoutine(loose.routineId);
    await db
      .update(workoutSessions)
      .set({ routineId: null })
      .where(eq(workoutSessions.id, d.sessionId));
    expect(await getProgressionSuggestion(db, { ...d, exerciseId: loose.exerciseId })).toBeNull();
  });

  it('5+ bitmiş seansta plato notu', async () => {
    const { exerciseId, routineId } = await setup();
    for (let i = 1; i <= 5; i += 1) {
      await createCompletedSession(db, {
        exerciseId,
        startedAt: `2026-09-0${i}T10:00:00.000Z`,
        setSeeds: [{ weightKg: 80, reps: 10 }],
      });
    }
    const { sessionId, sessionExerciseId } = await startFromRoutine(routineId);
    const s = await getProgressionSuggestion(db, { sessionId, sessionExerciseId, exerciseId });
    expect(s?.plateauNote).toBe(PLATEAU_NOTE);
  });
});
