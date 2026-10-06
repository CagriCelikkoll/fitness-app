/**
 * Antrenman takvimi ve haftalık hedef hesapları.
 *
 * Tarihler yerel tarih kurucusuyla kuruluyor; testler hangi saat
 * diliminde çalışırsa çalışsın "yerel gün" mantığı aynı kalmalı.
 *
 * Referans: 1 Ekim 2026 Perşembe, 5 Ekim Pazartesi, 11 Ekim Pazar.
 */

import { describe, expect, it } from 'vitest';

import { toDateKey } from '@/lib/format';
import {
  calendarDayState,
  calendarMonths,
  goalStreak,
  groupSessionsByDay,
  monthGrid,
  weekStartKey,
  workoutDayKeys,
  workoutDaysThisWeek,
} from '@/lib/workoutCalendar';

/** Yerel saatle ISO zaman damgası */
function at(y: number, m: number, d: number, h = 18, min = 0): string {
  return new Date(y, m - 1, d, h, min).toISOString();
}

function day(y: number, m: number, d: number): string {
  return toDateKey(new Date(y, m - 1, d));
}

function finished(startedAt: string) {
  return { startedAt, endedAt: startedAt };
}

/** 7 Ekim 2026 Çarşamba; haftası 5 Ekim Pazartesi */
const NOW = new Date(2026, 9, 7, 12, 0);

describe('antrenman günleri', () => {
  it('aynı gün iki seans tek gün sayılıyor', () => {
    const days = workoutDayKeys([
      finished(at(2026, 10, 5, 8)),
      finished(at(2026, 10, 5, 19)),
    ]);
    expect([...days]).toEqual([day(2026, 10, 5)]);
    expect(workoutDaysThisWeek(days, NOW)).toBe(1);
  });

  it('bitmemiş seans sayılmıyor', () => {
    const days = workoutDayKeys([
      finished(at(2026, 10, 5)),
      { startedAt: at(2026, 10, 6), endedAt: null },
    ]);
    expect([...days]).toEqual([day(2026, 10, 5)]);
  });

  it('Pazar 23:30 ile Pazartesi 00:30 farklı haftalara düşüyor', () => {
    const days = workoutDayKeys([
      finished(at(2026, 10, 11, 23, 30)),
      finished(at(2026, 10, 12, 0, 30)),
    ]);
    const weeks = [...days].map(weekStartKey);
    expect(weeks).toEqual([day(2026, 10, 5), day(2026, 10, 12)]);
  });

  it('gün içi seanslar başlangıç sırasıyla gruplanıyor', () => {
    const late = { id: 'b', ...finished(at(2026, 10, 5, 19)) };
    const early = { id: 'a', ...finished(at(2026, 10, 5, 8)) };
    const byDay = groupSessionsByDay([late, early]);
    expect(byDay.get(day(2026, 10, 5))?.map((s) => s.id)).toEqual(['a', 'b']);
  });
});

describe('ay ızgarası', () => {
  /** Izgaradaki gerçek günler, sırayla */
  const flatDays = (grid: (string | null)[][]) =>
    grid.flat().filter((k): k is string => k != null);

  it('Perşembe başlayan ay: ilk üç hücre boş (Ekim 2026)', () => {
    const grid = monthGrid(2026, 9);
    expect(grid[0].slice(0, 3)).toEqual([null, null, null]);
    expect(grid[0][3]).toBe('2026-10-01');
    expect(grid).toHaveLength(5);
  });

  it('Pazartesi başlayan ay ilk hücreden başlıyor (Haziran 2026)', () => {
    const grid = monthGrid(2026, 5);
    expect(grid[0][0]).toBe('2026-06-01');
    expect(grid).toHaveLength(5);
  });

  it('31 günlük, Pazar başlayan ay 6 haftaya taşıyor (Mart 2026)', () => {
    const grid = monthGrid(2026, 2);
    expect(grid[0][6]).toBe('2026-03-01');
    expect(grid[0].slice(0, 6).every((k) => k == null)).toBe(true);
    expect(grid).toHaveLength(6);
    expect(grid[5][1]).toBe('2026-03-31');
  });

  it('Şubat artık yıl: 29 gün (2024)', () => {
    const days = flatDays(monthGrid(2024, 1));
    expect(days).toHaveLength(29);
    expect(days[days.length - 1]).toBe('2024-02-29');
  });

  it('Şubat normal yıl: 28 gün, Pazartesi başlarsa tam 4 hafta (2021)', () => {
    const grid = monthGrid(2021, 1);
    expect(flatDays(grid)).toHaveLength(28);
    expect(grid).toHaveLength(4);
    expect(grid[0][0]).toBe('2021-02-01');
  });

  it('her hafta 7 hücre, günler sıralı ve eksiksiz', () => {
    const grid = monthGrid(2026, 9);
    expect(grid.every((w) => w.length === 7)).toBe(true);
    const days = flatDays(grid);
    expect(days).toHaveLength(31);
    expect(days[0]).toBe('2026-10-01');
    expect(days[30]).toBe('2026-10-31');
  });

  it('son 3 ay eskiden yeniye, yıl geçişiyle', () => {
    const months = calendarMonths(new Date(2027, 0, 15));
    expect(months.map((m) => `${m.year}-${m.month}`)).toEqual([
      '2026-10',
      '2026-11',
      '2027-0',
    ]);
    expect(months.map((m) => m.label)).toEqual(['Kas', 'Ara', 'Oca']);
  });
});

describe('nokta durumu', () => {
  const workouts = new Set([day(2026, 10, 5)]);
  const today = day(2026, 10, 7);

  it('antrenman / dinlenme / gelecek', () => {
    expect(calendarDayState(day(2026, 10, 5), today, workouts)).toBe('workout');
    expect(calendarDayState(day(2026, 10, 6), today, workouts)).toBe('rest');
    expect(calendarDayState(today, today, workouts)).toBe('rest');
    expect(calendarDayState(day(2026, 10, 8), today, workouts)).toBe('future');
  });
});

describe('seri', () => {
  // Haftalar (Pazartesi): 14 Eyl, 21 Eyl, 28 Eyl, 5 Eki (içinde bulunulan)
  const week = (mondayDay: number, month: number, count: number) =>
    Array.from({ length: count }, (_, i) => day(2026, month, mondayDay + i));

  it('ardışık haftalar sayılıyor', () => {
    const days = [...week(14, 9, 3), ...week(21, 9, 3), ...week(28, 9, 3)];
    expect(goalStreak(days, 3, NOW)).toBe(3);
  });

  it('arada kaçırılan hafta seriyi kesiyor', () => {
    const days = [...week(14, 9, 3), ...week(21, 9, 1), ...week(28, 9, 3)];
    expect(goalStreak(days, 3, NOW)).toBe(1);
  });

  it('içinde bulunulan hafta henüz tutmadıysa seriyi bozmuyor', () => {
    const days = [...week(21, 9, 3), ...week(28, 9, 3), day(2026, 10, 5)];
    expect(goalStreak(days, 3, NOW)).toBe(2);
  });

  it('içinde bulunulan hafta tuttuysa seriye ekleniyor', () => {
    const days = [...week(21, 9, 3), ...week(28, 9, 3), ...week(5, 10, 3)];
    expect(goalStreak(days, 3, NOW)).toBe(3);
  });

  it('hedefin üstü de tutmuş sayılıyor, aynı gün iki seans iki gün sayılmıyor', () => {
    const days = workoutDayKeys([
      finished(at(2026, 9, 28, 8)),
      finished(at(2026, 9, 28, 19)),
      finished(at(2026, 9, 29)),
    ]);
    expect(goalStreak(days, 2, NOW)).toBe(1);
    expect(goalStreak(days, 3, NOW)).toBe(0);
  });

  it('hedef yokken seri yok', () => {
    const days = [...week(28, 9, 3), ...week(5, 10, 3)];
    expect(goalStreak(days, null, NOW)).toBe(0);
  });
});
