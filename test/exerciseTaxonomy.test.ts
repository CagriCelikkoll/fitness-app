/**
 * Türkçe etiket sözlükleri ve bölge filtresi.
 *
 * Sözlükler gömülü veriden türetilen değer listelerine karşı sınanıyor:
 * kütüphane güncellenip yeni bir kas/ekipman gelirse, ekranda ham
 * İngilizce kalmadan önce burada patlasın.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Db } from '@/db/client';
import { seedIfEmpty } from '@/db/seed';
import { exercises } from '@/db/schema';
import {
  exerciseListCondition,
  exerciseListOrder,
} from '@/lib/exerciseFilter';
import {
  BODY_REGIONS,
  CATEGORY_LABELS,
  EQUIPMENT_LABELS,
  EXERCISE_FILTER_OPTIONS,
  FORCE_LABELS,
  LEVEL_LABELS,
  MECHANIC_LABELS,
  MUSCLE_LABELS,
  equipmentLabel,
  muscleLabel,
  muscleLabels,
  parseMuscles,
  type ExerciseFilter,
} from '@/lib/exerciseTaxonomy';
import { createTestDb, type TestDb } from './helpers/testDb';

interface LibraryExercise {
  primaryMuscles: string[];
  secondaryMuscles: string[];
  equipment: string | null;
  category: string;
  level: string | null;
  force: string | null;
  mechanic: string | null;
}
interface CardioMode {
  primary_muscles: string[];
  secondary_muscles?: string[];
  equipment?: string;
  category: string;
  level?: string;
}

const library = require('../assets/seed/exercises.json') as LibraryExercise[];
const cardioModes = require('../assets/seed/cardio-modes.json') as CardioMode[];

function unique(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))].sort();
}

const ALL_MUSCLES = unique([
  ...library.flatMap((e) => [...e.primaryMuscles, ...e.secondaryMuscles]),
  ...cardioModes.flatMap((c) => [
    ...c.primary_muscles,
    ...(c.secondary_muscles ?? []),
  ]),
]);

const FIELDS: [string, string[], Record<string, string>][] = [
  [
    'equipment',
    unique([
      ...library.map((e) => e.equipment),
      ...cardioModes.map((c) => c.equipment),
    ]),
    EQUIPMENT_LABELS,
  ],
  [
    'category',
    unique([
      ...library.map((e) => e.category),
      ...cardioModes.map((c) => c.category),
    ]),
    CATEGORY_LABELS,
  ],
  [
    'level',
    unique([
      ...library.map((e) => e.level),
      ...cardioModes.map((c) => c.level),
    ]),
    LEVEL_LABELS,
  ],
  ['force', unique(library.map((e) => e.force)), FORCE_LABELS],
  ['mechanic', unique(library.map((e) => e.mechanic)), MECHANIC_LABELS],
];

describe('etiket sözlükleri', () => {
  it('verideki her kas değerinin Türkçe karşılığı var', () => {
    const missing = ALL_MUSCLES.filter((m) => !(m in MUSCLE_LABELS));
    expect(missing).toEqual([]);
  });

  it.each(FIELDS)('verideki her %s değerinin karşılığı var', (_, values, dict) => {
    const missing = values.filter((v) => !(v in dict));
    expect(missing).toEqual([]);
  });

  it('bilinmeyen değerde ham değeri döndürüyor', () => {
    expect(muscleLabel('bilinmeyen')).toBe('bilinmeyen');
    expect(equipmentLabel('bilinmeyen')).toBe('bilinmeyen');
    expect(equipmentLabel(null)).toBe('');
  });

  it('parseMuscles bozuk veride patlamıyor', () => {
    expect(parseMuscles(null)).toEqual([]);
    expect(parseMuscles('')).toEqual([]);
    expect(parseMuscles('bozuk')).toEqual([]);
    expect(parseMuscles('{"a":1}')).toEqual([]);
    expect(parseMuscles('["chest","triceps"]')).toEqual(['chest', 'triceps']);
  });

  it('muscleLabels JSON metni Türkçe etikete çeviriyor', () => {
    expect(muscleLabels('["chest","lats"]')).toEqual(['Göğüs', 'Kanat']);
  });
});

describe('BODY_REGIONS', () => {
  it('verideki tüm kasları kapsıyor', () => {
    const covered = new Set(BODY_REGIONS.flatMap((r) => r.muscles));
    expect(ALL_MUSCLES.filter((m) => !covered.has(m))).toEqual([]);
  });

  it('hiçbir kas birden fazla bölgede değil', () => {
    const all = BODY_REGIONS.flatMap((r) => r.muscles);
    expect(all.length).toBe(new Set(all).size);
  });

  it('bölge kasları sözlükte tanımlı', () => {
    for (const r of BODY_REGIONS) {
      for (const m of r.muscles) expect(MUSCLE_LABELS[m]).toBeDefined();
    }
  });

  it('filtre seçeneklerinin id’leri benzersiz', () => {
    const ids = EXERCISE_FILTER_OPTIONS.map((o) => o.id);
    expect(ids.length).toBe(new Set(ids).size);
  });
});

describe('bölge filtresi (gerçek veritabanı)', () => {
  let testDb: TestDb;
  let db: Db;

  beforeAll(async () => {
    testDb = createTestDb();
    db = testDb.db;
    await seedIfEmpty(db);
  });

  afterAll(() => {
    testDb.close();
  });


  const run = (filter: ExerciseFilter, search = '') =>
    db
      .select()
      .from(exercises)
      .where(exerciseListCondition(filter, search))
      .orderBy(...exerciseListOrder(filter));

  const regionFilter = (id: string): ExerciseFilter => ({
    kind: 'region',
    region: BODY_REGIONS.find((r) => r.id === id)!,
  });

  type Row = Awaited<ReturnType<typeof run>>[number];

  /**
   * Beklenen bölge sonucu, "Tümü" listesinden (SQLite'ın alfabetik
   * sırası) JS ile türetiliyor: kardiyo hariç, önce güç, sonra diğerleri.
   * Kararlı bölme, grupların kendi içindeki alfabetik sırayı koruyor.
   */
  function expectedForRegion(all: Row[], muscles: string[]): Row[] {
    const matches = all.filter(
      (e) =>
        e.category !== 'cardio' &&
        parseMuscles(e.primaryMuscles).some((m) => muscles.includes(m))
    );
    return [
      ...matches.filter((e) => e.category === 'strength'),
      ...matches.filter((e) => e.category !== 'strength'),
    ];
  }

  it('Göğüs yalnızca birincil kası chest olanları getiriyor', async () => {
    const all = await run({ kind: 'all' });
    const chest = await run(regionFilter('chest'));

    expect(chest.length).toBeGreaterThan(0);
    expect(chest.map((e) => e.id)).toEqual(
      expectedForRegion(all, ['chest']).map((e) => e.id)
    );
    // Sadece ikincil kası göğüs olanlar gelmemeli
    for (const e of chest) {
      expect(parseMuscles(e.primaryMuscles)).toContain('chest');
    }
  });

  it('her bölge için filtre, JSON üzerinden hesaplanan sonuçla aynı', async () => {
    const all = await run({ kind: 'all' });
    for (const region of BODY_REGIONS) {
      const rows = await run({ kind: 'region', region });
      expect(rows.map((e) => e.id), region.id).toEqual(
        expectedForRegion(all, region.muscles).map((e) => e.id)
      );
    }
  });

  it('bölge filtresi kardiyo döndürmüyor', async () => {
    // Koşu/bisiklet gibi kardiyo modları bacak kaslarını listeliyor —
    // filtre olmasaydı Bacak altında çıkarlardı.
    const legs = await run(regionFilter('legs'));
    expect(legs.length).toBeGreaterThan(0);
    expect(legs.some((e) => e.category === 'cardio')).toBe(false);
    expect(legs.some((e) => e.id === 'cardio_running_outdoor')).toBe(false);
  });

  it('bölge filtresi esneme hareketlerini döndürüyor', async () => {
    const chest = await run(regionFilter('chest'));
    expect(chest.some((e) => e.category === 'stretching')).toBe(true);
  });

  it('bölge seçiliyken güç hareketleri listenin başında', async () => {
    for (const region of BODY_REGIONS) {
      const rows = await run({ kind: 'region', region });
      const firstOther = rows.findIndex((e) => e.category !== 'strength');
      if (firstOther === -1) continue;
      expect(
        rows.slice(firstOther).some((e) => e.category === 'strength'),
        region.id
      ).toBe(false);
    }
    const chest = await run(regionFilter('chest'));
    expect(chest[0]?.category).toBe('strength');
  });

  it('Kardiyo ve Esneklik çipleri yalnızca kendi kategorisini, alfabetik getiriyor', async () => {
    for (const category of ['cardio', 'stretching']) {
      const rows = await run({ kind: 'category', category });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((e) => e.category === category)).toBe(true);
    }
    const all = await run({ kind: 'all' });
    const cardio = await run({ kind: 'category', category: 'cardio' });
    expect(cardio.map((e) => e.id)).toEqual(
      all.filter((e) => e.category === 'cardio').map((e) => e.id)
    );
  });

  it('200 sınırı yok: Tümü bütün kayıtları getiriyor', async () => {
    const all = await run({ kind: 'all' });
    expect(all.length).toBe(library.length + cardioModes.length);
  });

  it('arama bölge filtresiyle birlikte çalışıyor', async () => {
    const pressChest = await run(regionFilter('chest'), 'press');
    expect(pressChest.length).toBeGreaterThan(0);
    for (const e of pressChest) {
      expect(e.name.toLowerCase()).toContain('press');
      expect(parseMuscles(e.primaryMuscles)).toContain('chest');
    }
  });
});
