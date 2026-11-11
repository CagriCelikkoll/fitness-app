/**
 * Egzersiz geçmişi sorguları — ilerleme grafikleri ve rekorlar için.
 *
 * Süzgeç kas haritasıyla aynı: tamamlanmış, normal (ısınma değil) setler,
 * bitmiş seanslar. Hesaplar `src/lib/exerciseProgress.ts`'te.
 *
 * Sorgular join içerdiği için ekranlarda `useLiveQuery` yerine
 * `useFocusEffect` ile okunuyor (canlı sorgu yalnızca FROM tablosunu
 * dinliyor).
 */

import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import {
  exercises,
  sessionExercises,
  sets,
  workoutSessions,
  type Exercise,
} from '@/db/schema';
import {
  buildSessionPoints,
  computeRecords,
  epley,
  recentE1rmTrend,
  type PersonalRecords,
  type SetRow,
  type TrendPoint,
} from '@/lib/exerciseProgress';

/** Sayılan setlerin ortak koşulu */
function countedSetConditions() {
  return [
    isNotNull(workoutSessions.endedAt),
    eq(sets.isCompleted, true),
    eq(sets.setType, 'normal'),
  ];
}

function setHistoryQuery(
  db: Db,
  exerciseId: string,
  excludeSessionId: string | null
) {
  return db
    .select({
      sessionId: workoutSessions.id,
      date: workoutSessions.startedAt,
      weightKg: sets.weightKg,
      reps: sets.reps,
    })
    .from(sets)
    .innerJoin(sessionExercises, eq(sets.sessionExerciseId, sessionExercises.id))
    .innerJoin(workoutSessions, eq(sessionExercises.sessionId, workoutSessions.id))
    .where(
      and(
        eq(sessionExercises.exerciseId, exerciseId),
        ...countedSetConditions(),
        excludeSessionId ? ne(workoutSessions.id, excludeSessionId) : undefined
      )
    )
    .orderBy(asc(workoutSessions.startedAt), asc(sets.setNumber));
}

/** Bir egzersizin tamamlanmış seanslardaki normal setleri (tarihe göre artan) */
export async function getExerciseSetHistory(
  db: Db,
  exerciseId: string
): Promise<SetRow[]> {
  return setHistoryQuery(db, exerciseId, null);
}

/**
 * Mevcut seans hariç en iyi e1RM (rekor kontrolü için). Hiç e1RM
 * hesaplanabilen set yoksa null.
 */
export async function getPreviousBestE1rm(
  db: Db,
  exerciseId: string,
  excludeSessionId: string | null
): Promise<number | null> {
  const rows = await setHistoryQuery(db, exerciseId, excludeSessionId);
  let best: number | null = null;
  for (const row of rows) {
    const e1rm = epley(row.weightKg, row.reps);
    if (e1rm != null && (best == null || e1rm > best)) best = e1rm;
  }
  return best;
}

export interface RecentlyUsedExercise {
  exercise: Exercise;
  /** Bütün sayılan setlerdeki en yüksek ağırlık; ağırlıksızsa null */
  bestWeightKg: number | null;
}

/** Hareketler listesindeki "Son kullandıkların": en son çalışılan önce */
export async function getRecentlyUsedExercises(db: Db, limit: number): Promise<RecentlyUsedExercise[]> {
  const lastDate = sql<string>`max(${workoutSessions.startedAt})`;
  return db
    .select({
      exercise: exercises,
      bestWeightKg: sql<number | null>`max(${sets.weightKg})`,
    })
    .from(sets)
    .innerJoin(sessionExercises, eq(sets.sessionExerciseId, sessionExercises.id))
    .innerJoin(workoutSessions, eq(sessionExercises.sessionId, workoutSessions.id))
    .innerJoin(exercises, eq(sessionExercises.exerciseId, exercises.id))
    .where(and(...countedSetConditions(), eq(exercises.isArchived, false)))
    .groupBy(exercises.id)
    .orderBy(desc(lastDate))
    .limit(limit);
}

export interface RecentExerciseRecords {
  exerciseId: string;
  name: string;
  nameTr: string | null;
  /** Bu egzersizin çalışıldığı son seansın başlangıcı (ISO) */
  lastDate: string;
  records: PersonalRecords;
  /** Son 8 seansın tahmini 1RM'i (trend çizgisi), tarihe göre artan */
  trend: TrendPoint[];
}

/**
 * Son antrenman yapılan `limit` egzersiz (en yenisi önce), rekorları ve
 * e1RM trendi — İlerleme sekmesindeki "Rekorların" kartı için.
 */
export async function getRecentExerciseRecords(
  db: Db,
  limit: number
): Promise<RecentExerciseRecords[]> {
  const lastDate = sql<string>`max(${workoutSessions.startedAt})`;

  const recent = await db
    .select({ exerciseId: sessionExercises.exerciseId, lastDate })
    .from(sets)
    .innerJoin(sessionExercises, eq(sets.sessionExerciseId, sessionExercises.id))
    .innerJoin(workoutSessions, eq(sessionExercises.sessionId, workoutSessions.id))
    .where(and(...countedSetConditions()))
    .groupBy(sessionExercises.exerciseId)
    .orderBy(desc(lastDate))
    .limit(limit);

  if (recent.length === 0) return [];

  const names = await db
    .select({ id: exercises.id, name: exercises.name, nameTr: exercises.nameTr })
    .from(exercises)
    .where(
      inArray(
        exercises.id,
        recent.map((r) => r.exerciseId)
      )
    );
  const nameById = new Map(names.map((n) => [n.id, n]));

  const result: RecentExerciseRecords[] = [];
  for (const r of recent) {
    const history = await getExerciseSetHistory(db, r.exerciseId);
    const exercise = nameById.get(r.exerciseId);
    const points = buildSessionPoints(history);
    result.push({
      exerciseId: r.exerciseId,
      name: exercise?.name ?? '',
      nameTr: exercise?.nameTr ?? null,
      lastDate: r.lastDate,
      records: computeRecords(points),
      trend: recentE1rmTrend(points),
    });
  }
  return result;
}
