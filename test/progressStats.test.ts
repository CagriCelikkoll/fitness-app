/**
 * İlerleme ekranı (v4.0a Bölüm 4): Hafta / Ay / Yıl dönemleri, 2×2 kartın
 * değerleri ve karşılaştırması, seçili metriğin çubukları (son 8 hafta /
 * 6 ay / 12 ay), kas başına set çubukları, gerçek SQLite okuması.
 */

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/db/client';
import { workoutSessions } from '@/db/schema';
import {
  chartBuckets,
  durationShort,
  durationSpoken,
  groupThousands,
  loadProgressData,
  metricValue,
  muscleBars,
  percentChange,
  periodRange,
  progressChart,
  progressStats,
  type ProgressData,
} from '@/lib/progressStats';
import { toDateKey } from '@/lib/format';

import { createCompletedSession, createSession, createTestDb, seedExercise, type TestDb } from './helpers/testDb';

// Pazar, 8 Kasım 2026 (yerel)
const NOW = new Date(2026, 10, 8, 18, 0);
const at = (y: number, m: number, d: number, h = 10) => new Date(y, m, d, h).toISOString();

describe('dönemler', () => {
  it('hafta Pazartesi başlar; ay ve yıl takvimden', () => {
    const w = periodRange('week', NOW);
    expect(toDateKey(w.start)).toBe('2026-11-02');
    expect(toDateKey(w.end)).toBe('2026-11-09');
    expect(toDateKey(periodRange('week', NOW, -1).start)).toBe('2026-10-26');
    expect(toDateKey(periodRange('month', NOW).start)).toBe('2026-11-01');
    expect(toDateKey(periodRange('month', NOW, -1).start)).toBe('2026-10-01');
    expect(toDateKey(periodRange('month', new Date(2026, 0, 15), -1).start)).toBe('2025-12-01');
    expect(toDateKey(periodRange('year', NOW).start)).toBe('2026-01-01');
    expect(toDateKey(periodRange('year', NOW, -1).end)).toBe('2026-01-01');
  });

  it('grafik: son 8 hafta / 6 ay / 12 ay, eskiden yeniye, etiketli', () => {
    const weeks = chartBuckets('week', NOW);
    expect(weeks).toHaveLength(8);
    expect(weeks[0]!.label).toBe('14 Eyl');
    expect(weeks[7]!.label).toBe('2 Kas');
    const months = chartBuckets('month', NOW);
    expect(months.map((b) => b.label)).toEqual(['Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas']);
    const year = chartBuckets('year', NOW);
    expect(year).toHaveLength(12);
    expect(year[0]!.label).toBe('Ara');
    expect(year[11]!.label).toBe('Kas');
  });
});

describe('biçim', () => {
  it('binlik ayraç, kısa ve sesli süre', () => {
    expect(groupThousands(72480)).toBe('72.480');
    expect(groupThousands(950.4)).toBe('950');
    expect(groupThousands(1234567)).toBe('1.234.567');
    expect(durationShort(0)).toBe('0 dk');
    expect(durationShort(53 * 60)).toBe('53 dk');
    expect(durationShort(9 * 3600 + 40 * 60)).toBe('9 sa 40');
    expect(durationShort(2 * 3600)).toBe('2 sa');
    expect(durationSpoken(9 * 3600 + 40 * 60)).toBe('9 saat 40 dakika');
    expect(durationSpoken(45 * 60)).toBe('45 dakika');
  });

  it('yüzde değişim; önceki 0 ise yok', () => {
    expect(percentChange(109, 100)?.text).toBe('↑ %9');
    expect(percentChange(95, 100)?.text).toBe('↓ %5');
    expect(percentChange(100, 100)?.text).toBe('= %0');
    expect(percentChange(100, 0)).toBeNull();
  });
});

describe('kartlar ve grafik', () => {
  const data: ProgressData = {
    sessions: [
      // bu hafta: iki gün, aynı gün iki antrenman
      { startedAt: at(2026, 10, 3), durationSeconds: 3600, volume: 5000 },
      { startedAt: at(2026, 10, 5, 9), durationSeconds: 1800, volume: 2000 },
      { startedAt: at(2026, 10, 5, 19), durationSeconds: 1800, volume: 4000 },
      // geçen hafta
      { startedAt: at(2026, 10, 1), durationSeconds: 3000, volume: 10000 },
      { startedAt: at(2026, 9, 27), durationSeconds: 3000, volume: 0 },
      // geçen yıl
      { startedAt: at(2025, 5, 1), durationSeconds: 3000, volume: 8000 },
    ],
    records: [
      { sessionId: 's1', exerciseId: 'a', at: at(2026, 10, 3) },
      { sessionId: 's1', exerciseId: 'a', at: at(2026, 10, 3) }, // aynı hareketin iki seti → 1
      { sessionId: 's1', exerciseId: 'b', at: at(2026, 10, 3) },
      { sessionId: 's0', exerciseId: 'a', at: at(2026, 9, 20) },
    ],
  };

  it('metrik değerleri: hacim, farklı gün, süre, rekor (hareket başına)', () => {
    const week = periodRange('week', NOW);
    expect(metricValue('volume', data, week)).toBe(11000);
    expect(metricValue('workouts', data, week)).toBe(2);
    expect(metricValue('duration', data, week)).toBe(7200);
    expect(metricValue('records', data, week)).toBe(2);
    expect(metricValue('records', data, periodRange('month', NOW, -1))).toBe(1);
  });

  it('hafta kartları: önceki haftayla karşılaştırma, ortalama süre', () => {
    const stats = progressStats(data, 'week', NOW);
    expect(stats.map((s) => s.metric)).toEqual(['volume', 'workouts', 'duration', 'records']);
    expect(stats[0]).toMatchObject({ value: '11.000', unit: 'kg', footnote: '↑ %10 · geçen haftaya göre' });
    expect(stats[0]!.accessibilityLabel).toBe(
      'Toplam hacim bu hafta: 11.000 kilogram, geçen haftaya göre yüzde 10 arttı'
    );
    // geçen hafta da 2 gün (1 Kas Pazar, 27 Eki): fark yok → dönem adı
    expect(stats[1]).toMatchObject({ value: '2', unit: 'gün', footnote: 'bu hafta' });
    expect(progressStats(data, 'month', NOW)[1]).toMatchObject({ value: '3', footnote: '↑ 2 · geçen aya göre' });
    expect(stats[2]).toMatchObject({ value: '2 sa', footnote: 'ort. 40 dk' });
    expect(stats[3]).toMatchObject({ value: '2', footnote: 'bu hafta' });
  });

  it('boş dönem: değişim yok, dönem adı yazıyor', () => {
    const stats = progressStats({ sessions: [], records: [] }, 'month', NOW);
    expect(stats.map((s) => [s.value, s.footnote])).toEqual([
      ['0', 'bu ay'],
      ['0', 'bu ay'],
      ['0 dk', 'bu ay'],
      ['0', 'bu ay'],
    ]);
  });

  it('yıl: takvim yılı, geçen yılla', () => {
    const stats = progressStats(data, 'year', NOW);
    expect(stats[0]).toMatchObject({ value: '21.000', footnote: '↑ %163 · geçen yıla göre' });
  });

  it('grafik: seçili metriğin son 8 haftası; başlık ve eksen biçimi', () => {
    const chart = progressChart(data, 'volume', 'week', NOW);
    expect(chart.title).toBe('Haftalık hacim');
    expect(chart.subtitle).toBe('son 8 hafta');
    expect(chart.bars).toHaveLength(8);
    expect(chart.bars[7]!.value).toBe(11000);
    expect(chart.bars[6]!.value).toBe(10000);
    expect(chart.format(11000)).toBe('11.000 kg');
    const months = progressChart(data, 'workouts', 'month', NOW);
    expect(months.title).toBe('Aylık antrenman');
    expect(months.bars.map((b) => b.value)).toEqual([0, 0, 0, 0, 1, 3]);
    expect(progressChart(data, 'duration', 'year', NOW).subtitle).toBe('son 12 ay');
  });
});

describe('kas başına set', () => {
  it('en çok 6 kas, azalan; üst / alt / nötr; orana göre çubuk', () => {
    const bars = muscleBars({
      chest: 12,
      lats: 14,
      quadriceps: 10,
      shoulders: 6,
      abdominals: 4,
      biceps: 3,
      calves: 2,
      triceps: 0,
    });
    expect(bars.map((b) => b.muscle)).toEqual(['lats', 'chest', 'quadriceps', 'shoulders', 'abdominals', 'biceps']);
    expect(bars.map((b) => b.context)).toEqual(['upper', 'upper', 'lower', 'upper', null, 'upper']);
    expect(bars[0]!.fraction).toBe(1);
    expect(bars[2]!.fraction).toBeCloseTo(10 / 14);
    expect(muscleBars({})).toEqual([]);
  });
});

describe('loadProgressData (gerçek SQLite)', () => {
  let t: TestDb;
  let db: Db;
  beforeEach(() => {
    t = createTestDb();
    db = t.db;
  });
  afterEach(() => t.close());

  it('bitmiş antrenmanlar; hacimde ısınma ve tamamlanmamış set yok; rekor ilk seansta sayılmıyor', async () => {
    const squat = await seedExercise(db, { name: 'Squat', primaryMuscles: '["quadriceps"]' });
    const first = await createCompletedSession(db, {
      exerciseId: squat,
      startedAt: at(2026, 10, 2),
      setSeeds: [{ weightKg: 100, reps: 5 }, { weightKg: 40, reps: 10, setType: 'warmup' }],
    });
    await db.update(workoutSessions).set({ durationSeconds: 3000 }).where(eq(workoutSessions.id, first.sessionId));
    await createCompletedSession(db, {
      exerciseId: squat,
      startedAt: at(2026, 10, 4),
      setSeeds: [{ weightKg: 110, reps: 5 }, { weightKg: 120, reps: 5, isCompleted: false }],
    });
    // bitmemiş antrenman sayılmaz
    await createSession(db, { exerciseId: squat, startedAt: at(2026, 10, 6), setSeeds: [{ weightKg: 200, reps: 5 }] });

    const data = await loadProgressData(db);
    expect(data.sessions).toHaveLength(2);
    const byDay = Object.fromEntries(data.sessions.map((s) => [toDateKey(new Date(s.startedAt)), s]));
    expect(byDay['2026-11-02']).toMatchObject({ volume: 500, durationSeconds: 3000 });
    expect(byDay['2026-11-04']).toMatchObject({ volume: 550 });
    expect(data.records).toHaveLength(1);
    expect(toDateKey(new Date(data.records[0]!.at))).toBe('2026-11-04');

    const stats = progressStats(data, 'week', NOW);
    expect(stats.map((s) => s.value)).toEqual(['1.050', '2', '50 dk', '1']);
  });
});
