/**
 * Ana sayfadaki antrenman takvimi ve haftalık hedef hesapları.
 *
 * Antrenman günü: bitmiş seansın (endedAt dolu) başlangıç günü, yerel
 * saatle. Gün sayılır, seans değil: aynı gün iki antrenman hedefte tek
 * gün. Hafta Pazartesi başlar; hafta mantığı `weeklyVolume.ts`'ten.
 */

import { SHORT_MONTHS_TR, toDateKey } from '@/lib/format';
import { dateKeyToLocalDate, startOfWeek } from '@/lib/weeklyVolume';

/** Takvimde gösterilen ay sayısı (önceki aylar + bu ay) */
export const CALENDAR_MONTHS = 3;

interface SessionLike {
  startedAt: string;
  endedAt: string | null;
}

/** Seansın yerel saate göre başlangıç günü, "2026-10-12" */
export function sessionDayKey(startedAt: string): string {
  return toDateKey(new Date(startedAt));
}

/** Bitmiş seansları güne göre gruplar; gün içinde başlangıç sırasıyla */
export function groupSessionsByDay<T extends SessionLike>(
  sessions: T[]
): Map<string, T[]> {
  const byDay = new Map<string, T[]>();
  const finished = sessions
    .filter((s) => s.endedAt != null)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  for (const s of finished) {
    const key = sessionDayKey(s.startedAt);
    const list = byDay.get(key);
    if (list) list.push(s);
    else byDay.set(key, [s]);
  }
  return byDay;
}

/** Antrenman yapılmış günler (bitmiş seanslar) */
export function workoutDayKeys(sessions: SessionLike[]): Set<string> {
  return new Set(groupSessionsByDay(sessions).keys());
}

/** Günün haftasının Pazartesi'si, "2026-10-12" */
export function weekStartKey(dayKey: string): string {
  return toDateKey(startOfWeek(dateKeyToLocalDate(dayKey)));
}

/** Hafta (Pazartesi anahtarı) → o haftadaki antrenman günü sayısı */
export function workoutDaysPerWeek(dayKeys: Iterable<string>): Map<string, number> {
  const perWeek = new Map<string, number>();
  for (const day of dayKeys) {
    const week = weekStartKey(day);
    perWeek.set(week, (perWeek.get(week) ?? 0) + 1);
  }
  return perWeek;
}

/** İçinde bulunulan haftadaki antrenman günü sayısı */
export function workoutDaysThisWeek(dayKeys: Iterable<string>, now: Date): number {
  return workoutDaysPerWeek(dayKeys).get(toDateKey(startOfWeek(now))) ?? 0;
}

/**
 * Hedefin üst üste tutturulduğu hafta sayısı.
 *
 * İçinde bulunulan hafta seriyi bozmaz: tutturulduysa eklenir, henüz
 * tutturulmadıysa nötr. Geçmiş haftalar bu haftadan geriye doğru, ilk
 * kaçırılan haftaya kadar sayılır. Hedef geçmişi tutulmadığı için hesap
 * mevcut hedefle geriye dönük yapılıyor.
 */
export function goalStreak(
  dayKeys: Iterable<string>,
  goal: number | null,
  now: Date
): number {
  if (goal == null) return 0;
  const perWeek = workoutDaysPerWeek(dayKeys);

  const current = startOfWeek(now);
  let streak = (perWeek.get(toDateKey(current)) ?? 0) >= goal ? 1 : 0;

  // Gün ekleme/çıkarma yerel tarih kurucusuyla — yaz saati geçişinde kaymasın
  let week = new Date(current.getFullYear(), current.getMonth(), current.getDate() - 7);
  while ((perWeek.get(toDateKey(week)) ?? 0) >= goal) {
    streak += 1;
    week = new Date(week.getFullYear(), week.getMonth(), week.getDate() - 7);
  }
  return streak;
}

/**
 * Ayın takvim ızgarası: dış dizi haftalar (sütunlar), iç dizi Pazartesi →
 * Pazar (satırlar). Ay dışındaki hücreler null.
 *
 * @param month 0-11
 */
export function monthGrid(year: number, month: number): (string | null)[][] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // Pazartesi = 0
  const days = new Date(year, month + 1, 0).getDate();
  const weekCount = Math.ceil((offset + days) / 7);

  const weeks: (string | null)[][] = [];
  for (let w = 0; w < weekCount; w += 1) {
    const week: (string | null)[] = [];
    for (let d = 0; d < 7; d += 1) {
      const day = w * 7 + d - offset + 1;
      week.push(day >= 1 && day <= days ? toDateKey(new Date(year, month, day)) : null);
    }
    weeks.push(week);
  }
  return weeks;
}

export interface CalendarMonth {
  year: number;
  /** 0-11 */
  month: number;
  /** "Eki" */
  label: string;
  weeks: (string | null)[][];
}

/** Bu ay dahil son `count` ay, eskiden yeniye */
export function calendarMonths(now: Date, count: number = CALENDAR_MONTHS): CalendarMonth[] {
  const months: CalendarMonth[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = d.getMonth();
    months.push({
      year,
      month,
      label: SHORT_MONTHS_TR[month],
      weeks: monthGrid(year, month),
    });
  }
  return months;
}

export type CalendarDayState = 'workout' | 'rest' | 'future';

/** Noktanın durumu; "bugün" ayrıca çerçeveyle gösteriliyor */
export function calendarDayState(
  dayKey: string,
  todayKey: string,
  workoutDays: Set<string>
): CalendarDayState {
  if (workoutDays.has(dayKey)) return 'workout';
  // "YYYY-MM-DD" sözlük sırası tarih sırasıyla aynı
  return dayKey > todayKey ? 'future' : 'rest';
}
