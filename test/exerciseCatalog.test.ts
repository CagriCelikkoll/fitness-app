/**
 * Egzersiz kataloğu (v3.8): gömülü core listesi, Türkçe ad, kelime kelime ve
 * Türkçe karakterden bağımsız arama, sıralama, kullanılan extra'nın core
 * gibi görünmesi ve ekrandaki liste (Diğer).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Db } from '@/db/client';
import { exercises, type Exercise } from '@/db/schema';
import { seedIfEmpty } from '@/db/seed';
import {
  buildExerciseListItems,
  catalogEntry,
  coreExerciseIds,
  exerciseDisplayName,
  exerciseOriginalName,
  isCoreFor,
  normalizeForSearch,
  partitionExercises,
  searchRank,
  searchTokens,
  showOtherLabel,
  type CatalogFile,
} from '@/lib/exerciseCatalog';
import { exerciseListCondition, getUsedExerciseIds } from '@/lib/exerciseFilter';
import { WORKOUT_TEMPLATES } from '@/lib/workoutTemplates';
import {
  createCardioSegment,
  createCompletedSession,
  createRoutine,
  createTestDb,
  seedExercise,
  type TestDb,
} from './helpers/testDb';

interface SourceExercise {
  id: string;
  name: string;
  category: string;
}

const source = require('../assets/seed/exercises.json') as SourceExercise[];
const cardio = require('../assets/seed/cardio-modes.json') as { id: string; name: string; name_tr: string }[];
const catalog = require('../assets/seed/exercise-catalog.json') as CatalogFile;
const seedIds = require('./fixtures/seed-exercise-ids.json') as string[];

const sourceById = new Map(source.map((e) => [e.id, e]));
const cardioIds = new Set(cardio.map((c) => c.id));

describe('exercise-catalog.json', () => {
  it('her anahtar hazır bir egzersiz; tier, Türkçe ad ve eş anlamlılar geçerli', () => {
    for (const [id, entry] of Object.entries(catalog)) {
      expect(sourceById.has(id) || cardioIds.has(id), id).toBe(true);
      expect(['core', 'extra']).toContain(entry.tier);
      expect(entry.tr.trim().length, id).toBeGreaterThan(0);
      for (const a of entry.aliases ?? []) expect(a.trim().length, id).toBeGreaterThan(0);
    }
  });

  it('core 150–200 hareket, esneme yok', () => {
    const core = coreExerciseIds();
    expect(core.length).toBeGreaterThanOrEqual(150);
    expect(core.length).toBeLessThanOrEqual(200);
    expect(core.filter((id) => sourceById.get(id)?.category === 'stretching')).toEqual([]);
  });

  it('onay turundaki değişiklikler', () => {
    for (const id of ['Glute_Ham_Raise', 'Reverse_Hyperextension', 'Donkey_Calf_Raises']) {
      expect(catalogEntry(id)?.tier ?? 'extra', id).toBe('extra');
    }
    expect(catalogEntry('Farmers_Walk')?.tier).toBe('core');
    expect(catalogEntry('Front_Box_Jump')?.tier).toBe('core');
    expect(catalogEntry('Crunches')?.tr).toBe('Crunch (mekik)');
    expect(catalogEntry('Concentration_Curls')?.tr).toBe('Concentration curl');
    expect(catalogEntry('Hyperextensions_Back_Extensions')?.tr).toBe('Back extension');
    expect(catalogEntry('Inverted_Row')?.tr).toBe('Inverted row');
  });

  it('kardiyo modları core', () => {
    for (const c of cardio) expect(catalogEntry(c.id)?.tier, c.id).toBe('core');
  });

  it('hazır programların bütün hareketleri core', () => {
    const notCore = WORKOUT_TEMPLATES.flatMap((t) =>
      t.days.flatMap((d) => d.exercises.map((e) => e.exerciseId))
    ).filter((id) => catalogEntry(id)?.tier !== 'core');
    expect(notCore).toEqual([]);
  });

  it('hiçbir hazır egzersiz kimliği kaybolmadı (eşitlenmiş antrenmanlar bağlı)', () => {
    const all = new Set([...sourceById.keys(), ...cardioIds]);
    expect(seedIds.filter((id) => !all.has(id))).toEqual([]);
  });
});

describe('ad', () => {
  it('Türkçe ad ana ad, İngilizce ad altta', () => {
    const e = { id: 'Butterfly', name: 'Butterfly', nameTr: null };
    expect(exerciseDisplayName(e)).toBe('Pec deck (butterfly)');
    expect(exerciseOriginalName(e)).toBe('Butterfly');
  });

  it('katalogda olmayan: veritabanındaki Türkçe ad, yoksa ad; aynıysa alt satır yok', () => {
    expect(exerciseDisplayName({ id: 'Axle_Deadlift', name: 'Axle Deadlift', nameTr: null })).toBe('Axle Deadlift');
    expect(exerciseOriginalName({ id: 'Axle_Deadlift', name: 'Axle Deadlift', nameTr: null })).toBeNull();
    expect(exerciseDisplayName({ id: 'custom-1', name: 'Benim hareketim', nameTr: null })).toBe('Benim hareketim');
    expect(exerciseOriginalName({ id: 'Plank', name: 'Plank', nameTr: null })).toBeNull();
  });
});

describe('arama', () => {
  it('büyük-küçük harf ve Türkçe karakter farkı yok', () => {
    expect(normalizeForSearch('Lat ÇEKİŞ')).toBe('lat cekis');
    expect(normalizeForSearch('İp Atlama')).toBe('ip atlama');
    expect(normalizeForSearch('ŞınAv  (dar)')).toBe('sinav dar');
    expect(normalizeForSearch('Göğüs-press')).toBe('gogus press');
    expect(searchTokens('  front   raise ')).toEqual(['front', 'raise']);
    expect(searchTokens('  ')).toEqual([]);
  });

  const row = (id: string): Exercise => {
    const s = sourceById.get(id)!;
    return { id, name: s.name, nameTr: null, category: s.category, isCustom: false } as Exercise;
  };
  const finds = (term: string, id: string) => searchRank(row(id), searchTokens(term)) != null;

  it('kelime kelime: "front raise" → Front Dumbbell Raise', () => {
    expect(finds('front raise', 'Front_Dumbbell_Raise')).toBe(true);
    expect(finds('raise front', 'Front_Dumbbell_Raise')).toBe(true);
    expect(finds('front squat raise', 'Front_Dumbbell_Raise')).toBe(false);
  });

  it('Türkçe ad ve eş anlamlılarla', () => {
    expect(finds('pec deck', 'Butterfly')).toBe(true);
    expect(finds('rdl', 'Romanian_Deadlift')).toBe(true);
    expect(finds('bulgarian', 'Split_Squat_with_Dumbbells')).toBe(true);
    expect(finds('lat cekis', 'Wide-Grip_Lat_Pulldown')).toBe(true);
    expect(finds('sırt çekiş', 'Wide-Grip_Lat_Pulldown')).toBe(true);
    expect(finds('on omuz kaldirma', 'Front_Dumbbell_Raise')).toBe(true);
    expect(finds('barfıks', 'Pullups')).toBe(true);
    expect(finds('MEKİK', 'Crunches')).toBe(true);
    expect(finds('farmer', 'Farmers_Walk')).toBe(true);
  });

  it('derece: ad başı < ad içinde < eş anlamlı < dağınık kelimeler', () => {
    const t = (s: string) => searchTokens(s);
    expect(searchRank(row('Barbell_Squat'), t('squat'))).toBe(0); // "Squat (barbell)"
    expect(searchRank(row('Goblet_Squat'), t('squat'))).toBe(1);
    expect(searchRank(row('Butterfly'), t('kelebek'))).toBe(2);
    expect(searchRank(row('Front_Dumbbell_Raise'), t('front raise'))).toBe(0); // "Front raise (dambıl)"
    expect(searchRank(row('Front_Dumbbell_Raise'), t('dumbbell front'))).toBe(3);
  });
});

describe('tier filtresi ve sıralama (gerçek veritabanı)', () => {
  let testDb: TestDb;
  let db: Db;
  let all: Exercise[];

  beforeAll(async () => {
    testDb = createTestDb();
    db = testDb.db;
    await seedIfEmpty(db);
    all = await db.select().from(exercises).where(exerciseListCondition({ kind: 'all' }));
  });

  afterAll(() => {
    testDb.close();
  });

  it('varsayılan liste yalnızca core; hiçbir hareket kaybolmuyor', () => {
    const { core, extra } = partitionExercises(all, { search: '', usedIds: new Set() });
    expect(core.length).toBe(coreExerciseIds().length);
    expect(core.length + extra.length).toBe(all.length);
    expect(extra.map((e) => e.id)).toContain('Front_Raise_And_Pullover');
    expect(extra.map((e) => e.id)).toContain('Axle_Deadlift');
    expect(core.map((e) => e.id)).not.toContain('Axle_Deadlift');
  });

  it('liste Türkçe ana ada göre alfabetik', () => {
    const { core } = partitionExercises(all, { search: '', usedIds: new Set() });
    const names = core.map(exerciseDisplayName);
    expect(names).toEqual([...names].sort(new Intl.Collator('tr', { sensitivity: 'base', numeric: true }).compare));
  });

  it('arama: önce core, extra "Diğer" altında, hiç gizlenmez', () => {
    const { core, extra } = partitionExercises(all, { search: 'deadlift', usedIds: new Set() });
    expect(core.map((e) => e.id)).toContain('Barbell_Deadlift');
    expect(extra.map((e) => e.id)).toContain('Axle_Deadlift');
    const items = buildExerciseListItems({ core, extra }, { searching: true, showExtra: false });
    const header = items.findIndex((i) => i.kind === 'otherHeader');
    expect(header).toBe(core.length);
    expect(items.length).toBe(core.length + 1 + extra.length);

    // Yalnızca extra eşleşirse doğrudan gösterilir
    const axle = partitionExercises(all, { search: 'axle', usedIds: new Set() });
    expect(axle.core).toEqual([]);
    expect(buildExerciseListItems(axle, { searching: true, showExtra: false }).every((i) => i.kind === 'exercise')).toBe(true);
  });

  it('arama sıralaması: ada baştan uyan önce', () => {
    const { core } = partitionExercises(all, { search: 'squat', usedIds: new Set() });
    expect(normalizeForSearch(exerciseDisplayName(core[0]!)).startsWith('squat')).toBe(true);
    const ranks = core.map((e) => searchRank(e, ['squat'])!);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('bölge filtresinde güç hareketleri önce', () => {
    const { core } = partitionExercises(
      all.filter((e) => e.primaryMuscles.includes('"quadriceps"') && e.category !== 'cardio'),
      { search: '', usedIds: new Set(), strengthFirst: true }
    );
    const firstOther = core.findIndex((e) => e.category !== 'strength');
    expect(firstOther).toBeGreaterThan(0);
    expect(core.slice(firstOther).every((e) => e.category !== 'strength')).toBe(true);
  });

  it('rutinde, geçmişte ya da kardiyo segmentinde kullanılan extra core gibi görünür', async () => {
    expect(await getUsedExerciseIds(db)).toEqual(new Set());
    await createRoutine(db, { exerciseIds: ['Axle_Deadlift'] });
    const { sessionId } = await createCompletedSession(db, {
      exerciseId: 'Atlas_Stones',
      startedAt: '2026-10-01T10:00:00.000Z',
    });
    await createCardioSegment(db, { sessionId, exerciseId: 'Running_Treadmill' });

    const used = await getUsedExerciseIds(db);
    expect([...used].sort()).toEqual(['Atlas_Stones', 'Axle_Deadlift', 'Running_Treadmill']);
    const { core, extra } = partitionExercises(all, { search: '', usedIds: used });
    for (const id of used) {
      expect(core.map((e) => e.id)).toContain(id);
      expect(extra.map((e) => e.id)).not.toContain(id);
    }
  });

  it('kullanıcının kendi hareketi core', async () => {
    const id = await seedExercise(db, { name: 'Benim makinem', nameTr: null, isCustom: true });
    expect(isCoreFor({ id, isCustom: true }, new Set())).toBe(true);
  });
});

describe('ekrandaki liste', () => {
  const core = ['a', 'b'];
  const extra = ['x', 'y', 'z'];

  it('aramasız: core ve en altta "Diğer egzersizleri göster (N)"', () => {
    expect(buildExerciseListItems({ core, extra }, { searching: false, showExtra: false })).toEqual([
      { kind: 'exercise', exercise: 'a' },
      { kind: 'exercise', exercise: 'b' },
      { kind: 'showOther', count: 3 },
    ]);
    expect(showOtherLabel(704)).toBe('Diğer egzersizleri göster (704)');
  });

  it('açılınca "Diğer" başlığıyla extra', () => {
    const items = buildExerciseListItems({ core, extra }, { searching: false, showExtra: true });
    expect(items[2]).toEqual({ kind: 'otherHeader' });
    expect(items).toHaveLength(6);
  });

  it('extra yoksa bağlantı yok; core yoksa (ör. Esneme) extra doğrudan', () => {
    expect(buildExerciseListItems({ core, extra: [] }, { searching: false, showExtra: false })).toHaveLength(2);
    expect(buildExerciseListItems({ core: [], extra }, { searching: false, showExtra: false })).toEqual(
      extra.map((exercise) => ({ kind: 'exercise', exercise }))
    );
  });
});
