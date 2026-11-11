/**
 * Kırılan rekorların geçmişi (v4.0a) — ana sayfa "Son rekor" ve İlerleme
 * "Rekor" kartı aynı kuralı kullanır.
 *
 * Seanslar kronolojik yürünür; her hareketin önceki seanslardaki en iyi
 * e1RM'i baz alınır (`findSessionRecordSetIds`, antrenman ekranındaki rozetle
 * aynı kural; hareketin ilk seansı rekor sayılmaz). Yalnızca bitmiş
 * antrenmanların tamamlanmış normal setleri.
 */

import { and, eq, isNotNull } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { exercises, sessionExercises, sets, workoutSessions } from '@/db/schema';
import { exerciseDisplayName } from '@/lib/exerciseCatalog';
import { epley, findSessionRecordSetIds, type SessionSet } from '@/lib/exerciseProgress';
import { formatDecimal } from '@/lib/format';

export interface RecordHistoryRow extends SessionSet {
  exerciseId: string;
  exerciseName: string;
  sessionId: string;
  sessionStartedAt: string;
}

export interface RecordSet {
  weightKg: number;
  reps: number;
  e1rm: number;
}

/** Rekor kıran bir set */
export interface RecordEvent extends RecordSet {
  sessionId: string;
  /** Seans başlangıcı (ISO) */
  at: string;
  exerciseId: string;
  exerciseName: string;
  /** Bu seanstan önceki en iyi set */
  previous: RecordSet;
}

/** Seans sırasıyla, her seansta rekor kıran setler */
export function recordEvents(rows: readonly RecordHistoryRow[]): RecordEvent[] {
  const sessionsInOrder = new Map<string, { startedAt: string; byExercise: Map<string, RecordHistoryRow[]> }>();
  const sortedRows = [...rows].sort((a, b) =>
    a.sessionStartedAt === b.sessionStartedAt ? 0 : a.sessionStartedAt < b.sessionStartedAt ? -1 : 1
  );
  for (const r of sortedRows) {
    let s = sessionsInOrder.get(r.sessionId);
    if (!s) {
      s = { startedAt: r.sessionStartedAt, byExercise: new Map() };
      sessionsInOrder.set(r.sessionId, s);
    }
    const list = s.byExercise.get(r.exerciseId) ?? [];
    list.push(r);
    s.byExercise.set(r.exerciseId, list);
  }

  const best = new Map<string, RecordSet>();
  const events: RecordEvent[] = [];
  for (const [sessionId, s] of sessionsInOrder) {
    for (const [exerciseId, list] of s.byExercise) {
      const prev = best.get(exerciseId) ?? null;
      const ids = findSessionRecordSetIds(list, prev?.e1rm ?? null);
      for (const r of list) {
        if (!ids.has(r.id) || prev == null) continue;
        events.push({
          sessionId,
          at: s.startedAt,
          exerciseId,
          exerciseName: r.exerciseName,
          weightKg: r.weightKg!,
          reps: r.reps!,
          e1rm: epley(r.weightKg, r.reps)!,
          previous: prev,
        });
      }
      let top = prev;
      for (const r of list) {
        if (!r.isCompleted || r.setType !== 'normal') continue;
        const e = epley(r.weightKg, r.reps);
        if (e != null && (top == null || e > top.e1rm)) top = { weightKg: r.weightKg!, reps: r.reps!, e1rm: e };
      }
      if (top != null) best.set(exerciseId, top);
    }
  }
  return events;
}

/** Antrenman sonundaki rekor sayfası (v4.0b Bölüm 7) */
export interface RecordPageData extends RecordSet {
  exerciseName: string;
  previous: RecordSet;
  /** En büyüğü dışında kaç harekette daha rekor var */
  moreCount: number;
}

/**
 * Bu seansın rekor sayfası; rekor yoksa null (sayfa çıkmaz). Bir harekette
 * birkaç set rekor kırdıysa o hareketin en iyisi sayılır; en büyük e1RM
 * gösterilir (özet ekranındaki sırayla aynı).
 */
export function sessionRecordPage(events: readonly RecordEvent[], sessionId: string): RecordPageData | null {
  const byExercise = new Map<string, RecordEvent>();
  for (const e of events) {
    if (e.sessionId !== sessionId) continue;
    const current = byExercise.get(e.exerciseId);
    if (!current || e.e1rm > current.e1rm) byExercise.set(e.exerciseId, e);
  }
  const ranked = [...byExercise.values()].sort((a, b) => b.e1rm - a.e1rm);
  const top = ranked[0];
  if (!top) return null;
  return {
    exerciseName: top.exerciseName,
    weightKg: top.weightKg,
    reps: top.reps,
    e1rm: top.e1rm,
    previous: top.previous,
    moreCount: ranked.length - 1,
  };
}

export async function loadSessionRecordPage(db: Db, sessionId: string): Promise<RecordPageData | null> {
  return sessionRecordPage(recordEvents(await loadRecordHistory(db)), sessionId);
}

/** "77,5 × 5" */
export function recordSetText(set: Pick<RecordSet, 'weightKg' | 'reps'>): string {
  return `${formatDecimal(set.weightKg, 2)} × ${set.reps}`;
}

/** Dev yazı iki renkli: ["80 kg ", "× 5"] */
export function recordHeadlineParts(set: Pick<RecordSet, 'weightKg' | 'reps'>): [weight: string, reps: string] {
  return [`${formatDecimal(set.weightKg, 2)} kg `, `× ${set.reps}`];
}

/** "+2,9"; tek ondalıkta fark görünmüyorsa null */
export function recordE1rmGain(page: Pick<RecordPageData, 'e1rm' | 'previous'>): string | null {
  const gain = Math.round((page.e1rm - page.previous.e1rm) * 10) / 10;
  return gain > 0 ? `+${formatDecimal(gain)}` : null;
}

/** "+2 rekor daha"; tek rekorsa null */
export function recordMoreText(moreCount: number): string | null {
  return moreCount > 0 ? `+${moreCount} rekor daha` : null;
}

/** Bütün bitmiş antrenmanların tamamlanmış normal setleri (Türkçe adla) */
export async function loadRecordHistory(db: Db): Promise<RecordHistoryRow[]> {
  const rows = await db
    .select({
      id: sets.id,
      setNumber: sets.setNumber,
      setType: sets.setType,
      weightKg: sets.weightKg,
      reps: sets.reps,
      isCompleted: sets.isCompleted,
      completedAt: sets.completedAt,
      exerciseId: exercises.id,
      name: exercises.name,
      nameTr: exercises.nameTr,
      sessionId: workoutSessions.id,
      sessionStartedAt: workoutSessions.startedAt,
    })
    .from(sets)
    .innerJoin(sessionExercises, eq(sets.sessionExerciseId, sessionExercises.id))
    .innerJoin(workoutSessions, eq(sessionExercises.sessionId, workoutSessions.id))
    .innerJoin(exercises, eq(sessionExercises.exerciseId, exercises.id))
    .where(and(isNotNull(workoutSessions.endedAt), eq(sets.isCompleted, true), eq(sets.setType, 'normal')));
  return rows.map(({ name, nameTr, ...r }) => ({
    ...r,
    exerciseName: exerciseDisplayName({ id: r.exerciseId, name, nameTr }),
  }));
}
