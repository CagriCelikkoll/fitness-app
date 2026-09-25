/**
 * Haftalık toplam hacim — İlerleme sekmesindeki çubuk grafik.
 *
 * Hafta Pazartesi başlıyor ve yerel saatle hesaplanıyor: Pazar 23:30'daki
 * seans o haftaya, Pazartesi 00:30'daki bir sonrakine düşer. Seansın
 * haftası başlangıç zamanına (startedAt) göre.
 *
 * Süzgeç v1.3 ile aynı: tamamlanmış, normal setler, bitmiş seanslar.
 * Ağırlığı olmayan setler hacme 0 katıyor.
 */

import { and, eq, gte, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { sessionExercises, sets, workoutSessions } from '@/db/schema';
import { toDateKey } from '@/lib/format';

/** Grafikteki hafta sayısı */
export const WEEKLY_VOLUME_WEEKS = 12;

/** Yerel saate göre, verilen günün haftasının Pazartesi 00:00'ı */
export function startOfWeek(date: Date): Date {
  const daysSinceMonday = (date.getDay() + 6) % 7;
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() - daysSinceMonday
  );
}

/**
 * Pencerenin ilk haftasının Pazartesi 00:00'ı. Gün ekleme/çıkarma yerel
 * tarih kurucusuyla — yaz saati geçişinde 7 × 24 saat kaymasın.
 */
export function weeklyVolumeWindowStart(
  now: Date,
  weeks: number = WEEKLY_VOLUME_WEEKS
): Date {
  const current = startOfWeek(now);
  return new Date(
    current.getFullYear(),
    current.getMonth(),
    current.getDate() - 7 * (weeks - 1)
  );
}

/** "2026-09-21" → yerel 21 Eylül 00:00 (new Date('YYYY-MM-DD') UTC olurdu) */
export function dateKeyToLocalDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export interface SessionVolume {
  /** Seans başlangıcı (ISO) */
  date: string;
  volume: number;
}

export interface WeekVolume {
  /** Haftanın Pazartesi'si, "2026-09-21" */
  weekStart: string;
  volume: number;
  /** İçinde bulunulan (henüz bitmemiş) hafta */
  isCurrent: boolean;
}

/**
 * Seans hacimlerini Pazartesi başlangıçlı haftalara toplar. Eskiden
 * yeniye tam `weeks` hafta döner; boş haftalar 0, pencere dışındaki
 * seanslar yok sayılır.
 */
export function groupWeeklyVolume(
  rows: SessionVolume[],
  now: Date,
  weeks: number = WEEKLY_VOLUME_WEEKS
): WeekVolume[] {
  const first = weeklyVolumeWindowStart(now, weeks);
  const result: WeekVolume[] = [];
  const index = new Map<string, WeekVolume>();

  for (let i = 0; i < weeks; i += 1) {
    const weekStart = toDateKey(
      new Date(first.getFullYear(), first.getMonth(), first.getDate() + 7 * i)
    );
    const week = { weekStart, volume: 0, isCurrent: i === weeks - 1 };
    result.push(week);
    index.set(weekStart, week);
  }

  for (const row of rows) {
    const key = toDateKey(startOfWeek(new Date(row.date)));
    const week = index.get(key);
    if (week) week.volume += Number(row.volume) || 0;
  }

  return result;
}

/** `since` (ISO) sonrasında başlamış, bitmiş seansların toplam hacmi */
export function sessionVolumesQuery(db: Db, since: string) {
  return db
    .select({
      date: workoutSessions.startedAt,
      volume: sql<number>`coalesce(sum(${sets.reps} * ${sets.weightKg}), 0)`,
    })
    .from(sets)
    .innerJoin(sessionExercises, eq(sets.sessionExerciseId, sessionExercises.id))
    .innerJoin(workoutSessions, eq(sessionExercises.sessionId, workoutSessions.id))
    .where(
      and(
        isNotNull(workoutSessions.endedAt),
        gte(workoutSessions.startedAt, since),
        eq(sets.isCompleted, true),
        eq(sets.setType, 'normal')
      )
    )
    .groupBy(workoutSessions.id);
}

/** Son `weeks` haftanın toplam hacmi, eskiden yeniye */
export async function getWeeklyVolume(
  db: Db,
  now: Date,
  weeks: number = WEEKLY_VOLUME_WEEKS
): Promise<WeekVolume[]> {
  const since = weeklyVolumeWindowStart(now, weeks).toISOString();
  const rows = await sessionVolumesQuery(db, since);
  return groupWeeklyVolume(rows, now, weeks);
}
