/**
 * Test veritabanı kurulumu.
 *
 * Gerçek SQLite'a karşı çalışıyoruz (mock yok): her test kendi bellek içi
 * veritabanını kuruyor, şema `drizzle/0000_initial.sql`'den uygulanıyor —
 * şemanın tek kaynağı migration dosyası kalsın diye.
 *
 * `PRAGMA foreign_keys = ON` uygulamadaki gibi açılıyor; kapalı olsaydı
 * cascade/restrict testleri sessizce "geçerdi".
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sql } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

import * as schema from '@/db/schema';
import type { Db } from '@/db/client';
import {
  cardioSegments,
  exercises,
  routineExercises,
  routines,
  sessionExercises,
  sets,
  workoutSessions,
} from '@/db/schema';

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const MIGRATION_PATH = path.join(PROJECT_ROOT, 'drizzle', '0000_initial.sql');

export interface TestDb {
  /**
   * Uygulama kodunun beklediği `Db` tipi. Sürücü farklı (better-sqlite3 vs
   * expo-sqlite) ama Drizzle sorgu API'si aynı; `Db` tanımını gevşetmemek
   * için cast burada, tek yerde duruyor.
   */
  db: Db;
  /** Ham better-sqlite3 bağlantısı — pragma kontrolü, raw SQL için */
  sqlite: Database.Database;
  close(): void;
}

/** Bellek içi DB kurar, migration uygular, FK açar, drizzle döndürür */
export function createTestDb(): TestDb {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');

  // `--> statement-breakpoint` yalnızca bir yorum; exec çoklu ifadeyi
  // zaten birlikte çalıştırıyor, ayrıştırmaya gerek yok.
  sqlite.exec(readFileSync(MIGRATION_PATH, 'utf8'));

  const drizzleDb = drizzle(sqlite, { schema });
  patchAsyncTransaction(drizzleDb, sqlite);

  return {
    db: drizzleDb as unknown as Db,
    sqlite,
    close: () => sqlite.close(),
  };
}

/**
 * better-sqlite3 sürücüsü senkron: `db.transaction(async tx => ...)`
 * çağrısı "Transaction function cannot return a promise" hatasıyla
 * patlıyor. Uygulamanın kullandığı expo-sqlite sürücüsü ise asenkron ve
 * bu kalıbı destekliyor — `src/lib/backup.ts` buna göre yazılmış.
 *
 * Bu yüzden test sürücüsünde `transaction`'ı üretimdeki davranışa uyacak
 * şekilde ham BEGIN / COMMIT / ROLLBACK ile sarıyoruz. Uygulama kodu
 * değişmiyor ve testler gerçek transaction semantiği görüyor (callback
 * hata atarsa rollback).
 */
function patchAsyncTransaction(
  drizzleDb: ReturnType<typeof drizzle>,
  sqlite: Database.Database
): void {
  Object.defineProperty(drizzleDb, 'transaction', {
    value: async (callback: (tx: unknown) => unknown) => {
      sqlite.exec('BEGIN');
      try {
        const result = await callback(drizzleDb);
        sqlite.exec('COMMIT');
        return result;
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    },
    writable: true,
    configurable: true,
  });
}

// ============================================================================
// Test verisi yardımcıları — her testte 20 satırlık kurulum tekrar etmesin
// ============================================================================

let seq = 0;

/** Test içinde okunabilir, çakışmayan id */
function testId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

export async function seedExercise(
  db: Db,
  overrides: Partial<typeof exercises.$inferInsert> = {}
): Promise<string> {
  const id = overrides.id ?? testId('ex');
  await db.insert(exercises).values({
    name: 'Bench Press',
    nameTr: 'Bench Press',
    primaryMuscles: '["chest"]',
    category: 'strength',
    ...overrides,
    id,
  });
  return id;
}

export async function createRoutine(
  db: Db,
  options: {
    name?: string;
    exerciseIds?: string[];
    restSeconds?: number;
  } = {}
): Promise<{ routineId: string; routineExerciseIds: string[] }> {
  const routineId = testId('routine');
  await db
    .insert(routines)
    .values({ id: routineId, name: options.name ?? 'Push Günü' });

  const routineExerciseIds: string[] = [];
  const exerciseIds = options.exerciseIds ?? [];
  for (let i = 0; i < exerciseIds.length; i += 1) {
    const id = testId('re');
    await db.insert(routineExercises).values({
      id,
      routineId,
      exerciseId: exerciseIds[i]!,
      orderIndex: i,
      targetSets: 3,
      targetReps: '10',
      restSeconds: options.restSeconds ?? 90,
    });
    routineExerciseIds.push(id);
  }

  return { routineId, routineExerciseIds };
}

export interface SetSeed {
  reps?: number;
  /** null: vücut ağırlığı hareketi (verilmezse 60) */
  weightKg?: number | null;
  isCompleted?: boolean;
  setType?: string;
}

export interface SessionHandles {
  sessionId: string;
  sessionExerciseId: string;
  setIds: string[];
}

/**
 * Tek egzersizli bir seans kurar.
 *
 * `endedAt` verilmezse seans bitmemiş sayılır — auto-fill'in bitmemiş
 * seansı yok saydığını test edebilmek için.
 */
export async function createSession(
  db: Db,
  options: {
    exerciseId: string;
    startedAt: string;
    endedAt?: string | null;
    routineId?: string | null;
    setSeeds?: SetSeed[];
  }
): Promise<SessionHandles> {
  const sessionId = testId('session');
  await db.insert(workoutSessions).values({
    id: sessionId,
    routineId: options.routineId ?? null,
    name: 'Antrenman',
    startedAt: options.startedAt,
    endedAt: options.endedAt ?? null,
  });

  const sessionExerciseId = testId('se');
  await db.insert(sessionExercises).values({
    id: sessionExerciseId,
    sessionId,
    exerciseId: options.exerciseId,
    orderIndex: 0,
  });

  const setIds: string[] = [];
  const setSeeds = options.setSeeds ?? [];
  for (let i = 0; i < setSeeds.length; i += 1) {
    const seed = setSeeds[i]!;
    const id = testId('set');
    await db.insert(sets).values({
      id,
      sessionExerciseId,
      setNumber: i + 1,
      setType: seed.setType ?? 'normal',
      reps: seed.reps ?? 10,
      weightKg: seed.weightKg === undefined ? 60 : seed.weightKg,
      isCompleted: seed.isCompleted ?? true,
    });
    setIds.push(id);
  }

  return { sessionId, sessionExerciseId, setIds };
}

/** Bitmiş seans — `createSession`'ın en sık kullanılan hali */
export async function createCompletedSession(
  db: Db,
  options: {
    exerciseId: string;
    startedAt: string;
    routineId?: string | null;
    setSeeds?: SetSeed[];
  }
): Promise<SessionHandles> {
  const started = new Date(options.startedAt);
  return createSession(db, {
    ...options,
    endedAt: new Date(started.getTime() + 60 * 60 * 1000).toISOString(),
  });
}

export async function createCardioSegment(
  db: Db,
  options: { sessionId: string; exerciseId: string }
): Promise<string> {
  const id = testId('cardio');
  await db.insert(cardioSegments).values({
    id,
    sessionId: options.sessionId,
    exerciseId: options.exerciseId,
    orderIndex: 0,
    durationSeconds: 1200,
  });
  return id;
}

/** Tablodaki satır sayısı */
export async function countRows(db: Db, table: SQLiteTable): Promise<number> {
  const rows = await db.select({ n: sql<number>`count(*)` }).from(table);
  return Number(rows[0]?.n ?? 0);
}
