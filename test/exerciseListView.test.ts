import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';

import { getRecentlyUsedExercises } from '@/lib/exerciseHistory';
import {
  EXERCISE_DETAIL_TABS,
  exerciseDetailSubtitle,
  exerciseListTitle,
  exerciseRowSubtitle,
  recentBestLabel,
  showRecentExercises,
} from '@/lib/exerciseListView';
import { EXERCISE_IMAGE_SURFACE } from '@/theme';
import { createCompletedSession, createSession, createTestDb, seedExercise, type TestDb } from './helpers/testDb';

const read = (path: string) => readFileSync(path, 'utf8');

const bench = { id: 'x', name: 'Barbell Bench Press', nameTr: 'Bench press', primaryMuscles: '["chest"]', category: 'strength' };

describe('hareket listesi metinleri', () => {
  it('satır: İngilizce ad · ilk kas grubu', () => {
    expect(exerciseRowSubtitle(bench)).toBe('Barbell Bench Press · Göğüs');
    expect(exerciseRowSubtitle({ ...bench, primaryMuscles: '["chest","triceps"]' })).toBe('Barbell Bench Press · Göğüs');
  });

  it('Türkçe adı yoksa İngilizce ad iki kez yazılmaz', () => {
    expect(exerciseRowSubtitle({ ...bench, nameTr: null })).toBe('Göğüs');
  });

  it('kası olmayan harekette kategori', () => {
    expect(exerciseRowSubtitle({ ...bench, primaryMuscles: null, category: 'cardio' })).toBe('Barbell Bench Press · Kardiyo');
  });

  it('bölüm başlığı', () => {
    expect(exerciseListTitle('Tümü', false, 181)).toBe('Tümü · 181');
    expect(exerciseListTitle('Göğüs', false, 23)).toBe('Göğüs · 23');
    expect(exerciseListTitle('Göğüs', true, 5)).toBe('Sonuçlar · 5');
  });

  it('son kullandıkların yalnızca süzülmemiş listede', () => {
    expect(showRecentExercises('all', '')).toBe(true);
    expect(showRecentExercises('all', '  ')).toBe(true);
    expect(showRecentExercises('all', 'bench')).toBe(false);
    expect(showRecentExercises('chest', '')).toBe(false);
  });

  it('en iyi kilo', () => {
    expect(recentBestLabel(80)).toBe('80 kg');
    expect(recentBestLabel(102.25)).toBe('102,25 kg');
    expect(recentBestLabel(0)).toBeNull();
    expect(recentBestLabel(null)).toBeNull();
  });

  it('detay alt satırı', () => {
    expect(exerciseDetailSubtitle({ ...bench, equipment: null })).toBe('Barbell Bench Press');
    expect(exerciseDetailSubtitle({ ...bench, nameTr: null, equipment: null })).toBeNull();
  });

  it('sekmeler spec sırasında', () => {
    expect(EXERCISE_DETAIL_TABS.map((t) => t.label)).toEqual(['Nasıl yapılır', 'Gelişim', 'Geçmiş']);
  });
});

describe('son kullanılan hareketler', () => {
  let testDb: TestDb;
  beforeEach(() => {
    testDb = createTestDb();
  });

  it('en son çalışılan önce, en iyi kilo bütün geçmişten', async () => {
    const { db } = testDb;
    const a = await seedExercise(db, { id: 'a', name: 'A' });
    const b = await seedExercise(db, { id: 'b', name: 'B' });
    await createCompletedSession(db, { exerciseId: a, startedAt: '2026-01-01T10:00:00.000Z', setSeeds: [{ weightKg: 100 }] });
    await createCompletedSession(db, { exerciseId: b, startedAt: '2026-01-02T10:00:00.000Z', setSeeds: [{ weightKg: 40 }] });
    await createCompletedSession(db, { exerciseId: a, startedAt: '2026-01-03T10:00:00.000Z', setSeeds: [{ weightKg: 70 }] });
    const rows = await getRecentlyUsedExercises(db, 3);
    expect(rows.map((r) => [r.exercise.id, r.bestWeightKg])).toEqual([['a', 100], ['b', 40]]);
  });

  it('limit uygulanır', async () => {
    const { db } = testDb;
    for (const [i, id] of ['a', 'b', 'c', 'd'].entries()) {
      await seedExercise(db, { id, name: id });
      await createCompletedSession(db, { exerciseId: id, startedAt: `2026-01-0${i + 1}T10:00:00.000Z`, setSeeds: [{}] });
    }
    expect((await getRecentlyUsedExercises(db, 3)).map((r) => r.exercise.id)).toEqual(['d', 'c', 'b']);
  });

  it('bitmemiş antrenman, ısınma ve tamamlanmamış set sayılmaz', async () => {
    const { db } = testDb;
    const a = await seedExercise(db, { id: 'a', name: 'A' });
    const b = await seedExercise(db, { id: 'b', name: 'B' });
    const c = await seedExercise(db, { id: 'c', name: 'C' });
    await createSession(db, { exerciseId: a, startedAt: '2026-01-01T10:00:00.000Z', setSeeds: [{}] });
    await createCompletedSession(db, { exerciseId: b, startedAt: '2026-01-01T10:00:00.000Z', setSeeds: [{ setType: 'warmup' }] });
    await createCompletedSession(db, { exerciseId: c, startedAt: '2026-01-01T10:00:00.000Z', setSeeds: [{ isCompleted: false }] });
    expect(await getRecentlyUsedExercises(db, 3)).toEqual([]);
  });

  it('ağırlıksız hareket listede kalır, kilosu yok', async () => {
    const { db } = testDb;
    const a = await seedExercise(db, { id: 'a', name: 'A' });
    await createCompletedSession(db, { exerciseId: a, startedAt: '2026-01-01T10:00:00.000Z', setSeeds: [{ weightKg: null }] });
    const rows = await getRecentlyUsedExercises(db, 3);
    expect(rows[0]!.exercise.id).toBe('a');
    expect(rows[0]!.bestWeightKg).toBeNull();
  });
});

describe('ekranlar', () => {
  it('liste: başlık, arama, son kullanılanlar, sayaç; yığın ekranında geri', () => {
    const list = read('app/(tabs)/exercises.tsx');
    expect(list).toContain('<ScreenTitle>Hareketler</ScreenTitle>');
    expect(list).toContain('placeholder="Ara: front raise, lat çekiş…"');
    expect(list).toContain('Son kullandıkların');
    expect(list).toContain('exerciseListTitle(');
    expect(read('app/exercise/index.tsx')).toContain('<ExercisesList showBack />');
  });

  it('detay: mevcut içerik sekmelerde duruyor', () => {
    const detail = read('app/exercise/[id].tsx');
    for (const part of ['<ExerciseHowTo', '<ExerciseQuickInfo', '<ExerciseMuscles', '<ExerciseGrowthTab', '<ExerciseHistoryTab']) {
      expect(detail, part).toContain(part);
    }
    expect(detail).toContain('<ExerciseImages urls={imageUrls} light />');
    expect(detail).toContain('active color={color}');
    const content = read('src/components/ExerciseDetailContent.tsx');
    expect(content).toContain('youtubeSearchUrl(exercise.name)');
    expect(content).toContain('Orijinalini göster');
  });

  it('Gelişim: üç kart ve grafik', () => {
    const progress = read('src/components/ExerciseProgress.tsx');
    for (const label of ['label="Tahmini 1RM"', 'label="En ağır"', 'label="Hacim"', '<LineChart']) {
      expect(progress, label).toContain(label);
    }
  });

  it('seçici ve odak paneli tek parça içeriği kullanmaya devam ediyor', () => {
    for (const file of ['src/components/ExercisePickerModal.tsx', 'src/components/FocusSheet.tsx']) {
      expect(read(file), file).toContain('<ExerciseDetailContent exercise={exercise} />');
    }
  });

  it('görsel zemini iki temada açık', () => {
    expect(EXERCISE_IMAGE_SURFACE).toBe('#F2F1EC');
  });
});
