/**
 * Eşitleme testlerinin ortak yardımcıları: "telefon" (gerçek SQLite,
 * migration'lar uygulanmış, iki hazır egzersiz), antrenman kurma,
 * eşitlenen tabloların karşılaştırılması.
 *
 * Telefonlar `closePhones()` ile kapatılır (afterEach).
 */

import { and, asc, eq } from 'drizzle-orm';
import { expect } from 'vitest';

import type { Db } from '@/db/client';
import { exercises, routineExercises, routines, sessionExercises, sets, syncOutbox } from '@/db/schema';
import { buildBackup } from '@/lib/backup';
import { finishSessionRecord } from '@/lib/finishSession';
import { newId } from '@/lib/id';
import { createSessionFromRoutine } from '@/lib/startSession';
import { runSync } from '@/lib/sync/engine';

import type { FakeSyncServer } from './fakeSyncServer';
import { createTestDb, type TestDb } from './testDb';

export const A = 'user-a';
export const B = 'user-b';
export const EX = ['Barbell_Squat', 'Barbell_Bench_Press_-_Medium_Grip'];

const opened: TestDb[] = [];

export function closePhones(): void {
  while (opened.length > 0) opened.pop()!.close();
}

export async function phone(): Promise<TestDb> {
  const t = createTestDb();
  opened.push(t);
  await t.db
    .insert(exercises)
    .values(EX.map((id) => ({ id, name: id, primaryMuscles: '[]', category: 'strength' })));
  return t;
}

export const sync = (
  t: TestDb,
  server: FakeSyncServer,
  userId = A,
  confirmDeletes = false,
  pullPageSize?: number
) => runSync({ db: t.db, transport: server.transport(userId), userId, confirmDeletes, pullPageSize });

export async function expectOk(p: ReturnType<typeof sync>) {
  const r = await p;
  expect(r).toMatchObject({ status: 'ok' });
  return r;
}

export async function newRoutine(db: Db, name = 'İtme', exerciseCount = 2): Promise<string> {
  const id = newId();
  await db.insert(routines).values({ id, name });
  await db.insert(routineExercises).values(
    Array.from({ length: exerciseCount }, (_, i) => ({
      id: newId(),
      routineId: id,
      exerciseId: EX[i % EX.length],
      orderIndex: i,
      targetSets: 2,
    }))
  );
  return id;
}

/** Başlat, ilk seti tamamla, bitir (boş setler silinir) */
export async function workout(db: Db, routineId: string, finish = true): Promise<string> {
  const sessionId = (await createSessionFromRoutine(db, { id: routineId, name: 'Antrenman' }))!;
  const ses = await db
    .select()
    .from(sessionExercises)
    .where(eq(sessionExercises.sessionId, sessionId))
    .orderBy(asc(sessionExercises.orderIndex));
  const first = await db
    .select()
    .from(sets)
    .where(eq(sets.sessionExerciseId, ses[0].id))
    .orderBy(asc(sets.setNumber));
  await db
    .update(sets)
    .set({ weightKg: 60, reps: 8, isCompleted: true, completedAt: new Date().toISOString() })
    .where(eq(sets.id, first[0].id));
  if (finish) {
    await finishSessionRecord(db, {
      sessionId,
      sessionExerciseIds: ses.map((s) => s.id),
      pendingFilledIds: [],
      mode: 'delete',
    });
  }
  return sessionId;
}

/** Eşitlenen tabloların içeriği, karşılaştırma için */
export async function synced(db: Db) {
  const { tables } = await buildBackup(db);
  const sortById = (rows: unknown[]) =>
    [...(rows as { id: string }[])].sort((a, b) => a.id.localeCompare(b.id));
  return {
    routines: sortById(tables.routines),
    routineExercises: sortById(tables.routineExercises),
    workoutSessions: sortById(tables.workoutSessions),
    sessionExercises: sortById(tables.sessionExercises),
    sets: sortById(tables.sets),
    cardioSegments: sortById(tables.cardioSegments),
  };
}

type Row = Record<string, unknown>;

/** Bitmemiş antrenmanların ağacı çıkarılmış hali (onlar gönderilmiyor) */
export function withoutSessions(data: Awaited<ReturnType<typeof synced>>, sessionIds: Set<string>) {
  const rows = (list: unknown[]) => list as Row[];
  const inOpen = (r: Row, key: string) => sessionIds.has(r[key] as string);
  const seIds = new Set(
    rows(data.sessionExercises)
      .filter((s) => inOpen(s, 'sessionId'))
      .map((s) => s.id as string)
  );
  return {
    ...data,
    workoutSessions: rows(data.workoutSessions).filter((s) => !inOpen(s, 'id')),
    sessionExercises: rows(data.sessionExercises).filter((s) => !inOpen(s, 'sessionId')),
    sets: rows(data.sets).filter((s) => !seIds.has(s.sessionExerciseId as string)),
    cardioSegments: rows(data.cardioSegments).filter((s) => !inOpen(s, 'sessionId')),
  };
}

export const outboxCount = async (db: Db) => (await db.select().from(syncOutbox)).length;

/** Telefon saatini kaydır: giden kutusundaki kayıtların zamanı */
export async function shiftOutboxClock(db: Db, ms: number) {
  const rows = await db.select().from(syncOutbox);
  for (const r of rows) {
    await db
      .update(syncOutbox)
      .set({ changedAt: new Date(Date.parse(r.changedAt) + ms).toISOString() })
      .where(and(eq(syncOutbox.tableName, r.tableName), eq(syncOutbox.rowId, r.rowId)));
  }
}
