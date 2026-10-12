/**
 * Eşitlenen tablolar ve yerel satır ↔ sunucu satırı dönüşümü.
 *
 * Sunucudaki sütun adları SQLite'takiyle aynı (snake_case); Drizzle
 * nesnelerinde camelCase. Eşleme Drizzle'ın sütun tanımlarından
 * türetiliyor, elle liste yok: şemaya sütun eklenirse burası kendiliğinden
 * izler (sunucuya da eklenmesi gerektiğini test/syncServer.test.ts
 * yakalar).
 */

import { getTableColumns } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';

import {
  cardioSegments,
  routineExercises,
  routines,
  sessionExercises,
  sets,
  workoutSessions,
} from '@/db/schema';
import type { ServerRow, SyncTableName } from './types';

export interface SyncTableInfo {
  name: SyncTableName;
  table: SQLiteTable;
  idColumn: SQLiteColumn;
  /** camelCase anahtar → sütun */
  columns: Record<string, SQLiteColumn>;
  /** Ebeveyn bağları: bu sütun → o tablonun id'si (FK) */
  parents: { column: string; table: SyncTableName; nullable: boolean }[];
  /** exercises'a bağlı sütun (yerelde yoksa yer tutucu eklenir) */
  exerciseColumn: string | null;
}

function info(
  name: SyncTableName,
  table: SQLiteTable & { id: SQLiteColumn },
  parents: SyncTableInfo['parents'],
  exerciseColumn: string | null
): SyncTableInfo {
  return {
    name,
    table,
    idColumn: table.id,
    columns: getTableColumns(table) as Record<string, SQLiteColumn>,
    parents,
    exerciseColumn,
  };
}

/** Ebeveynden çocuğa (yazma bu sırayla, silme tersiyle) */
export const SYNC_TABLES: readonly SyncTableInfo[] = [
  info('routines', routines, [], null),
  info('routine_exercises', routineExercises, [
    { column: 'routineId', table: 'routines', nullable: false },
  ], 'exerciseId'),
  info('workout_sessions', workoutSessions, [
    { column: 'routineId', table: 'routines', nullable: true },
  ], null),
  info('session_exercises', sessionExercises, [
    { column: 'sessionId', table: 'workout_sessions', nullable: false },
  ], 'exerciseId'),
  info('cardio_segments', cardioSegments, [
    { column: 'sessionId', table: 'workout_sessions', nullable: false },
  ], 'exerciseId'),
  info('sets', sets, [
    { column: 'sessionExerciseId', table: 'session_exercises', nullable: false },
  ], null),
];

export const SYNC_TABLE_NAMES = SYNC_TABLES.map((t) => t.name);

export function syncTable(name: string): SyncTableInfo | undefined {
  return SYNC_TABLES.find((t) => t.name === name);
}

/**
 * Silme koruması bu tablolarda sayıyor: bir antrenmanı silmek cascade
 * ile onlarca set silme kaydı üretir, bunlar tek silme sayılır.
 */
export const ROOT_TABLES: readonly SyncTableName[] = ['routines', 'workout_sessions'];

/** Drizzle satırı → sunucu satırı (snake_case; id dahil) */
export function toServerRow(t: SyncTableInfo, local: Record<string, unknown>): ServerRow {
  const row: ServerRow = {};
  for (const [key, column] of Object.entries(t.columns)) {
    row[column.name] = local[key] ?? null;
  }
  return row;
}

/** Sunucu satırı → Drizzle insert nesnesi. Bilinmeyen alanlar atılır. */
export function fromServerRow(t: SyncTableInfo, row: ServerRow, id: string): Record<string, unknown> {
  const local: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(t.columns)) {
    const value = row[column.name];
    if (value !== undefined) local[key] = value;
  }
  local.id = id;
  return local;
}
