/**
 * Kas haritası: veritabanı kası → kütüphane slug'ı eşlemesi, hacim ve
 * haftalık sorgu.
 *
 * Eşlemesi eksik bir kas haritada hata vermeden görünmez olur; yanlış
 * yazılmış bir slug da öyle. İkisini de ekrandan fark etmek zor.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/db/client';
import {
  BODY_SLUGS,
  MUSCLE_SLUGS,
  VOLUME_THRESHOLDS,
  exerciseHighlight,
  muscleVolume,
  toBodySlugs,
  volumeHighlight,
  volumeToIntensity,
} from '@/lib/muscleMap';
import {
  toMuscleSets,
  weeklyMuscleSetsQuery,
  weeklyWindowStart,
} from '@/lib/weeklyMuscles';
import {
  createCompletedSession,
  createSession,
  createTestDb,
  seedExercise,
  type TestDb,
} from './helpers/testDb';

interface LibraryExercise {
  primaryMuscles: string[];
  secondaryMuscles: string[];
}
interface CardioMode {
  primary_muscles: string[];
  secondary_muscles?: string[];
}
interface BodyPart {
  slug?: string;
}

const library = require('../assets/seed/exercises.json') as LibraryExercise[];
const cardioModes = require('../assets/seed/cardio-modes.json') as CardioMode[];

// Kütüphanenin gerçekten çizdiği bölgeler. index.js react-native-svg'yi
// çektiği için Node'da yalnızca vücut modeli dosyaları okunabiliyor.
const ASSET_DIR = 'react-native-body-highlighter/dist/assets';
const BODY_MODELS: Record<string, BodyPart[]> = {
  maleFront: require(`${ASSET_DIR}/bodyFront`).bodyFront,
  maleBack: require(`${ASSET_DIR}/bodyBack`).bodyBack,
  femaleFront: require(`${ASSET_DIR}/bodyFemaleFront`).bodyFemaleFront,
  femaleBack: require(`${ASSET_DIR}/bodyFemaleBack`).bodyFemaleBack,
};
const DRAWN_SLUGS = new Set(
  Object.values(BODY_MODELS).flatMap((parts) => parts.map((p) => p.slug))
);

const ALL_MUSCLES = [
  ...new Set([
    ...library.flatMap((e) => [...e.primaryMuscles, ...e.secondaryMuscles]),
    ...cardioModes.flatMap((c) => [
      ...c.primary_muscles,
      ...(c.secondary_muscles ?? []),
    ]),
  ]),
].sort();

describe('slug eşlemesi', () => {
  it('verideki her kasın en az bir slug karşılığı var', () => {
    expect(ALL_MUSCLES.length).toBeGreaterThan(0);
    const missing = ALL_MUSCLES.filter((m) => toBodySlugs(m).length === 0);
    expect(missing).toEqual([]);
  });

  it('eşlemedeki her slug kütüphanede çiziliyor', () => {
    const slugs = Object.values(MUSCLE_SLUGS).flat();
    expect(slugs.filter((s) => !DRAWN_SLUGS.has(s))).toEqual([]);
  });

  it('BODY_SLUGS kütüphanenin çizdiği slug listesiyle aynı', () => {
    expect([...BODY_SLUGS].sort()).toEqual([...DRAWN_SLUGS].sort());
  });

  it('bir kas birden fazla slug’a açılabiliyor (core → abs + obliques)', () => {
    expect(toBodySlugs('core')).toEqual(['abs', 'obliques']);
  });

  it('shoulders deltoid’e düşüyor ve deltoid hem önde hem arkada çiziliyor', () => {
    expect(toBodySlugs('shoulders')).toEqual(['deltoids']);
    for (const [model, parts] of Object.entries(BODY_MODELS)) {
      expect(parts.some((p) => p.slug === 'deltoids'), model).toBe(true);
    }
  });

  it('bilinmeyen kas boş liste döndürüyor', () => {
    expect(toBodySlugs('bilinmeyen')).toEqual([]);
  });
});

describe('exerciseHighlight', () => {
  it('birincil 2, ikincil 1 yoğunlukta', () => {
    const result = exerciseHighlight(['chest'], ['triceps', 'shoulders']);
    expect(result).toEqual(
      expect.arrayContaining([
        { slug: 'chest', intensity: 2 },
        { slug: 'triceps', intensity: 1 },
        { slug: 'deltoids', intensity: 1 },
      ])
    );
    expect(result).toHaveLength(3);
  });

  it('lats + middle back aynı slug’a düşünce en yüksek yoğunluk kazanıyor', () => {
    const result = exerciseHighlight(['lats'], ['middle back']);
    expect(result).toEqual([{ slug: 'upper-back', intensity: 2 }]);
  });

  it('aynı slug iki kez birincil olunca toplanmıyor', () => {
    expect(exerciseHighlight(['lats', 'middle back'], [])).toEqual([
      { slug: 'upper-back', intensity: 2 },
    ]);
  });
});

describe('muscleVolume', () => {
  it('birincil 1, ikincil 0,5 sayılıyor', () => {
    const bench = { primaryMuscles: ['chest'], secondaryMuscles: ['triceps'] };
    const pushdown = { primaryMuscles: ['triceps'], secondaryMuscles: [] };
    expect(muscleVolume([bench, bench, bench, pushdown])).toEqual({
      chest: 3,
      triceps: 2.5,
    });
  });

  it('set yoksa boş', () => {
    expect(muscleVolume([])).toEqual({});
  });
});

describe('volumeToIntensity', () => {
  it.each([
    [0, 0],
    [0.5, 1],
    [1, 1],
    [5, 1],
    [5.5, 1],
    [6, 2],
    [11, 2],
    [11.5, 2],
    [12, 3],
    [20, 3],
  ])('%s set → %s', (sets, intensity) => {
    expect(volumeToIntensity(sets)).toBe(intensity);
  });

  it('eşikler artan sırada', () => {
    const { low, mid, high } = VOLUME_THRESHOLDS;
    expect(low).toBeGreaterThan(0);
    expect(mid).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(mid);
  });

  it('volumeHighlight aynı slug’da en yüksek seviyeyi alıyor, 0 seviyeyi atlıyor', () => {
    expect(
      volumeHighlight({ lats: 12, 'middle back': 3, chest: 0 })
    ).toEqual([{ slug: 'upper-back', intensity: 3 }]);
  });
});

describe('haftalık sorgu (gerçek veritabanı)', () => {
  let testDb: TestDb;
  let db: Db;

  const NOW = new Date('2026-09-24T12:00:00.000Z');
  const daysAgo = (n: number) =>
    new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

  const weeklyVolume = async () =>
    muscleVolume(
      toMuscleSets(await weeklyMuscleSetsQuery(db, weeklyWindowStart(NOW)))
    );

  let bench: string;

  beforeEach(async () => {
    testDb = createTestDb();
    db = testDb.db;
    bench = await seedExercise(db, {
      primaryMuscles: '["chest"]',
      secondaryMuscles: '["triceps"]',
    });
    // Sayılması gereken tek seans: 2 gün önce, 2 normal set
    await createCompletedSession(db, {
      exerciseId: bench,
      startedAt: daysAgo(2),
      setSeeds: [{}, {}],
    });
  });

  afterEach(() => {
    testDb.close();
  });

  it('son 7 gündeki tamamlanmış normal setleri sayıyor', async () => {
    expect(await weeklyVolume()).toEqual({ chest: 2, triceps: 1 });
  });

  it('8 gün önceki seans sayılmıyor', async () => {
    await createCompletedSession(db, {
      exerciseId: bench,
      startedAt: daysAgo(8),
      setSeeds: [{}, {}, {}],
    });
    expect(await weeklyVolume()).toEqual({ chest: 2, triceps: 1 });
  });

  it('bitmemiş seans sayılmıyor', async () => {
    await createSession(db, {
      exerciseId: bench,
      startedAt: daysAgo(1),
      endedAt: null,
      setSeeds: [{}, {}, {}],
    });
    expect(await weeklyVolume()).toEqual({ chest: 2, triceps: 1 });
  });

  it('ısınma seti sayılmıyor', async () => {
    await createCompletedSession(db, {
      exerciseId: bench,
      startedAt: daysAgo(1),
      setSeeds: [{ setType: 'warmup' }, { setType: 'warmup' }],
    });
    expect(await weeklyVolume()).toEqual({ chest: 2, triceps: 1 });
  });

  it('tamamlanmamış set sayılmıyor', async () => {
    await createCompletedSession(db, {
      exerciseId: bench,
      startedAt: daysAgo(1),
      setSeeds: [{ isCompleted: false }, { isCompleted: true }],
    });
    expect(await weeklyVolume()).toEqual({ chest: 3, triceps: 1.5 });
  });

  it('hiç antrenman yoksa boş', async () => {
    testDb.close();
    testDb = createTestDb();
    db = testDb.db;
    expect(await weeklyVolume()).toEqual({});
  });
});
