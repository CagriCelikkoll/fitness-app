import { useMemo } from 'react';
import { useSQLiteContext } from 'expo-sqlite';

import { getDb, type Db } from '@/db/client';

/**
 * Drizzle client'ını SQLiteProvider'ın db'si üstünde memoize eder.
 *
 * Inline `drizzle(sqliteDb, { schema })` her render'da yeni bir referans
 * üretiyordu; useEffect bağımlılıklarında yer aldığı için gereksiz sorgu
 * tekrarına (ve app/routine/[id].tsx'te form ezilmesine) yol açıyordu.
 */
export function useDb(): Db {
  const sqliteDb = useSQLiteContext();
  return useMemo(() => getDb(sqliteDb), [sqliteDb]);
}
