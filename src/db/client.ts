import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import * as schema from './schema';

export const DATABASE_NAME = 'fitness.db';

/**
 * Drizzle client'ı useSQLiteContext'in döndürdüğü db üstüne kurarız.
 * Bu sayede expo-sqlite'ın SQLiteProvider'ını ve change listener'larını
 * kullanmaya devam edebiliriz (useLiveQuery için kritik).
 */
export function getDb(sqliteDb: SQLiteDatabase) {
  return drizzle(sqliteDb, { schema, logger: __DEV__ });
}

export type Db = ReturnType<typeof getDb>;

/**
 * Provider dışında (ör. seed scriptlerinde, migration kodunda) kullanmak için
 * doğrudan bir db açmak gerekirse:
 */
export function openDb() {
  const expoDb = openDatabaseSync(DATABASE_NAME, { enableChangeListener: true });
  return drizzle(expoDb, { schema, logger: __DEV__ });
}
