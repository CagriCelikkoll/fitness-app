/**
 * v4.0b Bölüm 4: Rutinler sekmesi (gruplama, kapaklar, kart satırı, kopyalama)
 * ve gizlilik cümlesi.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { routineExercises, routines, sessionExercises, sets, syncOutbox, workoutSessions } from '@/db/schema';
import type { CoverKind } from '@/lib/coverImage';
import {
  OWN_ROUTINES_TITLE,
  duplicateRoutine,
  findRoutineInGroups,
  groupRoutines,
  loadRoutineCards,
  loadRoutineExercises,
  routineCardLine,
  routineCoverLabel,
  routineExerciseLine,
  routineKindLabel,
  routineStatsLine,
} from '@/lib/routineCards';
import { getTemplate, templateRoutineName } from '@/lib/workoutTemplates';
import { FakeSyncServer } from './helpers/fakeSyncServer';
import { closePhones, expectOk, newRoutine, outboxCount, phone, sync, synced } from './helpers/syncPhones';
import { createTestDb, seedExercise, type TestDb } from './helpers/testDb';

const ROOT = path.resolve(__dirname, '..');
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');

let nextId = 0;
const item = (name: string, kind: CoverKind = 'upper') => ({ id: `r${++nextId}`, name, kind });
const daysOf = (templateId: string, indexes?: number[]) => {
  const template = getTemplate(templateId)!;
  return template.days
    .filter((_, i) => indexes == null || indexes.includes(i))
    .map((day) => item(templateRoutineName(template, day)));
};

describe('gruplama', () => {
  it('hazır programın günleri program adı altında, gün sırasıyla', () => {
    const ppl = daysOf('ppl');
    const groups = groupRoutines([...ppl].reverse());
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ title: 'Push Pull Leg', dayCount: 3 });
    expect(groups[0]!.members.map((m) => m.item.id)).toEqual(ppl.map((r) => r.id));
    expect(groups[0]!.members.map((m) => m.dayIndex)).toEqual([0, 1, 2]);
  });

  it('kendi rutinleri "Rutinlerim" altında ve en sonda', () => {
    const groups = groupRoutines([item('Kendi günüm'), ...daysOf('ppl')]);
    expect(groups.map((g) => g.title)).toEqual(['Push Pull Leg', OWN_ROUTINES_TITLE]);
    expect(groups[1]).toMatchObject({ key: 'own', dayCount: null });
    expect(groups[1]!.members[0]!.dayIndex).toBeNull();
  });

  it('programdan tek gün kaldıysa ya da ad değiştiyse grup yok', () => {
    expect(groupRoutines(daysOf('ppl', [0])).map((g) => g.title)).toEqual([OWN_ROUTINES_TITLE]);
    const [first, second] = daysOf('ppl', [0, 1]);
    expect(groupRoutines([first!, { ...second!, name: 'Sırt günüm' }]).map((g) => g.title)).toEqual([OWN_ROUTINES_TITLE]);
  });

  it('aynı program iki kez eklenince "(2)" ekli günler de aynı grupta', () => {
    const ppl = daysOf('ppl');
    const copy = { ...ppl[0]!, id: 'kopya', name: `${ppl[0]!.name} (2)` };
    const groups = groupRoutines([...ppl, copy]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.members).toHaveLength(4);
  });

  it('"Kopyala" ile oluşan rutin programa karışmaz', () => {
    const ppl = daysOf('ppl');
    const copy = { ...ppl[0]!, id: 'kopya', name: `${ppl[0]!.name} (kopya)` };
    const groups = groupRoutines([...ppl, copy]);
    expect(groups.map((g) => g.title)).toEqual(['Push Pull Leg', OWN_ROUTINES_TITLE]);
    expect(groups[1]!.members[0]!.item.id).toBe('kopya');
  });

  it('kısa adı aynı programlar karışmaz', () => {
    expect(groupRoutines(daysOf('ant-post')).map((g) => g.dayCount)).toEqual([2]);
    expect(groupRoutines(daysOf('ant-post-4')).map((g) => g.dayCount)).toEqual([4]);
  });

  it('salon programı bağı addan önce gelir; yüklü olmayan program gruplanmaz', () => {
    const [a, b] = daysOf('ppl', [0, 1]);
    const links = [
      { routineId: a!.id, programId: 'p1', dayIndex: 1 },
      { routineId: b!.id, programId: 'p1', dayIndex: 0 },
    ];
    const programs = [{ id: 'p1', name: 'Hocanın programı', payload: { days: [{}, {}, {}, {}] } }];
    const groups = groupRoutines([a!, b!], { links, programs });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ title: 'Hocanın programı', dayCount: 4 });
    expect(groups[0]!.members.map((m) => m.item.id)).toEqual([b!.id, a!.id]);

    expect(groupRoutines([item('Tek gün')], { links: [{ routineId: 'yok', programId: 'p1', dayIndex: 0 }], programs })[0]!.key).toBe('own');
  });

  it('aynı programın günleri farklı kapak alıyor', () => {
    const days = daysOf('split4');
    const covers = groupRoutines(days)[0]!.members.map((m) => m.cover);
    expect(new Set(covers).size).toBe(days.length);
  });

  it('rutin yoksa grup yok', () => {
    expect(groupRoutines([])).toEqual([]);
  });
});

describe('kart metinleri', () => {
  const rows = [{ targetSets: 4, restSeconds: 90, primaryMuscles: '["chest"]', category: 'strength' }];

  it('"N hareket · ~dk · son:"; hiç yapılmadıysa son yok', () => {
    expect(routineCardLine(rows, null, 'son: 3 gün önce')).toBe('1 hareket · ~15 dk · son: 3 gün önce');
    expect(routineCardLine(rows, 55, null)).toBe('1 hareket · ~55 dk');
  });

  it('etiketler', () => {
    expect((['upper', 'lower', 'full', 'cardio'] as const).map(routineKindLabel)).toEqual([
      'Üst vücut',
      'Alt vücut',
      'Full body',
      'Kardiyo',
    ]);
  });
});

describe('veritabanı', () => {
  let t: TestDb;
  let db: Db;
  beforeEach(() => {
    t = createTestDb();
    db = t.db;
  });
  afterEach(() => t.close());

  const seedRoutine = async (id: string, name: string, exerciseIds: string[]) => {
    await db.insert(routines).values({ id, name, description: 'not', estimatedDurationMin: 45 });
    await db.insert(routineExercises).values(
      exerciseIds.map((exerciseId, i) => ({
        id: `${id}-${i}`,
        routineId: id,
        exerciseId,
        orderIndex: i,
        targetSets: 4,
        targetReps: '6-8',
        targetWeightKg: 80,
        restSeconds: 120,
        notes: 'dikkat',
      }))
    );
  };

  it('kart: sayım, renk, son yapılma; arşivli yok; boş rutin de listede', async () => {
    const chest = await seedExercise(db, { id: 'chest' });
    const quad = await seedExercise(db, { id: 'quad', name: 'Squat', primaryMuscles: '["quadriceps"]' });
    await seedRoutine('a', 'A Üst', [chest]);
    await seedRoutine('b', 'B Alt', [quad]);
    await db.insert(routines).values({ id: 'c', name: 'C Boş' });
    await db.insert(routines).values({ id: 'd', name: 'D Arşiv', isArchived: true });
    await db.insert(workoutSessions).values({
      id: 's1',
      name: 'A Üst',
      routineId: 'a',
      startedAt: new Date(2026, 10, 6, 18).toISOString(),
      endedAt: new Date(2026, 10, 6, 19).toISOString(),
    });

    const cards = await loadRoutineCards(db, new Date(2026, 10, 9, 12));
    expect(cards.map((c) => c.name)).toEqual(['A Üst', 'B Alt', 'C Boş']);
    expect(cards[0]).toMatchObject({ exerciseCount: 1, line: '1 hareket · ~45 dk · son: 3 gün önce', color: 'upper', kind: 'upper' });
    expect(cards[1]).toMatchObject({ color: 'lower', line: '1 hareket · ~45 dk' });
    expect(cards[2]).toMatchObject({ exerciseCount: 0, color: 'full' });
  });

  it('kopyalama: plan aynı, kimlikler yeni, ad benzersiz, kaynak değişmez', async () => {
    const chest = await seedExercise(db, { id: 'chest' });
    const quad = await seedExercise(db, { id: 'quad' });
    await seedRoutine('a', 'Üst', [chest, quad]);

    const copyId = await duplicateRoutine(db, 'a');
    const secondId = await duplicateRoutine(db, 'a');
    expect(copyId).not.toBe('a');

    const names = (await db.select().from(routines).orderBy(asc(routines.name))).map((r) => r.name);
    expect(names).toEqual(['Üst', 'Üst (kopya)', 'Üst (kopya) (2)']);

    const plan = await db.select().from(routineExercises).where(eq(routineExercises.routineId, copyId)).orderBy(asc(routineExercises.orderIndex));
    expect(plan.map((p) => p.exerciseId)).toEqual([chest, quad]);
    expect(plan[0]).toMatchObject({ targetSets: 4, targetReps: '6-8', targetWeightKg: 80, restSeconds: 120, notes: 'dikkat' });
    expect(plan[0]!.id).not.toBe('a-0');
    expect(await db.select().from(routineExercises).where(eq(routineExercises.routineId, 'a'))).toHaveLength(2);
    expect(await db.select().from(routineExercises).where(eq(routineExercises.routineId, secondId))).toHaveLength(2);
  });

  it('kopyası silinince kaynak durur; olmayan rutin hata', async () => {
    const chest = await seedExercise(db, { id: 'chest' });
    await seedRoutine('a', 'Üst', [chest]);
    const copyId = await duplicateRoutine(db, 'a');
    await db.delete(routines).where(eq(routines.id, copyId));
    expect(await db.select().from(routineExercises).where(eq(routineExercises.routineId, 'a'))).toHaveLength(1);
    await expect(duplicateRoutine(db, 'yok')).rejects.toThrow('Rutin bulunamadı');
  });
});

describe('kopyalama ve eşitleme', () => {
  afterEach(closePhones);

  it('kopya giden kutusuna girer, sunucudan ikinci telefona iner', async () => {
    const server = new FakeSyncServer();
    const a = await phone();
    const b = await phone();
    const sourceId = await newRoutine(a.db, 'Üst', 2);
    await expectOk(sync(a, server));
    expect(await outboxCount(a.db)).toBe(0);

    const copyId = await duplicateRoutine(a.db, sourceId);

    const outbox = await a.db.select().from(syncOutbox);
    const planIds = (await a.db.select().from(routineExercises).where(eq(routineExercises.routineId, copyId))).map((p) => p.id);
    expect(outbox.filter((o) => o.tableName === 'routines').map((o) => o.rowId)).toEqual([copyId]);
    expect(outbox.filter((o) => o.tableName === 'routine_exercises').map((o) => o.rowId).sort()).toEqual([...planIds].sort());

    await expectOk(sync(a, server));
    expect(await outboxCount(a.db)).toBe(0);

    await expectOk(sync(b, server));
    const onB = await b.db.select().from(routines).where(eq(routines.id, copyId));
    expect(onB.map((r) => r.name)).toEqual(['Üst (kopya)']);
    expect(await b.db.select().from(routineExercises).where(eq(routineExercises.routineId, copyId))).toHaveLength(2);
    expect(await synced(b.db)).toEqual(await synced(a.db));
  });

  it('kopyalanan kendi bağlantısını taşımaz: kaynağın planı eşitlemede dokunulmadan kalır', async () => {
    const server = new FakeSyncServer();
    const a = await phone();
    const sourceId = await newRoutine(a.db, 'Üst', 2);
    await expectOk(sync(a, server));
    await duplicateRoutine(a.db, sourceId);
    const outbox = await a.db.select().from(syncOutbox);
    const sourcePlan = (await a.db.select().from(routineExercises).where(eq(routineExercises.routineId, sourceId))).map((p) => p.id);
    expect(outbox.some((o) => o.rowId === sourceId || sourcePlan.includes(o.rowId))).toBe(false);
  });
});

describe('rutin kapağı', () => {
  it('etiket: programda gün, değilse bölge; program adı büyük harfe çevrilmez', () => {
    expect(routineCoverLabel('upper', { dayCount: 4, title: 'Upper / Lower' }, 0)).toBe('4 GÜN · Upper / Lower · GÜN 1');
    expect(routineCoverLabel('upper', { dayCount: 5, title: '5 Günlük Bölgesel Split' }, 2)).toBe('5 GÜN · 5 Günlük Bölgesel Split · GÜN 3');
    expect(routineCoverLabel('lower', { dayCount: null, title: OWN_ROUTINES_TITLE }, null)).toBe('ALT VÜCUT');
  });

  it('kapak listedekiyle aynı', () => {
    const days = daysOf('split4');
    const groups = groupRoutines(days);
    for (const { id } of days) {
      const found = findRoutineInGroups(groups, id)!;
      expect(found.group.key).toBe('template:split4');
      expect(found.member.cover).toBe(groups[0]!.members.find((m) => m.item.id === id)!.cover);
    }
    expect(findRoutineInGroups(groups, 'yok')).toBeNull();
  });

  const plan = { targetSets: 4, targetReps: '6-8', targetDurationSeconds: null, targetDistanceKm: null, category: 'strength' };

  it('hareket satırı', () => {
    expect(routineExerciseLine(plan, 80)).toBe('4 × 6–8 · son 80 kg');
    expect(routineExerciseLine(plan, 62.5)).toBe('4 × 6–8 · son 62,5 kg');
    expect(routineExerciseLine({ ...plan, targetReps: '10' }, null)).toBe('4 × 10');
    expect(routineExerciseLine({ ...plan, targetReps: null, targetSets: null }, 0)).toBe('3 set');
  });

  it('kardiyo satırı', () => {
    const cardio = { ...plan, targetSets: null, targetReps: null, category: 'cardio' };
    expect(routineExerciseLine({ ...cardio, targetDurationSeconds: 1200, targetDistanceKm: 5.5 }, null)).toBe('20 dk · 5,5 km');
    expect(routineExerciseLine(cardio, null)).toBe('Kardiyo');
  });

  it('özet satırı: süre elle girilmişse o, set toplamı', () => {
    const rows = [
      { targetSets: 4, restSeconds: 90, primaryMuscles: '["chest"]', category: 'strength' },
      { targetSets: null, restSeconds: 90, primaryMuscles: '["chest"]', category: 'strength' },
    ];
    expect(routineStatsLine(rows, 55)).toBe('2 hareket · ~55 dk · 7 set');
  });

  describe('veritabanı', () => {
    let t: TestDb;
    afterEach(() => t.close());

    it('"son": son antrenmandaki en ağır tamamlanmış normal set; plan sırası korunur', async () => {
      t = createTestDb();
      const db = t.db;
      const bench = await seedExercise(db, { id: 'bench', imagePaths: '["a.jpg"]' });
      const row = await seedExercise(db, { id: 'row', name: 'Row' });
      await db.insert(routines).values({ id: 'r', name: 'Üst' });
      await db.insert(routineExercises).values([
        { id: 'p1', routineId: 'r', exerciseId: row, orderIndex: 0, targetSets: 3, targetReps: '8' },
        { id: 'p2', routineId: 'r', exerciseId: bench, orderIndex: 1, targetSets: 4, targetReps: '6-8' },
      ]);
      const addSession = async (id: string, day: number, weights: [number, boolean, 'normal' | 'warmup'][]) => {
        await db.insert(workoutSessions).values({
          id,
          name: 'Üst',
          routineId: 'r',
          startedAt: new Date(2026, 10, day, 18).toISOString(),
          endedAt: new Date(2026, 10, day, 19).toISOString(),
        });
        await db.insert(sessionExercises).values({ id: `${id}-e`, sessionId: id, exerciseId: bench, orderIndex: 0 });
        await db.insert(sets).values(
          weights.map(([weightKg, isCompleted, setType], i) => ({
            id: `${id}-${i}`,
            sessionExerciseId: `${id}-e`,
            setNumber: i + 1,
            weightKg,
            reps: 8,
            isCompleted,
            setType,
          }))
        );
      };
      await addSession('eski', 1, [[100, true, 'normal']]);
      await addSession('yeni', 8, [[75, true, 'normal'], [80, true, 'normal'], [90, false, 'normal'], [120, true, 'warmup']]);

      const rows = await loadRoutineExercises(db, 'r');
      expect(rows.map((r) => r.id)).toEqual(['p1', 'p2']);
      expect(rows[0]!.line).toBe('3 × 8');
      expect(rows[1]!.line).toBe('4 × 6–8 · son 80 kg');
      expect(rows[1]!.imagePaths).toBe('["a.jpg"]');
    });
  });

  const cover = read('app/routine/cover/[id].tsx');

  it('ekran: işlemler, Paylaş yok, Başla listenin altında (üstüne binmiyor)', () => {
    for (const piece of ['label="Geçmiş"', 'label="Düzenle"', 'label="Kopyala"', 'label="Sil"', "'Başla'", '<ExerciseThumb', '<DisplayName']) {
      expect(cover, piece).toContain(piece);
    }
    expect(cover).not.toContain('Paylaş');
    expect(cover.indexOf('</ScrollView>')).toBeLessThan(cover.indexOf("'Başla'"));
    expect(cover).not.toContain('insets.bottom');
  });

  it('sekmeden kapağa; Geçmiş rutine süzülüyor', () => {
    expect(read('app/(tabs)/workout.tsx')).toContain("pathname: '/routine/cover/[id]'");
    const history = read('app/history.tsx');
    expect(history).toContain('eq(workoutSessions.routineId, routineId)');
    expect(history).toContain('[routineId]');
    expect(read('app/_layout.tsx')).toContain('name="routine/cover/[id]"');
  });
});

describe('ekran', () => {
  const screen = read('app/(tabs)/workout.tsx');

  it('üst girişler, başlık ve yeni rutin', () => {
    for (const piece of ['<ScreenTitle>Rutinler</ScreenTitle>', 'variant="brand"', 'Bana program öner', 'Hazır programlar', '<ExercisesEntry />']) {
      expect(screen, piece).toContain(piece);
    }
  });

  it('⋯ işlemleri; boş durum ana sayfadaki kart', () => {
    const menu = read('src/components/RoutineMenu.tsx');
    for (const piece of ['label="Düzenle"', 'label="Kopyala"', 'label="Sil"']) expect(menu, piece).toContain(piece);
    expect(screen).toContain('<RoutineMenu');
    expect(screen).toContain('<ChooseProgramCard');
    expect(read('app/(tabs)/index.tsx')).toContain('<ChooseProgramCard');
  });

  it('ad büyük harfe çevrilmiyor; program güncelleme kartı duruyor', () => {
    expect(screen).toContain('<DisplayName');
    expect(screen).not.toContain('upperTr(');
    expect(screen).toContain('<ProgramUpdateCard');
  });
});

describe('gizlilik cümlesi', () => {
  const SENTENCE = 'Verilerin önce bu telefonda durur; hesap açmazsan hiçbir yere gönderilmez.';
  const screen = read('app/onboarding.tsx').replace(/\s+/g, ' ');

  it('iki yerde yeni cümle, eskisi yok', () => {
    expect(screen.split(SENTENCE)).toHaveLength(3);
    expect(screen).not.toContain('Hesap yok, sunucu yok');
    expect(screen).not.toContain('Verilerin sadece bu telefonda');
  });
});
