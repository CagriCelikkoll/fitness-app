/**
 * Haftalık hacim — hafta gruplaması (saf) ve sorgu (gerçek SQLite).
 *
 * Tarihler yerel saat kurucusuyla (new Date(y, m, d, h, min)) yazılıyor;
 * test hangi saat diliminde koşarsa koşsun aynı sonucu versin.
 * 2026-09-21 Pazartesi, 2026-09-25 Cuma.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/db/client';
import {
  getWeeklyVolume,
  groupWeeklyVolume,
  startOfWeek,
  WEEKLY_VOLUME_WEEKS,
} from '@/lib/weeklyVolume';
import {
  createCompletedSession,
  createSession,
  createTestDb,
  seedExercise,
  type TestDb,
} from './helpers/testDb';

const NOW = new Date(2026, 8, 25, 12, 0); // Cuma

function local(y: number, m: number, d: number, h = 10, min = 0): string {
  return new Date(y, m - 1, d, h, min).toISOString();
}

describe('startOfWeek', () => {
  it('haftanın Pazartesi 00:00\'ı (yerel)', () => {
    const monday = startOfWeek(NOW);
    expect(monday.getDay()).toBe(1);
    expect([monday.getDate(), monday.getHours(), monday.getMinutes()]).toEqual([
      21, 0, 0,
    ]);
  });

  it('Pazar bir önceki Pazartesi\'ye, Pazartesi kendisine bağlanıyor', () => {
    expect(startOfWeek(new Date(2026, 8, 20, 23, 30)).getDate()).toBe(14);
    expect(startOfWeek(new Date(2026, 8, 21, 0, 30)).getDate()).toBe(21);
  });
});

describe('groupWeeklyVolume', () => {
  it('tam 12 hafta, eskiden yeniye, son hafta içinde bulunulan', () => {
    const weeks = groupWeeklyVolume([], NOW);
    expect(weeks).toHaveLength(WEEKLY_VOLUME_WEEKS);
    expect(weeks[11]).toEqual({
      weekStart: '2026-09-21',
      volume: 0,
      isCurrent: true,
    });
    expect(weeks[0]!.weekStart).toBe('2026-07-06');
    expect(weeks.filter((w) => w.isCurrent)).toHaveLength(1);
  });

  it('Pazar 23:30 o haftaya, Pazartesi 00:30 bir sonrakine düşüyor', () => {
    const weeks = groupWeeklyVolume(
      [
        { date: local(2026, 9, 20, 23, 30), volume: 1000 },
        { date: local(2026, 9, 21, 0, 30), volume: 500 },
      ],
      NOW
    );
    const byKey = new Map(weeks.map((w) => [w.weekStart, w.volume]));
    expect(byKey.get('2026-09-14')).toBe(1000);
    expect(byKey.get('2026-09-21')).toBe(500);
  });

  it('aynı haftadaki seanslar toplanıyor, boş haftalar 0 kalıyor', () => {
    const weeks = groupWeeklyVolume(
      [
        { date: local(2026, 9, 1), volume: 1000 },
        { date: local(2026, 9, 3), volume: 250 },
        { date: local(2026, 9, 22), volume: 400 },
      ],
      NOW
    );
    const byKey = new Map(weeks.map((w) => [w.weekStart, w.volume]));
    expect(byKey.get('2026-08-31')).toBe(1250);
    expect(byKey.get('2026-09-07')).toBe(0);
    expect(byKey.get('2026-09-14')).toBe(0);
    expect(byKey.get('2026-09-21')).toBe(400);
  });

  it('12 haftadan eski seanslar dahil edilmiyor', () => {
    const weeks = groupWeeklyVolume(
      [
        { date: local(2026, 7, 5, 23, 0), volume: 9999 }, // pencereden bir gün önce
        { date: local(2026, 7, 6, 8, 0), volume: 100 }, // pencerenin ilk günü
      ],
      NOW
    );
    expect(weeks.reduce((sum, w) => sum + w.volume, 0)).toBe(100);
    expect(weeks[0]!.volume).toBe(100);
  });
});

describe('getWeeklyVolume (SQLite)', () => {
  let testDb: TestDb;
  let db: Db;

  beforeEach(() => {
    testDb = createTestDb();
    db = testDb.db;
  });

  afterEach(() => {
    testDb.close();
  });

  it('ısınma, tamamlanmamış set ve bitmemiş seans sayılmıyor', async () => {
    const exerciseId = await seedExercise(db);
    await createCompletedSession(db, {
      exerciseId,
      startedAt: local(2026, 9, 22),
      setSeeds: [
        { reps: 10, weightKg: 100 }, // 1000
        { reps: 10, weightKg: 40, setType: 'warmup' },
        { reps: 5, weightKg: 100, isCompleted: false },
      ],
    });
    await createSession(db, {
      exerciseId,
      startedAt: local(2026, 9, 23),
      endedAt: null,
      setSeeds: [{ reps: 10, weightKg: 200 }],
    });

    const weeks = await getWeeklyVolume(db, NOW);

    expect(weeks[11]!.volume).toBe(1000);
    expect(weeks.reduce((sum, w) => sum + w.volume, 0)).toBe(1000);
  });

  it('ağırlıksız set 0 sayılıyor, diğer setler toplanıyor', async () => {
    const exerciseId = await seedExercise(db);
    await createCompletedSession(db, {
      exerciseId,
      startedAt: local(2026, 9, 15),
      setSeeds: [
        { reps: 12, weightKg: null },
        { reps: 5, weightKg: 80 }, // 400
      ],
    });

    const weeks = await getWeeklyVolume(db, NOW);
    const byKey = new Map(weeks.map((w) => [w.weekStart, w.volume]));
    expect(byKey.get('2026-09-14')).toBe(400);
  });

  it('hiç veri yoksa 12 hafta, hepsi 0', async () => {
    const weeks = await getWeeklyVolume(db, NOW);
    expect(weeks).toHaveLength(12);
    expect(weeks.every((w) => w.volume === 0)).toBe(true);
  });
});
