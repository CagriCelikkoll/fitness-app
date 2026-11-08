/**
 * Ana sayfa "Bugün" (v4.0a Bölüm 3): haftalık hedef ve gün şeridi,
 * "Sıradaki" rutin seçimi, kart satırı, haftalık hacim, son rekor.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/db/client';
import { routines, workoutSessions } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { muscleLabel } from '@/lib/exerciseTaxonomy';
import {
  lastDoneText,
  latestRecord,
  loadTodayData,
  pickNextRoutine,
  routineColor,
  routineMinutes,
  routineSummaryLine,
  streakChipText,
  todayHeading,
  topMuscles,
  weekStrip,
  weekSummaryLabel,
  weekVolumePair,
  type RecordHistoryRow,
  type RoutineCandidate,
} from '@/lib/today';
import { createCompletedSession, createRoutine, createTestDb, seedExercise, type TestDb } from './helpers/testDb';

// Cumartesi, 7 Kasım 2026 (yerel)
const NOW = new Date(2026, 10, 7, 18, 30);

describe('tarih ve haftalık şerit', () => {
  it('başlık: "Cumartesi, 7 Kasım"', () => {
    expect(todayHeading(NOW)).toBe('Cumartesi, 7 Kasım');
    expect(todayHeading(new Date(2026, 10, 9))).toBe('Pazartesi, 9 Kasım');
    expect(todayHeading(new Date(2026, 0, 4))).toBe('Pazar, 4 Ocak');
  });

  it('Pt…Pz, yapılan günler dolu, bugün işaretli', () => {
    const strip = weekStrip(new Set(['2026-11-02', '2026-11-04', '2026-10-30']), NOW);
    expect(strip.map((d) => d.short)).toEqual(['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz']);
    expect(strip.map((d) => d.key)).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
    ]);
    expect(strip.map((d) => d.done)).toEqual([true, false, true, false, false, false, false]);
    expect(strip.filter((d) => d.today).map((d) => d.short)).toEqual(['Ct']);
  });

  it('Pazar günü hafta hâlâ Pazartesi’den başlar', () => {
    const strip = weekStrip(new Set(), new Date(2026, 10, 8, 23, 0));
    expect(strip[0]!.key).toBe('2026-11-02');
    expect(strip[6]!.today).toBe(true);
  });

  it('ekran okuyucu özeti', () => {
    const strip = weekStrip(new Set(['2026-11-02', '2026-11-04']), NOW);
    expect(weekSummaryLabel(strip, 2, 4)).toBe(
      'Bu hafta 2 / 4 antrenman. Pazartesi ve Çarşamba antrenman yapıldı. Bugün Cumartesi.'
    );
    expect(weekSummaryLabel(weekStrip(new Set(), NOW), 0, null)).toBe('Bu hafta 0 antrenman. Bugün Cumartesi.');
  });

  it('seri çipi: seri yoksa çip yok', () => {
    expect(streakChipText(0)).toBeNull();
    expect(streakChipText(1)).toBeNull();
    expect(streakChipText(3)).toBe('3 haftalık seri');
  });
});

describe('"Sıradaki" rutin seçimi', () => {
  const r = (id: string, lastDoneAt: string | null, createdAt = '2026-01-01 00:00:00'): RoutineCandidate => ({
    id,
    name: id,
    createdAt,
    lastDoneAt,
  });

  it('rutin yoksa null (kart "Programını seç")', () => {
    expect(pickNextRoutine([])).toBeNull();
  });

  it('program yoksa en uzun süredir yapılmayan', () => {
    const list = [r('A', '2026-11-05T10:00:00Z'), r('B', '2026-11-01T10:00:00Z'), r('C', '2026-11-03T10:00:00Z')];
    expect(pickNextRoutine(list)).toEqual({ routineId: 'B', dayLabel: null });
  });

  it('hiç yapılmamış rutin önce; aralarında eklenme sırası', () => {
    const list = [
      r('A', '2026-10-01T10:00:00Z'),
      r('Yeni2', null, '2026-11-02 10:00:00'),
      r('Yeni1', null, '2026-11-01 10:00:00'),
    ];
    expect(pickNextRoutine(list)?.routineId).toBe('Yeni1');
  });

  it('programdaki sıradaki gün: en son yapılan günden sonraki', () => {
    const list = [r('D1', '2026-11-02T10:00:00Z'), r('D2', '2026-11-04T10:00:00Z'), r('D3', null), r('D4', null), r('X', null)];
    const links = [
      { routineId: 'D3', programId: 'P', dayIndex: 2 },
      { routineId: 'D1', programId: 'P', dayIndex: 0 },
      { routineId: 'D2', programId: 'P', dayIndex: 1 },
      { routineId: 'D4', programId: 'P', dayIndex: 3 },
    ];
    // X hiç yapılmamış olsa da program önce
    expect(pickNextRoutine(list, links)).toEqual({ routineId: 'D3', dayLabel: 'Gün 3 / 4' });
  });

  it('son gün yapıldıysa başa döner; hiçbiri yapılmadıysa ilk gün', () => {
    const links = [
      { routineId: 'D1', programId: 'P', dayIndex: 0 },
      { routineId: 'D2', programId: 'P', dayIndex: 1 },
    ];
    expect(pickNextRoutine([r('D1', '2026-11-01T10:00:00Z'), r('D2', '2026-11-03T10:00:00Z')], links)).toEqual({
      routineId: 'D1',
      dayLabel: 'Gün 1 / 2',
    });
    expect(pickNextRoutine([r('D1', null), r('D2', null)], links)).toEqual({ routineId: 'D1', dayLabel: 'Gün 1 / 2' });
  });

  it('silinmiş rutinin bağı sayılmaz; birden çok programda en son çalışılan', () => {
    const list = [r('A1', '2026-10-01T10:00:00Z'), r('B1', '2026-11-05T10:00:00Z'), r('B2', null)];
    const links = [
      { routineId: 'A1', programId: 'A', dayIndex: 0 },
      { routineId: 'A2-silindi', programId: 'A', dayIndex: 1 },
      { routineId: 'B1', programId: 'B', dayIndex: 0 },
      { routineId: 'B2', programId: 'B', dayIndex: 1 },
    ];
    expect(pickNextRoutine(list, links)).toEqual({ routineId: 'B2', dayLabel: 'Gün 2 / 2' });
    // Yalnızca silinmiş rutinlerin bağı varsa program yok sayılır
    expect(pickNextRoutine([r('Z', null)], [{ routineId: 'yok', programId: 'P', dayIndex: 0 }])).toEqual({
      routineId: 'Z',
      dayLabel: null,
    });
  });
});

describe('rutin kartı satırı', () => {
  const ex = (muscles: string[], targetSets: number | null = 3, restSeconds = 90, category = 'strength') => ({
    targetSets,
    restSeconds,
    primaryMuscles: JSON.stringify(muscles),
    category,
  });

  it('süre: elle girilen varsa o; yoksa ısınma + setler × (40 sn + dinlenme), 5’e yuvarlı', () => {
    const list = [ex(['chest'], 3, 90), ex(['triceps'], 3, 60)];
    // 300 + 3×130 + 3×100 = 990 sn = 16,5 dk → 15
    expect(routineMinutes(list)).toBe(15);
    expect(routineMinutes(list, 50)).toBe(50);
    // hedef set yoksa 3 set açılıyor
    expect(routineMinutes([ex(['chest'], null, 90)])).toBe(routineMinutes([ex(['chest'], 3, 90)]));
  });

  it('en çok set düşen 3 ana kas, kardiyo hariç', () => {
    const list = [
      ex(['hamstrings', 'glutes'], 4),
      ex(['lats'], 3),
      ex(['quadriceps'], 1),
      ex(['hamstrings'], 3),
      ex(['quadriceps'], 0, 0, 'cardio'),
    ];
    expect(topMuscles(list)).toEqual([muscleLabel('hamstrings'), muscleLabel('lats'), muscleLabel('glutes')]);
  });

  it('"7 hareket · ~55 dk · …"', () => {
    const list = [ex(['chest'], 4, 120), ex(['shoulders'], 3, 90)];
    expect(routineSummaryLine(list)).toBe(`2 hareket · ~20 dk · ${muscleLabel('chest')}, ${muscleLabel('shoulders')}`);
  });

  it('bağlam rengi kaslardan', () => {
    expect(routineColor([ex(['quadriceps'], 4), ex(['hamstrings'], 3)])).toBe('lower');
    expect(routineColor([ex(['chest'], 4), ex(['lats'], 3)])).toBe('upper');
  });

  it('"son: 4 gün önce" takvim günüyle', () => {
    expect(lastDoneText(null, NOW)).toBeNull();
    expect(lastDoneText(new Date(2026, 10, 3, 23, 50).toISOString(), NOW)).toBe('son: 4 gün önce');
    expect(lastDoneText(new Date(2026, 10, 6, 23, 0).toISOString(), NOW)).toBe('son: dün');
    expect(lastDoneText(new Date(2026, 10, 7, 8, 0).toISOString(), NOW)).toBe('son: bugün');
  });
});

describe('haftalık hacim', () => {
  it('bu hafta / geçen hafta ve değişim', () => {
    const rows = [
      { date: new Date(2026, 10, 2, 10).toISOString(), volume: 10000 },
      { date: new Date(2026, 10, 4, 10).toISOString(), volume: 1200 },
      { date: new Date(2026, 9, 27, 10).toISOString(), volume: 10000 },
      { date: new Date(2026, 9, 20, 10).toISOString(), volume: 99999 }, // iki hafta önce
    ];
    expect(weekVolumePair(rows, NOW)).toEqual({ thisWeek: 11200, lastWeek: 10000, change: '+%12' });
    expect(weekVolumePair([{ date: new Date(2026, 9, 27).toISOString(), volume: 100 }], NOW).change).toBe('−%100');
    expect(weekVolumePair([], NOW)).toEqual({ thisWeek: 0, lastWeek: 0, change: null });
  });
});

describe('son rekor', () => {
  let n = 0;
  const row = (
    sessionId: string,
    startedAt: string,
    exerciseId: string,
    weightKg: number,
    reps: number,
    setType = 'normal'
  ): RecordHistoryRow => ({
    id: `s${n++}`,
    setNumber: 1,
    setType,
    weightKg,
    reps,
    isCompleted: true,
    completedAt: null,
    exerciseId,
    exerciseName: exerciseId,
    sessionId,
    sessionStartedAt: startedAt,
  });

  it('ilk seans rekor değil; sonra kırılan en yeni rekor', () => {
    const rows = [
      row('1', '2026-10-01', 'Bench', 70, 5),
      row('2', '2026-10-08', 'Bench', 75, 5), // rekor
      row('3', '2026-10-15', 'Bench', 72.5, 5), // değil
      row('3', '2026-10-15', 'Squat', 100, 5), // ilk kez
    ];
    expect(latestRecord(rows)).toEqual({ exerciseName: 'Bench', weightKg: 75, reps: 5, at: '2026-10-08' });
  });

  it('aynı seansta birden çok rekor: e1RM’i en büyük', () => {
    const rows = [
      row('1', '2026-10-01', 'Bench', 70, 5),
      row('1', '2026-10-01', 'Squat', 100, 5),
      row('2', '2026-10-08', 'Bench', 72.5, 5),
      row('2', '2026-10-08', 'Squat', 110, 5),
    ];
    expect(latestRecord(rows)?.exerciseName).toBe('Squat');
  });

  it('hiç rekor yoksa null', () => {
    expect(latestRecord([])).toBeNull();
    expect(latestRecord([row('1', '2026-10-01', 'Bench', 70, 5), row('2', '2026-10-08', 'Bench', 70, 5)])).toBeNull();
  });
});

describe('loadTodayData (gerçek SQLite)', () => {
  let t: TestDb;
  let db: Db;
  beforeEach(() => {
    t = createTestDb();
    db = t.db;
  });
  afterEach(() => t.close());

  it('rutin yoksa kart yok; hacim ve rekor boş', async () => {
    const data = await loadTodayData(db, NOW);
    expect(data).toEqual({ next: null, volume: { thisWeek: 0, lastWeek: 0, change: null }, record: null });
  });

  it('en uzun süredir yapılmayan rutin, kart satırı, hacim ve rekor', async () => {
    const squat = await seedExercise(db, { name: 'Squat', nameTr: 'Squat', primaryMuscles: '["quadriceps"]' });
    const bench = await seedExercise(db, { name: 'Bench Press', nameTr: 'Bench Press' });
    const legs = await createRoutine(db, { name: 'Bacak', exerciseIds: [squat] });
    const push = await createRoutine(db, { name: 'İtiş', exerciseIds: [bench] });
    await createRoutine(db, { name: 'Boş', exerciseIds: [] });

    await createCompletedSession(db, {
      exerciseId: bench,
      routineId: push.routineId,
      startedAt: new Date(2026, 10, 2, 10).toISOString(),
      setSeeds: [{ weightKg: 60, reps: 10 }],
    });
    await createCompletedSession(db, {
      exerciseId: squat,
      routineId: legs.routineId,
      startedAt: new Date(2026, 10, 4, 10).toISOString(),
      setSeeds: [{ weightKg: 100, reps: 5 }, { weightKg: 40, reps: 10, setType: 'warmup' }],
    });
    await createCompletedSession(db, {
      exerciseId: bench,
      routineId: push.routineId,
      startedAt: new Date(2026, 10, 6, 10).toISOString(),
      setSeeds: [{ weightKg: 65, reps: 10 }, { weightKg: 70, reps: 8, isCompleted: false }],
    });

    const data = await loadTodayData(db, NOW);
    expect(data.next).toMatchObject({
      routineId: legs.routineId,
      name: 'Bacak',
      dayLabel: null,
      lastDone: 'son: 3 gün önce',
      color: 'lower',
    });
    expect(data.next!.line).toBe(`1 hareket · ~10 dk · ${muscleLabel('quadriceps')}`);
    // ısınma ve tamamlanmamış set hacme girmez
    expect(data.volume.thisWeek).toBe(600 + 500 + 650);
    expect(data.record).toMatchObject({ exerciseName: 'Bench Press', weightKg: 65, reps: 10 });
  });

  it('program bağı varsa sıradaki gün; arşivli rutin aday değil', async () => {
    const bench = await seedExercise(db);
    const d1 = await createRoutine(db, { name: 'Gün A', exerciseIds: [bench] });
    const d2 = await createRoutine(db, { name: 'Gün B', exerciseIds: [bench] });
    const old = await createRoutine(db, { name: 'Eski', exerciseIds: [bench] });
    await db.update(routines).set({ isArchived: true }).where(eq(routines.id, old.routineId));
    await createCompletedSession(db, {
      exerciseId: bench,
      routineId: d1.routineId,
      startedAt: new Date(2026, 10, 5, 10).toISOString(),
    });
    // bitmemiş antrenman "yapıldı" sayılmaz
    await db.insert(workoutSessions).values({
      id: 'open',
      routineId: d2.routineId,
      name: 'Gün B',
      startedAt: new Date(2026, 10, 7, 10).toISOString(),
    });

    const links = [
      { routineId: d1.routineId, programId: 'P', dayIndex: 0 },
      { routineId: d2.routineId, programId: 'P', dayIndex: 1 },
    ];
    expect((await loadTodayData(db, NOW, links)).next).toMatchObject({ routineId: d2.routineId, dayLabel: 'Gün 2 / 2' });
    // bağsız: en uzun süredir yapılmayan (hiç yapılmamış Gün B); arşivli Eski değil
    expect((await loadTodayData(db, NOW)).next?.routineId).toBe(d2.routineId);
  });
});
